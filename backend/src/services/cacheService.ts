import Redis from 'ioredis'
import { dbService } from './databaseService'
import { SorobanService } from './sorobanService'
import { logger, createModuleLogger } from '../utils/logger'
import { CACHE_TTL } from '../config/cache.config'

const cacheLogger = createModuleLogger('CacheService')

export const redisClient = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
  lazyConnect: true,
  enableOfflineQueue: false,
  retryStrategy: (times) => Math.min(times * 50, 2000),
  maxRetriesPerRequest: null,
})

redisClient.on('error', (err) => cacheLogger.warn('Redis error', { error: err.message }))
redisClient.on('connect', () => cacheLogger.info('Redis connected'))
redisClient.on('ready', () => cacheLogger.info('Redis ready'))

const sorobanService = new SorobanService()

// ── Enhanced Cache Service Class ──────────────────────────────────────────────

/**
 * Enhanced Redis cache service with type safety, tags, and advanced features
 */
export class CacheService {
  private static instance: CacheService
  private stats = { hits: 0, misses: 0, sets: 0, deletes: 0, errors: 0 }
  private readonly defaultTTL = 300 // 5 minutes

  private constructor() {}

  static getInstance(): CacheService {
    if (!CacheService.instance) {
      CacheService.instance = new CacheService()
    }
    return CacheService.instance
  }

  /**
   * Get a value from cache with type safety
   */
  async get<T = any>(key: string): Promise<T | null> {
    try {
      const data = await redisClient.get(key)
      if (data) {
        this.stats.hits++
        cacheLogger.debug('Cache hit', { key })
        return JSON.parse(data) as T
      }
      this.stats.misses++
      cacheLogger.debug('Cache miss', { key })
      return null
    } catch (error) {
      this.stats.errors++
      cacheLogger.error('Cache get error', { key, error })
      return null
    }
  }

  /**
   * Set a value in cache with optional TTL
   */
  async set<T = any>(key: string, value: T, ttl?: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value)
      const ttlSeconds = ttl || this.defaultTTL
      await redisClient.setex(key, ttlSeconds, serialized)
      this.stats.sets++
      cacheLogger.debug('Cache set', { key, ttl: ttlSeconds })
    } catch (error) {
      this.stats.errors++
      cacheLogger.error('Cache set error', { key, error })
    }
  }

  /**
   * Delete one or multiple keys
   */
  async del(keys: string | string[]): Promise<number> {
    try {
      const keyArray = Array.isArray(keys) ? keys : [keys]
      if (keyArray.length === 0) return 0
      
      const deleted = await redisClient.del(...keyArray)
      this.stats.deletes += deleted
      cacheLogger.debug('Cache deleted', { count: deleted })
      return deleted
    } catch (error) {
      this.stats.errors++
      cacheLogger.error('Cache del error', { error })
      return 0
    }
  }

  /**
   * Cache-aside pattern: get from cache or compute and cache
   */
  async remember<T = any>(
    key: string,
    ttl: number,
    fn: () => Promise<T>
  ): Promise<T> {
    try {
      const cached = await this.get<T>(key)
      if (cached !== null) {
        return cached
      }

      const result = await fn()
      await this.set(key, result, ttl)
      return result
    } catch (error) {
      this.stats.errors++
      cacheLogger.error('Cache remember error', { key, error })
      throw error
    }
  }

  /**
   * Invalidate all keys matching a pattern (non-blocking SCAN)
   */
  async invalidatePattern(pattern: string): Promise<number> {
    try {
      let cursor = '0'
      let deletedCount = 0
      const batchSize = 100

      do {
        const [newCursor, keys] = await redisClient.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          batchSize
        )
        cursor = newCursor

        if (keys.length > 0) {
          const deleted = await redisClient.del(...keys)
          deletedCount += deleted
        }
      } while (cursor !== '0')

      this.stats.deletes += deletedCount
      cacheLogger.debug('Pattern invalidated', { pattern, count: deletedCount })
      return deletedCount
    } catch (error) {
      this.stats.errors++
      cacheLogger.error('Pattern invalidation error', { pattern, error })
      return 0
    }
  }

  /**
   * Tag-based invalidation: associate keys with tags for grouped invalidation
   */
  async tag(tags: string[], key: string): Promise<void> {
    try {
      for (const tag of tags) {
        await redisClient.sadd(`tag:${tag}`, key)
      }
      cacheLogger.debug('Cache tagged', { key, tags })
    } catch (error) {
      this.stats.errors++
      cacheLogger.error('Tag error', { key, tags, error })
    }
  }

  /**
   * Invalidate all keys associated with a tag
   */
  async invalidateTag(tag: string): Promise<number> {
    try {
      const keys = await redisClient.smembers(`tag:${tag}`)
      if (keys.length > 0) {
        await redisClient.del(...keys)
        await redisClient.del(`tag:${tag}`)
        this.stats.deletes += keys.length
        cacheLogger.debug('Tag invalidated', { tag, count: keys.length })
      }
      return keys.length
    } catch (error) {
      this.stats.errors++
      cacheLogger.error('Tag invalidation error', { tag, error })
      return 0
    }
  }

  /**
   * Increment a numeric value in cache
   */
  async increment(key: string, amount = 1): Promise<number> {
    try {
      const result = await redisClient.incrby(key, amount)
      cacheLogger.debug('Cache incremented', { key, amount, result })
      return result
    } catch (error) {
      this.stats.errors++
      cacheLogger.error('Increment error', { key, error })
      return 0
    }
  }

  /**
   * Set a value with expiration in seconds
   */
  async expire(key: string, seconds: number): Promise<boolean> {
    try {
      const result = await redisClient.expire(key, seconds)
      return result === 1
    } catch (error) {
      this.stats.errors++
      cacheLogger.error('Expire error', { key, error })
      return false
    }
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const total = this.stats.hits + this.stats.misses
    const hitRate = total > 0 ? Math.round((this.stats.hits / total) * 100) : 0
    return { ...this.stats, hitRate, total }
  }

  /**
   * Reset cache statistics
   */
  resetStats() {
    this.stats = { hits: 0, misses: 0, sets: 0, deletes: 0, errors: 0 }
  }

  /**
   * Get Redis server info
   */
  async getRedisInfo() {
    try {
      return await redisClient.info()
    } catch (error) {
      cacheLogger.error('Failed to get Redis info', { error })
      return null
    }
  }

  /**
   * Flush all cache (use with caution)
   */
  async flush(): Promise<void> {
    try {
      await redisClient.flushdb()
      this.stats.deletes++
      cacheLogger.warn('Cache flushed')
    } catch (error) {
      this.stats.errors++
      cacheLogger.error('Flush error', { error })
    }
  }

  /**
   * Close Redis connection
   */
  async disconnect(): Promise<void> {
    try {
      await redisClient.quit()
      cacheLogger.info('Redis disconnected')
    } catch (error) {
      cacheLogger.error('Disconnect error', { error })
    }
  }
}

// Export singleton instance
export const cacheService = CacheService.getInstance()

// ── Key patterns ──────────────────────────────────────────────────────────────

export const CacheKeys = {
  group: (id: string) => `group:${id}`,
  allGroups: () => 'groups:all',
  userMetrics: (id: string) => `user:metrics:${id}`,
  groupMetrics: (id: string) => `group:metrics:${id}`,
} as const

// ── Core helpers (backward compatibility) ──────────────────────────────────────

export async function cacheSet(key: string, value: string, ttlSeconds = 60) {
  return redisClient.set(key, value, 'EX', ttlSeconds)
}

export async function cacheGet(key: string): Promise<string | null> {
  return redisClient.get(key)
}

export async function cacheDel(key: string) {
  return redisClient.del(key)
}

// ── Invalidation ──────────────────────────────────────────────────────────────

/**
 * Deletes all keys matching a glob pattern using SCAN (non-blocking).
 */
export async function invalidatePattern(pattern: string): Promise<number> {
  let cursor = '0'
  let deleted = 0
  do {
    const [next, keys] = await redisClient.scan(cursor, 'MATCH', pattern, 'COUNT', 100)
    cursor = next
    if (keys.length) {
      await redisClient.del(...keys)
      deleted += keys.length
    }
  } while (cursor !== '0')
  cacheLogger.debug('Cache invalidated', { pattern, deleted })
  return deleted
}

/** Invalidates all cached data for a specific group. */
export async function invalidateGroup(groupId: string) {
  await Promise.all([
    cacheDel(CacheKeys.group(groupId)),
    cacheDel(CacheKeys.groupMetrics(groupId)),
    cacheDel(CacheKeys.allGroups()),
  ])
}

// ── Cache warming ─────────────────────────────────────────────────────────────

/**
 * Pre-populates Redis with active groups from the database.
 * Call on startup or after a cache flush.
 */
export async function warmCache(): Promise<{ warmed: number }> {
  let warmed = 0
  try {
    const groups = await dbService.getAllGroups()
    await Promise.all(
      groups.map(async (group) => {
        await cacheSet(CacheKeys.group(group.id), JSON.stringify(group), 300)
        warmed++
      })
    )
    await cacheSet(CacheKeys.allGroups(), JSON.stringify(groups), 300)
    cacheLogger.info('Cache warmed', { warmed })
  } catch (err) {
    cacheLogger.error('Cache warming failed', { error: err instanceof Error ? err.message : String(err) })
  }
  return { warmed }
}

// ── Redis metrics ─────────────────────────────────────────────────────────────

export async function getRedisMetrics() {
  try {
    const info = await redisClient.info()
    const parse = (key: string): string => {
      const match = info.match(new RegExp(`${key}:(\\S+)`))
      return match ? match[1] : '0'
    }
    return {
      connected: redisClient.status === 'ready',
      usedMemoryHuman: parse('used_memory_human'),
      connectedClients: parseInt(parse('connected_clients'), 10),
      totalCommandsProcessed: parseInt(parse('total_commands_processed'), 10),
      keyspaceHits: parseInt(parse('keyspace_hits'), 10),
      keyspaceMisses: parseInt(parse('keyspace_misses'), 10),
      hitRate: (() => {
        const hits = parseInt(parse('keyspace_hits'), 10)
        const misses = parseInt(parse('keyspace_misses'), 10)
        const total = hits + misses
        return total > 0 ? Math.round((hits / total) * 100) : 0
      })(),
      uptimeSeconds: parseInt(parse('uptime_in_seconds'), 10),
    }
  } catch {
    return { connected: false }
  }
}

// ── Group fetch with caching ──────────────────────────────────────────────────

export async function getGroupWithCache(groupId: string) {
  const key = CacheKeys.group(groupId)
  const cached = await redisClient.get(key)
  if (cached) return JSON.parse(cached)

  const dbGroup = await dbService.getGroup(groupId)
  if (dbGroup) {
    await cacheSet(key, JSON.stringify(dbGroup), 300)
    return dbGroup
  }

  const blockchainData = await sorobanService.getGroup(groupId)
  if (!blockchainData) throw new Error('Group not found on blockchain')

  const freqMap: Record<string, number> = { daily: 1, weekly: 7, monthly: 30 }
  const upserted = await dbService.upsertGroup(groupId, {
    name: blockchainData.name,
    contributionAmount: BigInt(blockchainData.contributionAmount),
    frequency: freqMap[blockchainData.frequency] ?? 30,
    maxMembers: blockchainData.maxMembers,
    isActive: blockchainData.isActive,
  })
  await cacheSet(key, JSON.stringify(upserted), 300)
  return upserted
}

export async function recordContribution(groupId: string, walletAddress: string, amount: bigint, round: number, txHash: string) {
  const existing = await dbService.getContributionByTxHash(txHash)
  if (existing) return existing
  const result = await dbService.addContribution({ groupId, walletAddress, amount, round, txHash })
  await invalidateGroup(groupId)
  return result
}

export async function getAllGroupsFast() {
  const cached = await cacheGet(CacheKeys.allGroups())
  if (cached) return JSON.parse(cached)
  const groups = await dbService.getAllGroups()
  await cacheSet(CacheKeys.allGroups(), JSON.stringify(groups), 300)
  return groups
}
