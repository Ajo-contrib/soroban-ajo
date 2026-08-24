/**
 * Tests for the notification worker's real-time ('push'/'websocket') channel
 * (#934). Before this fix, that branch called
 * `websocketService.sendToUser(...)` — a method that has never existed on
 * WebSocketService — so every job on this channel threw, was swallowed, and
 * no notification was ever delivered over the socket. These tests guard
 * against that regressing.
 */
jest.mock('../../src/queues/queueManager', () => ({
  createQueue: jest.fn(),
  getQueue: jest.fn(),
  createWorker: jest.fn(),
  redisConnection: {},
  defaultJobOptions: {},
}))

jest.mock('../../src/config/database', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
  },
}))

jest.mock('../../src/services/emailService', () => ({
  emailService: { sendEmail: jest.fn().mockResolvedValue(undefined) },
}))

jest.mock('../../src/services/smsService', () => ({
  smsService: { sendSms: jest.fn().mockResolvedValue(undefined) },
}))

jest.mock('../../src/services/notificationService', () => ({
  notificationService: { sendToUser: jest.fn() },
}))

import { processNotificationJob } from '../../src/workers/notificationWorker'
import { notificationService } from '../../src/services/notificationService'

function fakeJob(channels: Array<'push' | 'email' | 'sms' | 'websocket'>) {
  return {
    id: 'job-1',
    data: {
      userId: 'user-1',
      type: 'group_update',
      title: 'Title',
      message: 'Message',
      data: { groupId: 'g1' },
      channels,
    },
  } as any
}

describe('notificationWorker real-time delivery', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('delivers via notificationService.sendToUser (not the nonexistent websocketService method) for the push channel', async () => {
    const result = await processNotificationJob(fakeJob(['push']))

    expect(notificationService.sendToUser).toHaveBeenCalledWith('user-1', {
      type: 'group_update',
      title: 'Title',
      message: 'Message',
      data: { groupId: 'g1' },
    })
    expect(result.success).toBe(true)
    expect(result.channelsSent).toContain('websocket')
  })

  it('also delivers for the websocket channel alias', async () => {
    await processNotificationJob(fakeJob(['websocket']))
    expect(notificationService.sendToUser).toHaveBeenCalledTimes(1)
  })

  it('fails the job (all channels failed) if sendToUser throws, instead of silently swallowing it', async () => {
    ;(notificationService.sendToUser as jest.Mock).mockImplementation(() => {
      throw new Error('io not initialized')
    })

    await expect(processNotificationJob(fakeJob(['push']))).rejects.toThrow('All channels failed')
  })
})
