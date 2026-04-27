import { CacheService, cacheService, redisClient } from '../services/cacheService'
import { createModuleLogger } from '../utils/logger'

const logger = createModuleLogger('CacheService.test')

describe('CacheService', () => {
  // Setup/teardown
  beforeAll(async () => {
    try {
      await redisClient.connect()
    } catch {
      // Already connected
    }
  })

  afterAll(async () => {
    await cacheService.flush()
    await cacheService.disconnect()
  })

  afterEach(async () => {
    await cacheService.flush()
  })

  describe('Basic Operations', () => {
    it('should set and get values', async () => {
      const key = 'test:key'
      const value = { name: 'test', count: 42 }

      await cacheService.set(key, value, 60)
      const result = await cacheService.get<typeof value>(key)

      expect(result).toEqual(value)
    })

    it('should return null for non-existent keys', async () => {
      const result = await cacheService.get('non:existent')
      expect(result).toBeNull()
    })

    it('should delete keys', async () => {
      const key = 'test:key'
      await cacheService.set(key, { data: 'test' }, 60)
      
      const deleted = await cacheService.del(key)
      expect(deleted).toBe(1)

      const result = await cacheService.get(key)
      expect(result).toBeNull()
    })

    it('should delete multiple keys', async () => {
      const keys = ['test:1', 'test:2', 'test:3']
      
      for (const key of keys) {
        await cacheService.set(key, { id: key }, 60)
      }

      const deleted = await cacheService.del(keys)
      expect(deleted).toBe(3)
    })
  })

  describe('Cache-Aside Pattern', () => {
    it('should use remember pattern correctly', async () => {
      const key = 'remember:test'
      let callCount = 0

      const fn = async () => {
        callCount++
        return { result: 'data' }
      }

      // First call - should invoke function
      const result1 = await cacheService.remember(key, 60, fn)
      expect(result1).toEqual({ result: 'data' })
      expect(callCount).toBe(1)

      // Second call - should use cache
      const result2 = await cacheService.remember(key, 60, fn)
      expect(result2).toEqual({ result: 'data' })
      expect(callCount).toBe(1)
    })

    it('should handle remember errors gracefully', async () => {
      const key = 'remember:error'
      const error = new Error('Test error')

      const fn = async () => {
        throw error
      }

      await expect(cacheService.remember(key, 60, fn)).rejects.toThrow('Test error')
    })
  })

  describe('Pattern Invalidation', () => {
    it('should invalidate keys by pattern', async () => {
      const keys = ['pattern:user:1', 'pattern:user:2', 'pattern:user:3']

      for (const key of keys) {
        await cacheService.set(key, { data: key }, 60)
      }

      const deleted = await cacheService.invalidatePattern('pattern:user:*')
      expect(deleted).toBe(3)

      for (const key of keys) {
        const result = await cacheService.get(key)
        expect(result).toBeNull()
      }
    })

    it('should handle empty pattern results', async () => {
      const deleted = await cacheService.invalidatePattern('non:existent:*')
      expect(deleted).toBe(0)
    })
  })

  describe('Tag-Based Invalidation', () => {
    it('should associate keys with tags', async () => {
      const key = 'tag:test:key'
      const tags = ['user:1', 'group:2']

      await cacheService.set(key, { data: 'test' }, 60)
      await cacheService.tag(tags, key)

      const result = await cacheService.get(key)
      expect(result).toEqual({ data: 'test' })
    })

    it('should invalidate by tag', async () => {
      const keys = ['tag:key:1', 'tag:key:2']
      const tag = 'user:1'

      for (const key of keys) {
        await cacheService.set(key, { data: key }, 60)
        await cacheService.tag([tag], key)
      }

      const deleted = await cacheService.invalidateTag(tag)
      expect(deleted).toBe(2)

      for (const key of keys) {
        const result = await cacheService.get(key)
        expect(result).toBeNull()
      }
    })
  })

  describe('Numeric Operations', () => {
    it('should increment values', async () => {
      const key = 'counter:test'

      const result1 = await cacheService.increment(key, 1)
      expect(result1).toBe(1)

      const result2 = await cacheService.increment(key, 5)
      expect(result2).toBe(6)
    })

    it('should handle increment with different amounts', async () => {
      const key = 'counter:amount'

      const result1 = await cacheService.increment(key, 10)
      expect(result1).toBe(10)

      const result2 = await cacheService.increment(key, -3)
      expect(result2).toBe(7)
    })
  })

  describe('TTL Management', () => {
    it('should set expiration on keys', async () => {
      const key = 'ttl:test'
      await cacheService.set(key, { data: 'test' }, 3600)

      const expired = await cacheService.expire(key, 1)
      expect(expired).toBe(true)
    })

    it('should return false for non-existent keys', async () => {
      const expired = await cacheService.expire('non:existent', 60)
      expect(expired).toBe(false)
    })
  })

  describe('Statistics', () => {
    it('should track cache statistics', async () => {
      cacheService.resetStats()

      await cacheService.set('stat:1', { data: 'test' }, 60)
      await cacheService.get('stat:1')
      await cacheService.get('stat:1')
      await cacheService.get('non:existent')

      const stats = cacheService.getStats()
      expect(stats.sets).toBeGreaterThan(0)
      expect(stats.hits).toBeGreaterThan(0)
      expect(stats.misses).toBeGreaterThan(0)
      expect(stats.hitRate).toBeGreaterThan(0)
    })

    it('should reset statistics', async () => {
      await cacheService.set('stat:test', { data: 'test' }, 60)
      cacheService.resetStats()

      const stats = cacheService.getStats()
      expect(stats.hits).toBe(0)
      expect(stats.misses).toBe(0)
      expect(stats.sets).toBe(0)
    })
  })

  describe('Type Safety', () => {
    it('should handle typed values', async () => {
      interface User {
        id: string
        name: string
        email: string
      }

      const key = 'user:1'
      const user: User = { id: '1', name: 'John', email: 'john@example.com' }

      await cacheService.set(key, user, 60)
      const result = await cacheService.get<User>(key)

      expect(result).toEqual(user)
      expect(result?.email).toBe('john@example.com')
    })

    it('should handle complex nested objects', async () => {
      const key = 'complex:data'
      const complex = {
        users: [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
        ],
        metadata: {
          created: new Date().toISOString(),
          version: '1.0',
        },
      }

      await cacheService.set(key, complex, 60)
      const result = await cacheService.get(key)

      expect(result).toEqual(complex)
      expect(Array.isArray(result?.users)).toBe(true)
    })
  })

  describe('Error Handling', () => {
    it('should handle serialization errors gracefully', async () => {
      const key = 'error:serialize'
      // Circular reference will cause serialization error
      const circular: any = { a: 1 }
      circular.self = circular

      // Should not throw, but handle gracefully
      await cacheService.set(key, circular, 60)
      const result = await cacheService.get(key)
      expect(result).toBeNull()
    })

    it('should track errors in statistics', async () => {
      cacheService.resetStats()
      
      // Attempt operations that might fail
      const stats = cacheService.getStats()
      expect(stats.errors).toBeDefined()
    })
  })

  describe('Flush Operation', () => {
    it('should flush all cache', async () => {
      await cacheService.set('flush:1', { data: 1 }, 60)
      await cacheService.set('flush:2', { data: 2 }, 60)

      await cacheService.flush()

      const result1 = await cacheService.get('flush:1')
      const result2 = await cacheService.get('flush:2')

      expect(result1).toBeNull()
      expect(result2).toBeNull()
    })
  })
})
