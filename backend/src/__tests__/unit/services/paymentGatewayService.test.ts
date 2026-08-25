import { PaymentGateway, PaymentStatus } from '../../../types/payment'

const mockPrisma = {
  payment: {
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  processedPaymentWebhookEvent: {
    create: jest.fn(),
  },
  $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(mockPrisma)),
}

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn(() => mockPrisma),
}))

jest.mock('../../../services/notificationService', () => ({
  notificationService: { sendToUser: jest.fn() },
}))

import { PaymentGatewayService } from '../../../services/paymentGatewayService'
import { notificationService } from '../../../services/notificationService'

describe('PaymentGatewayService.confirmPayment', () => {
  let service: PaymentGatewayService

  const payment = {
    id: 'payment-1',
    userId: 'user-1',
    gatewayPaymentId: 'pi_123',
    fiatAmount: 10000,
    fiatCurrency: 'USD',
    metadata: {},
  }

  beforeEach(() => {
    jest.clearAllMocks()
    service = new PaymentGatewayService()
    mockPrisma.payment.findFirst.mockResolvedValue(payment)
    mockPrisma.payment.update.mockResolvedValue(payment)
  })

  it('applies the payment side effects and records the event as processed on first delivery', async () => {
    mockPrisma.processedPaymentWebhookEvent.create.mockResolvedValueOnce(undefined)

    await service.confirmPayment('pi_123', PaymentGateway.STRIPE, 'evt_1')

    expect(mockPrisma.processedPaymentWebhookEvent.create).toHaveBeenCalledWith({
      data: { gateway: PaymentGateway.STRIPE, eventId: 'evt_1' },
    })
    expect(mockPrisma.payment.update).toHaveBeenCalledWith({
      where: { id: payment.id },
      data: expect.objectContaining({ status: PaymentStatus.COMPLETED }),
    })
    expect(notificationService.sendToUser).toHaveBeenCalledTimes(1)
  })

  it('skips the payment update and notification when the same event is redelivered', async () => {
    const duplicateError: any = new Error('Unique constraint failed')
    duplicateError.code = 'P2002'
    mockPrisma.processedPaymentWebhookEvent.create.mockRejectedValueOnce(duplicateError)

    await service.confirmPayment('pi_123', PaymentGateway.STRIPE, 'evt_1')

    expect(mockPrisma.payment.update).not.toHaveBeenCalled()
    expect(notificationService.sendToUser).not.toHaveBeenCalled()
  })

  it('re-throws unexpected errors from the dedup insert instead of silently skipping', async () => {
    const unexpectedError = new Error('connection lost')
    mockPrisma.processedPaymentWebhookEvent.create.mockRejectedValueOnce(unexpectedError)

    await expect(service.confirmPayment('pi_123', PaymentGateway.STRIPE, 'evt_1')).rejects.toThrow(
      'connection lost'
    )
    expect(mockPrisma.payment.update).not.toHaveBeenCalled()
  })

  it('throws when no payment matches the gateway payment id', async () => {
    mockPrisma.payment.findFirst.mockResolvedValueOnce(null)

    await expect(service.confirmPayment('pi_missing', PaymentGateway.STRIPE, 'evt_2')).rejects.toThrow(
      'Payment not found'
    )
    expect(mockPrisma.processedPaymentWebhookEvent.create).not.toHaveBeenCalled()
  })
})
