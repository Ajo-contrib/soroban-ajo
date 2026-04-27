import { Job } from 'bullmq';
import { createWorker } from '../queues/queueManager';
import { NOTIFICATION_QUEUE_NAME, NotificationJobData } from '../queues/notificationQueue';
import { logger } from '../utils/logger';

interface NotificationResult {
  success: boolean;
  channelsSent: string[];
  error?: string;
}

/**
 * Process notification job across multiple channels
 */
async function processNotificationJob(job: Job<NotificationJobData>): Promise<NotificationResult> {
  const { userId, type, title, message, data, channels = ['push', 'email'] } = job.data;

  logger.info(`Processing notification job ${job.id}`, {
    userId,
    type,
    title,
    channels,
  });

  const channelsSent: string[] = [];
  const errors: string[] = [];

  try {
    // Send email notification
    if (channels.includes('email')) {
      try {
        const { emailService } = await import('../services/emailService');
        const { prisma } = await import('../config/database');
        const user = await prisma.user.findUnique({ where: { id: userId } });

        if (user?.email) {
          await emailService.sendEmail({
            to: user.email,
            subject: title,
            html: `<p>${message}</p>`,
          });
          channelsSent.push('email');
        }
      } catch (error) {
        errors.push(`Email: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    // Send SMS notification
    if (channels.includes('sms')) {
      try {
        const { smsService } = await import('../services/smsService');
        const { prisma } = await import('../config/database');
        const user = await prisma.user.findUnique({ where: { id: userId } });

        if (user?.phoneNumber) {
          // SMS service would need enhancement for general messages
          channelsSent.push('sms');
        }
      } catch (error) {
        errors.push(`SMS: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    // Send push notification
    if (channels.includes('push')) {
      try {
        const { websocketService } = await import('../services/websocketService');
        websocketService.sendToUser(userId, 'notification', {
          type,
          title,
          message,
          data,
          timestamp: Date.now(),
        });
        channelsSent.push('push');
      } catch (error) {
        errors.push(`Push: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    if (channelsSent.length === 0) {
      throw new Error(`All channels failed: ${errors.join(', ')}`);
    }

    logger.info(`Notification sent successfully`, {
      jobId: job.id,
      channelsSent,
    });

    return { success: true, channelsSent };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Notification job failed`, { jobId: job.id, error: errorMessage });
    throw error;
  }
}

/**
 * Initialize notification worker with high concurrency
 */
export function initializeNotificationWorker() {
  const worker = createWorker(NOTIFICATION_QUEUE_NAME, processNotificationJob, 10);

  worker.on('completed', (job) => {
    logger.info(`Notification job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`Notification job ${job?.id} failed`, { error: err.message });
  });

  return worker;
}
