# Job Queue System with BullMQ

Robust background job processing system for payouts, notifications, and analytics.

## Features

- **Payout Worker**: Blockchain payout processing with retry logic
- **Notification Worker**: Multi-channel notifications (email, SMS, push, websocket)
- **Analytics Worker**: Scheduled reports and metrics calculation
- **Automatic Retry**: Exponential backoff for failed jobs
- **Job Monitoring**: Track job status, progress, and failures
- **Scheduled Jobs**: Recurring tasks with cron patterns

## Usage

### Queue a Payout
```typescript
import { getQueue } from '../queues/queueManager';

const payoutQueue = getQueue('payouts');
await payoutQueue.add('execute-payout', {
  groupId: 'group-123',
  recipientId: 'user-456',
  recipientAddress: 'GXXX...',
  amount: 1000,
  currency: 'USDC',
  cycleNumber: 5
});
```

### Send Notification
```typescript
import { addNotificationJob } from '../queues/notificationQueue';

await addNotificationJob({
  userId: 'user-123',
  type: 'payout_executed',
  title: 'Payout Received',
  message: 'You received 1000 USDC',
  channels: ['push', 'email']
});
```

### Schedule Analytics
```typescript
import { getAnalyticsQueue } from '../workers/analyticsWorker';

const queue = getAnalyticsQueue();
await queue.add('daily-report', { type: 'daily-report' });
```

## API Endpoints

- `POST /api/jobs/payout` - Queue payout job
- `POST /api/jobs/notification` - Queue notification
- `POST /api/jobs/analytics` - Queue analytics job
- `GET /api/jobs/:queueName/:jobId` - Get job status
- `GET /api/jobs/stats/:queueName` - Get queue statistics
- `POST /api/jobs/:queueName/:jobId/retry` - Retry failed job

## Environment Variables

```env
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
FCM_SERVER_KEY=your-fcm-key
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=
```
