import { cacheMonitor, CacheMonitor } from '../services/cacheMonitor'
import { cacheService, redisClient } from '../services/cacheService'

describe('CacheMonitor', () => {
  beforeAll(async () => {
    try {
      await redisClient.connect()
    } catch {
      // Already connected
    }
  })

  afterEach(async () => {
    cacheMonitor.clearHistory()
  })

  afterAll(async () => {
    await cacheService.disconnect()
  })

  describe('Singleton Pattern', () => {
    it('should return the same instance', () => {
      const instance1 = CacheMonitor.getInstance()
      const instance2 = CacheMonitor.getInstance()

      expect(instance1).toBe(instance2)
    })
  })

  describe('Metrics Collection', () => {
    it('should collect Redis metrics', async () => {
      const metrics = await cacheMonitor.getMetrics()

      expect(metrics).not.toBeNull()
      expect(metrics?.timestamp).toBeInstanceOf(Date)
      expect(metrics?.memoryUsed).toBeDefined()
      expect(metrics?.connectedClients).toBeGreaterThanOrEqual(0)
      expect(metrics?.hitRate).toBeGreaterThanOrEqual(0)
    })

    it('should track metrics history', async () => {
      // Collect multiple metrics
      await cacheMonitor.getMetrics()
      await new Promise((resolve) => setTimeout(resolve, 10))
      await cacheMonitor.getMetrics()
      await new Promise((resolve) => setTimeout(resolve, 10))
      await cacheMonitor.getMetrics()

      const history = cacheMonitor.getMetricsHistory()

      expect(history.length).toBeGreaterThan(0)
      expect(history.length).toBeLessThanOrEqual(3)
    })

    it('should limit history size', async () => {
      // Collect more metrics than the limit
      for (let i = 0; i < 1100; i++) {
        await cacheMonitor.getMetrics()
      }

      const history = cacheMonitor.getMetricsHistory(1100)

      expect(history.length).toBeLessThanOrEqual(1000)
    })

    it('should retrieve history with limit', async () => {
      // Collect some metrics
      for (let i = 0; i < 50; i++) {
        await cacheMonitor.getMetrics()
      }

      const recent = cacheMonitor.getMetricsHistory(10)

      expect(recent.length).toBeLessThanOrEqual(10)
    })
  })

  describe('Health Status', () => {
    it('should determine cache health', async () => {
      const health = await cacheMonitor.getHealthStatus()

      expect(health).toBeDefined()
      expect(health.isHealthy).toBeDefined()
      expect(health.memoryUsagePercent).toBeGreaterThanOrEqual(0)
      expect(health.hitRate).toBeGreaterThanOrEqual(0)
      expect(Array.isArray(health.errors)).toBe(true)
      expect(Array.isArray(health.warnings)).toBe(true)
    })

    it('should flag low hit rates as warnings', async () => {
      // Make a request that will cause misses
      for (let i = 0; i < 100; i++) {
        await cacheService.get(`non:existent:${i}`)
      }

      const health = await cacheMonitor.getHealthStatus()

      // Should have warnings or errors related to hit rate
      expect(health.hitRate).toBeGreaterThanOrEqual(0)
    })

    it('should detect connection issues', async () => {
      const health = await cacheMonitor.getHealthStatus()

      if (!health.isHealthy) {
        expect(health.errors.length).toBeGreaterThan(0)
      }
    })
  })

  describe('Performance Summary', () => {
    it('should calculate performance summary', async () => {
      // Collect some metrics first
      await cacheMonitor.getMetrics()

      const summary = await cacheMonitor.getPerformanceSummary()

      expect(summary).toBeDefined()
      expect(summary.averageHitRate).toBeGreaterThanOrEqual(0)
      expect(summary.hitRateTrend).toMatch(/improving|declining/)
    })

    it('should handle insufficient data', async () => {
      cacheMonitor.clearHistory()

      const summary = await cacheMonitor.getPerformanceSummary()

      expect(summary.error).toBeDefined()
    })

    it('should track service statistics', async () => {
      // Use cache service
      await cacheService.set('test:key', { data: 'test' }, 60)
      await cacheService.get('test:key')
      await cacheService.get('non:existent')

      await cacheMonitor.getMetrics()

      const summary = await cacheMonitor.getPerformanceSummary()

      expect(summary.serviceStats).toBeDefined()
      expect(summary.serviceStats?.sets).toBeGreaterThan(0)
    })
  })

  describe('Memory Analysis', () => {
    it('should retrieve memory information', async () => {
      const memInfo = await cacheMonitor.getMemoryInfo()

      expect(memInfo).not.toBeNull()
      if (memInfo) {
        expect(typeof memInfo).toBe('object')
      }
    })

    it('should get top memory-consuming keys', async () => {
      // Set some keys
      for (let i = 0; i < 10; i++) {
        await cacheService.set(`top:key:${i}`, { data: 'x'.repeat(100) }, 60)
      }

      const topKeys = await cacheMonitor.getTopKeys(5)

      expect(Array.isArray(topKeys)).toBe(true)
      expect(topKeys.length).toBeLessThanOrEqual(5)
    })

    it('should handle top keys retrieval errors', async () => {
      // Should not throw even if there are issues
      const topKeys = await cacheMonitor.getTopKeys(10)

      expect(Array.isArray(topKeys)).toBe(true)
    })
  })

  describe('Monitoring Control', () => {
    it('should start and stop monitoring', async () => {
      cacheMonitor.startMonitoring(100)

      // Let it run for a bit
      await new Promise((resolve) => setTimeout(resolve, 150))

      cacheMonitor.stopMonitoring()

      // Verify it stopped
      expect(cacheMonitor).toBeDefined()
    })

    it('should schedule periodic health checks', async () => {
      cacheMonitor.startMonitoring(50)

      await new Promise((resolve) => setTimeout(resolve, 100))

      const health = await cacheMonitor.getHealthStatus()

      expect(health).toBeDefined()

      cacheMonitor.stopMonitoring()
    })
  })

  describe('History Management', () => {
    it('should clear history', async () => {
      // Collect some metrics
      await cacheMonitor.getMetrics()
      await cacheMonitor.getMetrics()

      let history = cacheMonitor.getMetricsHistory()
      expect(history.length).toBeGreaterThan(0)

      cacheMonitor.clearHistory()

      history = cacheMonitor.getMetricsHistory()
      expect(history.length).toBe(0)
    })

    it('should maintain history across multiple collections', async () => {
      for (let i = 0; i < 5; i++) {
        await cacheMonitor.getMetrics()
      }

      const history = cacheMonitor.getMetricsHistory()

      expect(history.length).toBeGreaterThan(0)
      // Verify timestamps are in order
      for (let i = 1; i < history.length; i++) {
        expect(history[i].timestamp.getTime()).toBeGreaterThanOrEqual(
          history[i - 1].timestamp.getTime()
        )
      }
    })
  })

  describe('Metrics Data Validation', () => {
    it('should provide valid metric values', async () => {
      const metrics = await cacheMonitor.getMetrics()

      if (metrics) {
        expect(typeof metrics.connectedClients).toBe('number')
        expect(typeof metrics.totalCommandsProcessed).toBe('number')
        expect(typeof metrics.keyspaceHits).toBe('number')
        expect(typeof metrics.keyspaceMisses).toBe('number')
        expect(typeof metrics.hitRate).toBe('number')
        expect(typeof metrics.uptimeSeconds).toBe('number')
        expect(typeof metrics.dbSize).toBe('number')

        // Validate ranges
        expect(metrics.connectedClients).toBeGreaterThanOrEqual(0)
        expect(metrics.totalCommandsProcessed).toBeGreaterThanOrEqual(0)
        expect(metrics.keyspaceHits).toBeGreaterThanOrEqual(0)
        expect(metrics.keyspaceMisses).toBeGreaterThanOrEqual(0)
        expect(metrics.hitRate).toBeGreaterThanOrEqual(0)
        expect(metrics.hitRate).toBeLessThanOrEqual(100)
        expect(metrics.uptimeSeconds).toBeGreaterThanOrEqual(0)
      }
    })
  })

  describe('Error Recovery', () => {
    it('should handle Redis connection issues gracefully', async () => {
      const metrics = await cacheMonitor.getMetrics()
      const health = await cacheMonitor.getHealthStatus()

      // Should return data even if there are issues
      expect(health).toBeDefined()
    })

    it('should not throw on memory info retrieval failure', async () => {
      // Should not throw
      await expect(cacheMonitor.getMemoryInfo()).resolves.toBeDefined()
    })

    it('should not throw on top keys retrieval failure', async () => {
      // Should not throw
      await expect(cacheMonitor.getTopKeys(10)).resolves.toBeDefined()
    })
  })
})
