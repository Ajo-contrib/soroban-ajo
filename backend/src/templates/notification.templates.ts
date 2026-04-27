/**
 * Notification templates for different event types
 */

export interface NotificationTemplate {
  title: string;
  message: string;
  emailSubject?: string;
  emailBody?: string;
}

export const NotificationTemplates: Record<string, (data: any) => NotificationTemplate> = {
  contribution_reminder: (data: { groupName: string; amount: string; dueDate: string }) => ({
    title: 'Contribution Reminder',
    message: `Your contribution of ${data.amount} for ${data.groupName} is due on ${data.dueDate}`,
    emailSubject: `Reminder: Contribution Due for ${data.groupName}`,
    emailBody: `
      <p>Hello,</p>
      <p>This is a friendly reminder that your contribution is due soon.</p>
      <ul>
        <li><strong>Group:</strong> ${data.groupName}</li>
        <li><strong>Amount:</strong> ${data.amount}</li>
        <li><strong>Due Date:</strong> ${data.dueDate}</li>
      </ul>
      <p>Please make your contribution on time to keep the group running smoothly.</p>
    `,
  }),

  contribution_received: (data: { groupName: string; amount: string }) => ({
    title: 'Contribution Received',
    message: `Your contribution of ${data.amount} to ${data.groupName} has been confirmed`,
    emailSubject: `Contribution Confirmed - ${data.groupName}`,
    emailBody: `
      <p>Hello,</p>
      <p>We've received your contribution!</p>
      <ul>
        <li><strong>Group:</strong> ${data.groupName}</li>
        <li><strong>Amount:</strong> ${data.amount}</li>
      </ul>
      <p>Thank you for your timely contribution.</p>
    `,
  }),

  payout_scheduled: (data: { groupName: string; amount: string; date: string }) => ({
    title: 'Payout Scheduled',
    message: `Your payout of ${data.amount} from ${data.groupName} is scheduled for ${data.date}`,
    emailSubject: `Payout Scheduled - ${data.groupName}`,
    emailBody: `
      <p>Hello,</p>
      <p>Good news! Your payout has been scheduled.</p>
      <ul>
        <li><strong>Group:</strong> ${data.groupName}</li>
        <li><strong>Amount:</strong> ${data.amount}</li>
        <li><strong>Date:</strong> ${data.date}</li>
      </ul>
      <p>You'll receive another notification when the payout is processed.</p>
    `,
  }),

  payout_executed: (data: { groupName: string; amount: string; txHash: string }) => ({
    title: 'Payout Received',
    message: `You've received ${data.amount} from ${data.groupName}`,
    emailSubject: `Payout Received - ${data.groupName}`,
    emailBody: `
      <p>Hello,</p>
      <p>Your payout has been successfully processed!</p>
      <ul>
        <li><strong>Group:</strong> ${data.groupName}</li>
        <li><strong>Amount:</strong> ${data.amount}</li>
        <li><strong>Transaction:</strong> ${data.txHash}</li>
      </ul>
      <p>The funds should now be available in your wallet.</p>
    `,
  }),

  group_invitation: (data: { groupName: string; inviterName: string }) => ({
    title: 'Group Invitation',
    message: `${data.inviterName} invited you to join ${data.groupName}`,
    emailSubject: `You're invited to join ${data.groupName}`,
    emailBody: `
      <p>Hello,</p>
      <p>${data.inviterName} has invited you to join their savings group: <strong>${data.groupName}</strong></p>
      <p>Click the link in your invitation to learn more and join the group.</p>
    `,
  }),

  member_joined: (data: { groupName: string; memberName: string }) => ({
    title: 'New Member',
    message: `${data.memberName} joined ${data.groupName}`,
    emailSubject: `New Member Joined - ${data.groupName}`,
    emailBody: `
      <p>Hello,</p>
      <p><strong>${data.memberName}</strong> has joined your group <strong>${data.groupName}</strong>.</p>
      <p>Welcome the new member!</p>
    `,
  }),

  cycle_completed: (data: { groupName: string; cycleNumber: number }) => ({
    title: 'Cycle Completed',
    message: `Cycle ${data.cycleNumber} of ${data.groupName} has been completed`,
    emailSubject: `Cycle ${data.cycleNumber} Completed - ${data.groupName}`,
    emailBody: `
      <p>Hello,</p>
      <p>Congratulations! Cycle ${data.cycleNumber} of <strong>${data.groupName}</strong> has been completed successfully.</p>
      <p>The next cycle will begin soon.</p>
    `,
  }),

  late_payment: (data: { groupName: string; amount: string; daysPastDue: number }) => ({
    title: 'Late Payment Notice',
    message: `Your contribution to ${data.groupName} is ${data.daysPastDue} days overdue`,
    emailSubject: `Late Payment Notice - ${data.groupName}`,
    emailBody: `
      <p>Hello,</p>
      <p>Your contribution to <strong>${data.groupName}</strong> is now <strong>${data.daysPastDue} days overdue</strong>.</p>
      <ul>
        <li><strong>Amount Due:</strong> ${data.amount}</li>
        <li><strong>Days Overdue:</strong> ${data.daysPastDue}</li>
      </ul>
      <p>Please make your contribution as soon as possible to avoid penalties.</p>
    `,
  }),

  dispute_opened: (data: { groupName: string; reason: string }) => ({
    title: 'Dispute Opened',
    message: `A dispute has been opened in ${data.groupName}`,
    emailSubject: `Dispute Opened - ${data.groupName}`,
    emailBody: `
      <p>Hello,</p>
      <p>A dispute has been opened in <strong>${data.groupName}</strong>.</p>
      <p><strong>Reason:</strong> ${data.reason}</p>
      <p>Please review the dispute and participate in the resolution process.</p>
    `,
  }),

  dispute_resolved: (data: { groupName: string; resolution: string }) => ({
    title: 'Dispute Resolved',
    message: `The dispute in ${data.groupName} has been resolved`,
    emailSubject: `Dispute Resolved - ${data.groupName}`,
    emailBody: `
      <p>Hello,</p>
      <p>The dispute in <strong>${data.groupName}</strong> has been resolved.</p>
      <p><strong>Resolution:</strong> ${data.resolution}</p>
    `,
  }),
};

/**
 * Get notification template
 */
export function getNotificationTemplate(type: string, data: any): NotificationTemplate {
  const templateFn = NotificationTemplates[type];
  if (!templateFn) {
    return {
      title: 'Notification',
      message: 'You have a new notification',
    };
  }
  return templateFn(data);
}
