import { socialService } from '../../../src/services/gamification/SocialService';
import { prisma } from '../../../src/config/database';
import { RateLimitExceededError } from '../../../src/errors/GamificationError';

jest.mock('../../../src/config/database', () => ({
  prisma: {
    userFollow: {
      findUnique: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
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
jest.mock('../../../src/services/gamification/ChallengeService');

describe('SocialService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('followUser', () => {
    it('should follow user successfully', async () => {
      (prisma.userFollow.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.userFollow.create as jest.Mock).mockResolvedValue({});

      await socialService.followUser('user1', 'user2');

      expect(prisma.userFollow.create).toHaveBeenCalledWith({
        data: {
          followerId: 'user1',
          followingId: 'user2',
        },
      });
    });

    it('should throw error when trying to follow self', async () => {
      await expect(socialService.followUser('user1', 'user1')).rejects.toThrow(
        'Cannot follow yourself'
      );
    });

    it('should throw error when already following', async () => {
      (prisma.userFollow.findUnique as jest.Mock).mockResolvedValue({ id: 'existing' });

      await expect(socialService.followUser('user1', 'user2')).rejects.toThrow(
        'Already following this user'
      );
    });

    it('should enforce rate limiting', async () => {
      (prisma.userFollow.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.userFollow.create as jest.Mock).mockResolvedValue({});

      // Use a unique user ID to avoid state leaking from earlier tests in this suite
      const testUser = 'user_ratelimit_test';

      // Follow 20 users (max per hour)
      for (let i = 0; i < 20; i++) {
        await socialService.followUser(testUser, `user${i + 100}`);
      }

      // 21st follow should be rate limited
      await expect(socialService.followUser(testUser, 'user200')).rejects.toThrow(
        RateLimitExceededError
      );
    });
  });

  describe('unfollowUser', () => {
    it('should unfollow user successfully', async () => {
      (prisma.userFollow.deleteMany as jest.Mock).mockResolvedValue({ count: 1 });

      await socialService.unfollowUser('user1', 'user2');

      expect(prisma.userFollow.deleteMany).toHaveBeenCalledWith({
        where: {
          followerId: 'user1',
          followingId: 'user2',
        },
      });
    });

    it('should throw error when not following', async () => {
      (prisma.userFollow.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });

      await expect(socialService.unfollowUser('user1', 'user2')).rejects.toThrow(
        'Not following this user'
      );
    });
  });

  describe('getFollowers', () => {
    it('should return followers list', async () => {
      const mockFollowers = [
        {
          id: 'f1',
          createdAt: new Date(),
          follower: {
            walletAddress: 'user1',
            gamification: {
              points: 1000,
              level: 'SILVER',
            },
          },
        },
      ];

      (prisma.userFollow.findMany as jest.Mock).mockResolvedValue(mockFollowers);

      const result = await socialService.getFollowers('user2', 50, 0);

      expect(result).toHaveLength(1);
      expect(result[0].walletAddress).toBe('user1');
      expect(result[0].points).toBe(1000);
    });
  });

  describe('getFollowing', () => {
    it('should return following list', async () => {
      const mockFollowing = [
        {
          id: 'f1',
          createdAt: new Date(),
          following: {
            walletAddress: 'user2',
            gamification: {
              points: 2000,
              level: 'GOLD',
            },
          },
        },
      ];

      (prisma.userFollow.findMany as jest.Mock).mockResolvedValue(mockFollowing);

      const result = await socialService.getFollowing('user1', 50, 0);

      expect(result).toHaveLength(1);
      expect(result[0].walletAddress).toBe('user2');
      expect(result[0].level).toBe('GOLD');
    });
  });

  describe('getFollowCounts', () => {
    it('should return follower and following counts', async () => {
      (prisma.userFollow.count as jest.Mock)
        .mockResolvedValueOnce(10) // followers
        .mockResolvedValueOnce(15); // following

      const result = await socialService.getFollowCounts('user1');

      expect(result).toEqual({
        followers: 10,
        following: 15,
      });
    });
  });

  describe('isFollowing', () => {
    it('should return true if following', async () => {
      (prisma.userFollow.findUnique as jest.Mock).mockResolvedValue({ id: 'f1' });

      const result = await socialService.isFollowing('user1', 'user2');

      expect(result).toBe(true);
    });

    it('should return false if not following', async () => {
      (prisma.userFollow.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await socialService.isFollowing('user1', 'user2');

      expect(result).toBe(false);
    });
  });
});
