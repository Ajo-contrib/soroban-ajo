import { Worker } from 'bullmq';
import { redisConnection } from '../queues/queueManager';
import { QUEUE_NAMES } from '../queues';
import { processSyncJob } from './syncJob';
import { processReminderJob } from './reminderJob';
import { processAnalyticsJob } from './analyticsJob';
import { processEmailJob } from './emailJob';
import { processPayoutJob } from './payoutJob';
import { logger } from '../utils/logger';
import { initializeAllWorkers } from '../workers';

// Queue names for reminder and analytics (not yet in dedicated queue files)
const REMINDER_QUEUE_NAME = 'reminder';
const ANALYTICS_QUEUE_NAME = 'analytics';

const workers: Worker[] = [];
let enhancedWorkers: any = null;

function createWorker(
  queueName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  processor: (job: any) => Promise<void>,
  concurrency = 1
): Worker {
  const worker = new Worker(queueName, processor, {
    connection: redisConnection,
    concurrency,
  });

  worker.on('completed', (job) => {
    logger.info(`Job completed: ${queueName}`, { jobId: job.id });
  });

  worker.on('failed', (job, err) => {
    logger.error(`Job failed: ${queueName}`, {
      jobId: job?.id,
      error: err.message,
      attemptsMade: job?.attemptsMade,
      attemptsTotal: job?.opts?.attempts,
    });
  });

  worker.on('error', (err) => {
    logger.error(`Worker error: ${queueName}`, { error: err.message });
  });

  return worker;
}

export function startWorkers(): void {
  logger.info('Starting job workers...');

  // Start legacy workers
  workers.push(
    createWorker(QUEUE_NAMES.SYNC, processSyncJob as unknown as (job: any) => Promise<void>),
    createWorker(REMINDER_QUEUE_NAME, processReminderJob as unknown as (job: any) => Promise<void>),
    createWorker(ANALYTICS_QUEUE_NAME, processAnalyticsJob as unknown as (job: any) => Promise<void>),
    createWorker(QUEUE_NAMES.EMAIL, processEmailJob as unknown as (job: any) => Promise<void>, 3),
    createWorker(QUEUE_NAMES.PAYOUT, processPayoutJob as unknown as (job: any) => Promise<void>)
  );

  // Initialize enhanced workers (payout, analytics, notification)
  try {
    initializeAllWorkers().then((workers) => {
      enhancedWorkers = workers;
      logger.info('Enhanced workers initialized successfully');
    }).catch((error) => {
      logger.error('Failed to initialize enhanced workers', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    });
  } catch (error) {
    logger.error('Failed to start enhanced workers', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  logger.info(`Started ${workers.length} legacy job workers`);
}

export async function stopWorkers(): Promise<void> {
  logger.info('Stopping job workers...');
  await Promise.all(workers.map((w) => w.close()));
  
  // Close enhanced workers if they were initialized
  if (enhancedWorkers) {
    await Promise.all([
      enhancedWorkers.payoutWorker?.close(),
      enhancedWorkers.analyticsWorker?.close(),
      enhancedWorkers.notificationWorker?.close(),
    ].filter(Boolean));
  }
  
  logger.info('All job workers stopped');
}
