import { Prisma } from '@prisma/client'
import { ConflictError } from '../../../errors/AppError'

jest.mock('../../../config/database', () => ({
  prisma: {
    eventStore: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
  },
}))

import { prisma } from '../../../config/database'
import { EventStore } from '../../../events/eventStore'

const mockPrisma = prisma as unknown as {
  eventStore: {
    create: jest.Mock
    findMany: jest.Mock
    findFirst: jest.Mock
  }
}

describe('EventStore', () => {
  let eventStore: EventStore

  beforeEach(() => {
    eventStore = new EventStore()
    jest.clearAllMocks()
  })

  describe('append', () => {
    it('persists a new event and returns it with its assigned sequence number', async () => {
      mockPrisma.eventStore.create.mockResolvedValue({
        sequenceNumber: 5,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      })

      const result = await eventStore.append({
        type: 'GROUP_CREATED',
        aggregateId: 'group-1',
        aggregateType: 'Group',
        payload: { name: 'Test Group' },
        metadata: { timestamp: '2026-01-01T00:00:00Z', version: 1 },
      })

      expect(mockPrisma.eventStore.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          aggregateId: 'group-1',
          version: 1,
        }),
      })
      expect(result.sequenceNumber).toBe(5)
    })

    it('surfaces a concurrent-write conflict as a ConflictError instead of a raw Prisma error', async () => {
      // Simulates two writers both trying to append version N for the same
      // aggregate: the DB's unique(aggregateId, version) constraint rejects
      // the loser, which is exactly the case that must not be swallowed —
      // silently ignoring it would let the aggregate's event log develop a
      // duplicate/ambiguous version, breaking replay determinism.
      mockPrisma.eventStore.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`aggregateId`,`version`)', {
          code: 'P2002',
          clientVersion: '5.22.0',
        })
      )

      await expect(
        eventStore.append({
          type: 'CONTRIBUTION_MADE',
          aggregateId: 'group-1',
          aggregateType: 'Group',
          payload: { amount: 100 },
          metadata: { timestamp: '2026-01-01T00:00:00Z', version: 3 },
        })
      ).rejects.toBeInstanceOf(ConflictError)
    })

    it('rethrows non-conflict errors unchanged', async () => {
      mockPrisma.eventStore.create.mockRejectedValue(new Error('connection lost'))

      await expect(
        eventStore.append({
          type: 'CONTRIBUTION_MADE',
          aggregateId: 'group-1',
          aggregateType: 'Group',
          payload: { amount: 100 },
          metadata: { timestamp: '2026-01-01T00:00:00Z', version: 3 },
        })
      ).rejects.toThrow('connection lost')
    })
  })

  describe('getLatestVersion', () => {
    it('returns the version of the most recent event for the aggregate', async () => {
      mockPrisma.eventStore.findFirst.mockResolvedValue({ version: 7 })

      const version = await eventStore.getLatestVersion('group-1')

      expect(version).toBe(7)
      expect(mockPrisma.eventStore.findFirst).toHaveBeenCalledWith({
        where: { aggregateId: 'group-1' },
        orderBy: { version: 'desc' },
        select: { version: true },
      })
    })

    it('returns 0 for an aggregate with no events yet', async () => {
      mockPrisma.eventStore.findFirst.mockResolvedValue(null)

      const version = await eventStore.getLatestVersion('brand-new-group')

      expect(version).toBe(0)
    })
  })

  describe('getByAggregateId', () => {
    it('returns events ordered by sequence number, optionally starting from a given version', async () => {
      mockPrisma.eventStore.findMany.mockResolvedValue([
        {
          id: 'evt-2',
          type: 'MEMBER_JOINED',
          aggregateId: 'group-1',
          aggregateType: 'Group',
          payload: {},
          metadata: { version: 2, timestamp: '2026-01-01T00:00:01Z' },
          version: 2,
          sequenceNumber: 2,
          createdAt: new Date('2026-01-01T00:00:01Z'),
        },
      ])

      const events = await eventStore.getByAggregateId('group-1', 2)

      expect(mockPrisma.eventStore.findMany).toHaveBeenCalledWith({
        where: { aggregateId: 'group-1', version: { gte: 2 } },
        orderBy: { sequenceNumber: 'asc' },
      })
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('MEMBER_JOINED')
    })
  })
})
