import { Job } from 'bullmq';
import { createWorker } from '../queues/queueManager';
import { PAYOUT_QUEUE_NAME, PayoutJobData } from '../queues/payoutQueue';
import { logger } from '../utils/logger';
import { prisma } from '../config/database';

interface PayoutResult {
  success: boolean;
  transactionHash?: string;
  error?: string;
}

/**
 * Process payout job with blockchain integration
 */
async function processPayoutJob(job: Job<PayoutJobData>): Promise<PayoutResult> {
  const { groupId, recipientId, recipientAddress, amount, currency, cycleNumber } = job.data;

  logger.info(`Processing payout job ${job.id}`, {
    groupId,
    recipientId,
    amount,
    cycleNumber,
    attempt: job.attemptsMade + 1,
  });

  try {
    await job.updateProgress(10);

    // Validate payout data
    if (!groupId || !recipientId || !recipientAddress || !amount) {
      throw new Error('Missing required payout fields');
    }

    if (amount <= 0) {
      throw new Error(`Invalid payout amount: ${amount}`);
    }

    await job.updateProgress(30);

    // Execute payout on blockchain
    const { sorobanService } = await import('../services/sorobanService');
    const result = await sorobanService.executePayout({
      groupId,
      recipientAddress,
      amount,
      memo: `ajo-payout-${groupId}-cycle-${cycleNumber}`,
    });

    await job.updateProgress(70);

    // Record payout in database
    await prisma.payout.create({
      data: {
        groupId,
        recipientId,
        amount,
        currency,
        cycleNumber,
        transactionHash: result.hash,
        status: 'completed',
        processedAt: new Date(),
      },
    });

    await job.updateProgress(90);

    // Send notification
    const { emailService } = await import('../services/emailService');
    const recipient = await prisma.user.findUnique({ where: { id: recipientId } });
    const group = await prisma.group.findUnique({ where: { id: groupId } });

    if (recipient?.email && group) {
      await emailService.sendPayoutNotification(
        recipient.email,
        group.name,
        `${amount} ${currency}`,
        result.hash,
        cycleNumber,
        new Date().toLocaleDateString()
      );
    }

    await job.updateProgress(100);

    logger.info(`Payout processed successfully`, {
      jobId: job.id,
      transactionHash: result.hash,
    });

    return { success: true, transactionHash: result.hash };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Payout job failed`, { jobId: job.id, error: errorMessage });
    throw error;
  }
}

/**
 * Initialize payout worker
 */
export function initializePayoutWorker() {
  const worker = createWorker(PAYOUT_QUEUE_NAME, processPayoutJob, 5);

  worker.on('completed', (job) => {
    logger.info(`Payout job ${job.id} completed successfully`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`Payout job ${job?.id} failed after all retries`, { error: err.message });
  });

  return worker;
}
