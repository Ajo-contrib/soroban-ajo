import { streakService } from '../../../src/services/gamification/StreakService';
import { prisma } from '../../../src/config/database';
import { POINTS_CONFIG } from '../../../src/types/gamification';

jest.mock('../../../src/config/database', () => ({
  prisma: {
    userGamification: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
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

describe('StreakService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('updateContributionStreak', () => {
    it('should initialize streak for new user', async () => {
      const mockTransaction = jest.fn(async (callback) => {
        return await callback({
          userGamification: {
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({}),
          },
        });
      });

      (prisma.$transaction as jest.Mock) = mockTransaction;

      const result = await streakService.updateContributionStreak('user1');

      expect(result).toEqual({ streak: 1, bonusAwarded: false });
    });

    it('should increment streak for consecutive day', async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const mockTransaction = jest.fn(async (callback) => {
        return await callback({
          userGamification: {
            findUnique: jest.fn().mockResolvedValue({
              contributionStreak: 5,
              lastContribution: yesterday,
            }),
            update: jest.fn().mockResolvedValue({}),
          },
        });
      });

      (prisma.$transaction as jest.Mock) = mockTransaction;

      const result = await streakService.updateContributionStreak('user1');

      expect(result.streak).toBe(6);
      expect(result.bonusAwarded).toBe(true);
    });

    it('should reset streak for non-consecutive day', async () => {
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

      const mockTransaction = jest.fn(async (callback) => {
        return await callback({
          userGamification: {
            findUnique: jest.fn().mockResolvedValue({
              contributionStreak: 5,
              lastContribution: threeDaysAgo,
            }),
            update: jest.fn().mockResolvedValue({}),
          },
        });
      });

      (prisma.$transaction as jest.Mock) = mockTransaction;

      const result = await streakService.updateContributionStreak('user1');

      expect(result.streak).toBe(1);
      expect(result.bonusAwarded).toBe(false);
    });

    it('should not update streak for same day', async () => {
      const today = new Date();

      const mockTransaction = jest.fn(async (callback) => {
        return await callback({
          userGamification: {
            findUnique: jest.fn().mockResolvedValue({
              contributionStreak: 5,
              lastContribution: today,
            }),
          },
        });
      });

      (prisma.$transaction as jest.Mock) = mockTransaction;

      const result = await streakService.updateContributionStreak('user1');

      expect(result.streak).toBe(5);
      expect(result.bonusAwarded).toBe(false);
    });
  });

  describe('updateLoginStreak', () => {
    it('should initialize login streak for new user', async () => {
      const mockTransaction = jest.fn(async (callback) => {
        return await callback({
          userGamification: {
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({}),
          },
        });
      });

      (prisma.$transaction as jest.Mock) = mockTransaction;

      const result = await streakService.updateLoginStreak('user1');

      expect(result).toEqual({ streak: 1 });
    });

    it('should not update if already logged in today', async () => {
      const today = new Date();

      const mockTransaction = jest.fn(async (callback) => {
        return await callback({
          userGamification: {
            findUnique: jest.fn().mockResolvedValue({
              loginStreak: 3,
              lastLogin: today,
            }),
          },
        });
      });

      (prisma.$transaction as jest.Mock) = mockTransaction;

      const result = await streakService.updateLoginStreak('user1');

      expect(result.streak).toBe(3);
    });

    it('should increment streak for consecutive day login', async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const mockTransaction = jest.fn(async (callback) => {
        return await callback({
          userGamification: {
            findUnique: jest.fn().mockResolvedValue({
              loginStreak: 7,
              lastLogin: yesterday,
            }),
            update: jest.fn().mockResolvedValue({}),
          },
        });
      });

      (prisma.$transaction as jest.Mock) = mockTransaction;

      const result = await streakService.updateLoginStreak('user1');

      expect(result.streak).toBe(8);
    });
  });

  describe('getStreaks', () => {
    it('should return user streaks', async () => {
      (prisma.userGamification.findUnique as jest.Mock).mockResolvedValue({
        contributionStreak: 5,
        loginStreak: 10,
      });

      const result = await streakService.getStreaks('user1');

      expect(result).toEqual({
        contributionStreak: 5,
        loginStreak: 10,
      });
    });

    it('should return zeros for non-existent user', async () => {
      (prisma.userGamification.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await streakService.getStreaks('user1');

      expect(result).toEqual({
        contributionStreak: 0,
        loginStreak: 0,
      });
    });
  });
});
