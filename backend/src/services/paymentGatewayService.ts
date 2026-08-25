import { PrismaClient } from '@prisma/client'
import { StripeService } from './stripeService'
import { PayPalService } from './paypalService'
import { FiatCryptoService } from './fiatCryptoService'
import {
  PaymentGateway,
  PaymentType,
  PaymentStatus,
  RefundStatus,
  RefundReason,
  CreatePaymentIntent,
  PaymentResult,
  RefundPayment,
  RefundResult,
  PaymentMethodResult,
} from '../types/payment'
import { createModuleLogger } from '../utils/logger'
import { notificationService } from './notificationService'

const logger = createModuleLogger('PaymentGatewayService')

const prisma = new PrismaClient()

export class PaymentGatewayService {
  private stripeService: StripeService
  private payPalService: PayPalService
  private fiatCryptoService: FiatCryptoService

  constructor() {
    this.stripeService = new StripeService()
    this.payPalService = new PayPalService()
    this.fiatCryptoService = new FiatCryptoService()
  }

  /**
   * Create a payment intent with the specified gateway
   */
  async createPayment(params: CreatePaymentIntent): Promise<PaymentResult> {
    try {
      // Get exchange rate and calculate crypto amount
      const exchangeRate = await this.fiatCryptoService.getExchangeRate(
        params.currency,
        'XLM'
      )

      const cryptoAmount = await this.fiatCryptoService.convertFiatToCrypto(
        params.amount,
        params.currency,
        'XLM'
      )

      // Create payment record in database
      const payment = await prisma.payment.create({
        data: {
          userId: params.userId,
          gateway: params.gateway,
          type: PaymentType.DEPOSIT,
          fiatAmount: BigInt(params.amount),
          fiatCurrency: params.currency,
          cryptoAmount: BigInt(Math.floor(cryptoAmount * 10000000)), // Convert to stroops
          cryptoCurrency: 'XLM',
          exchangeRate: exchangeRate.rate,
          status: PaymentStatus.PENDING,
          description: params.description,
          metadata: params.metadata || {},
        },
      })

      // Create payment intent with the selected gateway
      let result: PaymentResult

      if (params.gateway === PaymentGateway.STRIPE) {
        result = await this.stripeService.createPaymentIntent(params)
      } else if (params.gateway === PaymentGateway.PAYPAL) {
        result = await this.payPalService.createOrder(params)
      } else {
        throw new Error(`Unsupported payment gateway: ${params.gateway}`)
      }

      // Update payment record with gateway payment ID
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          gatewayPaymentId: result.gatewayPaymentId,
          status: result.status,
        },
      })

      logger.info('Payment created', {
        paymentId: payment.id,
        gateway: params.gateway,
        amount: params.amount,
        userId: params.userId,
      })

      return {
        ...result,
        paymentId: payment.id,
      }
    } catch (error: any) {
      logger.error('Failed to create payment', {
        error: error.message,
        userId: params.userId,
        gateway: params.gateway,
      })
      throw error
    }
  }

  /**
   * Confirm payment completion (called by webhooks).
   *
   * `gateway` + `eventId` identify the specific webhook delivery (Stripe's
   * `event.id`, PayPal's `event.id`, etc.), not the payment itself. Payment
   * providers document at-least-once delivery as a guarantee, so the same
   * event can arrive more than once. The dedup record is inserted inside
   * the same transaction as the payment update: if another delivery of the
   * same event already committed that insert, the unique constraint makes
   * this insert fail and we skip the side effects below instead of applying
   * them twice — a plain "check payment.status first" read would leave a
   * gap for two concurrent deliveries to both pass the check.
   */
  async confirmPayment(
    gatewayPaymentId: string,
    gateway: PaymentGateway,
    eventId: string,
    metadata?: any
  ): Promise<void> {
    try {
      const payment = await prisma.$transaction(async (tx) => {
        const payment = await tx.payment.findFirst({
          where: { gatewayPaymentId },
        })

        if (!payment) {
          throw new Error('Payment not found')
        }

        try {
          await tx.processedPaymentWebhookEvent.create({
            data: { gateway, eventId },
          })
        } catch (err: any) {
          if (err.code === 'P2002') {
            return null
          }
          throw err
        }

        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.COMPLETED,
            completedAt: new Date(),
            metadata: metadata || payment.metadata,
          },
        })

        return payment
      })

      if (!payment) {
        logger.info('Duplicate payment webhook event skipped', {
          gatewayPaymentId,
          gateway,
          eventId,
        })
        return
      }

      // Notify user
      await notificationService.sendToUser(payment.userId, {
        type: 'payment_completed',
        title: 'Payment Successful',
        message: `Your payment of ${(Number(payment.fiatAmount) / 100).toFixed(2)} ${payment.fiatCurrency} has been processed successfully.`,
        metadata: { paymentId: payment.id },
      })

      logger.info('Payment confirmed', {
        paymentId: payment.id,
        gatewayPaymentId,
        eventId,
      })
    } catch (error: any) {
      logger.error('Failed to confirm payment', {
        error: error.message,
        gatewayPaymentId,
        eventId,
      })
      throw error
    }
  }

  /**
   * Process a refund
   */
  async processRefund(params: RefundPayment): Promise<RefundResult> {
    try {
      const payment = await prisma.payment.findUnique({
        where: { id: params.paymentId },
      })

      if (!payment) {
        throw new Error('Payment not found')
      }

      if (payment.status !== PaymentStatus.COMPLETED) {
        throw new Error('Only completed payments can be refunded')
      }

      const refundAmount = params.amount || Number(payment.fiatAmount)

      // Process refund with gateway
      let result: RefundResult

      if (payment.gateway === PaymentGateway.STRIPE) {
        result = await this.stripeService.refundPayment(
          payment.gatewayPaymentId!,
          refundAmount,
          params.reason
        )
      } else if (payment.gateway === PaymentGateway.PAYPAL) {
        // For PayPal, we need the capture ID from the order
        const captureId = this.extractPayPalCaptureId(payment.gatewayPaymentId!)
        result = await this.payPalService.refundPayment(
          captureId,
          refundAmount,
          params.reason
        )
      } else {
        throw new Error(`Unsupported payment gateway: ${payment.gateway}`)
      }

      // Create refund record in database
      const refund = await prisma.paymentRefund.create({
        data: {
          paymentId: payment.id,
          userId: payment.userId,
          gateway: payment.gateway,
          amount: BigInt(refundAmount),
          currency: payment.fiatCurrency,
          status: result.status,
          reason: params.reason,
          gatewayRefundId: result.gatewayRefundId,
          metadata: {},
        },
      })

      // Update payment refund tracking
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          refundedAmount: (payment.refundedAmount || BigInt(0)) + BigInt(refundAmount),
          refundCount: payment.refundCount + 1,
          status: refundAmount >= Number(payment.fiatAmount)
            ? PaymentStatus.REFUNDED
            : payment.status,
        },
      })

      // Notify user
      await notificationService.sendToUser(payment.userId, {
        type: 'refund_processed',
        title: 'Refund Processed',
        message: `Your refund of ${(refundAmount / 100).toFixed(2)} ${payment.fiatCurrency} has been initiated.`,
        metadata: { refundId: refund.id, paymentId: payment.id },
      })

      logger.info('Refund processed', {
        refundId: refund.id,
        paymentId: payment.id,
        amount: refundAmount,
      })

      return {
        ...result,
        refundId: refund.id,
      }
    } catch (error: any) {
      logger.error('Failed to process refund', {
        error: error.message,
        paymentId: params.paymentId,
      })
      throw error
    }
  }

  /**
   * Save a payment method for future use
   */
  async savePaymentMethod(
    userId: string,
    gateway: PaymentGateway,
    paymentMethodId: string,
    email?: string,
    name?: string
  ): Promise<PaymentMethodResult> {
    try {
      let gatewayCustomerId: string
      let cardDetails: any = {}

      if (gateway === PaymentGateway.STRIPE) {
        // Create or get Stripe customer
        gatewayCustomerId = await this.stripeService.createCustomer(userId, email, name)

        // Attach payment method to customer
        const pm = await this.stripeService.attachPaymentMethod(
          gatewayCustomerId,
          paymentMethodId
        )

        cardDetails = this.stripeService.extractCardDetails(pm)
      } else {
        // For PayPal, the payment method is the billing agreement
        gatewayCustomerId = userId
        cardDetails = {}
      }

      // Save to database
      const paymentMethod = await prisma.paymentMethod.create({
        data: {
          userId,
          gateway,
          gatewayCustomerId,
          paymentMethodId,
          ...cardDetails,
          isDefault: false,
        },
      })

      logger.info('Payment method saved', {
        paymentMethodId: paymentMethod.id,
        gateway,
        userId,
      })

      return {
        id: paymentMethod.id,
        gateway,
        ...cardDetails,
        isDefault: paymentMethod.isDefault,
      }
    } catch (error: any) {
      logger.error('Failed to save payment method', {
        error: error.message,
        userId,
        gateway,
      })
      throw error
    }
  }

  /**
   * Get user's saved payment methods
   */
  async getPaymentMethods(userId: string, gateway?: PaymentGateway): Promise<PaymentMethodResult[]> {
    try {
      const where: any = { userId, isActive: true }
      if (gateway) {
        where.gateway = gateway
      }

      const paymentMethods = await prisma.paymentMethod.findMany({
        where,
        orderBy: { isDefault: 'desc' },
      })

      return paymentMethods.map(pm => ({
        id: pm.id,
        gateway: pm.gateway as PaymentGateway,
        cardBrand: pm.cardBrand || undefined,
        cardLast4: pm.cardLast4 || undefined,
        expiryMonth: pm.expiryMonth || undefined,
        expiryYear: pm.expiryYear || undefined,
        isDefault: pm.isDefault,
      }))
    } catch (error: any) {
      logger.error('Failed to get payment methods', {
        error: error.message,
        userId,
      })
      throw error
    }
  }

  /**
   * Delete a payment method
   */
  async deletePaymentMethod(userId: string, paymentMethodId: string): Promise<void> {
    try {
      const paymentMethod = await prisma.paymentMethod.findFirst({
        where: { id: paymentMethodId, userId },
      })

      if (!paymentMethod) {
        throw new Error('Payment method not found')
      }

      // Detach from gateway
      if (paymentMethod.gateway === PaymentGateway.STRIPE && paymentMethod.paymentMethodId) {
        await this.stripeService.detachPaymentMethod(paymentMethod.paymentMethodId)
      }

      // Soft delete in database
      await prisma.paymentMethod.update({
        where: { id: paymentMethodId },
        data: { isActive: false },
      })

      logger.info('Payment method deleted', {
        paymentMethodId,
        userId,
      })
    } catch (error: any) {
      logger.error('Failed to delete payment method', {
        error: error.message,
        userId,
        paymentMethodId,
      })
      throw error
    }
  }

  /**
   * Get payment history for a user
   */
  async getPaymentHistory(
    userId: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<any[]> {
    try {
      const payments = await prisma.payment.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: {
          refunds: true,
        },
      })

      return payments
    } catch (error: any) {
      logger.error('Failed to get payment history', {
        error: error.message,
        userId,
      })
      throw error
    }
  }

  /**
   * Extract PayPal capture ID from order ID
   */
  private extractPayPalCaptureId(orderId: string): string {
    // In production, you'd retrieve the order and get the capture ID from the response
    // For now, we assume the order ID is the capture ID (simplified)
    return orderId
  }
}
