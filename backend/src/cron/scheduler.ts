import * as cron from 'node-cron'
import { createQueue, getQueue } from '../queues/queueManager'
import { SYNC_QUEUE_NAME } from '../queues/syncQueue'
import { REMINDER_QUEUE_NAME } from '../jobs/workers'
import { addScheduleJob } from '../queues/scheduleQueue'
import { logger } from '../utils/logger'
import { backupService } from '../services/backupService'

const ANALYTICS_QUEUE_NAME = 'analytics'

const scheduledTasks: cron.ScheduledTask[] = []

function getReminderQueue() {
  return getQueue(REMINDER_QUEUE_NAME) || createQueue(REMINDER_QUEUE_NAME)
}

function getSyncQueue() {
  return getQueue(SYNC_QUEUE_NAME) || createQueue(SYNC_QUEUE_NAME)
}

function getAnalyticsQueue() {
  return getQueue(ANALYTICS_QUEUE_NAME) || createQueue(ANALYTICS_QUEUE_NAME)
}

export function startScheduler(): void {
  logger.info('Starting cron scheduler...')

  // Blockchain sync - every 5 minutes
  scheduledTasks.push(
    cron.schedule('*/5 * * * *', async () => {
      logger.info('Cron: scheduling blockchain sync job')
      await getSyncQueue().add('blockchain-sync', { triggeredBy: 'cron' })
    })
  )

  // Daily contribution reminders - 8 AM UTC
  scheduledTasks.push(
    cron.schedule('0 8 * * *', async () => {
      logger.info('Cron: scheduling daily contribution reminders')
      await getReminderQueue().add('daily-reminders', { type: 'daily_contribution' })
    })
  )

  // Weekly summary emails - Monday 9 AM UTC
  scheduledTasks.push(
    cron.schedule('0 9 * * 1', async () => {
      logger.info('Cron: scheduling weekly summary')
      await getReminderQueue().add('weekly-summary', { type: 'weekly_summary' })
    })
  )

  // Monthly analytics reports - 1st of month, 9 AM UTC
  scheduledTasks.push(
    cron.schedule('0 9 1 * *', async () => {
      logger.info('Cron: scheduling monthly analytics report')
      await getReminderQueue().add('monthly-report', { type: 'monthly_report' })
    })
  )

  // Analytics ETL - hourly
  scheduledTasks.push(
    cron.schedule('0 * * * *', async () => {
      logger.info('Cron: scheduling hourly analytics ETL')
      await getAnalyticsQueue().add('hourly-etl', { type: 'hourly_etl' })
    })
  )

  // Daily analytics ETL - midnight UTC
  scheduledTasks.push(
    cron.schedule('0 0 * * *', async () => {
      logger.info('Cron: scheduling daily analytics ETL')
      await getAnalyticsQueue().add('daily-etl', { type: 'daily_etl' })
    })
  )

  // Cohort analysis - every Sunday at 1 AM UTC
  scheduledTasks.push(
    cron.schedule('0 1 * * 0', async () => {
      logger.info('Cron: scheduling cohort analysis')
      await getAnalyticsQueue().add('cohort-analysis', { type: 'cohort_analysis' })
    })
  )

  // Predictive metrics update - daily at 3 AM UTC
  scheduledTasks.push(
    cron.schedule('0 3 * * *', async () => {
      logger.info('Cron: scheduling predictive metrics update')
      await getAnalyticsQueue().add('metrics-update', { type: 'metrics_update' })
    })
  )

  // Database cleanup - daily at 2 AM UTC
  scheduledTasks.push(
    cron.schedule('0 2 * * *', async () => {
      logger.info('Cron: scheduling database cleanup')
      await getAnalyticsQueue().add('cleanup', { type: 'cleanup' })
    })
  )

  // ── Contribution Schedule jobs ──────────────────────────────────────────

  // Grace period enforcement — every 15 minutes
  scheduledTasks.push(
    cron.schedule('*/15 * * * *', async () => {
      logger.info('Cron: scheduling grace period enforcement')
      await addScheduleJob({ type: 'enforce_grace_periods' })
    })
  )

  // Due-date reminders — every hour (catches schedules due in the next 24 h)
  scheduledTasks.push(
    cron.schedule('0 * * * *', async () => {
      logger.info('Cron: scheduling contribution due reminders')
      await addScheduleJob({ type: 'send_due_reminders' })
    })
  )

  logger.info(`Cron scheduler started with ${scheduledTasks.length} scheduled tasks`)
}

export function stopScheduler(): void {
  scheduledTasks.forEach((task) => task.stop())
  logger.info('Cron scheduler stopped')
}
