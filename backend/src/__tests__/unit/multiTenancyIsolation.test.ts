import { EventStore } from '../../events/eventStore'
import { cacheKeys, getCacheKeyPatterns, createScopedCacheKeys, createScopedCacheKeyPatterns } from '../../utils/cacheKeys'
import { MLFraudDetectionService } from '../../services/mlFraudDetectionService'

jest.mock('../../config/database', () => ({
  prisma: {
    eventStore: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    fraudAlert: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    fraudModelVersion: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
  },
}))

import { prisma } from '../../config/database'

const mockPrisma = prisma as unknown as {
  eventStore: {
    create: jest.Mock
    findMany: jest.Mock
    findFirst: jest.Mock
  }
  fraudAlert: {
    create: jest.Mock
    findMany: jest.Mock
    count: jest.Mock
    update: jest.Mock
  }
  fraudModelVersion: {
    findFirst: jest.Mock
    findUnique: jest.Mock
    create: jest.Mock
    updateMany: jest.Mock
    update: jest.Mock
  }
}

describe('Multi-Tenancy and Multi-Deployment Isolation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('EventStore Multi-Tenant Scoping', () => {
    let eventStore: EventStore

    beforeEach(() => {
      eventStore = new EventStore()
    })

    it('records contractAddress, tenantId, and network in event metadata on append', async () => {
      mockPrisma.eventStore.create.mockResolvedValue({
        sequenceNumber: 10,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      })

      const result = await eventStore.append({
        type: 'GROUP_CREATED',
        aggregateId: 'grp-tenant-1',
        aggregateType: 'Group',
        payload: { name: 'White-label Group A' },
        metadata: {
          timestamp: '2026-01-01T00:00:00Z',
          version: 1,
          contractAddress: 'CA_TENANT_A',
          tenantId: 'tenant-a',
          network: 'testnet',
        },
      })

      expect(mockPrisma.eventStore.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          aggregateId: 'grp-tenant-1',
          version: 1,
          metadata: expect.objectContaining({
            contractAddress: 'CA_TENANT_A',
            tenantId: 'tenant-a',
            network: 'testnet',
          }),
        }),
      })
      expect(result.sequenceNumber).toBe(10)
    })

    it('isolates events by contractAddress and tenantId during getByAggregateId queries', async () => {
      mockPrisma.eventStore.findMany.mockResolvedValue([
        {
          id: 'evt-1',
          type: 'GROUP_CREATED',
          aggregateId: 'grp-shared-id',
          aggregateType: 'Group',
          payload: {},
          metadata: { version: 1, timestamp: '2026-01-01T00:00:01Z', contractAddress: 'CA_TENANT_A', tenantId: 'tenant-a' },
          version: 1,
          sequenceNumber: 1,
          createdAt: new Date('2026-01-01T00:00:01Z'),
        },
        {
          id: 'evt-2',
          type: 'GROUP_CREATED',
          aggregateId: 'grp-shared-id',
          aggregateType: 'Group',
          payload: {},
          metadata: { version: 1, timestamp: '2026-01-01T00:00:02Z', contractAddress: 'CA_TENANT_B', tenantId: 'tenant-b' },
          version: 1,
          sequenceNumber: 2,
          createdAt: new Date('2026-01-01T00:00:02Z'),
        },
      ])

      const tenantAEvents = await eventStore.getByAggregateId('grp-shared-id', 0, {
        contractAddress: 'CA_TENANT_A',
      })
      expect(tenantAEvents).toHaveLength(1)
      expect(tenantAEvents[0].id).toBe('evt-1')

      const tenantBEvents = await eventStore.getByAggregateId('grp-shared-id', 0, {
        tenantId: 'tenant-b',
      })
      expect(tenantBEvents).toHaveLength(1)
      expect(tenantBEvents[0].id).toBe('evt-2')
    })
  })

  describe('Cache Keys Multi-Tenant Scoping', () => {
    it('generates un-prefixed keys when no tenant scope is provided', () => {
      expect(cacheKeys.groupDetails('grp-123')).toBe('group:details:grp-123')
      expect(cacheKeys.userProfile('WALLET_1')).toBe('user:profile:WALLET_1')
      expect(cacheKeys.leaderboardTopSavers(50)).toBe('leaderboard:savers:top:50')
    })

    it('generates tenant-scoped keys when scoped helper is used', () => {
      const tenantA = cacheKeys.scoped('tenant-alpha')
      const tenantB = cacheKeys.scoped('contract-0x999')

      expect(tenantA.groupDetails('grp-123')).toBe('tenant:tenant-alpha:group:details:grp-123')
      expect(tenantA.userProfile('WALLET_1')).toBe('tenant:tenant-alpha:user:profile:WALLET_1')
      expect(tenantA.leaderboardTopSavers(50)).toBe('tenant:tenant-alpha:leaderboard:savers:top:50')

      expect(tenantB.groupDetails('grp-123')).toBe('tenant:contract-0x999:group:details:grp-123')
      expect(tenantB.userProfile('WALLET_1')).toBe('tenant:contract-0x999:user:profile:WALLET_1')
    })

    it('generates tenant-isolated cache invalidation patterns', () => {
      const tenantPatterns = getCacheKeyPatterns.scoped('tenant-alpha')
      expect(tenantPatterns.groupAll('grp-123')).toBe('tenant:tenant-alpha:group:*:grp-123')
      expect(tenantPatterns.tenantAll()).toBe('tenant:tenant-alpha:*')
    })
  })

  describe('ML Fraud Model Multi-Tenant Data Partitioning', () => {
    let fraudService: MLFraudDetectionService

    beforeEach(() => {
      fraudService = new MLFraudDetectionService(mockPrisma as any)
    })

    it('partitions model training dataset by contractAddress/tenantId', async () => {
      // Setup mock alerts with two different tenants
      const mockAlerts = [
        // 12 alerts for Tenant A (alternating labels so both slices have 0 and 1)
        ...Array.from({ length: 12 }, (_, i) => ({
          score: i % 2 === 0 ? 85 : 25,
          resolution: i % 2 === 0 ? '[FALSE_NEGATIVE] confirmed fraud' : '[FALSE_POSITIVE] dismissed legitimate',
          details: JSON.stringify({ contractAddress: 'CONTRACT_A', tenantId: 'tenant-a' }),
          createdAt: new Date(Date.now() + i * 1000),
        })),
        // 10 alerts for Tenant B (different distribution)
        ...Array.from({ length: 10 }, (_, i) => ({
          score: 95,
          resolution: '[FALSE_NEGATIVE] confirmed fraud',
          details: JSON.stringify({ contractAddress: 'CONTRACT_B', tenantId: 'tenant-b' }),
          createdAt: new Date(Date.now() + i * 1000),
        })),
      ]

      mockPrisma.fraudAlert.findMany.mockResolvedValue(mockAlerts)
      mockPrisma.fraudModelVersion.findFirst.mockResolvedValue({
        id: 'fraud-statistical-v1',
        parameters: JSON.stringify({ anomalyThreshold: 30 }),
      })
      mockPrisma.fraudModelVersion.create.mockResolvedValue({ id: 'new-model' })
      mockPrisma.fraudModelVersion.updateMany.mockResolvedValue({ count: 1 })

      const result = await fraudService.retrainModel({
        contractAddress: 'CONTRACT_A',
      })

      expect(result).not.toBeNull()
      // Only 12 alerts from CONTRACT_A should be used (9 training, 3 validation)
      expect(result?.trainingExamples).toBe(9)
      expect(result?.validationExamples).toBe(3)
      expect(mockPrisma.fraudModelVersion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: expect.stringContaining('CONTRACT_A'),
        }),
      })
    })

    it('embeds contractAddress and tenantId in fraud alert metadata', async () => {
      mockPrisma.fraudAlert.create.mockResolvedValue({
        id: 'alert-1',
        userId: 'USER_1',
        alertType: 'TRANSACTION_ANOMALY',
        severity: 'HIGH',
        score: 75,
        details: JSON.stringify({ reasons: ['Rapid successive transactions'], contractAddress: 'CONTRACT_A', tenantId: 'tenant-a' }),
        status: 'OPEN',
        source: 'ML',
        createdAt: new Date(),
      })

      const alert = await fraudService.createAlert(
        'USER_1',
        'TRANSACTION_ANOMALY',
        'HIGH',
        75,
        { reasons: ['Rapid successive transactions'] },
        { contractAddress: 'CONTRACT_A', tenantId: 'tenant-a' }
      )

      expect(alert.contractAddress).toBe('CONTRACT_A')
      expect(alert.tenantId).toBe('tenant-a')
    })
  })
})
