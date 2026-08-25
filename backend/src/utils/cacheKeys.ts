import { CACHE_PREFIX } from '../config/cache.config'

/**
 * Centralized cache key generation to ensure consistency across the application.
 * This prevents key collisions and makes invalidation patterns easier to manage.
 */

function prefixKey(scope: string | undefined, key: string): string {
  if (!scope) return key
  const cleanScope = scope.trim()
  return cleanScope ? `tenant:${cleanScope}:${key}` : key
}

export function createScopedCacheKeys(scope?: string) {
  return {
    // User keys
    userProfile: (walletAddress: string) => prefixKey(scope, `${CACHE_PREFIX.USER}:profile:${walletAddress}`),
    userStats: (walletAddress: string) => prefixKey(scope, `${CACHE_PREFIX.USER}:stats:${walletAddress}`),
    userAchievements: (walletAddress: string) => prefixKey(scope, `${CACHE_PREFIX.USER}:achievements:${walletAddress}`),
    userGamification: (walletAddress: string) => prefixKey(scope, `${CACHE_PREFIX.USER}:gamification:${walletAddress}`),
    userGoals: (walletAddress: string) => prefixKey(scope, `${CACHE_PREFIX.USER}:goals:${walletAddress}`),
    userActivity: (walletAddress: string) => prefixKey(scope, `${CACHE_PREFIX.USER}:activity:${walletAddress}`),

    // Group keys
    groupDetails: (groupId: string) => prefixKey(scope, `${CACHE_PREFIX.GROUP}:details:${groupId}`),
    groupMembers: (groupId: string) => prefixKey(scope, `${CACHE_PREFIX.GROUP}:members:${groupId}`),
    groupContributions: (groupId: string) => prefixKey(scope, `${CACHE_PREFIX.GROUP}:contributions:${groupId}`),
    groupContributionsByRound: (groupId: string, round: number) =>
      prefixKey(scope, `${CACHE_PREFIX.GROUP}:contributions:${groupId}:round:${round}`),
    groupList: (filter?: string) => prefixKey(scope, `${CACHE_PREFIX.GROUP}:list${filter ? `:${filter}` : ''}`),
    groupStats: (groupId: string) => prefixKey(scope, `${CACHE_PREFIX.GROUP}:stats:${groupId}`),

    // Goal keys
    goalDetails: (goalId: string) => prefixKey(scope, `${CACHE_PREFIX.GOAL}:details:${goalId}`),
    goalList: (walletAddress: string) => prefixKey(scope, `${CACHE_PREFIX.GOAL}:list:${walletAddress}`),
    goalProgress: (goalId: string) => prefixKey(scope, `${CACHE_PREFIX.GOAL}:progress:${goalId}`),

    // Contribution keys
    contributionHistory: (walletAddress: string) => prefixKey(scope, `${CACHE_PREFIX.CONTRIBUTION}:history:${walletAddress}`),
    contributionStats: (walletAddress: string) => prefixKey(scope, `${CACHE_PREFIX.CONTRIBUTION}:stats:${walletAddress}`),

    // Leaderboard keys
    leaderboardTopReferrers: (limit: number = 100) => prefixKey(scope, `${CACHE_PREFIX.LEADERBOARD}:referrers:top:${limit}`),
    leaderboardTopSavers: (limit: number = 100) => prefixKey(scope, `${CACHE_PREFIX.LEADERBOARD}:savers:top:${limit}`),
    leaderboardTopContributors: (limit: number = 100) => prefixKey(scope, `${CACHE_PREFIX.LEADERBOARD}:contributors:top:${limit}`),
    leaderboardUserRank: (walletAddress: string, type: string) =>
      prefixKey(scope, `${CACHE_PREFIX.LEADERBOARD}:rank:${type}:${walletAddress}`),

    // Activity keys
    activityFeed: (walletAddress: string, limit: number = 50) =>
      prefixKey(scope, `${CACHE_PREFIX.ACTIVITY}:feed:${walletAddress}:${limit}`),
    activityGlobal: (limit: number = 100) => prefixKey(scope, `${CACHE_PREFIX.ACTIVITY}:global:${limit}`),

    // Referral keys
    referralCode: (walletAddress: string) => prefixKey(scope, `${CACHE_PREFIX.REFERRAL}:code:${walletAddress}`),
    referralStats: (walletAddress: string) => prefixKey(scope, `${CACHE_PREFIX.REFERRAL}:stats:${walletAddress}`),
    referralHistory: (walletAddress: string) => prefixKey(scope, `${CACHE_PREFIX.REFERRAL}:history:${walletAddress}`),

    // Reward keys
    rewardList: (filter?: string) => prefixKey(scope, `${CACHE_PREFIX.REWARD}:list${filter ? `:${filter}` : ''}`),
    rewardHistory: (walletAddress: string) => prefixKey(scope, `${CACHE_PREFIX.REWARD}:history:${walletAddress}`),
    rewardBalance: (walletAddress: string) => prefixKey(scope, `${CACHE_PREFIX.REWARD}:balance:${walletAddress}`),

    // Analytics keys
    analyticsMetrics: (timeframe: string) => prefixKey(scope, `${CACHE_PREFIX.ANALYTICS}:metrics:${timeframe}`),
    analyticsUserMetrics: (walletAddress: string) => prefixKey(scope, `${CACHE_PREFIX.ANALYTICS}:user:${walletAddress}`),
    analyticsGroupMetrics: (groupId: string) => prefixKey(scope, `${CACHE_PREFIX.ANALYTICS}:group:${groupId}`),

    // Session keys
    sessionData: (sessionId: string) => prefixKey(scope, `${CACHE_PREFIX.SESSION}:${sessionId}`),

    // Temporary keys (for operations in progress)
    tempOperation: (operationId: string) => prefixKey(scope, `${CACHE_PREFIX.TEMP}:op:${operationId}`),
  }
}

export function createScopedCacheKeyPatterns(scope?: string) {
  return {
    userAll: (walletAddress: string) => prefixKey(scope, `${CACHE_PREFIX.USER}:*:${walletAddress}`),
    groupAll: (groupId: string) => prefixKey(scope, `${CACHE_PREFIX.GROUP}:*:${groupId}`),
    goalAll: (walletAddress: string) => prefixKey(scope, `${CACHE_PREFIX.GOAL}:*:${walletAddress}`),
    leaderboardAll: () => prefixKey(scope, `${CACHE_PREFIX.LEADERBOARD}:*`),
    activityAll: () => prefixKey(scope, `${CACHE_PREFIX.ACTIVITY}:*`),
    referralAll: (walletAddress: string) => prefixKey(scope, `${CACHE_PREFIX.REFERRAL}:*:${walletAddress}`),
    rewardAll: (walletAddress: string) => prefixKey(scope, `${CACHE_PREFIX.REWARD}:*:${walletAddress}`),
    tenantAll: () => (scope ? `tenant:${scope}:*` : '*'),
  }
}

const defaultKeys = createScopedCacheKeys()
const defaultPatterns = createScopedCacheKeyPatterns()

export const cacheKeys = {
  ...defaultKeys,
  scoped: (tenantIdOrContractAddress: string) => createScopedCacheKeys(tenantIdOrContractAddress),
}

/**
 * Get all cache keys matching a pattern (for invalidation)
 * Note: This is a helper for pattern-based invalidation
 */
export const getCacheKeyPatterns = {
  ...defaultPatterns,
  scoped: (tenantIdOrContractAddress: string) => createScopedCacheKeyPatterns(tenantIdOrContractAddress),
}
