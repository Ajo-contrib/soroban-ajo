import { prisma } from '../../config/database';
import { logger } from '../../utils/logger';
import { pointsService } from './PointsService';
import { streakService } from './StreakService';
import { achievementService } from './AchievementService';
import { challengeService } from './ChallengeService';
import { POINTS_CONFIG, ReferenceType, ActivityType } from '../../types/gamification';

export class GamificationService {
  async handleContribution(
    userId: string,
    contributionId: string
  ): Promise<{ points: number; streak: number; achievementsUnlocked: string[] }> {
    try {
      // Award contribution points (idempotent)
      const pointResult = await pointsService.awardPoints(
        userId,
        POINTS_CONFIG.CONTRIBUTION,
        'Contribution made',
        contributionId,
        ReferenceType.CONTRIBUTION
      );

      // Update contribution streak
      const streakResult = await streakService.updateContributionStreak(userId);

      // Check and award achievements
      const achievementsUnlocked = await achievementService.checkAndAwardAchievements(userId);

      // Update challenge progress
      await challengeService.updateChallengeProgress(userId, 'CONTRIBUTION');

      // Create activity feed entry
      await this.createActivity(
        userId,
        ActivityType.CONTRIBUTION,
        'Contribution Made',
        `Earned ${POINTS_CONFIG.CONTRIBUTION} points for making a contribution`
      );

      // Handle level up
      if (pointResult.leveledUp && pointResult.newLevel) {
        await this.createActivity(
          userId,
          ActivityType.LEVEL_UP,
          'Level Up!',
          `Congratulations! You've reached ${pointResult.newLevel} level`
        );
      }

      logger.info('Contribution handled', {
        userId,
        contributionId,
        points: pointResult.points,
        streak: streakResult.streak,
        achievementsUnlocked,
      });

      return {
        points: pointResult.points,
        streak: streakResult.streak,
        achievementsUnlocked,
      };
    } catch (error) {
      logger.error('Failed to handle contribution', { error, userId, contributionId });
      throw error;
    }
  }

  async handleGroupCompletion(
    userId: string,
    groupId: string
  ): Promise<{ points: number; achievementsUnlocked: string[] }> {
    try {
      // Award group completion points (idempotent)
      const pointResult = await pointsService.awardPoints(
        userId,
        POINTS_CONFIG.GROUP_COMPLETE,
        'Group completed',
        groupId,
        ReferenceType.GROUP_COMPLETE
      );

      // Increment groups completed
      await prisma.userGamification.update({
        where: { userId },
        data: { groupsCompleted: { increment: 1 } },
      });

      // Check and award achievements
      const achievementsUnlocked = await achievementService.checkAndAwardAchievements(userId);

      // Update challenge progress
      await challengeService.updateChallengeProgress(userId, 'GROUP_COMPLETE');

      // Create activity feed entry
      await this.createActivity(
        userId,
        ActivityType.GROUP_COMPLETE,
        'Group Completed',
        'Successfully completed a savings group'
      );

      logger.info('Group completion handled', {
        userId,
        groupId,
        points: pointResult.points,
        achievementsUnlocked,
      });

      return {
        points: pointResult.points,
        achievementsUnlocked,
      };
    } catch (error) {
      logger.error('Failed to handle group completion', { error, userId, groupId });
      throw error;
    }
  }

  async handleInvite(
    userId: string,
    invitedUserId: string
  ): Promise<{ points: number; achievementsUnlocked: string[] }> {
    try {
      // Award invite points (idempotent)
      const pointResult = await pointsService.awardPoints(
        userId,
        POINTS_CONFIG.INVITE_FRIEND,
        'Friend invited',
        invitedUserId,
        ReferenceType.INVITE
      );

      // Increment total invites
      await prisma.userGamification.update({
        where: { userId },
        data: { totalInvites: { increment: 1 } },
      });

      // Check and award achievements
      const achievementsUnlocked = await achievementService.checkAndAwardAchievements(userId);

      // Update challenge progress
      await challengeService.updateChallengeProgress(userId, 'INVITE');

      logger.info('Invite handled', {
        userId,
        invitedUserId,
        points: pointResult.points,
        achievementsUnlocked,
      });

      return {
        points: pointResult.points,
        achievementsUnlocked,
      };
    } catch (error) {
      logger.error('Failed to handle invite', { error, userId, invitedUserId });
      throw error;
    }
  }

  async handleLogin(userId: string): Promise<{ points: number; streak: number }> {
    try {
      const now = new Date();
      const dateKey = now.toISOString().split('T')[0];

      // Award daily login points (idempotent)
      const pointResult = await pointsService.awardPoints(
        userId,
        POINTS_CONFIG.DAILY_LOGIN,
        'Daily login',
        `login-${dateKey}`,
        ReferenceType.LOGIN
      );

      // Update login streak
      const streakResult = await streakService.updateLoginStreak(userId);

      // Update challenge progress
      await challengeService.updateChallengeProgress(userId, 'LOGIN');

      logger.info('Login handled', {
        userId,
        points: pointResult.points,
        streak: streakResult.streak,
      });

      return {
        points: pointResult.points,
        streak: streakResult.streak,
      };
    } catch (error) {
      logger.error('Failed to handle login', { error, userId });
      throw error;
    }
  }

  async getUserStats(userId: string): Promise<{
    gamification: {
      points: number;
      level: string;
      contributionStreak: number;
      loginStreak: number;
      totalInvites: number;
      groupsCompleted: number;
    } | null;
    achievements: Array<{
      id: string;
      name: string;
      description: string;
      icon: string;
      category: string;
      points: number;
      unlockedAt: Date;
    }>;
    challenges: Array<{
      id: string;
      name: string;
      description: string;
      type: string;
      points: number;
      progress: number;
      target: number;
      completed: boolean;
      completedAt: Date | null;
      endDate: Date;
    }>;
  }> {
    const [gamification, achievements, challenges] = await Promise.all([
      prisma.userGamification.findUnique({
        where: { userId },
        select: {
          points: true,
          level: true,
          contributionStreak: true,
          loginStreak: true,
          totalInvites: true,
          groupsCompleted: true,
        },
      }),
      achievementService.getUserAchievements(userId),
      challengeService.getUserChallenges(userId),
    ]);

    return {
      gamification,
      achievements,
      challenges,
    };
  }

  async getLeaderboard(
    limit: number = 100,
    offset: number = 0
  ): Promise<
    Array<{
      userId: string;
      walletAddress: string;
      points: number;
      level: string;
      contributionStreak: number;
      rank: number;
    }>
  > {
    const leaderboard = await prisma.userGamification.findMany({
      take: limit,
      skip: offset,
      orderBy: { points: 'desc' },
      select: {
        userId: true,
        points: true,
        level: true,
        contributionStreak: true,
        user: {
          select: {
            walletAddress: true,
          },
        },
      },
    });

    return leaderboard.map((entry: any, index: number) => ({
      userId: entry.userId,
      walletAddress: entry.user.walletAddress,
      points: entry.points,
      level: entry.level,
      contributionStreak: entry.contributionStreak,
      rank: offset + index + 1,
    }));
  }

  private async createActivity(
    userId: string,
    type: ActivityType,
    title: string,
    description: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    try {
      await prisma.activityFeed.create({
        data: {
          userId,
          type,
          title,
          description,
          metadata: metadata ? JSON.stringify(metadata) : null,
        },
      });
    } catch (error) {
      logger.error('Failed to create activity', { error, userId, type });
    }
  }

  async getActivityFeed(
    userId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<
    Array<{
      id: string;
      type: string;
      title: string;
      description: string;
      createdAt: Date;
    }>
  > {
    return await prisma.activityFeed.findMany({
      where: { userId },
      select: {
        id: true,
        type: true,
        title: true,
        description: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }
}

export const gamificationService = new GamificationService();
