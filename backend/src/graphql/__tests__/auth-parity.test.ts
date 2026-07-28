/**
 * Every mutation/query that touches a single user's private data must require
 * auth and enforce ownership, exactly like its REST equivalent. Two of the
 * original resolvers (updateGoal/deleteGoal) trusted a client-supplied
 * userId/id with no ownership check at all — this locks in the fix.
 */
jest.mock('@/config/database', () => ({
  prisma: {
    group: { findMany: jest.fn(), count: jest.fn() },
    groupMember: { findMany: jest.fn(), groupBy: jest.fn() },
    contribution: { findMany: jest.fn() },
    user: { findMany: jest.fn() },
  },
}))
jest.mock('../../services/goalsService', () => ({
  goalsService: {
    getGoal: jest.fn(),
    createGoal: jest.fn(),
    updateGoal: jest.fn(),
    deleteGoal: jest.fn(),
  },
}))
jest.mock('../../services/rewardService', () => ({ rewardService: {} }))
jest.mock('../../services/disputeService', () => ({ disputeService: {} }))
jest.mock('../../services/insuranceService', () => ({ insuranceService: {} }))
jest.mock('../../services/gamification/GamificationService', () => ({
  gamificationService: { getUserStats: jest.fn(), getLeaderboard: jest.fn() },
}))

import { graphql } from 'graphql'
import { makeExecutableSchema } from '@graphql-tools/schema'
import { typeDefs } from '../schema'
import { resolvers } from '../resolvers'
import { createDataLoaders } from '../dataloader'
import { goalsService } from '../../services/goalsService'
import { gamificationService } from '../../services/gamification/GamificationService'

const schema = makeExecutableSchema({ typeDefs, resolvers })

function contextFor(walletAddress?: string) {
  return { walletAddress, loaders: createDataLoaders() }
}

describe('GraphQL auth parity', () => {
  beforeEach(() => jest.clearAllMocks())

  it('rejects gamificationStats for an unauthenticated caller', async () => {
    const result = await graphql({
      schema,
      source: `query { gamificationStats { achievements { id } } }`,
      contextValue: contextFor(undefined),
    })

    expect(result.errors?.[0]?.extensions?.code).toBe('UNAUTHORIZED')
    expect(gamificationService.getUserStats).not.toHaveBeenCalled()
  })

  it('resolves gamificationStats for the authenticated caller only (no walletAddress argument exists)', async () => {
    ;(gamificationService.getUserStats as jest.Mock).mockResolvedValue({
      gamification: null,
      achievements: [],
      challenges: [],
    })

    const result = await graphql({
      schema,
      source: `query { gamificationStats { achievements { id } } }`,
      contextValue: contextFor('GCALLER'),
    })

    expect(result.errors).toBeUndefined()
    expect(gamificationService.getUserStats).toHaveBeenCalledWith('GCALLER')
  })

  it('rejects createGoal for an unauthenticated caller', async () => {
    const result = await graphql({
      schema,
      source: `mutation {
        createGoal(title: "t", targetAmount: "100", deadline: "2027-01-01", category: "CUSTOM") { id }
      }`,
      contextValue: contextFor(undefined),
    })

    expect(result.errors?.[0]?.extensions?.code).toBe('UNAUTHORIZED')
    expect(goalsService.createGoal).not.toHaveBeenCalled()
  })

  it('rejects updateGoal when the caller does not own the goal', async () => {
    ;(goalsService.getGoal as jest.Mock).mockResolvedValue({ id: 'g1', userId: 'GOWNER' })

    const result = await graphql({
      schema,
      source: `mutation { updateGoal(id: "g1", title: "new title") { id } }`,
      contextValue: contextFor('GNOTOWNER'),
    })

    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN')
    expect(goalsService.updateGoal).not.toHaveBeenCalled()
  })

  it('allows updateGoal when the caller owns the goal', async () => {
    ;(goalsService.getGoal as jest.Mock).mockResolvedValue({ id: 'g1', userId: 'GOWNER' })
    ;(goalsService.updateGoal as jest.Mock).mockResolvedValue({
      id: 'g1',
      userId: 'GOWNER',
      title: 'new title',
      targetAmount: '100',
      currentAmount: '0',
      deadline: '2027-01-01',
      category: 'CUSTOM',
      isPublic: false,
      status: 'ACTIVE',
      createdAt: '2026-01-01T00:00:00.000Z',
    })

    const result = await graphql({
      schema,
      source: `mutation { updateGoal(id: "g1", title: "new title") { id title } }`,
      contextValue: contextFor('GOWNER'),
    })

    expect(result.errors).toBeUndefined()
    expect(goalsService.updateGoal).toHaveBeenCalledWith('g1', { title: 'new title' })
  })

  it('rejects deleteGoal when the caller does not own the goal', async () => {
    ;(goalsService.getGoal as jest.Mock).mockResolvedValue({ id: 'g1', userId: 'GOWNER' })

    const result = await graphql({
      schema,
      source: `mutation { deleteGoal(id: "g1") }`,
      contextValue: contextFor('GNOTOWNER'),
    })

    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN')
    expect(goalsService.deleteGoal).not.toHaveBeenCalled()
  })
})
