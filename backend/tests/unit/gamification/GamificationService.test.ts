import { gamificationService } from '../../../src/services/gamification/GamificationService';
import { prisma } from '../../../src/config/database';
import { pointsService } from '../../../src/services/gamification/PointsService';
import { streakService } from '../../../src/services/gamification/StreakService';
import { achievementService } from '../../../src/services/gamification/AchievementService';
import { challengeService } from '../../../src/services/gamification/ChallengeService';
import { POINTS_CONFIG, ReferenceType } from '../../../src/types/gamification';

jest.mock('../../../src/config/database', () => ({
  prisma: {
    userGamification: { findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn() },
    activityFeed: { create: jest.fn(), findMany: jest.fn() },
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
jest.mock('../../../src/services/gamification/StreakService');
jest.mock('../../../src/services/gamification/AchievementService');
jest.mock('../../../src/services/gamification/ChallengeService');

describe('GamificationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('handleContribution', () => {
    it('should handle contribution successfully', async () => {
      (pointsService.awardPoints as jest.Mock).mockResolvedValue({
        points: 150,
        leveledUp: false,
      });
      (streakService.updateContributionStreak as jest.Mock).mockResolvedValue({
        streak: 5,
        bonusAwarded: true,
      });
      (achievementService.checkAndAwardAchievements as jest.Mock).mockResolvedValue(['ach1']);
      (challengeService.updateChallengeProgress as jest.Mock).mockResolvedValue([]);
      (prisma.activityFeed.create as jest.Mock).mockResolvedValue({});

      const result = await gamificationService.handleContribution('user1', 'contrib1');

      expect(result).toEqual({
        points: 150,
        streak: 5,
        achievementsUnlocked: ['ach1'],
      });

      expect(pointsService.awardPoints).toHaveBeenCalledWith(
        'user1',
        POINTS_CONFIG.CONTRIBUTION,
        'Contribution made',
        'contrib1',
        ReferenceType.CONTRIBUTION
      );
    });

    it('should create level up activity when leveled up', async () => {
      (pointsService.awardPoints as jest.Mock).mockResolvedValue({
        points: 1050,
        leveledUp: true,
        newLevel: 'SILVER',
      });
      (streakService.updateContributionStreak as jest.Mock).mockResolvedValue({
        streak: 1,
        bonusAwarded: false,
      });
      (achievementService.checkAndAwardAchievements as jest.Mock).mockResolvedValue([]);
      (challengeService.updateChallengeProgress as jest.Mock).mockResolvedValue([]);
      (prisma.activityFeed.create as jest.Mock).mockResolvedValue({});

      await gamificationService.handleContribution('user1', 'contrib1');

      expect(prisma.activityFeed.create).toHaveBeenCalledTimes(2);
    });
  });

  describe('handleGroupCompletion', () => {
    it('should handle group completion successfully', async () => {
      (pointsService.awardPoints as jest.Mock).mockResolvedValue({
        points: 600,
        leveledUp: false,
      });
      (prisma.userGamification.update as jest.Mock).mockResolvedValue({});
      (achievementService.checkAndAwardAchievements as jest.Mock).mockResolvedValue([]);
      (challengeService.updateChallengeProgress as jest.Mock).mockResolvedValue([]);
      (prisma.activityFeed.create as jest.Mock).mockResolvedValue({});

      const result = await gamificationService.handleGroupCompletion('user1', 'group1');

      expect(result).toEqual({
        points: 600,
        achievementsUnlocked: [],
      });

      expect(pointsService.awardPoints).toHaveBeenCalledWith(
        'user1',
        POINTS_CONFIG.GROUP_COMPLETE,
        'Group completed',
        'group1',
        ReferenceType.GROUP_COMPLETE
      );

      expect(prisma.userGamification.update).toHaveBeenCalledWith({
        where: { userId: 'user1' },
        data: { groupsCompleted: { increment: 1 } },
      });
    });
  });

  describe('handleInvite', () => {
    it('should handle invite successfully', async () => {
      (pointsService.awardPoints as jest.Mock).mockResolvedValue({
        points: 200,
        leveledUp: false,
      });
      (prisma.userGamification.update as jest.Mock).mockResolvedValue({});
      (achievementService.checkAndAwardAchievements as jest.Mock).mockResolvedValue([]);
      (challengeService.updateChallengeProgress as jest.Mock).mockResolvedValue([]);

      const result = await gamificationService.handleInvite('user1', 'user2');

      expect(result).toEqual({
        points: 200,
        achievementsUnlocked: [],
      });

      expect(pointsService.awardPoints).toHaveBeenCalledWith(
        'user1',
        POINTS_CONFIG.INVITE_FRIEND,
        'Friend invited',
        'user2',
        ReferenceType.INVITE
      );

      expect(prisma.userGamification.update).toHaveBeenCalledWith({
        where: { userId: 'user1' },
        data: { totalInvites: { increment: 1 } },
      });
    });
  });

  describe('handleLogin', () => {
    it('should handle login successfully', async () => {
      (pointsService.awardPoints as jest.Mock).mockResolvedValue({
        points: 110,
        leveledUp: false,
      });
      (streakService.updateLoginStreak as jest.Mock).mockResolvedValue({
        streak: 7,
      });
      (challengeService.updateChallengeProgress as jest.Mock).mockResolvedValue([]);

      const result = await gamificationService.handleLogin('user1');

      expect(result).toEqual({
        points: 110,
        streak: 7,
      });
    });
  });

  describe('getUserStats', () => {
    it('should return user stats', async () => {
      const mockGamification = {
        points: 1500,
        level: 'SILVER',
        contributionStreak: 10,
        loginStreak: 15,
        totalInvites: 5,
        groupsCompleted: 2,
      };

      const mockAchievements = [
        {
          id: 'ach1',
          name: 'First Contribution',
          description: 'Made first contribution',
          icon: '🎯',
          category: 'CONTRIBUTION',
          points: 100,
          unlockedAt: new Date(),
        },
      ];

      const mockChallenges = [
        {
          id: 'ch1',
          name: 'Weekly Warrior',
          description: 'Make 3 contributions',
          type: 'WEEKLY',
          points: 150,
          progress: 2,
          target: 3,
          completed: false,
          completedAt: null,
          endDate: new Date(),
        },
      ];

      (prisma.userGamification.findUnique as jest.Mock).mockResolvedValue(mockGamification);
      (achievementService.getUserAchievements as jest.Mock).mockResolvedValue(mockAchievements);
      (challengeService.getUserChallenges as jest.Mock).mockResolvedValue(mockChallenges);

      const result = await gamificationService.getUserStats('user1');

      expect(result.gamification).toEqual(mockGamification);
      expect(result.achievements).toEqual(mockAchievements);
      expect(result.challenges).toEqual(mockChallenges);
    });
  });

  describe('getLeaderboard', () => {
    it('should return leaderboard with rankings', async () => {
      const mockData = [
        {
          userId: 'user1',
          points: 5000,
          level: 'GOLD',
          contributionStreak: 30,
          user: { walletAddress: 'GABC...123' },
        },
        {
          userId: 'user2',
          points: 3000,
          level: 'SILVER',
          contributionStreak: 15,
          user: { walletAddress: 'GDEF...456' },
        },
      ];

      (prisma.userGamification.findMany as jest.Mock).mockResolvedValue(mockData);

      const result = await gamificationService.getLeaderboard(100, 0);

      expect(result).toHaveLength(2);
      expect(result[0].rank).toBe(1);
      expect(result[1].rank).toBe(2);
      expect(result[0].points).toBe(5000);
    });
  });

  describe('getActivityFeed', () => {
    it('should return activity feed', async () => {
      const mockActivities = [
        {
          id: 'act1',
          type: 'CONTRIBUTION',
          title: 'Contribution Made',
          description: 'Earned 50 points',
          createdAt: new Date(),
        },
      ];

      (prisma.activityFeed.findMany as jest.Mock).mockResolvedValue(mockActivities);

      const result = await gamificationService.getActivityFeed('user1', 50, 0);

      expect(result).toEqual(mockActivities);
    });
  });
});
