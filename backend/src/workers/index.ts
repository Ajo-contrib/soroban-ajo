import { logger } from '../utils/logger';
import { initializePayoutWorker } from './payoutWorker';
import { initializeAnalyticsWorker, scheduleAnalyticsJobs } from './analyticsWorker';
import { initializeNotificationWorker } from './notificationWorker';

/**
 * Initialize all workers
 */
export async function initializeAllWorkers() {
  logger.info('Initializing all workers...');

  try {
    // Initialize workers
    const payoutWorker = initializePayoutWorker();
    const analyticsWorker = initializeAnalyticsWorker();
    const notificationWorker = initializeNotificationWorker();

    // Schedule recurring analytics jobs
    await scheduleAnalyticsJobs();

    logger.info('All workers initialized successfully', {
      workers: ['payout', 'analytics', 'notification'],
    });

    return {
      payoutWorker,
      analyticsWorker,
      notificationWorker,
    };
  } catch (error) {
    logger.error('Failed to initialize workers', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}

export * from './payoutWorker';
export * from './analyticsWorker';
export * from './notificationWorker';
