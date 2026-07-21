import { achievementService } from '../../../src/services/gamification/AchievementService';
import { prisma } from '../../../src/config/database';
import {
  AchievementNotFoundError,
  DuplicateRewardError,
} from '../../../src/errors/GamificationError';
import { AchievementCategory, RewardType } from '../../../src/types/gamification';

jest.mock('../../../src/config/database', () => ({
  prisma: {
    userGamification: { findUnique: jest.fn() },
    contribution: { count: jest.fn() },
    achievement: { findMany: jest.fn() },
    userAchievement: { findMany: jest.fn(), create: jest.fn() },
    rewardHistory: { findUnique: jest.fn(), create: jest.fn() },
    userFollow: { count: jest.fn() },
    $transaction: jest.fn(),
  },
}));
jest.mock('../../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));
jest.mock('../../../src/services/gamification/PointsService');

describe('AchievementService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('checkAndAwardAchievements', () => {
    it('should award first contribution achievement', async () => {
      const mockAchievement = {
        id: 'ach1',
        name: 'First Contribution',
        category: AchievementCategory.CONTRIBUTION,
        requirement: JSON.stringify({ type: 'first' }),
        points: 100,
      };

      (prisma.userGamification.findUnique as jest.Mock).mockResolvedValue({
        contributionStreak: 1,
        totalInvites: 0,
        groupsCompleted: 0,
      });
      (prisma.contribution.count as jest.Mock).mockResolvedValue(1);
      (prisma.achievement.findMany as jest.Mock).mockResolvedValue([mockAchievement]);
      (prisma.userAchievement.findMany as jest.Mock).mockResolvedValue([]);

      const mockTransaction = jest.fn(async (callback) => {
        return await callback({
          rewardHistory: {
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({}),
          },
          achievement: {
            findUnique: jest.fn().mockResolvedValue(mockAchievement),
          },
          userAchievement: {
            create: jest.fn().mockResolvedValue({}),
          },
        });
      });

      (prisma.$transaction as jest.Mock) = mockTransaction;

      const awarded = await achievementService.checkAndAwardAchievements('user1');

      expect(awarded).toContain('ach1');
    });

    it('should not award already unlocked achievements', async () => {
      const mockAchievement = {
        id: 'ach1',
        name: 'First Contribution',
        category: AchievementCategory.CONTRIBUTION,
        requirement: JSON.stringify({ type: 'first' }),
        points: 100,
      };

      (prisma.userGamification.findUnique as jest.Mock).mockResolvedValue({
        contributionStreak: 1,
        totalInvites: 0,
        groupsCompleted: 0,
      });
      (prisma.contribution.count as jest.Mock).mockResolvedValue(1);
      (prisma.achievement.findMany as jest.Mock).mockResolvedValue([mockAchievement]);
      (prisma.userAchievement.findMany as jest.Mock).mockResolvedValue([
        { achievementId: 'ach1' },
      ]);

      const awarded = await achievementService.checkAndAwardAchievements('user1');

      expect(awarded).toEqual([]);
    });

    it('should award streak achievement', async () => {
      const mockAchievement = {
        id: 'ach2',
        name: 'Perfect Attendance',
        category: AchievementCategory.CONTRIBUTION,
        requirement: JSON.stringify({ type: 'streak', days: 30 }),
        points: 500,
      };

      (prisma.userGamification.findUnique as jest.Mock).mockResolvedValue({
        contributionStreak: 30,
        totalInvites: 0,
        groupsCompleted: 0,
      });
      (prisma.contribution.count as jest.Mock).mockResolvedValue(30);
      (prisma.achievement.findMany as jest.Mock).mockResolvedValue([mockAchievement]);
      (prisma.userAchievement.findMany as jest.Mock).mockResolvedValue([]);

      const mockTransaction = jest.fn(async (callback) => {
        return await callback({
          rewardHistory: {
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({}),
          },
          achievement: {
            findUnique: jest.fn().mockResolvedValue(mockAchievement),
          },
          userAchievement: {
            create: jest.fn().mockResolvedValue({}),
          },
        });
      });

      (prisma.$transaction as jest.Mock) = mockTransaction;

      const awarded = await achievementService.checkAndAwardAchievements('user1');

      expect(awarded).toContain('ach2');
    });
  });

  describe('awardAchievement', () => {
    it('should throw AchievementNotFoundError for invalid achievement', async () => {
      const mockTransaction = jest.fn(async (callback) => {
        return await callback({
          rewardHistory: {
            findUnique: jest.fn().mockResolvedValue(null),
          },
          achievement: {
            findUnique: jest.fn().mockResolvedValue(null),
          },
        });
      });

      (prisma.$transaction as jest.Mock) = mockTransaction;

      await expect(achievementService.awardAchievement('user1', 'invalid')).rejects.toThrow(
        AchievementNotFoundError
      );
    });

    it('should throw DuplicateRewardError for already awarded achievement', async () => {
      const mockTransaction = jest.fn(async (callback) => {
        return await callback({
          rewardHistory: {
            findUnique: jest.fn().mockResolvedValue({ id: 'existing' }),
          },
        });
      });

      (prisma.$transaction as jest.Mock) = mockTransaction;

      await expect(achievementService.awardAchievement('user1', 'ach1')).rejects.toThrow(
        DuplicateRewardError
      );
    });
  });

  describe('getUserAchievements', () => {
    it('should return user achievements', async () => {
      const mockData = [
        {
          id: 'ua1',
          unlockedAt: new Date(),
          achievement: {
            id: 'ach1',
            name: 'First Contribution',
            description: 'Make your first contribution',
            icon: '🎯',
            category: 'CONTRIBUTION',
            points: 100,
          },
        },
      ];

      (prisma.userAchievement.findMany as jest.Mock).mockResolvedValue(mockData);

      const result = await achievementService.getUserAchievements('user1');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('First Contribution');
    });
  });
});
