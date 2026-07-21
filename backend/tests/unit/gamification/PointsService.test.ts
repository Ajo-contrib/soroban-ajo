import { pointsService } from '../../../src/services/gamification/PointsService';
import { prisma } from '../../../src/config/database';
import { DuplicateRewardError } from '../../../src/errors/GamificationError';
import { UserLevel, ReferenceType } from '../../../src/types/gamification';

jest.mock('../../../src/config/database', () => ({
  prisma: {
    $transaction: jest.fn(),
    pointTransaction: {
      findUnique: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
    },
    userGamification: {
      upsert: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('../../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

describe('PointsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('awardPoints', () => {
    it('should award points successfully', async () => {
      const mockTransaction = jest.fn(async (callback) => {
        return await callback({
          pointTransaction: {
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({}),
          },
          userGamification: {
            upsert: jest.fn().mockResolvedValue({
              points: 50,
              level: UserLevel.BRONZE,
            }),
            update: jest.fn().mockResolvedValue({}),
          },
        });
      });

      (prisma.$transaction as jest.Mock) = mockTransaction;

      const result = await pointsService.awardPoints(
        'user1',
        50,
        'Test reward',
        'ref1',
        ReferenceType.CONTRIBUTION
      );

      expect(result).toEqual({
        points: 100,
        newLevel: undefined,
        leveledUp: false,
      });
    });

    it('should throw DuplicateRewardError for duplicate reference', async () => {
      const mockTransaction = jest.fn(async (callback) => {
        return await callback({
          pointTransaction: {
            findUnique: jest.fn().mockResolvedValue({ id: 'existing' }),
          },
        });
      });

      (prisma.$transaction as jest.Mock) = mockTransaction;

      await expect(
        pointsService.awardPoints(
          'user1',
          50,
          'Test reward',
          'ref1',
          ReferenceType.CONTRIBUTION
        )
      ).rejects.toThrow(DuplicateRewardError);
    });

    it('should detect level up', async () => {
      const mockTransaction = jest.fn(async (callback) => {
        return await callback({
          pointTransaction: {
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({}),
          },
          userGamification: {
            upsert: jest.fn().mockResolvedValue({
              points: 950,
              level: UserLevel.BRONZE,
            }),
            update: jest.fn().mockResolvedValue({}),
          },
        });
      });

      (prisma.$transaction as jest.Mock) = mockTransaction;

      const result = await pointsService.awardPoints('user1', 100, 'Test reward');

      expect(result.leveledUp).toBe(true);
      expect(result.newLevel).toBe(UserLevel.SILVER);
    });

    it('should throw error for negative points', async () => {
      await expect(pointsService.awardPoints('user1', -10, 'Invalid')).rejects.toThrow(
        'Points must be positive'
      );
    });

    it('should throw error for zero points', async () => {
      await expect(pointsService.awardPoints('user1', 0, 'Invalid')).rejects.toThrow(
        'Points must be positive'
      );
    });
  });

  describe('calculateLevel', () => {
    it('should return BRONZE for 0-999 points', () => {
      expect(pointsService.calculateLevel(0)).toBe(UserLevel.BRONZE);
      expect(pointsService.calculateLevel(500)).toBe(UserLevel.BRONZE);
      expect(pointsService.calculateLevel(999)).toBe(UserLevel.BRONZE);
    });

    it('should return SILVER for 1000-4999 points', () => {
      expect(pointsService.calculateLevel(1000)).toBe(UserLevel.SILVER);
      expect(pointsService.calculateLevel(2500)).toBe(UserLevel.SILVER);
      expect(pointsService.calculateLevel(4999)).toBe(UserLevel.SILVER);
    });

    it('should return GOLD for 5000-14999 points', () => {
      expect(pointsService.calculateLevel(5000)).toBe(UserLevel.GOLD);
      expect(pointsService.calculateLevel(10000)).toBe(UserLevel.GOLD);
      expect(pointsService.calculateLevel(14999)).toBe(UserLevel.GOLD);
    });

    it('should return PLATINUM for 15000+ points', () => {
      expect(pointsService.calculateLevel(15000)).toBe(UserLevel.PLATINUM);
      expect(pointsService.calculateLevel(50000)).toBe(UserLevel.PLATINUM);
      expect(pointsService.calculateLevel(1000000)).toBe(UserLevel.PLATINUM);
    });
  });

  describe('getUserPoints', () => {
    it('should return user points', async () => {
      (prisma.userGamification.findUnique as jest.Mock).mockResolvedValue({
        points: 1500,
      });

      const points = await pointsService.getUserPoints('user1');
      expect(points).toBe(1500);
    });

    it('should return 0 for non-existent user', async () => {
      (prisma.userGamification.findUnique as jest.Mock).mockResolvedValue(null);

      const points = await pointsService.getUserPoints('user1');
      expect(points).toBe(0);
    });
  });

  describe('getPointHistory', () => {
    it('should return point transaction history', async () => {
      const mockHistory = [
        {
          id: '1',
          points: 50,
          reason: 'Contribution',
          referenceType: 'CONTRIBUTION',
          createdAt: new Date(),
        },
      ];

      (prisma.pointTransaction.findMany as jest.Mock).mockResolvedValue(mockHistory);

      const history = await pointsService.getPointHistory('user1', 10, 0);
      expect(history).toEqual(mockHistory);
      expect(prisma.pointTransaction.findMany).toHaveBeenCalledWith({
        where: { userId: 'user1' },
        select: {
          id: true,
          points: true,
          reason: true,
          referenceType: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
        skip: 0,
      });
    });
  });
});
