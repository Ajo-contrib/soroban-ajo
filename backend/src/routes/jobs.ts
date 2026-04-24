import { Router, Request, Response, NextFunction } from 'express'
import { 
  getQueueStatistics, 
  getFailedJobs, 
  getJobById,
  retryFailedJob,
  removeJob,
  getSystemHealth,
  getAllQueueStatistics,
} from '../services/jobMonitor'
import { 
  QUEUE_NAMES,
  addEmailJob,
  EmailJobData,
  addPayoutJob,
  PayoutJobData,
  addSyncJob,
  SyncJobData,
  addNotificationJob,
  NotificationJobData,
} from '../queues'
import { logger } from '../utils/logger'

const router = Router()

// Valid queue names
const validQueues = Object.values(QUEUE_NAMES)

// Middleware to validate queue name
function validateQueueName(req: Request, res: Response, next: NextFunction): void {
  const queueName = req.params.queue
  if (!validQueues.includes(queueName as any)) {
    res.status(400).json({
      error: 'Invalid queue name',
      validQueues,
    })
    return
  }
  next()
}

/**
 * GET /jobs/health
 * Get overall system health
 */
router.get('/health', async (_req: Request, res: Response) => {
  try {
    const health = await getSystemHealth()
    res.json(health)
  } catch (error) {
    logger.error('Failed to get system health', { error })
    res.status(500).json({ error: 'Failed to get system health' })
  }
})

/**
 * GET /jobs/stats
 * Get statistics for all queues
 */
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const stats = await getAllQueueStatistics()
    res.json(stats)
  } catch (error) {
    logger.error('Failed to get queue stats', { error })
    res.status(500).json({ error: 'Failed to get queue statistics' })
  }
})

/**
 * GET /jobs/:queue/stats
 * Get statistics for a specific queue
 */
router.get('/:queue/stats', validateQueueName, async (req: Request, res: Response, _next: NextFunction) => {
  try {
    const { queue } = req.params
    const stats = await getQueueStatistics(queue)
    
    if (!stats) {
      return res.status(404).json({ error: 'Queue not found' })
    }
    
    res.json(stats)
  } catch (error) {
    logger.error('Failed to get queue stats', { error })
    res.status(500).json({ error: 'Failed to get queue statistics' })
  }
})

/**
 * GET /jobs/:queue/failed
 * Get failed jobs from a specific queue
 */
router.get('/:queue/failed', validateQueueName, async (req: Request, res: Response) => {
  try {
    const { queue } = req.params
    const start = parseInt(req.query.start as string) || 0
    const end = parseInt(req.query.end as string) || 10
    
    const failedJobs = await getFailedJobs(queue, start, end)
    res.json({
      queue,
      count: failedJobs.length,
      jobs: failedJobs,
    })
  } catch (error) {
    logger.error('Failed to get failed jobs', { error })
    res.status(500).json({ error: 'Failed to get failed jobs' })
  }
})

/**
 * GET /jobs/:queue/:jobId
 * Get a specific job by ID
 */
router.get('/:queue/:jobId', validateQueueName, async (req: Request, res: Response) => {
  try {
    const { queue, jobId } = req.params
    const job = await getJobById(queue, jobId)
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' })
    }
    
    res.json(job)
  } catch (error) {
    logger.error('Failed to get job', { error })
    res.status(500).json({ error: 'Failed to get job' })
  }
})

/**
 * POST /jobs/:queue/:jobId/retry
 * Retry a failed job
 */
router.post('/:queue/:jobId/retry', validateQueueName, async (req: Request, res: Response) => {
  try {
    const { queue, jobId } = req.params
    const success = await retryFailedJob(queue, jobId)
    
    if (!success) {
      return res.status(404).json({ error: 'Job not found or cannot be retried' })
    }
    
    res.json({ success: true, message: 'Job requeued for retry' })
  } catch (error) {
    logger.error('Failed to retry job', { error })
    res.status(500).json({ error: 'Failed to retry job' })
  }
})

/**
 * DELETE /jobs/:queue/:jobId
 * Remove a specific job
 */
router.delete('/:queue/:jobId', validateQueueName, async (req: Request, res: Response) => {
  try {
    const { queue, jobId } = req.params
    const success = await removeJob(queue, jobId)
    
    if (!success) {
      return res.status(404).json({ error: 'Job not found' })
    }
    
    res.json({ success: true, message: 'Job removed' })
  } catch (error) {
    logger.error('Failed to remove job', { error })
    res.status(500).json({ error: 'Failed to remove job' })
  }
})

// ============================================
// Job submission endpoints
// ============================================

/**
 * POST /jobs/email
 * Add an email job to the queue
 */
router.post('/email', async (req: Request, res: Response) => {
  try {
    const emailData: EmailJobData = req.body
    
    if (!emailData.to || !emailData.subject || !emailData.body) {
      return res.status(400).json({ 
        error: 'Missing required fields: to, subject, body' 
      })
    }
    
    const jobId = await addEmailJob(emailData, {
      delay: req.body.delay,
      priority: req.body.priority,
    })
    
    res.status(201).json({ success: true, jobId })
  } catch (error) {
    logger.error('Failed to add email job', { error })
    res.status(500).json({ error: 'Failed to add email job' })
  }
})

/**
 * POST /jobs/payout
 * Add a payout job to the queue
 */
router.post('/payout', async (req: Request, res: Response) => {
  try {
    const payoutData: PayoutJobData = req.body
    
    if (!payoutData.groupId || !payoutData.recipientId || 
        !payoutData.recipientAddress || !payoutData.amount) {
      return res.status(400).json({ 
        error: 'Missing required fields: groupId, recipientId, recipientAddress, amount' 
      })
    }
    
    const jobId = await addPayoutJob(payoutData, {
      delay: req.body.delay,
      priority: req.body.priority,
      attempts: req.body.attempts,
    })
    
    res.status(201).json({ success: true, jobId })
  } catch (error) {
    logger.error('Failed to add payout job', { error })
    res.status(500).json({ error: 'Failed to add payout job' })
  }
})

/**
 * POST /jobs/sync
 * Add a sync job to the queue
 */
router.post('/sync', async (req: Request, res: Response) => {
  try {
    const syncData: SyncJobData = req.body
    
    if (!syncData.groupId || !syncData.syncType) {
      return res.status(400).json({ 
        error: 'Missing required fields: groupId, syncType' 
      })
    }
    
    const jobId = await addSyncJob(syncData, {
      delay: req.body.delay,
      priority: req.body.priority,
    })
    
    res.status(201).json({ success: true, jobId })
  } catch (error) {
    logger.error('Failed to add sync job', { error })
    res.status(500).json({ error: 'Failed to add sync job' })
  }
})

/**
 * POST /jobs/notification
 * Add a notification job to the queue
 */
router.post('/notification', async (req: Request, res: Response) => {
  try {
    const notificationData: NotificationJobData = req.body
    
    if (!notificationData.userId || !notificationData.type || 
        !notificationData.title || !notificationData.message) {
      return res.status(400).json({ 
        error: 'Missing required fields: userId, type, title, message' 
      })
    }
    
    const jobId = await addNotificationJob(notificationData, {
      delay: req.body.delay,
      priority: req.body.priority,
    })
    
    res.status(201).json({ success: true, jobId })
  } catch (error) {
    logger.error('Failed to add notification job', { error })
    res.status(500).json({ error: 'Failed to add notification job' })
  }
})

export const jobsRouter = router
