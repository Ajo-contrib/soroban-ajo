import { Router } from 'express';
import { gamificationService } from '../services/gamification/GamificationService';
import { socialService } from '../services/gamification/SocialService';
import { challengeService } from '../services/gamification/ChallengeService';
import { authenticate } from '../middleware/auth';
import { validateRequest } from '../middleware/validation';
import {
  paginationSchema,
  walletAddressParamSchema,
  leaderboardQuerySchema,
  activityFeedQuerySchema,
} from '../validators/gamification';
import { asyncHandler } from '../middleware/errorHandler';
import { logger } from '../utils/logger';

export const gamificationRouter = Router();

// Get user gamification stats
gamificationRouter.get(
  '/stats',
  authenticate,
  asyncHandler(async (req, res) => {
    const userId = req.user?.walletAddress;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const stats = await gamificationService.getUserStats(userId);
    res.json({ success: true, data: stats });
  })
);

// Get leaderboard
gamificationRouter.get(
  '/leaderboard',
  validateRequest(leaderboardQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const { limit, offset } = req.query as { limit: number; offset: number };
    const leaderboard = await gamificationService.getLeaderboard(limit, offset);
    res.json({ success: true, data: leaderboard });
  })
);

// Get user activity feed
gamificationRouter.get(
  '/activity',
  authenticate,
  validateRequest(activityFeedQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const userId = req.user?.walletAddress;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const { limit, offset } = req.query as { limit: number; offset: number };
    const activities = await gamificationService.getActivityFeed(userId, limit, offset);
    res.json({ success: true, data: activities });
  })
);

// Follow user
gamificationRouter.post(
  '/follow/:walletAddress',
  authenticate,
  validateRequest(walletAddressParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    const followerId = req.user?.walletAddress;
    if (!followerId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const { walletAddress: followingId } = req.params;
    await socialService.followUser(followerId, followingId);
    res.json({ success: true, message: 'User followed successfully' });
  })
);

// Unfollow user
gamificationRouter.delete(
  '/follow/:walletAddress',
  authenticate,
  validateRequest(walletAddressParamSchema, 'params'),
  asyncHandler(async (req, res) => {
    const followerId = req.user?.walletAddress;
    if (!followerId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const { walletAddress: followingId } = req.params;
    await socialService.unfollowUser(followerId, followingId);
    res.json({ success: true, message: 'User unfollowed successfully' });
  })
);

// Get followers
gamificationRouter.get(
  '/followers',
  authenticate,
  validateRequest(paginationSchema, 'query'),
  asyncHandler(async (req, res) => {
    const userId = req.user?.walletAddress;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const { limit, offset } = req.query as { limit: number; offset: number };
    const followers = await socialService.getFollowers(userId, limit, offset);
    res.json({ success: true, data: followers });
  })
);

// Get following
gamificationRouter.get(
  '/following',
  authenticate,
  validateRequest(paginationSchema, 'query'),
  asyncHandler(async (req, res) => {
    const userId = req.user?.walletAddress;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const { limit, offset } = req.query as { limit: number; offset: number };
    const following = await socialService.getFollowing(userId, limit, offset);
    res.json({ success: true, data: following });
  })
);

// Get follow counts
gamificationRouter.get(
  '/follow-counts',
  authenticate,
  asyncHandler(async (req, res) => {
    const userId = req.user?.walletAddress;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const counts = await socialService.getFollowCounts(userId);
    res.json({ success: true, data: counts });
  })
);

// Handle login (for daily login tracking)
gamificationRouter.post(
  '/login',
  authenticate,
  asyncHandler(async (req, res) => {
    const userId = req.user?.walletAddress;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    try {
      const result = await gamificationService.handleLogin(userId);
      res.json({ success: true, data: result });
    } catch (error) {
      // Don't fail if already logged in today
      logger.warn('Login tracking failed', { error, userId });
      res.json({ success: true, data: { points: 0, streak: 0 } });
    }
  })
);

// Get active challenges
gamificationRouter.get(
  '/challenges',
  asyncHandler(async (req, res) => {
    const challenges = await challengeService.getActiveChallenges();
    res.json({ success: true, data: challenges });
  })
);

// Get user challenges
gamificationRouter.get(
  '/challenges/user',
  authenticate,
  asyncHandler(async (req, res) => {
    const userId = req.user?.walletAddress;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const challenges = await challengeService.getUserChallenges(userId);
    res.json({ success: true, data: challenges });
  })
);
