import { Request, Response } from 'express'
import { StripeService } from '../services/stripeService'
import { PayPalService } from '../services/paypalService'
import { PaymentGatewayService } from '../services/paymentGatewayService'
import { PaymentGateway, PaymentStatus } from '../types/payment'
import { createModuleLogger } from '../utils/logger'

const logger = createModuleLogger('PaymentWebhookHandler')

const stripeService = new StripeService()
const payPalService = new PayPalService()
const paymentGatewayService = new PaymentGatewayService()

export const paymentWebhookHandler = {
  /**
   * Handle Stripe webhook events
   * POST /api/webhooks/stripe
   */
  async handleStripeWebhook(req: Request, res: Response): Promise<void> {
    try {
      const sig = req.headers['stripe-signature'] as string

      if (!sig) {
        res.status(400).json({ error: 'No Stripe signature found' })
        return
      }

      // Verify webhook signature
      const event = await stripeService.handleWebhook(req.body, sig)

      // Handle different event types
      switch (event.type) {
        case 'payment_intent.succeeded': {
          const paymentIntent = event.data.object
          await paymentGatewayService.confirmPayment(
            paymentIntent.id,
            PaymentGateway.STRIPE,
            event.id,
            { stripeEvent: event }
          )
          logger.info('Stripe payment succeeded', {
            paymentIntentId: paymentIntent.id,
          })
          break
        }

        case 'payment_intent.payment_failed': {
          const failedIntent = event.data.object
          logger.error('Stripe payment failed', {
            paymentIntentId: failedIntent.id,
            error: failedIntent.last_payment_error,
          })
          // Update payment status in database
          break
        }

        case 'charge.refunded': {
          const charge = event.data.object
          logger.info('Stripe charge refunded', {
            chargeId: charge.id,
          })
          // Update refund status in database
          break
        }

        default:
          logger.info('Unhandled Stripe event type', {
            eventType: event.type,
          })
      }

      res.status(200).json({ received: true })
    } catch (error: any) {
      logger.error('Stripe webhook handler failed', {
        error: error.message,
      })
      res.status(400).json({ error: error.message })
    }
  },

  /**
   * Handle PayPal webhook events
   * POST /api/webhooks/paypal
   */
  async handlePayPalWebhook(req: Request, res: Response): Promise<void> {
    try {
      const event = req.body

      if (!event || !event.id || !event.event_type) {
        res.status(400).json({ error: 'Invalid PayPal webhook event' })
        return
      }

      // Verify webhook event
      const isValid = await payPalService.verifyWebhook(event.id, event.event_type)

      if (!isValid) {
        res.status(401).json({ error: 'Webhook verification failed' })
        return
      }

      // Handle different event types
      switch (event.event_type) {
        case 'PAYMENT.CAPTURE.COMPLETED': {
          const orderId = event.resource.id
          await paymentGatewayService.confirmPayment(
            orderId,
            PaymentGateway.PAYPAL,
            event.id,
            { payPalEvent: event }
          )
          logger.info('PayPal payment completed', {
            orderId,
          })
          break
        }

        case 'PAYMENT.CAPTURE.DENIED':
          logger.error('PayPal payment denied', {
            orderId: event.resource.id,
          })
          // Update payment status in database
          break

        case 'PAYMENT.CAPTURE.REFUNDED':
          logger.info('PayPal payment refunded', {
            captureId: event.resource.id,
            refundId: event.resource.supplementary_data?.related_ids?.refund_id,
          })
          // Update refund status in database
          break

        default:
          logger.info('Unhandled PayPal event type', {
            eventType: event.event_type,
          })
      }

      res.status(200).json({ received: true })
    } catch (error: any) {
      logger.error('PayPal webhook handler failed', {
        error: error.message,
      })
      res.status(400).json({ error: error.message })
    }
  },
}
