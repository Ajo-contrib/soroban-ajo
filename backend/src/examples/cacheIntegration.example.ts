/**
 * CACHE INTEGRATION EXAMPLES
 * 
 * This file demonstrates how to integrate the Redis caching layer
 * into existing routes and services.
 */

// ════════════════════════════════════════════════════════════════════════════
// 1. GROUPS CONTROLLER - Route-Level Caching
// ════════════════════════════════════════════════════════════════════════════

import { Router, Request, Response } from 'express'
import { cacheService } from '../services/cacheService'
import { CacheInvalidationManager } from '../utils/cacheInvalidation'
import { cacheKeys } from '../utils/cacheKeys'
import {
  detailCacheMiddleware,
  listCacheMiddleware,
  apiCacheMiddleware,
} from '../middleware/cache'
import { CACHE_TTL } from '../config/cache.config'

export const createGroupsRouter = (groupService: any, authMiddleware: any) => {
  const router = Router()

  /**
   * GET /groups
   * List all groups with 10-minute cache
   */
  router.get('/groups', listCacheMiddleware(600), async (req: Request, res: Response) => {
    try {
      const { page = 1, limit = 20 } = req.query
      const groups = await groupService.getAllGroups(
        Number(page),
        Number(limit)
      )
      res.json(groups)
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  })

  /**
   * GET /groups/:id
   * Get group details with 15-minute cache
   */
  router.get('/groups/:id', detailCacheMiddleware(900), async (req: Request, res: Response) => {
    try {
      const group = await groupService.getGroupById(req.params.id)
      if (!group) {
        return res.status(404).json({ error: 'Group not found' })
      }
      res.json(group)
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  })

  /**
   * GET /groups/:id/members
   * Get group members with 10-minute cache
   */
  router.get('/groups/:id/members', apiCacheMiddleware(600), async (req: Request, res: Response) => {
    try {
      const members = await groupService.getGroupMembers(req.params.id)
      res.json(members)
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  })

  /**
   * GET /groups/:id/contributions
   * Get group contributions with 5-minute cache
   */
  router.get(
    '/groups/:id/contributions',
    apiCacheMiddleware(300),
    async (req: Request, res: Response) => {
      try {
        const contributions = await groupService.getContributions(req.params.id)
        res.json(contributions)
      } catch (error) {
        res.status(500).json({ error: error.message })
      }
    }
  )

  /**
   * POST /groups
   * Create a new group
   */
  router.post('/groups', authMiddleware, async (req: Request, res: Response) => {
    try {
      const newGroup = await groupService.createGroup(req.body)

      // Invalidate group list cache
      await CacheInvalidationManager.invalidatePattern(
        cacheKeys.groupList()
      )

      res.status(201).json(newGroup)
    } catch (error) {
      res.status(400).json({ error: error.message })
    }
  })

  /**
   * PUT /groups/:id
   * Update group details
   */
  router.put('/groups/:id', authMiddleware, async (req: Request, res: Response) => {
    try {
      const updated = await groupService.updateGroup(req.params.id, req.body)

      // Invalidate all group-related caches
      await CacheInvalidationManager.invalidateGroupCache(req.params.id)

      // Also invalidate the group list
      await CacheInvalidationManager.invalidatePattern(
        cacheKeys.groupList()
      )

      res.json(updated)
    } catch (error) {
      res.status(400).json({ error: error.message })
    }
  })

  /**
   * DELETE /groups/:id
   * Delete a group
   */
  router.delete('/groups/:id', authMiddleware, async (req: Request, res: Response) => {
    try {
      await groupService.deleteGroup(req.params.id)

      // Invalidate all group-related caches
      await CacheInvalidationManager.invalidateGroupCache(req.params.id)
      await CacheInvalidationManager.invalidatePattern(
        cacheKeys.groupList()
      )

      res.json({ success: true })
    } catch (error) {
      res.status(400).json({ error: error.message })
    }
  })

  return router
}

// ════════════════════════════════════════════════════════════════════════════
// 2. USERS CONTROLLER - Service-Level Caching
// ════════════════════════════════════════════════════════════════════════════

export class CachedUserService {
  constructor(private userService: any) {}

  /**
   * Get user profile with cache-aside pattern
   */
  async getProfile(walletAddress: string) {
    return cacheService.remember(
      cacheKeys.userProfile(walletAddress),
      CACHE_TTL.USER_PROFILE,
      () => this.userService.getProfileFromDb(walletAddress)
    )
  }

  /**
   * Get user statistics with cache-aside pattern
   */
  async getUserStats(walletAddress: string) {
    return cacheService.remember(
      cacheKeys.userStats(walletAddress),
      CACHE_TTL.USER_STATS,
      () => this.userService.calculateStats(walletAddress)
    )
  }

  /**
   * Update user profile and invalidate cache
   */
  async updateProfile(walletAddress: string, data: any) {
    const updated = await this.userService.updateProfileInDb(walletAddress, data)

    // Invalidate all user caches
    await CacheInvalidationManager.invalidateUserCache(walletAddress)

    return updated
  }

  /**
   * Get user achievements with caching
   */
  async getAchievements(walletAddress: string) {
    return cacheService.remember(
      cacheKeys.userAchievements(walletAddress),
      CACHE_TTL.USER_ACHIEVEMENTS,
      () => this.userService.fetchAchievements(walletAddress)
    )
  }

  /**
   * Award achievement and invalidate relevant caches
   */
  async awardAchievement(walletAddress: string, achievementId: string) {
    const result = await this.userService.awardAchievementInDb(
      walletAddress,
      achievementId
    )

    // Invalidate caches that are affected
    await CacheInvalidationManager.invalidateUserCache(walletAddress)
    await CacheInvalidationManager.invalidateLeaderboardCache()
    await CacheInvalidationManager.invalidateActivityCache()

    return result
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 3. LEADERBOARD SERVICE - Complex Caching Strategy
// ════════════════════════════════════════════════════════════════════════════

export class CachedLeaderboardService {
  constructor(private leaderboardService: any) {}

  /**
   * Get top contributors with tag-based caching
   */
  async getTopContributors(limit = 100) {
    const key = cacheKeys.leaderboardTopContributors(limit)
    const tag = 'leaderboard:contributors'

    return cacheService.remember(
      key,
      CACHE_TTL.LEADERBOARD,
      () => this.leaderboardService.fetchTopContributors(limit)
    )
  }

  /**
   * Get user rank with cache-aside pattern
   */
  async getUserRank(walletAddress: string, type: 'contributor' | 'saver') {
    return cacheService.remember(
      cacheKeys.leaderboardUserRank(walletAddress, type),
      CACHE_TTL.LEADERBOARD,
      () => this.leaderboardService.calculateUserRank(walletAddress, type)
    )
  }

  /**
   * Record contribution and cascade invalidation
   */
  async recordContribution(walletAddress: string, groupId: string, amount: number) {
    const result = await this.leaderboardService.recordInDb(
      walletAddress,
      groupId,
      amount
    )

    // Cascade invalidation: contribution affects multiple caches
    await CacheInvalidationManager.invalidateContributionChange(
      groupId,
      walletAddress
    )

    // Also invalidate specific leaderboard entries
    await cacheService.del(cacheKeys.leaderboardUserRank(walletAddress, 'contributor'))

    return result
  }

  /**
   * Get activity feed with cache
   */
  async getActivityFeed(walletAddress: string, limit = 50) {
    return cacheService.remember(
      cacheKeys.activityFeed(walletAddress, limit),
      CACHE_TTL.ACTIVITY_FEED,
      () => this.leaderboardService.fetchActivityFeed(walletAddress, limit)
    )
  }

  /**
   * Record activity and invalidate feeds
   */
  async recordActivity(walletAddress: string, action: string, data: any) {
    const result = await this.leaderboardService.recordActivityInDb(
      walletAddress,
      action,
      data
    )

    // Invalidate activity feeds
    await CacheInvalidationManager.invalidateActivityCache()

    return result
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 4. GAMIFICATION SERVICE - Tag-Based Caching
// ════════════════════════════════════════════════════════════════════════════

export class CachedGamificationService {
  constructor(private gamificationService: any) {}

  /**
   * Get user achievements
   */
  async getAchievements(walletAddress: string) {
    return cacheService.remember(
      cacheKeys.userAchievements(walletAddress),
      CACHE_TTL.USER_ACHIEVEMENTS,
      () => this.gamificationService.fetchAchievements(walletAddress)
    )
  }

  /**
   * Award points and invalidate caches
   */
  async awardPoints(walletAddress: string, points: number, reason: string) {
    const result = await this.gamificationService.awardPointsInDb(
      walletAddress,
      points,
      reason
    )

    // Cascade gamification invalidation
    await CacheInvalidationManager.invalidateGamificationChange(walletAddress)

    return result
  }

  /**
   * Get user badges
   */
  async getBadges(walletAddress: string) {
    return cacheService.remember(
      `badges:${walletAddress}`,
      CACHE_TTL.USER_ACHIEVEMENTS,
      () => this.gamificationService.fetchBadges(walletAddress)
    )
  }

  /**
   * Award badge and invalidate
   */
  async awardBadge(walletAddress: string, badgeId: string) {
    const result = await this.gamificationService.awardBadgeInDb(
      walletAddress,
      badgeId
    )

    // Invalidate related caches
    await CacheInvalidationManager.invalidateUserCache(walletAddress)
    await CacheInvalidationManager.invalidateLeaderboardCache()

    return result
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 5. HEALTH CHECK & MONITORING ENDPOINTS
// ════════════════════════════════════════════════════════════════════════════

import { cacheMonitor } from '../services/cacheMonitor'

export const createCacheMonitoringRouter = () => {
  const router = Router()

  /**
   * GET /health/cache
   * Check cache health status
   */
  router.get('/health/cache', async (req: Request, res: Response) => {
    try {
      const health = await cacheMonitor.getHealthStatus()
      const metrics = await cacheMonitor.getMetrics()

      const statusCode = health.isHealthy ? 200 : 503
      res.status(statusCode).json({
        status: health.isHealthy ? 'healthy' : 'unhealthy',
        health,
        metrics,
        timestamp: new Date(),
      })
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  })

  /**
   * GET /metrics/cache
   * Get cache performance metrics
   */
  router.get('/metrics/cache', async (req: Request, res: Response) => {
    try {
      const summary = await cacheMonitor.getPerformanceSummary()
      const stats = cacheService.getStats()

      res.json({
        performance: summary,
        serviceStats: stats,
        timestamp: new Date(),
      })
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  })

  /**
   * GET /metrics/cache/top-keys
   * Get top memory-consuming keys
   */
  router.get('/metrics/cache/top-keys', async (req: Request, res: Response) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 10, 100)
      const topKeys = await cacheMonitor.getTopKeys(limit)

      res.json({
        topKeys,
        limit,
        timestamp: new Date(),
      })
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  })

  /**
   * POST /cache/flush
   * Flush all cache (admin only)
   */
  router.post('/cache/flush', async (req: Request, res: Response) => {
    try {
      await cacheService.flush()
      res.json({
        success: true,
        message: 'Cache flushed',
        timestamp: new Date(),
      })
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  })

  /**
   * POST /cache/warmup
   * Warm cache with critical data (admin only)
   */
  router.post('/cache/warmup', async (req: Request, res: Response) => {
    try {
      // Example: warm up groups and top leaderboards
      const leaderboardService = req.app.locals.leaderboardService
      
      const topContributors = await leaderboardService.getTopContributors(100)
      const topSavers = await leaderboardService.getTopSavers(100)

      res.json({
        success: true,
        message: 'Cache warmed up',
        timestamp: new Date(),
      })
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  })

  return router
}

// ════════════════════════════════════════════════════════════════════════════
// 6. SETUP & INTEGRATION
// ════════════════════════════════════════════════════════════════════════════

/**
 * Example: Initialize and integrate all caching services
 */
export const initializeCache = (app: any) => {
  // Initialize services with caching
  const userService = new CachedUserService(app.locals.userService)
  const leaderboardService = new CachedLeaderboardService(
    app.locals.leaderboardService
  )
  const gamificationService = new CachedGamificationService(
    app.locals.gamificationService
  )

  // Store in app locals for access in routes
  app.locals.cachedUserService = userService
  app.locals.cachedLeaderboardService = leaderboardService
  app.locals.cachedGamificationService = gamificationService

  // Mount routers
  app.use('/api', createGroupsRouter(app.locals.groupService, app.locals.auth))
  app.use('/api', createCacheMonitoringRouter())

  // Start cache monitoring
  cacheMonitor.startMonitoring(60000) // Check every minute

  console.log('✅ Cache layer initialized')
}
