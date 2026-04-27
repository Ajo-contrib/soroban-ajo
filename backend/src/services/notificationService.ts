import { WebSocketServer } from '../websocket/server';
import { emailService } from './emailService';
import { pushService } from './pushService';
import { addNotificationJob, addBatchNotificationJobs } from '../queues/notificationQueue';
import { logger } from '../utils/logger';

export type NotificationType =
  | 'contribution_reminder'
  | 'contribution_received'
  | 'payout_scheduled'
  | 'payout_executed'
  | 'dispute_opened'
  | 'dispute_resolved'
  | 'group_invitation'
  | 'member_joined'
  | 'cycle_completed'
  | 'late_payment';

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

export class NotificationService {
  constructor(private wsServer: WebSocketServer) {}

  /**
   * Send notification across multiple channels
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

  // ── Legacy methods for backward compatibility ──

  async notifyContribution(groupId: string, contribution: any): Promise<void> {
    this.wsServer.emitToGroup(groupId, 'contribution:new', {
      type: 'contribution',
      groupId,
      member: contribution.member,
      amount: contribution.amount,
      timestamp: Date.now(),
    });

    this.wsServer.emitToUser(contribution.memberId, 'contribution:confirmed', {
      groupId,
      amount: contribution.amount,
      timestamp: Date.now(),
    });

    await this.send({
      userId: contribution.memberId,
      type: 'contribution_received',
      title: 'Contribution Confirmed',
      message: `Your contribution of ${contribution.amount} has been received`,
      data: { groupId, amount: contribution.amount },
      channels: ['push', 'email'],
    });
  }

  async notifyPayout(groupId: string, payout: any): Promise<void> {
    this.wsServer.emitToGroup(groupId, 'payout:executed', {
      type: 'payout',
      groupId,
      recipient: payout.recipient,
      amount: payout.amount,
      timestamp: Date.now(),
    });

    this.wsServer.emitToUser(payout.recipientId, 'payout:received', {
      groupId,
      amount: payout.amount,
      timestamp: Date.now(),
    });

    await this.send({
      userId: payout.recipientId,
      type: 'payout_executed',
      title: 'Payout Received',
      message: `You received a payout of ${payout.amount}`,
      data: { groupId, amount: payout.amount },
      channels: ['push', 'email'],
      priority: 1,
    });
  }

  async notifyDispute(groupId: string, dispute: any): Promise<void> {
    this.wsServer.emitToGroup(groupId, 'dispute:opened', {
      type: 'dispute',
      groupId,
      disputeId: dispute.id,
      reason: dispute.reason,
      timestamp: Date.now(),
    });
  }

  async notifyMemberJoined(groupId: string, member: any): Promise<void> {
    this.wsServer.emitToGroup(groupId, 'member:joined', {
      type: 'member_joined',
      groupId,
      member: {
        id: member.id,
        name: member.name,
      },
      timestamp: Date.now(),
    });
  }

  async notifyMemberLeft(groupId: string, member: any): Promise<void> {
    this.wsServer.emitToGroup(groupId, 'member:left', {
      type: 'member_left',
      groupId,
      memberId: member.id,
      timestamp: Date.now(),
    });
  }

  async notifyCycleComplete(groupId: string, cycle: any): Promise<void> {
    this.wsServer.emitToGroup(groupId, 'cycle:complete', {
      type: 'cycle_complete',
      groupId,
      cycleNumber: cycle.number,
      totalContributions: cycle.totalContributions,
      timestamp: Date.now(),
    });
  }

  async notifyReminder(userId: string, reminder: any): Promise<void> {
    this.wsServer.emitToUser(userId, 'reminder', {
      type: 'reminder',
      message: reminder.message,
      groupId: reminder.groupId,
      dueDate: reminder.dueDate,
      timestamp: Date.now(),
    });

    await this.send({
      userId,
      type: 'contribution_reminder',
      title: 'Contribution Reminder',
      message: reminder.message,
      data: { groupId: reminder.groupId, dueDate: reminder.dueDate },
      channels: ['push', 'email', 'sms'],
    });
  }

  async broadcastSystemMessage(message: string): Promise<void> {
    this.wsServer.broadcast('system:message', {
      type: 'system',
      message,
      timestamp: Date.now(),
    });
  }
}

