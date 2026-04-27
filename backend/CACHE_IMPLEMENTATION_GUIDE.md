# Redis Caching Layer Implementation Guide

## Overview

The comprehensive Redis caching layer provides high-performance, distributed caching capabilities for the Ajo backend. It includes:

- **CacheService**: Type-safe cache operations with singleton pattern
- **Cache Middleware**: Express middleware for automatic HTTP response caching
- **Cache Invalidation Manager**: Sophisticated invalidation strategies
- **Cache Monitor**: Performance monitoring and health checks

## Quick Start

### Using the Cache Service

```typescript
import { cacheService } from '../services/cacheService'

// Set a value
await cacheService.set('user:123:profile', userProfile, 600) // 10 minutes

// Get a value
const profile = await cacheService.get<User>('user:123:profile')

// Cache-aside pattern
const user = await cacheService.remember(
  'user:123:profile',
  600,
  async () => {
    return await userService.getProfile('123')
  }
)
```

### Using Cache Middleware

```typescript
import { Router } from 'express'
import { apiCacheMiddleware, detailCacheMiddleware } from '../middleware/cache'

const router = Router()

// Cache API responses for 5 minutes
router.get('/api/groups', apiCacheMiddleware(300), async (req, res) => {
  const groups = await groupService.getAll()
  res.json(groups)
})

// Cache detail endpoints for 10 minutes
router.get('/api/groups/:id', detailCacheMiddleware(600), async (req, res) => {
  const group = await groupService.getById(req.params.id)
  res.json(group)
})
```

### Cache Invalidation

```typescript
import { CacheInvalidationManager } from '../utils/cacheInvalidation'

// Invalidate specific key
await CacheInvalidationManager.invalidateKey('user:123:profile')

// Invalidate multiple keys
await CacheInvalidationManager.invalidateKeys([
  'user:123:profile',
  'user:123:stats'
])

// Invalidate pattern
await CacheInvalidationManager.invalidatePattern('user:123:*')

// Domain-specific invalidation
await CacheInvalidationManager.invalidateUserCache('wallet:address')
await CacheInvalidationManager.invalidateGroupCache('group:id')
```

## Advanced Usage

### Cache Tags

```typescript
// Associate keys with tags
await cacheService.tag(['user:1', 'group:2'], 'key:123')

// Invalidate all keys with a tag
await cacheService.invalidateTag('user:1')
```

### Cache with Custom TTL

```typescript
import { CACHE_TTL } from '../config/cache.config'

// Use predefined TTLs
await cacheService.set(
  key,
  value,
  CACHE_TTL.USER_PROFILE // 10 minutes
)

await cacheService.set(
  key,
  value,
  CACHE_TTL.LEADERBOARD // 5 minutes
)
```

### Numeric Operations

```typescript
// Increment counter
const newCount = await cacheService.increment('user:1:score', 10)

// Decrement
const decremented = await cacheService.increment('counter:key', -5)
```

### Cache Monitoring

```typescript
import { cacheMonitor } from '../services/cacheMonitor'

// Get current metrics
const metrics = await cacheMonitor.getMetrics()
console.log(`Memory: ${metrics?.memoryUsed}`)
console.log(`Hit Rate: ${metrics?.hitRate}%`)

// Get health status
const health = await cacheMonitor.getHealthStatus()
if (!health.isHealthy) {
  console.error('Errors:', health.errors)
  console.warn('Warnings:', health.warnings)
}

// Get performance summary
const summary = await cacheMonitor.getPerformanceSummary()
console.log(`Average Hit Rate: ${summary.averageHitRate}%`)
console.log(`Trend: ${summary.hitRateTrend}`)

// Start continuous monitoring
cacheMonitor.startMonitoring(60000) // Check every minute
```

## Route Integration Examples

### Groups Service

```typescript
// controllers/groupsController.ts
import { Router, Request, Response } from 'express'
import { cacheService } from '../services/cacheService'
import { CacheInvalidationManager } from '../utils/cacheInvalidation'
import { detailCacheMiddleware } from '../middleware/cache'
import { cacheKeys } from '../utils/cacheKeys'

const router = Router()

// Get group with automatic caching
router.get(
  '/groups/:id',
  detailCacheMiddleware(600),
  async (req: Request, res: Response) => {
    try {
      const group = await groupService.getGroupById(req.params.id)
      res.json(group)
    } catch (error) {
      res.status(404).json({ error: 'Group not found' })
    }
  }
)

// Create group - invalidate lists
router.post('/groups', async (req: Request, res: Response) => {
  try {
    const newGroup = await groupService.createGroup(req.body)
    
    // Invalidate related caches
    await CacheInvalidationManager.invalidatePattern(cacheKeys.groupList())
    
    res.status(201).json(newGroup)
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

// Update group - selective invalidation
router.put('/groups/:id', async (req: Request, res: Response) => {
  try {
    const updated = await groupService.updateGroup(req.params.id, req.body)
    
    // Invalidate specific group cache
    await CacheInvalidationManager.invalidateGroupCache(req.params.id)
    
    res.json(updated)
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

export default router
```

### Users Service

```typescript
// controllers/usersController.ts
import { cacheService } from '../services/cacheService'
import { CacheInvalidationManager } from '../utils/cacheInvalidation'
import { apiCacheMiddleware } from '../middleware/cache'

router.get('/users/:wallet/stats', apiCacheMiddleware(300), async (req, res) => {
  const stats = await cacheService.remember(
    `user:${req.params.wallet}:stats`,
    CACHE_TTL.USER_STATS,
    async () => {
      return await userService.calculateStats(req.params.wallet)
    }
  )
  res.json(stats)
})

router.put('/users/:wallet/profile', async (req, res) => {
  const updated = await userService.updateProfile(req.params.wallet, req.body)
  
  // Invalidate all user-related caches
  await CacheInvalidationManager.invalidateUserCache(req.params.wallet)
  
  res.json(updated)
})
```

### Leaderboard Service

```typescript
// services/leaderboardService.ts
import { cacheService } from './cacheService'
import { CACHE_TTL } from '../config/cache.config'

export async function getTopContributors(limit = 100) {
  return cacheService.remember(
    `leaderboard:contributors:top:${limit}`,
    CACHE_TTL.LEADERBOARD,
    async () => {
      return await database.query(`
        SELECT * FROM leaderboard_contributors
        ORDER BY contributions DESC
        LIMIT ?
      `, [limit])
    }
  )
}

export async function recordContribution(userId: string, amount: number) {
  await database.recordContribution(userId, amount)
  
  // Invalidate leaderboard cache
  await CacheInvalidationManager.invalidateLeaderboardCache()
}
```

## Cache Configuration

### Environment Variables

```env
# Redis connection
REDIS_URL=redis://localhost:6379

# Cache settings
CACHE_ENABLED=true
CACHE_DEFAULT_TTL=300
CACHE_MAX_MEMORY=256mb
CACHE_EVICTION_POLICY=allkeys-lru
```

### TTL Configuration

Edit `backend/src/config/cache.config.ts`:

```typescript
export const CACHE_TTL = {
  // User data - moderate TTL
  USER_PROFILE: 600,        // 10 minutes
  USER_STATS: 300,          // 5 minutes
  USER_ACHIEVEMENTS: 600,   // 10 minutes

  // Group data - longer TTL
  GROUP_DETAILS: 900,       // 15 minutes
  GROUP_MEMBERS: 600,       // 10 minutes
  GROUP_CONTRIBUTIONS: 300, // 5 minutes

  // Real-time data - shorter TTL
  LEADERBOARD: 300,         // 5 minutes
  ACTIVITY_FEED: 180,       // 3 minutes
  POINTS_BALANCE: 300,      // 5 minutes
}
```

## Cache Key Naming Convention

Use the predefined key generators in `cacheKeys.ts`:

```typescript
import { cacheKeys } from '../utils/cacheKeys'

// User keys
cacheKeys.userProfile(walletAddress)
cacheKeys.userStats(walletAddress)
cacheKeys.userAchievements(walletAddress)

// Group keys
cacheKeys.groupDetails(groupId)
cacheKeys.groupMembers(groupId)
cacheKeys.groupContributions(groupId)

// Leaderboard keys
cacheKeys.leaderboardTopContributors(100)
```

## Middleware Options

### Basic Middleware

```typescript
import { cacheMiddleware } from '../middleware/cache'

// Custom options
app.use(cacheMiddleware({
  ttl: 600,                          // 10 minutes
  exclude: (req) => {                // Exclude certain requests
    return req.path.includes('admin')
  },
  includeQuery: true,                // Include query params in cache key
  includeHeaders: ['authorization'], // Include specific headers
  keyPrefix: 'api:',                 // Custom prefix
  statusCodes: [200, 201],           // Cache specific status codes
}))
```

### Preset Middleware

```typescript
// API endpoints
import { apiCacheMiddleware } from '../middleware/cache'
app.use('/api/data', apiCacheMiddleware(300))

// List endpoints with pagination
import { listCacheMiddleware } from '../middleware/cache'
app.use('/api/items', listCacheMiddleware(300))

// Detail endpoints
import { detailCacheMiddleware } from '../middleware/cache'
app.use('/api/items/:id', detailCacheMiddleware(600))
```

## Monitoring and Debugging

### Health Check Endpoint

```typescript
import { Router } from 'express'
import { cacheMonitor } from '../services/cacheMonitor'

const router = Router()

router.get('/health/cache', async (req, res) => {
  const health = await cacheMonitor.getHealthStatus()
  const metrics = await cacheMonitor.getMetrics()
  
  res.json({
    status: health.isHealthy ? 'healthy' : 'unhealthy',
    health,
    metrics,
  })
})

router.get('/metrics/cache', async (req, res) => {
  const summary = await cacheMonitor.getPerformanceSummary()
  res.json(summary)
})

router.get('/metrics/cache/top-keys', async (req, res) => {
  const topKeys = await cacheMonitor.getTopKeys(10)
  res.json(topKeys)
})
```

### Cache Statistics

```typescript
// Get service statistics
const stats = cacheService.getStats()
console.log(`Hits: ${stats.hits}`)
console.log(`Misses: ${stats.misses}`)
console.log(`Hit Rate: ${stats.hitRate}%`)
console.log(`Total Operations: ${stats.total}`)
console.log(`Errors: ${stats.errors}`)

// Reset stats
cacheService.resetStats()
```

## Performance Best Practices

1. **Choose appropriate TTLs**
   - Real-time data: 1-3 minutes
   - Frequently accessed: 5-10 minutes
   - Stable data: 15-30 minutes

2. **Invalidate strategically**
   - Use pattern invalidation for related keys
   - Use tag-based invalidation for complex dependencies
   - Cascade invalidation for related entities

3. **Monitor cache health**
   - Watch hit rate (aim for > 80%)
   - Monitor memory usage
   - Track error rates

4. **Cache warmth**
   - Pre-populate cache on startup
   - Use remember pattern for expensive operations
   - Implement cache warming for critical data

## Testing

Run the comprehensive test suite:

```bash
# Test cache service
npm test -- cacheService.test.ts

# Test middleware
npm test -- cache.test.ts

# Test invalidation
npm test -- cacheInvalidation.test.ts

# Test monitoring
npm test -- cacheMonitor.test.ts

# Run all cache tests
npm test -- --testPathPattern='cache'
```

## Troubleshooting

### Low Hit Rate
- Check TTL configuration
- Verify cache invalidation isn't too aggressive
- Monitor for cache storms

### High Memory Usage
- Reduce TTL for large objects
- Implement size-based eviction
- Monitor top keys

### Connection Issues
- Verify Redis is running
- Check Redis URL in environment
- Monitor connection pool

## Future Improvements

- [ ] Redis Cluster support
- [ ] Cache compression for large values
- [ ] Advanced analytics dashboard
- [ ] Automatic cache warming
- [ ] Cache performance ML predictions
- [ ] Distributed cache invalidation
