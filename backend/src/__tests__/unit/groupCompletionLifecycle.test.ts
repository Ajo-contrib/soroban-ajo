import { handleGroupCompleted } from '../../handlers/contractEventHandlers'
import { notificationService } from '../../services/notificationService'
import { webhookService } from '../../services/webhookService'
import { WebhookEventType } from '../../services/webhookService'

jest.mock('../../config/database', () => ({
  prisma: {
    group: {
      upsert: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
    },
  },
}))

jest.mock('../../services/notificationService', () => ({
  notificationService: {
    sendToGroup: jest.fn(),
  },
}))

jest.mock('../../services/webhookService', () => ({
  webhookService: {
    triggerEvent: jest.fn().mockResolvedValue(undefined),
  },
  WebhookEventType: {
    GROUP_COMPLETED: 'group.completed',
  },
}))

import { prisma } from '../../config/database'

const mockPrisma = prisma as unknown as {
  group: {
    upsert: jest.Mock
    update: jest.Mock
    findUnique: jest.Mock
  }
}

describe('Group Completion Lifecycle Flow Audit Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('updates group state, notifies all group members, and dispatches webhook on completion', async () => {
    mockPrisma.group.upsert.mockResolvedValue({
      id: 'grp-complete-100',
      isActive: false,
    })

    const parsedEvent = {
      id: 'evt-comp-1',
      contractId: 'CA_CONTRACT_1',
      topic: 'group.completed',
      groupId: 'grp-complete-100',
      type: 'group_completed',
      data: {},
      timestamp: new Date(),
      ledgerSequence: 5000,
    }

    await handleGroupCompleted(parsedEvent as any)

    // 1. Database state transition
    expect(mockPrisma.group.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'grp-complete-100' },
        update: expect.objectContaining({ isActive: false }),
      })
    )

    // 2. Multicast notification to group members
    expect(notificationService.sendToGroup).toHaveBeenCalledWith(
      'grp-complete-100',
      expect.objectContaining({
        type: 'cycle_completed',
        title: 'Group Completed',
        groupId: 'grp-complete-100',
      })
    )

    // 3. Webhook dispatch
    expect(webhookService.triggerEvent).toHaveBeenCalledWith(
      WebhookEventType.GROUP_COMPLETED,
      expect.objectContaining({ groupId: 'grp-complete-100' }),
      expect.any(Object)
    )
  })

  it('maintains error isolation: webhook dispatch failure does not abort the completion handler', async () => {
    mockPrisma.group.upsert.mockResolvedValue({
      id: 'grp-complete-200',
      isActive: false,
    })

    ;(webhookService.triggerEvent as jest.Mock).mockRejectedValue(
      new Error('Webhook partner endpoint timed out')
    )

    const parsedEvent = {
      id: 'evt-comp-2',
      contractId: 'CA_CONTRACT_1',
      topic: 'group.completed',
      groupId: 'grp-complete-200',
      type: 'group_completed',
      data: {},
      timestamp: new Date(),
      ledgerSequence: 5001,
    }

    // Should resolve cleanly without throwing
    await expect(handleGroupCompleted(parsedEvent as any)).resolves.not.toThrow()

    expect(mockPrisma.group.upsert).toHaveBeenCalled()
    expect(notificationService.sendToGroup).toHaveBeenCalled()
  })
})
