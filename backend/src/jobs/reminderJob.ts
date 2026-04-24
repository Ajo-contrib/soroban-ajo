import { Job } from 'bullmq'
import { logger } from '../utils/logger'

export interface ReminderJobData {
  type: 'daily_contribution' | 'weekly_summary' | 'monthly_report'
}

export async function processReminderJob(job: Job<ReminderJobData>): Promise<void> {
  logger.info('Processing reminder job', {
    jobId: job.id,
    type: job.data.type,
  })

  try {
    switch (job.data.type) {
      case 'daily_contribution': {
        const { SorobanService } = await import('../services/sorobanService')
        const service = new SorobanService()
        const groups = await service.getAllGroups({ page: 1, limit: 100 })
        const activeGroups = groups.data.filter((g) => g.isActive)

        logger.info('Contribution reminders processed', {
          jobId: job.id,
          activeGroups: activeGroups.length,
          totalMembers: activeGroups.reduce((sum, g) => sum + g.currentMembers, 0),
        })
        break
      }

      case 'weekly_summary': {
        const { sendWeeklyReports } = await import('../services/reportService')
        const result = await sendWeeklyReports()
        logger.info('Weekly summary reports dispatched', { jobId: job.id, ...result })
        break
      }

      case 'monthly_report': {
        const { sendMonthlyReports } = await import('../services/reportService')
        const result = await sendMonthlyReports()
        logger.info('Monthly reports dispatched', { jobId: job.id, ...result })
        break
      }

      default:
        logger.warn('Unknown reminder type', { jobId: job.id, type: (job.data as any).type })
    }
  } catch (error) {
    logger.error('Reminder job failed', {
      jobId: job.id,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}
