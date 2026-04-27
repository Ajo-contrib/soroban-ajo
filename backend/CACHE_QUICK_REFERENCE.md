# Redis Caching Layer - Quick Reference Guide

## 📌 Common Use Cases

### 1. Cache Route Responses

```typescript
import { detailCacheMiddleware } from '../middleware/cache'

router.get('/api/resource/:id', 
  detailCacheMiddleware(600), // 10 minutes
  handler
)
```

### 2. Cache Service Methods

```typescript
import { cacheService } from '../services/cacheService'

// Set value
await cacheService.set('key', value, 300)

// Get value
const data = await cacheService.get('key')

// Delete
await cacheService.del('key')
```

### 3. Cache-Aside Pattern

```typescript
const result = await cacheService.remember(
  'expensive-key',
  600,
  async () => await expensiveOperation()
)
```

### 4. Invalidate Cache on Update

```typescript
import { CacheInvalidationManager } from '../utils/cacheInvalidation'

router.put('/api/resource/:id', async (req, res) => {
  const updated = await service.update(req.params.id, req.body)
  
  // Invalidate pattern
  await CacheInvalidationManager.invalidatePattern(`resource:${req.params.id}:*`)
  
  res.json(updated)
})
```

## 🔑 Cache Key Helpers

```typescript
import { cacheKeys } from '../utils/cacheKeys'

cacheKeys.userProfile(walletAddress)
cacheKeys.groupDetails(groupId)
cacheKeys.leaderboardTopContributors(100)
cacheKeys.activityFeed(walletAddress, 50)
```

## ⏱️ Common TTL Values

```typescript
import { CACHE_TTL } from '../config/cache.config'

CACHE_TTL.USER_PROFILE          // 600s (10 min)
CACHE_TTL.GROUP_DETAILS         // 900s (15 min)
CACHE_TTL.LEADERBOARD           // 300s (5 min)
CACHE_TTL.ACTIVITY_FEED         // 180s (3 min)
```

## 🎯 Middleware Variants

```typescript
// Automatic response caching with default options
import { apiCacheMiddleware } from '../middleware/cache'
router.get('/api/data', apiCacheMiddleware(300), handler)

// List endpoints with pagination cache
import { listCacheMiddleware } from '../middleware/cache'
router.get('/api/items', listCacheMiddleware(300), handler)

// Detail endpoints with longer cache
import { detailCacheMiddleware } from '../middleware/cache'
router.get('/api/items/:id', detailCacheMiddleware(600), handler)

// Custom options
import { cacheMiddleware } from '../middleware/cache'
router.get('/api/custom', cacheMiddleware({
  ttl: 300,
  exclude: (req) => req.query.nocache === 'true',
  statusCodes: [200],
}), handler)
```

## 🔄 Cascade Invalidation

```typescript
// Multiple related caches invalidated together
await CacheInvalidationManager.invalidateContributionChange(groupId, userId)
await CacheInvalidationManager.invalidateGamificationChange(userId)
await CacheInvalidationManager.invalidateGroupMembershipChange(groupId, userId)
```

## 📊 Monitoring

```typescript
import { cacheMonitor } from '../services/cacheMonitor'

// Get metrics
const metrics = await cacheMonitor.getMetrics()
console.log(metrics.hitRate)

// Check health
const health = await cacheMonitor.getHealthStatus()
if (!health.isHealthy) console.error(health.errors)

// Performance summary
const summary = await cacheMonitor.getPerformanceSummary()
console.log(summary.averageHitRate, summary.hitRateTrend)

// Service stats
const stats = cacheService.getStats()
console.log(stats.hitRate, stats.hits, stats.misses)
```

## 🏥 Health Check

```typescript
// Setup endpoint
router.get('/health/cache', async (req, res) => {
  const health = await cacheMonitor.getHealthStatus()
  const statusCode = health.isHealthy ? 200 : 503
  res.status(statusCode).json(health)
})
```

## 💾 Cache Types

| Type | TTL | Use Case |
|------|-----|----------|
| **Profile** | 10 min | User/group details |
| **Stats** | 5 min | Metrics, analytics |
| **List** | 10 min | Paginated results |
| **Activity** | 3 min | Real-time feeds |
| **Leaderboard** | 5 min | Rankings |
| **Analytics** | 30 min | Historical data |

## ⚙️ Configuration

```bash
# .env
REDIS_URL=redis://localhost:6379
CACHE_ENABLED=true
CACHE_DEFAULT_TTL=300
CACHE_MAX_MEMORY=256mb
```

## 🧪 Testing

```bash
# Run all cache tests
npm test -- --testPathPattern='cache'

# Run specific test
npm test -- cacheService.test.ts

# Watch mode
npm test -- --watch --testPathPattern='cache'
```

## 🔧 Common Patterns

### Pattern 1: Auto-Cache with Middleware
```typescript
router.get('/groups/:id', detailCacheMiddleware(900), async (req, res) => {
  const group = await db.getGroup(req.params.id)
  res.json(group) // Automatically cached
})
```

### Pattern 2: Service-Level Caching
```typescript
export class GroupService {
  async getGroup(id: string) {
    return cacheService.remember(
      `group:${id}`,
      900,
      () => db.getGroup(id)
    )
  }

  async updateGroup(id: string, data: any) {
    const result = await db.updateGroup(id, data)
    await CacheInvalidationManager.invalidateGroupCache(id)
    return result
  }
}
```

### Pattern 3: Domain-Specific Invalidation
```typescript
// When user joins group
await CacheInvalidationManager.invalidateGroupMembershipChange(groupId, userId)

// When contribution is made
await CacheInvalidationManager.invalidateContributionChange(groupId, userId)

// When points awarded
await CacheInvalidationManager.invalidateGamificationChange(userId)
```

### Pattern 4: Warming Cache on Startup
```typescript
async function startServer() {
  const app = express()
  
  // Warm critical caches
  await cacheService.set('critical:data', data, 3600)
  
  app.listen(3000)
}
```

## 🚨 Troubleshooting Quick Tips

| Issue | Solution |
|-------|----------|
| Low hit rate | Check TTL, verify invalidation isn't too aggressive |
| High memory | Reduce TTL for large objects, monitor top keys |
| Redis error | Verify Redis is running, check REDIS_URL |
| Stale data | Review invalidation strategy, check cascade invalidation |
| Slow queries | Check if expensive ops are cached with `remember()` |

## 📱 Response Headers

```
X-Cache: HIT       # Response from cache
X-Cache: MISS      # Response from origin
X-Cache-Key: ...   # Cache key used
```

## 🔗 Quick Links

- **Full Guide**: `backend/CACHE_IMPLEMENTATION_GUIDE.md`
- **Examples**: `backend/src/examples/cacheIntegration.example.ts`
- **Config**: `backend/src/config/cache.config.ts`
- **Tests**: `backend/src/**/__tests__/*cache*.test.ts`

## 📞 Getting Help

1. Check `CACHE_IMPLEMENTATION_GUIDE.md` for detailed docs
2. Review `src/examples/cacheIntegration.example.ts` for code samples
3. Look at test files for usage patterns
4. Review existing implementations in controllers

---

**Pro Tips:**
- Use `remember()` for expensive operations
- Use middleware for automatic response caching
- Use cascade invalidation for related entities
- Monitor hit rate via `/metrics/cache`
- Check health status via `/health/cache`
