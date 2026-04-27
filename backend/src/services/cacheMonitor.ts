import { createModuleLogger } from '../utils/logger'
import { cacheService, redisClient } from './cacheService'

const logger = createModuleLogger('CacheMonitor')

export interface CacheMetrics {
  timestamp: Date
  memoryUsed: string
  connectedClients: number
  totalCommandsProcessed: number
  keyspaceHits: number
  keyspaceMisses: number
  hitRate: number
  uptimeSeconds: number
  dbSize: number
}

export interface CacheHealthStatus {
  isHealthy: boolean
  memoryUsagePercent: number
  hitRate: number
  errors: string[]
  warnings: string[]
}

/**
 * Cache monitoring and metrics service
 * Tracks Redis performance and provides health checks
 */
export class CacheMonitor {
  private static instance: CacheMonitor
  private metricsHistory: CacheMetrics[] = []
  private maxHistoryLength = 1000
  private lastCheckTime = 0
  private checkInterval = 60000 // 1 minute

  private constructor() {}

  static getInstance(): CacheMonitor {
    if (!CacheMonitor.instance) {
      CacheMonitor.instance = new CacheMonitor()
    }
    return CacheMonitor.instance
  }

  /**
   * Get current Redis metrics
   */
  async getMetrics(): Promise<CacheMetrics | null> {
    try {
      const info = await redisClient.info()
      const dbSize = await redisClient.dbsize()

      const parse = (key: string): string => {
        const match = info.match(new RegExp(`${key}:(\\S+)`))
        return match ? match[1] : '0'
      }

      const metrics: CacheMetrics = {
        timestamp: new Date(),
        memoryUsed: parse('used_memory_human'),
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
        dbSize,
      }

      // Store in history (with max limit)
      this.metricsHistory.push(metrics)
      if (this.metricsHistory.length > this.maxHistoryLength) {
        this.metricsHistory.shift()
      }

      return metrics
    } catch (error) {
      logger.error('Failed to get cache metrics', { error })
      return null
    }
  }

  /**
   * Get metrics history
   */
  getMetricsHistory(limit = 100): CacheMetrics[] {
    return this.metricsHistory.slice(-limit)
  }

  /**
   * Get cache health status
   */
  async getHealthStatus(): Promise<CacheHealthStatus> {
    const metrics = await this.getMetrics()
    const errors: string[] = []
    const warnings: string[] = []

    if (!metrics) {
      return {
        isHealthy: false,
        memoryUsagePercent: 0,
        hitRate: 0,
        errors: ['Failed to retrieve Redis metrics'],
        warnings: [],
      }
    }

    // Check connection
    if (!redisClient.connected) {
      errors.push('Redis not connected')
    }

    // Parse memory
    const memoryMatch = metrics.memoryUsed.match(/(\d+\.?\d*)([MKG]B?)/)
    let memoryPercent = 0
    if (memoryMatch) {
      let bytes = parseFloat(memoryMatch[1])
      switch (memoryMatch[2]) {
        case 'GB':
          bytes *= 1024 * 1024 * 1024
          break
        case 'MB':
          bytes *= 1024 * 1024
          break
        case 'KB':
          bytes *= 1024
          break
      }
      // Assume 256MB max memory (from config)
      memoryPercent = Math.round((bytes / (256 * 1024 * 1024)) * 100)
    }

    // Check memory usage
    if (memoryPercent > 90) {
      errors.push(`Memory usage critically high: ${memoryPercent}%`)
    } else if (memoryPercent > 75) {
      warnings.push(`Memory usage high: ${memoryPercent}%`)
    }

    // Check hit rate
    if (metrics.hitRate < 50) {
      warnings.push(`Cache hit rate low: ${metrics.hitRate}%`)
    }

    // Check for slow operations
    if (metrics.totalCommandsProcessed > 1000000) {
      logger.debug('High command volume detected', {
        totalCommands: metrics.totalCommandsProcessed,
      })
    }

    return {
      isHealthy: errors.length === 0,
      memoryUsagePercent: memoryPercent,
      hitRate: metrics.hitRate,
      errors,
      warnings,
    }
  }

  /**
   * Get cache performance summary
   */
  async getPerformanceSummary() {
    const metrics = await this.getMetrics()
    const history = this.getMetricsHistory(60) // Last 60 entries

    if (!metrics || history.length === 0) {
      return { error: 'Insufficient data' }
    }

    // Calculate averages
    const avgHitRate = Math.round(
      history.reduce((sum, m) => sum + m.hitRate, 0) / history.length
    )

    // Trend analysis
    const recentTrend = history.slice(-5)
    const olderTrend = history.slice(-15, -10)
    const recentAvg = recentTrend.reduce((sum, m) => sum + m.hitRate, 0) / recentTrend.length
    const olderAvg = olderTrend.reduce((sum, m) => sum + m.hitRate, 0) / olderTrend.length
    const hitRateTrend = recentAvg > olderAvg ? 'improving' : 'declining'

    return {
      currentMetrics: metrics,
      averageHitRate: avgHitRate,
      hitRateTrend,
      totalKeys: metrics.dbSize,
      serviceStats: cacheService.getStats(),
    }
  }

  /**
   * Start monitoring with periodic health checks
   */
  startMonitoring(interval = this.checkInterval) {
    this.checkInterval = interval
    this.scheduleHealthCheck()
    logger.info('Cache monitoring started', { interval })
  }

  /**
   * Stop monitoring
   */
  stopMonitoring() {
    this.lastCheckTime = 0
    logger.info('Cache monitoring stopped')
  }

  private scheduleHealthCheck() {
    if (this.lastCheckTime) {
      return // Already scheduled
    }

    this.lastCheckTime = Date.now()
    const check = async () => {
      try {
        const health = await this.getHealthStatus()
        if (!health.isHealthy) {
          logger.warn('Cache health check failed', {
            errors: health.errors,
            warnings: health.warnings,
          })
        } else if (health.warnings.length > 0) {
          logger.info('Cache health warnings', { warnings: health.warnings })
        }
      } catch (error) {
        logger.error('Health check error', { error })
      }

      // Schedule next check
      setTimeout(check, this.checkInterval)
    }

    setTimeout(check, this.checkInterval)
  }

  /**
   * Clear metrics history
   */
  clearHistory() {
    this.metricsHistory = []
  }

  /**
   * Get memory usage info
   */
  async getMemoryInfo() {
    try {
      const info = await redisClient.info('memory')
      const lines = info.split('\r\n')
      const memInfo: Record<string, string> = {}

      for (const line of lines) {
        if (line.includes(':')) {
          const [key, value] = line.split(':')
          memInfo[key] = value
        }
      }

      return memInfo
    } catch (error) {
      logger.error('Failed to get memory info', { error })
      return null
    }
  }

  /**
   * Get top memory consuming keys
   */
  async getTopKeys(count = 10): Promise<Array<{ key: string; size: number }>> {
    try {
      const keys = await redisClient.keys('*')
      const keySizes: Array<{ key: string; size: number }> = []

      for (const key of keys) {
        try {
          const size = await redisClient.memory('USAGE', key)
          keySizes.push({ key, size: size || 0 })
        } catch {
          // Skip keys that can't be measured
        }
      }

      return keySizes
        .sort((a, b) => b.size - a.size)
        .slice(0, count)
    } catch (error) {
      logger.error('Failed to get top keys', { error })
      return []
    }
  }
}

// Export singleton instance
export const cacheMonitor = CacheMonitor.getInstance()
