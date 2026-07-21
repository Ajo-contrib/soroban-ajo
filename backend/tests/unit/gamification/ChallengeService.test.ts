import { challengeService } from '../../../src/services/gamification/ChallengeService';
import { prisma } from '../../../src/config/database';
import {
  ChallengeNotFoundError,
  ChallengeExpiredError,
  DuplicateRewardError,
} from '../../../src/errors/GamificationError';

jest.mock('../../../src/config/database', () => ({
  prisma: {
    challenge: { findMany: jest.fn(), findUnique: jest.fn() },
    userChallenge: { upsert: jest.fn(), update: jest.fn(), findMany: jest.fn() },
    rewardHistory: { findUnique: jest.fn(), create: jest.fn() },
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

describe('ChallengeService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('updateChallengeProgress', () => {
    it('should update progress for matching challenge', async () => {
      const mockChallenge = {
        id: 'ch1',
        name: 'Weekly Warrior',
        requirement: JSON.stringify({ actionType: 'CONTRIBUTION', target: 3 }),
        points: 150,
        endDate: new Date(Date.now() + 86400000),
      };

      (prisma.challenge.findMany as jest.Mock).mockResolvedValue([mockChallenge]);
      (prisma.userChallenge.upsert as jest.Mock).mockResolvedValue({
        progress: 1,
        completed: false,
      });

      const result = await challengeService.updateChallengeProgress('user1', 'CONTRIBUTION');

      expect(result).toEqual([]);
      expect(prisma.userChallenge.upsert).toHaveBeenCalled();
    });

    it('should complete challenge when target reached', async () => {
      const mockChallenge = {
        id: 'ch1',
        name: 'Weekly Warrior',
        requirement: JSON.stringify({ actionType: 'CONTRIBUTION', target: 3 }),
        points: 150,
        endDate: new Date(Date.now() + 86400000),
      };

      (prisma.challenge.findMany as jest.Mock).mockResolvedValue([mockChallenge]);
      (prisma.userChallenge.upsert as jest.Mock).mockResolvedValue({
        progress: 2,
        completed: false,
      });

      const mockTransaction = jest.fn(async (callback) => {
        return await callback({
          challenge: {
            findUnique: jest.fn().mockResolvedValue(mockChallenge),
          },
          rewardHistory: {
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({}),
          },
          userChallenge: {
            update: jest.fn().mockResolvedValue({}),
          },
        });
      });

      (prisma.$transaction as jest.Mock) = mockTransaction;

      const result = await challengeService.updateChallengeProgress('user1', 'CONTRIBUTION');

      expect(result).toContain('ch1');
    });

    it('should not update progress for non-matching action type', async () => {
      const mockChallenge = {
        id: 'ch1',
        name: 'Social Connector',
        requirement: JSON.stringify({ actionType: 'INVITE', target: 2 }),
        points: 200,
        endDate: new Date(Date.now() + 86400000),
      };

      (prisma.challenge.findMany as jest.Mock).mockResolvedValue([mockChallenge]);

      const result = await challengeService.updateChallengeProgress('user1', 'CONTRIBUTION');

      expect(result).toEqual([]);
      expect(prisma.userChallenge.upsert).not.toHaveBeenCalled();
    });
  });

  describe('completeChallenge', () => {
    it('should throw ChallengeNotFoundError for invalid challenge', async () => {
      const mockTransaction = jest.fn(async (callback) => {
        return await callback({
          challenge: {
            findUnique: jest.fn().mockResolvedValue(null),
          },
        });
      });

      (prisma.$transaction as jest.Mock) = mockTransaction;

      await expect(challengeService.completeChallenge('user1', 'invalid')).rejects.toThrow(
        ChallengeNotFoundError
      );
    });

    it('should throw ChallengeExpiredError for expired challenge', async () => {
      const expiredChallenge = {
        id: 'ch1',
        endDate: new Date(Date.now() - 86400000),
      };

      const mockTransaction = jest.fn(async (callback) => {
        return await callback({
          challenge: {
            findUnique: jest.fn().mockResolvedValue(expiredChallenge),
          },
        });
      });

      (prisma.$transaction as jest.Mock) = mockTransaction;

      await expect(challengeService.completeChallenge('user1', 'ch1')).rejects.toThrow(
        ChallengeExpiredError
      );
    });

    it('should throw DuplicateRewardError for already completed challenge', async () => {
      const mockChallenge = {
        id: 'ch1',
        endDate: new Date(Date.now() + 86400000),
      };

      const mockTransaction = jest.fn(async (callback) => {
        return await callback({
          challenge: {
            findUnique: jest.fn().mockResolvedValue(mockChallenge),
          },
          rewardHistory: {
            findUnique: jest.fn().mockResolvedValue({ id: 'existing' }),
          },
        });
      });

      (prisma.$transaction as jest.Mock) = mockTransaction;

      await expect(challengeService.completeChallenge('user1', 'ch1')).rejects.toThrow(
        DuplicateRewardError
      );
    });
  });

  describe('getUserChallenges', () => {
    it('should return user challenges with progress', async () => {
      const now = new Date();
      const mockChallenges = [
        {
          id: 'ch1',
          name: 'Weekly Warrior',
          description: 'Make 3 contributions',
          type: 'WEEKLY',
          points: 150,
          requirement: JSON.stringify({ actionType: 'CONTRIBUTION', target: 3 }),
          endDate: new Date(now.getTime() + 86400000),
          userChallenges: [
            {
              progress: 2,
              completed: false,
              completedAt: null,
            },
          ],
        },
      ];

      (prisma.challenge.findMany as jest.Mock).mockResolvedValue(mockChallenges);

      const result = await challengeService.getUserChallenges('user1');

      expect(result).toHaveLength(1);
      expect(result[0].progress).toBe(2);
      expect(result[0].target).toBe(3);
      expect(result[0].completed).toBe(false);
    });
  });

  describe('getActiveChallenges', () => {
    it('should return only active challenges', async () => {
      const now = new Date();
      const mockChallenges = [
        {
          id: 'ch1',
          name: 'Weekly Warrior',
          description: 'Make 3 contributions',
          type: 'WEEKLY',
          category: 'CONTRIBUTION',
          points: 150,
          startDate: new Date(now.getTime() - 86400000),
          endDate: new Date(now.getTime() + 86400000),
        },
      ];

      (prisma.challenge.findMany as jest.Mock).mockResolvedValue(mockChallenges);

      const result = await challengeService.getActiveChallenges();

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Weekly Warrior');
    });
  });
});
