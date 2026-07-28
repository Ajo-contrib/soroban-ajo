import { IResolvers } from '@graphql-tools/utils'
import { prisma } from '@/config/database'
import { GraphQLContext } from '../types/context'
import { UnauthorizedError, ForbiddenError, ValidationError, AppError } from '../../errors/AppError'
import { goalsService } from '../../services/goalsService'
import { rewardService } from '../../services/rewardService'
import { disputeService, DisputeType } from '../../services/disputeService'
import { insuranceService } from '../../services/insuranceService'
import { gamificationService } from '../../services/gamification/GamificationService'

/**
 * disputeService/rewardService throw plain Errors (sometimes with an
 * ad-hoc `.statusCode`, e.g. rewardService's ownership check) rather than
 * AppError. Preserve whatever status they intended instead of collapsing
 * everything to a generic 400, so GraphQL error codes stay meaningful.
 */
function toGraphQLError(err: unknown): AppError {
  if (err instanceof AppError) return err
  if (err instanceof Error) {
    const statusCode = (err as { statusCode?: number }).statusCode
    if (statusCode === 404) return new AppError(err.message, 'NOT_FOUND', 404)
    if (statusCode === 403) return new AppError(err.message, 'FORBIDDEN', 403)
    if (statusCode === 401) return new AppError(err.message, 'UNAUTHORIZED', 401)
    return new ValidationError(err.message)
  }
  return new ValidationError('Request failed')
}

function requireAuth(context: GraphQLContext): string {
  if (!context.walletAddress) {
    throw new UnauthorizedError('Authentication required')
  }
  return context.walletAddress
}

export const resolvers: IResolvers<unknown, GraphQLContext> = {
  Query: {
    groups: async (_: any, { page = 1, limit = 10 }: any) => {
      const skip = (page - 1) * limit
      const [data, total] = await Promise.all([
        prisma.group.findMany({ skip, take: limit, orderBy: { createdAt: 'desc' } }),
        prisma.group.count(),
      ])
      return {
        data,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      }
    },

    group: async (_: any, { id }: any, { loaders }) => {
      return loaders.groupLoader.load(id)
    },

    goals: async (_: any, { userId }: any) => {
      return goalsService.getGoals(userId)
    },

    goal: async (_: any, { id }: any) => {
      return goalsService.getGoal(id)
    },

    rewards: async (_: any, { userId, status, type }: any) => {
      return rewardService.getRewards(userId, { status, type })
    },

    rewardHistory: async (_: any, { userId }: any) => {
      return rewardService.getRewardHistory(userId)
    },

    payouts: async (_: any, { groupId, page = 1, limit = 20 }: any) => {
      const skip = (page - 1) * limit
      const [data, total] = await Promise.all([
        prisma.payout.findMany({
          where: { groupId },
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
        }),
        prisma.payout.count({ where: { groupId } }),
      ])
      return {
        data,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      }
    },

    dispute: async (_: any, { id }: any) => {
      return disputeService.getDispute(id)
    },

    disputesByGroup: async (_: any, { groupId }: any) => {
      return disputeService.listGroupDisputes(groupId)
    },

    insurancePool: async (_: any, { tokenAddress }: any) => {
      try {
        return await insuranceService.getInsurancePool(tokenAddress)
      } catch (err) {
        throw toGraphQLError(err)
      }
    },

    // No `walletAddress` argument by design — REST's /api/gamification/stats
    // always resolves the caller's own stats from the verified token, never an
    // arbitrary target user. Accepting one here would be a parity regression.
    gamificationStats: async (_: any, __: any, context: GraphQLContext) => {
      const walletAddress = requireAuth(context)
      return gamificationService.getUserStats(walletAddress)
    },

    leaderboard: async (_: any, { limit = 100, offset = 0 }: any) => {
      return gamificationService.getLeaderboard(limit, offset)
    },

    activityFeed: async (_: any, { limit = 50, offset = 0 }: any, context: GraphQLContext) => {
      const walletAddress = requireAuth(context)
      return gamificationService.getActivityFeed(walletAddress, limit, offset)
    },
  },

  Mutation: {
    createGoal: async (_: any, args: any, context: GraphQLContext) => {
      const walletAddress = requireAuth(context)
      return goalsService.createGoal(walletAddress, args)
    },

    updateGoal: async (_: any, { id, ...data }: any, context: GraphQLContext) => {
      const walletAddress = requireAuth(context)
      const existing = await goalsService.getGoal(id)
      if (existing.userId !== walletAddress) {
        throw new ForbiddenError('You do not own this goal')
      }
      return goalsService.updateGoal(id, data)
    },

    deleteGoal: async (_: any, { id }: any, context: GraphQLContext) => {
      const walletAddress = requireAuth(context)
      const existing = await goalsService.getGoal(id)
      if (existing.userId !== walletAddress) {
        throw new ForbiddenError('You do not own this goal')
      }
      await goalsService.deleteGoal(id)
      return true
    },

    redeemReward: async (_: any, { rewardId }: any, context: GraphQLContext) => {
      const walletAddress = requireAuth(context)
      try {
        return await rewardService.redeemReward(walletAddress, rewardId)
      } catch (err) {
        throw toGraphQLError(err)
      }
    },

    fileDispute: async (_: any, { groupId, type, summary, evidence }: any, context: GraphQLContext) => {
      const walletAddress = requireAuth(context)
      try {
        return await disputeService.fileDispute(
          groupId,
          walletAddress,
          type as DisputeType,
          summary,
          evidence || []
        )
      } catch (err) {
        throw toGraphQLError(err)
      }
    },

    voteOnDispute: async (_: any, { id, vote }: any, context: GraphQLContext) => {
      const walletAddress = requireAuth(context)
      if (vote !== 'yes' && vote !== 'no') {
        throw new ValidationError('vote must be yes or no')
      }
      try {
        return await disputeService.voteOnDispute(id, walletAddress, vote)
      } catch (err) {
        throw toGraphQLError(err)
      }
    },

    fileInsuranceClaim: async (
      _: any,
      { groupId, cycle, defaulter, amount, signedXdr }: any,
      context: GraphQLContext
    ) => {
      const walletAddress = requireAuth(context)
      try {
        return await insuranceService.fileClaim({
          claimant: walletAddress,
          groupId,
          cycle,
          defaulter,
          amount,
          signedXdr,
        })
      } catch (err) {
        throw toGraphQLError(err)
      }
    },

    // Matches REST: the route only requires *a* valid caller, not a verified
    // admin role (see routes/insurance.ts) — this is a pre-existing REST gap,
    // not something to silently tighten under the banner of "parity".
    processInsuranceClaim: async (
      _: any,
      { claimId, approved, signedXdr }: any,
      context: GraphQLContext
    ) => {
      const walletAddress = requireAuth(context)
      try {
        return await insuranceService.processClaim({
          admin: walletAddress,
          claimId,
          approved,
          signedXdr,
        })
      } catch (err) {
        throw toGraphQLError(err)
      }
    },
  },

  Group: {
    // Prisma returns BigInt for these columns; the `String` scalar's default
    // serializer calls `isFinite()` on the resolved value, which throws a
    // TypeError on a raw BigInt (`isFinite(10n)` → "Cannot convert a BigInt
    // value to a number"). Stringify explicitly instead of leaking that crash.
    contributionAmount: (parent: any) => String(parent.contributionAmount),
    memberCount: async (parent: any, _: any, { loaders }) => {
      return loaders.memberCountLoader.load(parent.id)
    },
    members: async (parent: any, _: any, { loaders }) => {
      return loaders.membersByGroupLoader.load(parent.id)
    },
    contributions: async (parent: any, _: any, { loaders }) => {
      return loaders.contributionsByGroupLoader.load(parent.id)
    },
  },

  Member: {
    joinedAt: (parent: any) => parent.joinedAt.toISOString(),
  },

  Contribution: {
    amount: (parent: any) => String(parent.amount),
    createdAt: (parent: any) => parent.createdAt.toISOString(),
  },

  Payout: {
    amount: (parent: any) => String(parent.amount),
    createdAt: (parent: any) => parent.createdAt.toISOString(),
    processedAt: (parent: any) => (parent.processedAt ? parent.processedAt.toISOString() : null),
  },

  Achievement: {
    unlockedAt: (parent: any) => parent.unlockedAt.toISOString(),
  },

  ActivityFeedItem: {
    createdAt: (parent: any) => parent.createdAt.toISOString(),
  },
}
