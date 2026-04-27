import { logger } from '../utils/logger';
import { prisma } from '../config/database';

export interface PushNotification {
  title: string;
  body: string;
  data?: Record<string, any>;
  icon?: string;
  badge?: string;
  sound?: string;
  priority?: 'high' | 'normal';
}

export interface PushToken {
  userId: string;
  token: string;
  platform: 'web' | 'ios' | 'android';
  deviceId?: string;
}

/**
 * Push notification service using Firebase Cloud Messaging (FCM)
 */
export class PushService {
  private fcmServerKey: string | undefined;
  private fcmEndpoint = 'https://fcm.googleapis.com/fcm/send';

  constructor() {
    this.fcmServerKey = process.env.FCM_SERVER_KEY;
  }

  /**
   * Send push notification to specific user
   */
  async sendToUser(userId: string, notification: PushNotification): Promise<boolean> {
    const tokens = await this.getUserPushTokens(userId);

    if (tokens.length === 0) {
      logger.debug(`No push tokens found for user ${userId}`);
      return false;
    }

    const results = await Promise.allSettled(
      tokens.map((token) => this.sendToToken(token.token, notification))
    );

    const successCount = results.filter((r) => r.status === 'fulfilled' && r.value).length;

    logger.info(`Push notification sent to user ${userId}`, {
      totalTokens: tokens.length,
      successCount,
    });

    return successCount > 0;
  }

  /**
   * Send push notification to multiple users
   */
  async sendToUsers(userIds: string[], notification: PushNotification): Promise<void> {
    await Promise.allSettled(userIds.map((userId) => this.sendToUser(userId, notification)));
  }

  /**
   * Send push notification to specific token
   */
  async sendToToken(token: string, notification: PushNotification): Promise<boolean> {
    if (!this.fcmServerKey) {
      logger.warn('FCM_SERVER_KEY not configured, skipping push notification');
      return false;
    }

    try {
      const response = await fetch(this.fcmEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `key=${this.fcmServerKey}`,
        },
        body: JSON.stringify({
          to: token,
          notification: {
            title: notification.title,
            body: notification.body,
            icon: notification.icon || '/icon-192.png',
            badge: notification.badge || '/badge-72.png',
            sound: notification.sound || 'default',
          },
          data: notification.data,
          priority: notification.priority || 'high',
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        logger.error('FCM push failed', { error, token: token.substring(0, 10) });
        return false;
      }

      return true;
    } catch (error) {
      logger.error('Push notification error', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  /**
   * Register push token for user
   */
  async registerToken(data: PushToken): Promise<void> {
    await prisma.pushToken.upsert({
      where: {
        userId_deviceId: {
          userId: data.userId,
          deviceId: data.deviceId || 'default',
        },
      },
      create: {
        userId: data.userId,
        token: data.token,
        platform: data.platform,
        deviceId: data.deviceId || 'default',
      },
      update: {
        token: data.token,
        platform: data.platform,
      },
    });

    logger.info('Push token registered', {
      userId: data.userId,
      platform: data.platform,
    });
  }

  /**
   * Unregister push token
   */
  async unregisterToken(userId: string, deviceId: string): Promise<void> {
    await prisma.pushToken.deleteMany({
      where: { userId, deviceId },
    });

    logger.info('Push token unregistered', { userId, deviceId });
  }

  /**
   * Get all push tokens for user
   */
  private async getUserPushTokens(userId: string): Promise<PushToken[]> {
    const tokens = await prisma.pushToken.findMany({
      where: { userId },
    });

    return tokens.map((t) => ({
      userId: t.userId,
      token: t.token,
      platform: t.platform as 'web' | 'ios' | 'android',
      deviceId: t.deviceId,
    }));
  }

  /**
   * Clean up expired or invalid tokens
   */
  async cleanupInvalidTokens(): Promise<void> {
    // Remove tokens older than 90 days
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const result = await prisma.pushToken.deleteMany({
      where: {
        updatedAt: { lt: ninetyDaysAgo },
      },
    });

    logger.info('Cleaned up expired push tokens', { count: result.count });
  }
}

export const pushService = new PushService();
