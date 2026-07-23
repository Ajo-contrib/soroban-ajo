/**
 * Proves Group.members / Group.contributions are batched through DataLoader
 * instead of firing one query per group (the classic GraphQL N+1). Prisma is
 * mocked so the assertion is on *call count*, not on a live database.
 *
 * The other domain services are mocked too (matching the pattern used in
 * src/sagas/__tests__/groupCreationSaga.test.ts) purely so importing
 * resolvers/index.ts doesn't eagerly construct their real Redis/Soroban
 * clients — this test only exercises the Query.groups / Group field resolvers.
 * ts-jest doesn't hoist jest.mock() the way babel-jest does, so every mock
 * below must stay textually before the imports it needs to intercept.
 */
jest.mock('@/config/database', () => ({
  prisma: {
    group: { findMany: jest.fn(), count: jest.fn() },
    groupMember: { findMany: jest.fn(), groupBy: jest.fn() },
    contribution: { findMany: jest.fn() },
    user: { findMany: jest.fn() },
  },
}))
jest.mock('../../services/goalsService', () => ({ goalsService: {} }))
jest.mock('../../services/rewardService', () => ({ rewardService: {} }))
jest.mock('../../services/disputeService', () => ({ disputeService: {} }))
jest.mock('../../services/insuranceService', () => ({ insuranceService: {} }))
jest.mock('../../services/gamification/GamificationService', () => ({ gamificationService: {} }))

import { graphql, parse } from 'graphql'
import { makeExecutableSchema } from '@graphql-tools/schema'
import { prisma } from '@/config/database'
import { typeDefs } from '../schema'
import { resolvers } from '../resolvers'
import { createDataLoaders } from '../dataloader'

const schema = makeExecutableSchema({ typeDefs, resolvers })

const GROUP_COUNT = 5
const MEMBERS_PER_GROUP = 2
const CONTRIBUTIONS_PER_GROUP = 3

function groupId(i: number) {
  return `group-${i}`
}

describe('Group.members / Group.contributions dataloader batching', () => {
  beforeEach(() => {
    jest.clearAllMocks()

    const groups = Array.from({ length: GROUP_COUNT }, (_, i) => ({
      id: groupId(i),
      name: `Group ${i}`,
      contributionAmount: BigInt(1000),
      frequency: 30,
      maxMembers: 10,
      currentRound: 0,
      isActive: true,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    }))
    ;(prisma.group.findMany as jest.Mock).mockResolvedValue(groups)
    ;(prisma.group.count as jest.Mock).mockResolvedValue(GROUP_COUNT)

    const members = groups.flatMap((g) =>
      Array.from({ length: MEMBERS_PER_GROUP }, (_, m) => ({
        id: `${g.id}-member-${m}`,
        groupId: g.id,
        userId: `user-${g.id}-${m}`,
        joinedAt: new Date('2026-01-02T00:00:00Z'),
      }))
    )
    ;(prisma.groupMember.findMany as jest.Mock).mockResolvedValue(members)

    const contributions = groups.flatMap((g) =>
      Array.from({ length: CONTRIBUTIONS_PER_GROUP }, (_, c) => ({
        id: `${g.id}-contribution-${c}`,
        groupId: g.id,
        userId: `user-${g.id}-${c}`,
        amount: BigInt(500),
        round: c,
        txHash: `tx-${g.id}-${c}`,
        createdAt: new Date('2026-01-03T00:00:00Z'),
      }))
    )
    ;(prisma.contribution.findMany as jest.Mock).mockResolvedValue(contributions)
  })

  it('issues exactly one query for members and one for contributions across N groups', async () => {
    const query = `
      query {
        groups(page: 1, limit: ${GROUP_COUNT}) {
          data {
            id
            members { id userId }
            contributions { id amount }
          }
        }
      }
    `

    const result = await graphql({
      schema,
      source: query,
      contextValue: { loaders: createDataLoaders() },
    })

    expect(result.errors).toBeUndefined()

    // Bounded: one batched call each, not one per group (which would be N).
    expect(prisma.groupMember.findMany).toHaveBeenCalledTimes(1)
    expect(prisma.contribution.findMany).toHaveBeenCalledTimes(1)

    const data = (result.data as any).groups.data
    expect(data).toHaveLength(GROUP_COUNT)
    for (const group of data) {
      expect(group.members).toHaveLength(MEMBERS_PER_GROUP)
      expect(group.contributions).toHaveLength(CONTRIBUTIONS_PER_GROUP)
      expect(
        group.members.every((m: { userId: string }) => m.userId.includes(group.id))
      ).toBe(true)
    }
  })

  it('parses without error (sanity check on the query text itself)', () => {
    expect(() =>
      parse(`query { groups { data { id members { id } contributions { id } } } }`)
    ).not.toThrow()
  })
})
