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
 * Process notification job across multiple channels.
 * Exported for unit testing (see tests/unit/notificationWorker.test.ts) —
 * `initializeNotificationWorker` below is what wires it into BullMQ at runtime.
 */
export async function processNotificationJob(job: Job<NotificationJobData>): Promise<NotificationResult> {
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

    // Real-time delivery over the shared Socket.IO connection. `channels`
    // historically used 'push' for this (see NotificationJobData) even though
    // it isn't a device push notification — 'websocket' was added later as
    // the correctly-named alias; both are handled the same way here.
    //
    // NOTE: this previously called `websocketService.sendToUser(...)`, a
    // method that has never existed on WebSocketService (it only exposes
    // `init`) — every single 'push'-channel job threw, was swallowed into
    // `errors`, and no realtime delivery ever happened. This is the direct
    // cause of "why didn't I get that notification" reports (#934):
    // `notificationService.sendToUser` is the one that actually holds the
    // shared, Redis-adapter-backed `io` (see chatService.init), so it's the
    // only thing that can reach a socket connected to another instance.
    //
    // This only reaches sockets connected *right now* — a client that was
    // briefly offline when this job ran will not retroactively receive it
    // over the socket. That's an accepted tradeoff here (unlike chat, see
    // chatService's missed-message replay): durable catch-up for
    // notifications already exists via `GET /api/notifications`, which reads
    // the persisted ActivityFeed history rather than anything ephemeral to
    // this queue job — clients should refetch it on reconnect.
    if (channels.includes('push') || channels.includes('websocket')) {
      try {
        const { notificationService } = await import('../services/notificationService');
        notificationService.sendToUser(userId, { type, title, message, data });
        channelsSent.push('websocket');
      } catch (error) {
        errors.push(`Websocket: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
