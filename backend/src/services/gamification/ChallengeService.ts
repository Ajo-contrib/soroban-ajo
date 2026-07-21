import { prisma } from '../../config/database';
import { logger } from '../../utils/logger';
import {
  ChallengeNotFoundError,
  ChallengeExpiredError,
  DuplicateRewardError,
} from '../../errors/GamificationError';
import {
  ChallengeRequirement,
  challengeRequirementSchema,
  RewardType,
} from '../../types/gamification';
import { pointsService } from './PointsService';

export class ChallengeService {
  async updateChallengeProgress(
    userId: string,
    actionType: string,
    incrementBy: number = 1
  ): Promise<string[]> {
    const completedIds: string[] = [];
    const now = new Date();

    const activeChallenges = await prisma.challenge.findMany({
      where: {
        isActive: true,
        startDate: { lte: now },
        endDate: { gte: now },
      },
    });

    for (const challenge of activeChallenges) {
      const requirement = this.parseRequirement(challenge.requirement);

      if (requirement.actionType !== actionType) continue;

      const userChallenge = await prisma.userChallenge.upsert({
        where: {
          userId_challengeId: {
            userId,
            challengeId: challenge.id,
          },
        },
        update: {
          progress: { increment: incrementBy },
        },
        create: {
          userId,
          challengeId: challenge.id,
          progress: incrementBy,
        },
      });

      const newProgress = userChallenge.progress + incrementBy;

      if (newProgress >= requirement.target && !userChallenge.completed) {
        try {
          await this.completeChallenge(userId, challenge.id);
          completedIds.push(challenge.id);
        } catch (error) {
          if (error instanceof DuplicateRewardError) {
            continue;
          }
          throw error;
        }
      }
    }

    return completedIds;
  }

  async completeChallenge(userId: string, challengeId: string): Promise<void> {
    await prisma.$transaction(async (tx: any) => {
      const challenge = await tx.challenge.findUnique({
        where: { id: challengeId },
      });

      if (!challenge) {
        throw new ChallengeNotFoundError(challengeId);
      }

      const now = new Date();
      if (now > challenge.endDate) {
        throw new ChallengeExpiredError(challengeId);
      }

      // Check for duplicate
      const existing = await tx.rewardHistory.findUnique({
        where: {
          userId_rewardType_rewardId: {
            userId,
            rewardType: RewardType.CHALLENGE,
            rewardId: challengeId,
          },
        },
      });

      if (existing) {
        throw new DuplicateRewardError(`Challenge already completed: ${challengeId}`);
      }

      // Mark as completed
      await tx.userChallenge.update({
        where: {
          userId_challengeId: {
            userId,
            challengeId,
          },
        },
        data: {
          completed: true,
          completedAt: now,
        },
      });

      // Record reward
      await tx.rewardHistory.create({
        data: {
          userId,
          rewardType: RewardType.CHALLENGE,
          rewardId: challengeId,
          points: challenge.points,
          metadata: JSON.stringify({ challengeName: challenge.name }),
        },
      });

      // Award points
      await pointsService.awardPoints(
        userId,
        challenge.points,
        `Challenge completed: ${challenge.name}`,
        challengeId,
        undefined,
        { challengeName: challenge.name }
      );

      logger.info('Challenge completed', {
        userId,
        challengeId,
        challengeName: challenge.name,
        points: challenge.points,
      });
    });
  }

  private parseRequirement(requirementJson: string): ChallengeRequirement {
    const parsed = JSON.parse(requirementJson);
    return challengeRequirementSchema.parse(parsed) as ChallengeRequirement;
  }

  async getUserChallenges(userId: string): Promise<
    Array<{
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
    }>
  > {
    const now = new Date();

    const challenges = await prisma.challenge.findMany({
      where: {
        isActive: true,
        startDate: { lte: now },
        endDate: { gte: now },
      },
      include: {
        userChallenges: {
          where: { userId },
        },
      },
    });

    return challenges.map((challenge: any) => {
      const userChallenge = challenge.userChallenges[0];
      const requirement = this.parseRequirement(challenge.requirement);

      return {
        id: challenge.id,
        name: challenge.name,
        description: challenge.description,
        type: challenge.type,
        points: challenge.points,
        progress: userChallenge?.progress || 0,
        target: requirement.target,
        completed: userChallenge?.completed || false,
        completedAt: userChallenge?.completedAt || null,
        endDate: challenge.endDate,
      };
    });
  }

  async getActiveChallenges(): Promise<
    Array<{
      id: string;
      name: string;
      description: string;
      type: string;
      category: string;
      points: number;
      startDate: Date;
      endDate: Date;
    }>
  > {
    const now = new Date();

    return await prisma.challenge.findMany({
      where: {
        isActive: true,
        startDate: { lte: now },
        endDate: { gte: now },
      },
      select: {
        id: true,
        name: true,
        description: true,
        type: true,
        category: true,
        points: true,
        startDate: true,
        endDate: true,
      },
      orderBy: { endDate: 'asc' },
    });
  }
}

export const challengeService = new ChallengeService();
