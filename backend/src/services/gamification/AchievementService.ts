import { prisma } from '../../config/database';
import { logger } from '../../utils/logger';
import {
  AchievementNotFoundError,
  DuplicateRewardError,
} from '../../errors/GamificationError';
import {
  AchievementCategory,
  AchievementRequirement,
  achievementRequirementSchema,
  RewardType,
} from '../../types/gamification';
import { pointsService } from './PointsService';

export class AchievementService {
  /**
   * Scans all active achievements for the user and awards any that are newly
   * eligible.  Safe to call after any user action — already-awarded achievements
   * are skipped via the `existingIds` set, and the rewardHistory table provides
   * a second dedup layer inside `awardAchievement()`.
   *
   * @returns Array of achievement IDs that were awarded during this call.
   */
  async checkAndAwardAchievements(userId: string): Promise<string[]> {
    const awardedIds: string[] = [];

    const [gamification, contributions, achievements, existingAchievements] =
      await Promise.all([
        prisma.userGamification.findUnique({ where: { userId } }),
        prisma.contribution.count({ where: { userId } }),
        prisma.achievement.findMany({ where: { isActive: true } }),
        prisma.userAchievement.findMany({
          where: { userId },
          select: { achievementId: true },
        }),
      ]);

    if (!gamification) return awardedIds;

    const existingIds = new Set(existingAchievements.map((a: any) => a.achievementId));

    for (const achievement of achievements) {
      if (existingIds.has(achievement.id)) continue;

      const requirement = this.parseRequirement(achievement.requirement);
      const shouldAward = await this.checkRequirement(
        userId,
        achievement.category as AchievementCategory,
        requirement,
        gamification,
        contributions
      );

      if (shouldAward) {
        try {
          await this.awardAchievement(userId, achievement.id);
          awardedIds.push(achievement.id);
        } catch (error) {
          if (error instanceof DuplicateRewardError) {
            // Already awarded via another code path, skip silently
            continue;
          }
          throw error;
        }
      }
    }

    return awardedIds;
  }

  /**
   * Evaluates a single achievement requirement against the user's current stats.
   */
  private async checkRequirement(
    userId: string,
    category: AchievementCategory,
    requirement: AchievementRequirement,
    gamification: { contributionStreak: number; totalInvites: number; groupsCompleted: number },
    contributionCount: number
  ): Promise<boolean> {
    switch (category) {
      case AchievementCategory.CONTRIBUTION:
        if (requirement.type === 'first' && contributionCount >= 1) return true;
        if (requirement.type === 'count' && contributionCount >= (requirement.count || 0))
          return true;
        if (
          requirement.type === 'streak' &&
          gamification.contributionStreak >= (requirement.days || 0)
        )
          return true;
        break;

      case AchievementCategory.SOCIAL:
        if (requirement.type === 'invites' && gamification.totalInvites >= (requirement.count || 0))
          return true;
        if (requirement.type === 'follows') {
          const followCount = await prisma.userFollow.count({
            where: { followerId: userId },
          });
          if (followCount >= (requirement.count || 0)) return true;
        }
        break;

      case AchievementCategory.MILESTONE:
        if (
          requirement.type === 'groups' &&
          gamification.groupsCompleted >= (requirement.count || 0)
        )
          return true;
        break;

      case AchievementCategory.SPECIAL:
        // Special achievements are awarded manually via awardAchievement() only
        return false;
    }

    return false;
  }

  /**
   * Atomically records the achievement, adds a rewardHistory entry (dedup
   * guard), and awards the associated points.  Throws `DuplicateRewardError`
   * if the achievement was already awarded via any code path.
   */
  async awardAchievement(userId: string, achievementId: string): Promise<void> {
    await prisma.$transaction(async (tx: any) => {
      // Strong dedup via rewardHistory composite key
      const existing = await tx.rewardHistory.findUnique({
        where: {
          userId_rewardType_rewardId: {
            userId,
            rewardType: RewardType.ACHIEVEMENT,
            rewardId: achievementId,
          },
        },
      });

      if (existing) {
        throw new DuplicateRewardError(`Achievement already awarded: ${achievementId}`);
      }

      const achievement = await tx.achievement.findUnique({
        where: { id: achievementId },
      });

      if (!achievement) {
        throw new AchievementNotFoundError(achievementId);
      }

      // Create userAchievement record
      await tx.userAchievement.create({
        data: { userId, achievementId },
      });

      // Record in rewardHistory for cross-service dedup
      await tx.rewardHistory.create({
        data: {
          userId,
          rewardType: RewardType.ACHIEVEMENT,
          rewardId: achievementId,
          points: achievement.points,
          metadata: JSON.stringify({ achievementName: achievement.name }),
        },
      });

      // Award points (delegated to PointsService)
      await pointsService.awardPoints(
        userId,
        achievement.points,
        `Achievement unlocked: ${achievement.name}`,
        achievementId,
        undefined,
        { achievementName: achievement.name }
      );

      logger.info('Achievement awarded', {
        userId,
        achievementId,
        achievementName: achievement.name,
        points: achievement.points,
      });
    });
  }

  /**
   * Parses and schema-validates a raw requirement JSON string.
   * Throws a Zod validation error if the JSON does not match the expected shape.
   */
  private parseRequirement(requirementJson: string): AchievementRequirement {
    const parsed = JSON.parse(requirementJson);
    return achievementRequirementSchema.parse(parsed) as AchievementRequirement;
  }

  /**
   * Returns all achievements the user has unlocked, ordered by most recent.
   */
  async getUserAchievements(userId: string): Promise<
    Array<{
      id: string;
      name: string;
      description: string;
      icon: string;
      category: string;
      points: number;
      unlockedAt: Date;
    }>
  > {
    const userAchievements = await prisma.userAchievement.findMany({
      where: { userId },
      include: {
        achievement: {
          select: {
            id: true,
            name: true,
            description: true,
            icon: true,
            category: true,
            points: true,
          },
        },
      },
      orderBy: { unlockedAt: 'desc' },
    });

    return userAchievements.map((ua: any) => ({
      id: ua.achievement.id,
      name: ua.achievement.name,
      description: ua.achievement.description,
      icon: ua.achievement.icon,
      category: ua.achievement.category,
      points: ua.achievement.points,
      unlockedAt: ua.unlockedAt,
    }));
  }
}

export const achievementService = new AchievementService();
