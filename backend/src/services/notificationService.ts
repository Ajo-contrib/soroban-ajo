import { addNotificationJob, addBatchNotificationJobs } from '../queues/notificationQueue';
import { prisma } from '../config/database';
import { logger } from '../utils/logger';
import { presenceService } from './realtimePresence';

export type NotificationType = string;

export interface NotificationOptions {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, any>;
  channels?: Array<'push' | 'email' | 'sms' | 'websocket'>;
  priority?: number;
  delay?: number;
}

export interface SocketNotification {
  type: NotificationType;
  title: string;
  message: string;
  [key: string]: any;
}

export class NotificationService {
  private io: any = null;

  /**
   * Attaches this service to a shared Socket.IO server instance.
   *
   * Presence (which users are online) is delegated to `presenceService`,
   * which is Redis-backed rather than an in-memory Map — with more than one
   * backend instance behind a load balancer, an in-memory map here would only
   * ever reflect sockets connected to THIS instance, making `isUserOnline`
   * wrong for users connected elsewhere. The shared `io` passed in (from
   * chatService, which attaches the Redis adapter) is what makes
   * `sendToUser`/`sendToGroup` below reach sockets on any instance too.
   */
  init(io: any): void {
    this.io = io;
    io.on('connection', (socket: any) => {
      const userId = socket.data?.userId;
      if (!userId) return;

      presenceService.addConnection(userId).catch((err: unknown) => logger.error('Failed to record presence', { userId, err }));
      socket.join(`user:${userId}`);

      prisma.groupMember
        .findMany({ where: { userId }, select: { groupId: true } })
        .then((memberships: { groupId: string }[]) => {
          for (const { groupId } of memberships) socket.join(`group:${groupId}`);
        })
        .catch((err: unknown) => logger.error('Failed to join group rooms', { userId, err }));

      socket.on('disconnect', () => {
        presenceService.removeConnection(userId).catch((err: unknown) => logger.error('Failed to clear presence', { userId, err }));
      });
    });
  }

  isUserOnline(userId: string): Promise<boolean> {
    return presenceService.isOnline(userId);
  }

  /**
   * Emits a real-time notification to a single user's room.
   */
  sendToUser(userId: string, notification: SocketNotification): SocketNotification & { userId: string; timestamp: number } {
    const payload = { ...notification, userId, timestamp: Date.now() };
    this.io?.to(`user:${userId}`).emit('notification', payload);
    return payload;
  }

  /**
   * Emits a real-time notification to a group's room, optionally excluding
   * the member who triggered it.
   */
  sendToGroup(
    groupId: string,
    notification: SocketNotification,
    excludeUserId?: string
  ): SocketNotification & { groupId: string; timestamp: number } {
    const payload = { ...notification, groupId, timestamp: Date.now() };
    if (this.io) {
      const emitter = excludeUserId
        ? this.io.to(`group:${groupId}`).except(`user:${excludeUserId}`)
        : this.io.to(`group:${groupId}`);
      emitter.emit('notification', payload);
    }
    return payload;
  }

  /**
   * Queues a notification for async, multi-channel delivery (push/email/sms).
   */
  async send(options: NotificationOptions): Promise<void> {
    const { userId, type, title, message, data, channels = ['push', 'websocket'], priority, delay } = options;

    // Queue notification for async processing
    await addNotificationJob(
      {
        userId,
        type,
        title,
        message,
        data,
        channels,
        priority,
      },
      { delay, priority }
    );

    logger.info('Notification queued', { userId, type, channels });
  }

  /**
   * Send batch notifications
   */
  async sendBatch(notifications: NotificationOptions[]): Promise<void> {
    await addBatchNotificationJobs(
      notifications.map((n) => ({
        data: {
          userId: n.userId,
          type: n.type,
          title: n.title,
          message: n.message,
          data: n.data,
          channels: n.channels,
          priority: n.priority,
        },
        options: { delay: n.delay, priority: n.priority },
      }))
    );

    logger.info('Batch notifications queued', { count: notifications.length });
  }

  /**
   * Schedule notification for future delivery
   */
  async schedule(options: NotificationOptions, sendAt: Date): Promise<void> {
    const delay = sendAt.getTime() - Date.now();
    await this.send({ ...options, delay: Math.max(0, delay) });
  }
}

export const notificationService = new NotificationService();

