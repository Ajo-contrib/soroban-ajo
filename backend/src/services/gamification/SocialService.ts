import { prisma } from '../../config/database';
import { logger } from '../../utils/logger';
import { RateLimitExceededError } from '../../errors/GamificationError';
import { challengeService } from './ChallengeService';

export class SocialService {
  private followRateLimits: Map<string, { count: number; resetAt: number }> = new Map();
  private readonly MAX_FOLLOWS_PER_HOUR = 20;
  private readonly RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

  async followUser(followerId: string, followingId: string): Promise<void> {
    if (followerId === followingId) {
      throw new Error('Cannot follow yourself');
    }

    // Check rate limit
    this.checkRateLimit(followerId);

    // Check if already following
    const existing = await prisma.userFollow.findUnique({
      where: {
        followerId_followingId: {
          followerId,
          followingId,
        },
      },
    });

    if (existing) {
      throw new Error('Already following this user');
    }

    // Create follow relationship
    await prisma.userFollow.create({
      data: {
        followerId,
        followingId,
      },
    });

    // Update rate limit
    this.incrementRateLimit(followerId);

    // Update challenge progress
    await challengeService.updateChallengeProgress(followerId, 'FOLLOW');

    logger.info('User followed', { followerId, followingId });
  }

  async unfollowUser(followerId: string, followingId: string): Promise<void> {
    const result = await prisma.userFollow.deleteMany({
      where: {
        followerId,
        followingId,
      },
    });

    if (result.count === 0) {
      throw new Error('Not following this user');
    }

    logger.info('User unfollowed', { followerId, followingId });
  }

  async getFollowers(
    userId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<
    Array<{
      id: string;
      walletAddress: string;
      points: number;
      level: string;
      followedAt: Date;
    }>
  > {
    const followers = await prisma.userFollow.findMany({
      where: { followingId: userId },
      take: limit,
      skip: offset,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        follower: {
          select: {
            walletAddress: true,
            gamification: {
              select: {
                points: true,
                level: true,
              },
            },
          },
        },
      },
    });

    return followers.map((f: any) => ({
      id: f.id,
      walletAddress: f.follower.walletAddress,
      points: f.follower.gamification?.points || 0,
      level: f.follower.gamification?.level || 'BRONZE',
      followedAt: f.createdAt,
    }));
  }

  async getFollowing(
    userId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<
    Array<{
      id: string;
      walletAddress: string;
      points: number;
      level: string;
      followedAt: Date;
    }>
  > {
    const following = await prisma.userFollow.findMany({
      where: { followerId: userId },
      take: limit,
      skip: offset,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        following: {
          select: {
            walletAddress: true,
            gamification: {
              select: {
                points: true,
                level: true,
              },
            },
          },
        },
      },
    });

    return following.map((f: any) => ({
      id: f.id,
      walletAddress: f.following.walletAddress,
      points: f.following.gamification?.points || 0,
      level: f.following.gamification?.level || 'BRONZE',
      followedAt: f.createdAt,
    }));
  }

  async getFollowCounts(userId: string): Promise<{ followers: number; following: number }> {
    const [followers, following] = await Promise.all([
      prisma.userFollow.count({ where: { followingId: userId } }),
      prisma.userFollow.count({ where: { followerId: userId } }),
    ]);

    return { followers, following };
  }

  async isFollowing(followerId: string, followingId: string): Promise<boolean> {
    const follow = await prisma.userFollow.findUnique({
      where: {
        followerId_followingId: {
          followerId,
          followingId,
        },
      },
    });

    return !!follow;
  }

  private checkRateLimit(userId: string): void {
    const now = Date.now();
    const limit = this.followRateLimits.get(userId);

    if (!limit || now > limit.resetAt) {
      return;
    }

    if (limit.count >= this.MAX_FOLLOWS_PER_HOUR) {
      const retryAfter = Math.ceil((limit.resetAt - now) / 1000);
      throw new RateLimitExceededError('follow', retryAfter);
    }
  }

  private incrementRateLimit(userId: string): void {
    const now = Date.now();
    const limit = this.followRateLimits.get(userId);

    if (!limit || now > limit.resetAt) {
      this.followRateLimits.set(userId, {
        count: 1,
        resetAt: now + this.RATE_LIMIT_WINDOW_MS,
      });
    } else {
      limit.count++;
    }

    // Cleanup old entries periodically
    if (Math.random() < 0.01) {
      this.cleanupRateLimits();
    }
  }

  private cleanupRateLimits(): void {
    const now = Date.now();
    for (const [userId, limit] of this.followRateLimits.entries()) {
      if (now > limit.resetAt) {
        this.followRateLimits.delete(userId);
      }
    }
  }
}

export const socialService = new SocialService();
