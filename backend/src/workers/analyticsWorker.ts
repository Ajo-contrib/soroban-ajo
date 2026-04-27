import { Job } from 'bullmq';
import { createQueue, createWorker } from '../queues/queueManager';
import { logger } from '../utils/logger';
import { prisma } from '../config/database';

export const ANALYTICS_QUEUE_NAME = 'analytics';

export interface AnalyticsJobData {
  type: 'daily-report' | 'member-score' | 'group-health' | 'weekly-summary' | 'monthly-report';
  params?: {
    groupId?: string;
    userId?: string;
    date?: string;
  };
}

/**
 * Process analytics job
 */
async function processAnalyticsJob(job: Job<AnalyticsJobData>): Promise<void> {
  const { type, params } = job.data;

  logger.info(`Processing analytics job ${job.id}`, { type, params });

  try {
    switch (type) {
      case 'daily-report':
        await generateDailyReport(params);
        break;

      case 'member-score':
        await updateMemberScores(params);
        break;

      case 'group-health':
        await calculateGroupHealth(params);
        break;

      case 'weekly-summary':
        await generateWeeklySummary(params);
        break;

      case 'monthly-report':
        await generateMonthlyReport(params);
        break;

      default:
        logger.warn(`Unknown analytics job type: ${type}`);
    }

    logger.info(`Analytics job ${job.id} completed successfully`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Analytics job ${job.id} failed`, { error: errorMessage });
    throw error;
  }
}

/**
 * Generate daily analytics report
 */
async function generateDailyReport(params?: any): Promise<void> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  // Aggregate daily metrics
  const [contributions, payouts, newGroups, newUsers] = await Promise.all([
    prisma.contribution.count({
      where: { createdAt: { gte: yesterday, lt: today } },
    }),
    prisma.payout.count({
      where: { processedAt: { gte: yesterday, lt: today } },
    }),
    prisma.group.count({
      where: { createdAt: { gte: yesterday, lt: today } },
    }),
    prisma.user.count({
      where: { createdAt: { gte: yesterday, lt: today } },
    }),
  ]);

  logger.info('Daily report generated', {
    date: yesterday.toISOString(),
    contributions,
    payouts,
    newGroups,
    newUsers,
  });
}

/**
 * Update member reliability scores
 */
async function updateMemberScores(params?: any): Promise<void> {
  const groupId = params?.groupId;

  const where = groupId ? { groupId } : {};
  const members = await prisma.groupMember.findMany({ where });

  for (const member of members) {
    const [totalContributions, onTimeContributions] = await Promise.all([
      prisma.contribution.count({
        where: { groupId: member.groupId, memberId: member.userId },
      }),
      prisma.contribution.count({
        where: {
          groupId: member.groupId,
          memberId: member.userId,
          status: 'completed',
        },
      }),
    ]);

    const score = totalContributions > 0 ? (onTimeContributions / totalContributions) * 100 : 0;

    await prisma.groupMember.update({
      where: { id: member.id },
      data: { reliabilityScore: score },
    });
  }

  logger.info('Member scores updated', { count: members.length });
}

/**
 * Calculate group health metrics
 */
async function calculateGroupHealth(params?: any): Promise<void> {
  const groupId = params?.groupId;

  const where = groupId ? { id: groupId } : {};
  const groups = await prisma.group.findMany({ where, include: { members: true } });

  for (const group of groups) {
    const [totalContributions, completedCycles] = await Promise.all([
      prisma.contribution.count({ where: { groupId: group.id } }),
      prisma.cycle.count({
        where: { groupId: group.id, status: 'completed' },
      }),
    ]);

    const healthScore = calculateHealthScore(group, totalContributions, completedCycles);

    await prisma.group.update({
      where: { id: group.id },
      data: { healthScore },
    });
  }

  logger.info('Group health calculated', { count: groups.length });
}

function calculateHealthScore(group: any, contributions: number, cycles: number): number {
  const memberCount = group.members.length;
  const expectedContributions = memberCount * cycles;
  const contributionRate = expectedContributions > 0 ? contributions / expectedContributions : 0;
  return Math.min(contributionRate * 100, 100);
}

/**
 * Generate weekly summary for users
 */
async function generateWeeklySummary(params?: any): Promise<void> {
  const users = await prisma.user.findMany({
    where: { emailVerified: true },
    include: { groupMemberships: { include: { group: true } } },
  });

  const { emailService } = await import('../services/emailService');

  for (const user of users) {
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - 7);

    const contributions = await prisma.contribution.findMany({
      where: {
        memberId: user.id,
        createdAt: { gte: weekStart },
      },
    });

    if (contributions.length > 0 && user.email) {
      await emailService.sendWeeklySummary(user.email, {
        weekOf: weekStart.toLocaleDateString(),
        activeGroups: user.groupMemberships.length,
        totalSaved: contributions.reduce((sum, c) => sum + c.amount, 0).toString(),
        contributionCount: contributions.length,
        groups: user.groupMemberships.map((m) => ({
          name: m.group.name,
          contributions: contributions.filter((c) => c.groupId === m.groupId).length,
          balance: '0',
          status: 'active',
        })),
      });
    }
  }

  logger.info('Weekly summaries sent', { count: users.length });
}

/**
 * Generate monthly report for users
 */
async function generateMonthlyReport(params?: any): Promise<void> {
  const users = await prisma.user.findMany({
    where: { emailVerified: true },
    include: { groupMemberships: { include: { group: true } } },
  });

  const { emailService } = await import('../services/emailService');

  for (const user of users) {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [contributions, payouts] = await Promise.all([
      prisma.contribution.findMany({
        where: { memberId: user.id, createdAt: { gte: monthStart } },
      }),
      prisma.payout.findMany({
        where: { recipientId: user.id, processedAt: { gte: monthStart } },
      }),
    ]);

    if ((contributions.length > 0 || payouts.length > 0) && user.email) {
      await emailService.sendMonthlyReport(user.email, {
        monthOf: monthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
        totalContributed: contributions.reduce((sum, c) => sum + c.amount, 0).toString(),
        totalReceived: payouts.reduce((sum, p) => sum + p.amount, 0).toString(),
        groupsJoined: user.groupMemberships.length,
        groupsCompleted: 0,
        contributionCount: contributions.length,
        groups: user.groupMemberships.map((m) => ({
          name: m.group.name,
          contributions: contributions.filter((c) => c.groupId === m.groupId).length,
          balance: '0',
          status: 'active',
        })),
      });
    }
  }

  logger.info('Monthly reports sent', { count: users.length });
}

/**
 * Get or create analytics queue
 */
export function getAnalyticsQueue() {
  return createQueue(ANALYTICS_QUEUE_NAME);
}

/**
 * Initialize analytics worker
 */
export function initializeAnalyticsWorker() {
  const worker = createWorker(ANALYTICS_QUEUE_NAME, processAnalyticsJob, 3);

  worker.on('completed', (job) => {
    logger.info(`Analytics job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`Analytics job ${job?.id} failed`, { error: err.message });
  });

  return worker;
}

/**
 * Schedule recurring analytics jobs
 */
export async function scheduleAnalyticsJobs() {
  const queue = getAnalyticsQueue();

  // Daily report at midnight
  await queue.add(
    'daily-report',
    { type: 'daily-report' },
    {
      repeat: { pattern: '0 0 * * *' },
      jobId: 'daily-report-recurring',
    }
  );

  // Weekly summary on Mondays at 9 AM
  await queue.add(
    'weekly-summary',
    { type: 'weekly-summary' },
    {
      repeat: { pattern: '0 9 * * 1' },
      jobId: 'weekly-summary-recurring',
    }
  );

  // Monthly report on 1st of month at 9 AM
  await queue.add(
    'monthly-report',
    { type: 'monthly-report' },
    {
      repeat: { pattern: '0 9 1 * *' },
      jobId: 'monthly-report-recurring',
    }
  );

  // Member scores every 6 hours
  await queue.add(
    'member-score',
    { type: 'member-score' },
    {
      repeat: { pattern: '0 */6 * * *' },
      jobId: 'member-score-recurring',
    }
  );

  // Group health daily at 2 AM
  await queue.add(
    'group-health',
    { type: 'group-health' },
    {
      repeat: { pattern: '0 2 * * *' },
      jobId: 'group-health-recurring',
    }
  );

  logger.info('Analytics jobs scheduled');
}
