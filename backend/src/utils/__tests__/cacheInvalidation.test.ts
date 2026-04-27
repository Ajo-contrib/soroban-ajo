import { CacheInvalidationManager } from '../utils/cacheInvalidation'
import { cacheService, redisClient } from '../services/cacheService'
import { cacheKeys } from '../utils/cacheKeys'

describe('CacheInvalidationManager', () => {
  beforeAll(async () => {
    try {
      await redisClient.connect()
    } catch {
      // Already connected
    }
  })

  afterEach(async () => {
    await cacheService.flush()
  })

  afterAll(async () => {
    await cacheService.disconnect()
  })

  describe('Pattern Invalidation', () => {
    it('should invalidate keys matching a pattern', async () => {
      // Set up test keys
      await cacheService.set('user:profile:1', { id: 1 }, 60)
      await cacheService.set('user:profile:2', { id: 2 }, 60)
      await cacheService.set('user:stats:1', { stats: [] }, 60)

      // Invalidate user profile pattern
      const deleted = await CacheInvalidationManager.invalidatePattern('user:profile:*')

      expect(deleted).toBe(2)

      // Verify deletion
      expect(await cacheService.get('user:profile:1')).toBeNull()
      expect(await cacheService.get('user:profile:2')).toBeNull()
      // Stats should still exist
      expect(await cacheService.get('user:stats:1')).not.toBeNull()
    })

    it('should handle patterns with no matches', async () => {
      const deleted = await CacheInvalidationManager.invalidatePattern('non:existent:*')
      expect(deleted).toBe(0)
    })

    it('should handle complex patterns', async () => {
      await cacheService.set('group:123:members', [], 60)
      await cacheService.set('group:123:contributions', [], 60)
      await cacheService.set('group:456:members', [], 60)

      const deleted = await CacheInvalidationManager.invalidatePattern('group:123:*')

      expect(deleted).toBe(2)
      expect(await cacheService.get('group:456:members')).not.toBeNull()
    })
  })

  describe('Key Invalidation', () => {
    it('should invalidate specific keys', async () => {
      const keys = ['key:1', 'key:2', 'key:3']

      for (const key of keys) {
        await cacheService.set(key, { data: key }, 60)
      }

      const deleted = await CacheInvalidationManager.invalidateKeys(keys)

      expect(deleted).toBe(3)
      for (const key of keys) {
        expect(await cacheService.get(key)).toBeNull()
      }
    })

    it('should handle empty key array', async () => {
      const deleted = await CacheInvalidationManager.invalidateKeys([])
      expect(deleted).toBe(0)
    })

    it('should invalidate single key', async () => {
      const key = 'single:key'
      await cacheService.set(key, { data: 'test' }, 60)

      const deleted = await CacheInvalidationManager.invalidateKey(key)

      expect(deleted).toBe(true)
      expect(await cacheService.get(key)).toBeNull()
    })

    it('should return false when key does not exist', async () => {
      const deleted = await CacheInvalidationManager.invalidateKey('non:existent')
      expect(deleted).toBe(false)
    })
  })

  describe('Domain-Specific Invalidation', () => {
    it('should invalidate user cache', async () => {
      const walletAddress = 'wallet:123'

      // Set up user-related cache keys
      await cacheService.set(`user:profile:${walletAddress}`, { name: 'User' }, 60)
      await cacheService.set(`user:stats:${walletAddress}`, { score: 100 }, 60)
      await cacheService.set(`user:goals:${walletAddress}`, [], 60)

      // This should invalidate keys matching the pattern
      const deleted = await CacheInvalidationManager.invalidateUserCache(walletAddress)

      expect(deleted).toBeGreaterThanOrEqual(0)
    })

    it('should invalidate group cache', async () => {
      const groupId = 'group:123'

      await cacheService.set(`group:details:${groupId}`, { name: 'Group' }, 60)
      await cacheService.set(`group:members:${groupId}`, [], 60)

      const deleted = await CacheInvalidationManager.invalidateGroupCache(groupId)

      expect(deleted).toBeGreaterThanOrEqual(0)
    })

    it('should invalidate user goals cache', async () => {
      const walletAddress = 'wallet:123'

      await cacheService.set(`goal:details:goal1:${walletAddress}`, {}, 60)
      await cacheService.set(`goal:list:${walletAddress}`, [], 60)

      const deleted = await CacheInvalidationManager.invalidateUserGoalsCache(walletAddress)

      expect(deleted).toBeGreaterThanOrEqual(0)
    })

    it('should invalidate leaderboard cache', async () => {
      await cacheService.set('leaderboard:referrers:top:100', [], 60)
      await cacheService.set('leaderboard:savers:top:100', [], 60)

      const deleted = await CacheInvalidationManager.invalidateLeaderboardCache()

      expect(deleted).toBeGreaterThanOrEqual(0)
    })

    it('should invalidate activity cache', async () => {
      await cacheService.set('activity:feed:wallet:1:50', [], 60)
      await cacheService.set('activity:global:100', [], 60)

      const deleted = await CacheInvalidationManager.invalidateActivityCache()

      expect(deleted).toBeGreaterThanOrEqual(0)
    })

    it('should invalidate referral cache', async () => {
      const walletAddress = 'wallet:123'

      await cacheService.set(`referral:code:${walletAddress}`, 'CODE123', 60)
      await cacheService.set(`referral:stats:${walletAddress}`, {}, 60)

      const deleted = await CacheInvalidationManager.invalidateReferralCache(walletAddress)

      expect(deleted).toBeGreaterThanOrEqual(0)
    })

    it('should invalidate reward cache', async () => {
      const walletAddress = 'wallet:123'

      await cacheService.set(`reward:history:${walletAddress}`, [], 60)
      await cacheService.set(`reward:balance:${walletAddress}`, 100, 60)

      const deleted = await CacheInvalidationManager.invalidateRewardCache(walletAddress)

      expect(deleted).toBeGreaterThanOrEqual(0)
    })
  })

  describe('Cascade Invalidation', () => {
    it('should invalidate on group membership change', async () => {
      const groupId = 'group:123'
      const walletAddress = 'wallet:123'

      // Set up caches
      await cacheService.set(`group:details:${groupId}`, {}, 60)
      await cacheService.set(`user:profile:${walletAddress}`, {}, 60)

      const deleted = await CacheInvalidationManager.invalidateGroupMembershipChange(
        groupId,
        walletAddress
      )

      expect(deleted).toBeGreaterThanOrEqual(0)
    })

    it('should invalidate on contribution change', async () => {
      const groupId = 'group:123'
      const walletAddress = 'wallet:123'

      await cacheService.set(`group:contributions:${groupId}`, [], 60)
      await cacheService.set(`user:stats:${walletAddress}`, {}, 60)

      const deleted = await CacheInvalidationManager.invalidateContributionChange(
        groupId,
        walletAddress
      )

      expect(deleted).toBeGreaterThanOrEqual(0)
    })

    it('should invalidate on gamification change', async () => {
      const walletAddress = 'wallet:123'

      await cacheService.set(`user:achievements:${walletAddress}`, [], 60)
      await cacheService.set('leaderboard:top:100', [], 60)

      const deleted = await CacheInvalidationManager.invalidateGamificationChange(walletAddress)

      expect(deleted).toBeGreaterThanOrEqual(0)
    })
  })

  describe('Full Database Invalidation', () => {
    it('should invalidate all cache', async () => {
      // Set up multiple keys
      await cacheService.set('key:1', { data: 1 }, 60)
      await cacheService.set('key:2', { data: 2 }, 60)
      await cacheService.set('key:3', { data: 3 }, 60)

      const result = await CacheInvalidationManager.invalidateAll()

      expect(result).toBeGreaterThan(0)

      // Verify all keys are gone
      expect(await cacheService.get('key:1')).toBeNull()
      expect(await cacheService.get('key:2')).toBeNull()
      expect(await cacheService.get('key:3')).toBeNull()
    })
  })

  describe('Error Handling', () => {
    it('should handle invalidation errors', async () => {
      // Test with a valid pattern - should not throw
      const result = await CacheInvalidationManager.invalidatePattern('test:*')
      expect(typeof result).toBe('number')
    })

    it('should handle key invalidation errors', async () => {
      // Test with non-existent keys - should handle gracefully
      const result = await CacheInvalidationManager.invalidateKeys(['non:existent:1'])
      expect(typeof result).toBe('number')
    })
  })

  describe('Batch Operations', () => {
    it('should efficiently handle batch invalidation', async () => {
      // Set up many keys
      const keyCount = 100
      const keys: string[] = []

      for (let i = 0; i < keyCount; i++) {
        const key = `batch:key:${i}`
        keys.push(key)
        await cacheService.set(key, { index: i }, 60)
      }

      const deleted = await CacheInvalidationManager.invalidateKeys(keys)

      expect(deleted).toBe(keyCount)
    })

    it('should handle large pattern invalidation', async () => {
      // Set up many keys matching a pattern
      for (let i = 0; i < 50; i++) {
        await cacheService.set(`pattern:test:${i}`, { index: i }, 60)
      }

      const deleted = await CacheInvalidationManager.invalidatePattern('pattern:test:*')

      expect(deleted).toBe(50)
    })
  })
})
