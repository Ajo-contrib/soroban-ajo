import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { PrismaClient } from '@prisma/client'
import { analyticsService } from '../services/analyticsService'
import { biService } from '../services/biService'
import { dataExportService } from '../services/dataExportService'
import { abTestService } from '../services/abTestService'
import { anomalyDetectionService } from '../services/anomalyDetectionService'
import { logger } from '../utils/logger'
import { AuthRequest } from '../middleware/auth'

const prisma = new PrismaClient()
const router = Router()

// Validation schemas
const eventSchema = z.object({
  type: z.string(),
  userId: z.string().optional(),
  groupId: z.string().optional(),
  eventData: z.any().optional(),
})

const dateRangeSchema = z.object({
  start: z.string().datetime().optional(),
  end: z.string().datetime().optional(),
})

// POST /api/analytics — receive events from frontend
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const validatedData = eventSchema.parse(req.body)

    await analyticsService.saveEvent(validatedData.type, validatedData)
    await biService.trackEvent(
      validatedData.type,
      validatedData.userId,
      validatedData.groupId,
      validatedData.eventData
    )

    return res.status(201).json({ success: true })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid data', details: error.errors })
    }
    logger.error('[Analytics Route] Error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /api/analytics/stats — get aggregated stats for dashboard
router.get('/stats', async (req: AuthRequest, res: Response) => {
  try {
    const dateRange = dateRangeSchema.parse(req.query)
    const dateFilter =
      dateRange.start && dateRange.end
        ? {
            start: new Date(dateRange.start),
            end: new Date(dateRange.end),
          }
        : undefined

    const stats = await analyticsService.getStats()
    const advancedMetrics = await biService.calculateAdvancedMetrics(dateFilter)

    return res.json({
      ...stats,
      advancedMetrics,
    })
  } catch (error) {
    logger.error('[Analytics Route] Error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /api/analytics/metrics — get performance metrics
router.get('/metrics', async (_req: Request, res: Response) => {
  try {
    const metrics = await analyticsService.getMetrics()
    return res.json(metrics)
  } catch (error) {
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /api/analytics/advanced — get advanced BI metrics
router.get('/advanced', async (req: AuthRequest, res: Response) => {
  try {
    const dateRange = dateRangeSchema.parse(req.query)
    const dateFilter =
      dateRange.start && dateRange.end
        ? {
            start: new Date(dateRange.start),
            end: new Date(dateRange.end),
          }
        : undefined

    const metrics = await biService.calculateAdvancedMetrics(dateFilter)
    return res.json(metrics)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid date range', details: error.errors })
    }
    logger.error('[Analytics Route] Advanced metrics error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /api/analytics/predictive — get predictive analytics
router.get('/predictive', async (_req: Request, res: Response) => {
  try {
    const predictions = await biService.generatePredictiveMetrics()
    return res.json(predictions)
  } catch (error) {
    logger.error('[Analytics Route] Predictive analytics error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /api/analytics/funnel — get funnel analysis
router.get('/funnel', async (_req: Request, res: Response) => {
  try {
    const funnel = await biService.analyzeFunnel()
    return res.json(funnel)
  } catch (error) {
    logger.error('[Analytics Route] Funnel analysis error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /api/analytics/cohort — get cohort analysis
router.get('/cohort', async (req: AuthRequest, res: Response) => {
  try {
    const { limit = 12 } = req.query
    const cohorts = await biService.getCohortData(Number(limit))
    return res.json(cohorts)
  } catch (error) {
    logger.error('[Analytics Route] Cohort analysis error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// POST /api/analytics/track — track specific event
router.post('/track', async (req: AuthRequest, res: Response) => {
  try {
    const { eventType, userId, groupId, eventData } = req.body

    if (!eventType) {
      return res.status(400).json({ error: 'eventType is required' })
    }

    await biService.trackEvent(eventType, userId, groupId, eventData)

    return res.status(201).json({ success: true })
  } catch (error) {
    logger.error('[Analytics Route] Track event error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /api/analytics/users/:userId/metrics — get user-specific metrics
router.get('/users/:userId/metrics', async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.params
    await biService.updateUserMetrics(userId)

    const userMetrics = await prisma.userMetrics.findUnique({
      where: { userId },
      include: {
        user: {
          select: {
            walletAddress: true,
            createdAt: true,
          },
        },
      },
    })

    if (!userMetrics) {
      return res.status(404).json({ error: 'User metrics not found' })
    }

    return res.json(userMetrics)
  } catch (error) {
    logger.error('[Analytics Route] User metrics error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /api/analytics/groups/:groupId/metrics — get group-specific metrics
router.get('/groups/:groupId/metrics', async (req: AuthRequest, res: Response) => {
  try {
    const { groupId } = req.params
    await biService.updateGroupMetrics(groupId)

    const groupMetrics = await prisma.groupMetrics.findUnique({
      where: { groupId },
      include: {
        group: {
          select: {
            id: true,
            name: true,
            createdAt: true,
            isActive: true,
          },
        },
      },
    })

    if (!groupMetrics) {
      return res.status(404).json({ error: 'Group metrics not found' })
    }

    return res.json(groupMetrics)
  } catch (error) {
    logger.error('[Analytics Route] Group metrics error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

export const analyticsRouter = router

// Export routes
router.post('/export', async (req: AuthRequest, res: Response) => {
  try {
    const { format, dateRange, includeMetrics, includePredictions, includeFunnel } = req.body
    const userId = req.user?.publicKey || 'anonymous'

    const exportRequest = {
      format,
      dateRange: dateRange
        ? {
            start: new Date(dateRange.start),
            end: new Date(dateRange.end),
          }
        : undefined,
      includeMetrics: includeMetrics || false,
      includePredictions: includePredictions || false,
      includeFunnel: includeFunnel || false,
    }

    const exportJob = await dataExportService.createExportJob(userId, exportRequest)
    return res.status(201).json({ exportId: exportJob.id, status: exportJob.status })
  } catch (error) {
    logger.error('[Analytics Route] Export error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/export/:exportId/status', async (req: Request, res: Response) => {
  try {
    const { exportId } = req.params
    const status = await dataExportService.getExportStatus(exportId)

    if (!status) {
      return res.status(404).json({ error: 'Export not found' })
    }

    return res.json(status)
  } catch (error) {
    logger.error('[Analytics Route] Export status error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/export/:exportId/download', async (req: Request, res: Response) => {
  try {
    const { exportId } = req.params
    const exportRecord = await dataExportService.getExportStatus(exportId)

    if (!exportRecord) {
      return res.status(404).json({ error: 'Export not found' })
    }

    if (exportRecord.status !== 'completed' || !exportRecord.filePath) {
      return res.status(400).json({ error: 'Export not ready' })
    }

    const fs = await import('fs')
    if (!fs.existsSync(exportRecord.filePath)) {
      return res.status(404).json({ error: 'Export file not found' })
    }

    res.download(exportRecord.filePath, `analytics.${exportRecord.format}`)
  } catch (error) {
    logger.error('[Analytics Route] Export download error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// A/B Testing routes
router.post('/ab-tests', async (req: Request, res: Response) => {
  try {
    const testConfig = req.body
    const test = await abTestService.createTest(testConfig)
    return res.status(201).json(test)
  } catch (error) {
    logger.error('[Analytics Route] A/B test creation error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/ab-tests/assign', async (req: Request, res: Response) => {
  try {
    const { userId, testName } = req.body
    const variant = await abTestService.assignUser(userId, testName)
    return res.json({ variant })
  } catch (error) {
    logger.error('[Analytics Route] A/B test assignment error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/ab-tests/convert', async (req: Request, res: Response) => {
  try {
    const { userId, testName, metric, value } = req.body
    await abTestService.trackConversion(userId, testName, metric, value)
    return res.json({ success: true })
  } catch (error) {
    logger.error('[Analytics Route] A/B test conversion error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/ab-tests/:testName/results', async (req: Request, res: Response) => {
  try {
    const { testName } = req.params
    const results = await abTestService.getTestResults(testName)
    return res.json(results)
  } catch (error) {
    logger.error('[Analytics Route] A/B test results error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/ab-tests/:testName/stop', async (req: Request, res: Response) => {
  try {
    const { testName } = req.params
    await abTestService.stopTest(testName)
    return res.json({ success: true })
  } catch (error) {
    logger.error('[Analytics Route] A/B test stop error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/ab-tests/active', async (_req: Request, res: Response) => {
  try {
    const tests = await abTestService.getActiveTests()
    return res.json(tests)
  } catch (error) {
    logger.error('[Analytics Route] Active A/B tests error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/ab-tests/history', async (_req: Request, res: Response) => {
  try {
    const tests = await abTestService.getTestHistory()
    return res.json(tests)
  } catch (error) {
    logger.error('[Analytics Route] A/B test history error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// Anomaly Detection routes
router.get('/anomalies', async (req: Request, res: Response) => {
  try {
    const { hours = 24 } = req.query
    const anomalies = await anomalyDetectionService.getRecentAnomalies(Number(hours))
    return res.json(anomalies)
  } catch (error) {
    logger.error('[Analytics Route] Anomalies error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/anomalies/summary', async (_req: Request, res: Response) => {
  try {
    const summary = await anomalyDetectionService.getAnomalySummary()
    return res.json(summary)
  } catch (error) {
    logger.error('[Analytics Route] Anomaly summary error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/anomalies/detect', async (_req: Request, res: Response) => {
  try {
    const anomalies = await anomalyDetectionService.detectAnomalies()
    return res.json(anomalies)
  } catch (error) {
    logger.error('[Analytics Route] Anomaly detection error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/anomalies/config', async (req: Request, res: Response) => {
  try {
    const config = req.body
    await anomalyDetectionService.addMetricConfig(config)
    return res.json({ success: true })
  } catch (error) {
    logger.error('[Analytics Route] Anomaly config error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})
