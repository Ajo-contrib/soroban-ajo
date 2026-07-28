/**
 * A naive per-request rate limit can't tell a cheap query from an arbitrarily
 * expensive one, since GraphQL lets a single request fan out via nesting or
 * aliasing. This proves assertQueryComplexity (wired into every request via
 * the Apollo plugin in server.ts) rejects a deliberately expensive query
 * before any resolver would run, while leaving normal queries untouched.
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

import { parse } from 'graphql'
import { makeExecutableSchema } from '@graphql-tools/schema'
import { typeDefs } from '../schema'
import { resolvers } from '../resolvers'
import { assertQueryComplexity, QueryComplexityError, MAX_QUERY_COMPLEXITY } from '../complexity'

const schema = makeExecutableSchema({ typeDefs, resolvers })

describe('assertQueryComplexity', () => {
  it('allows an ordinary, shallow query', () => {
    const document = parse(`
      query {
        leaderboard(limit: 10) {
          userId
          points
          rank
        }
      }
    `)

    expect(() => assertQueryComplexity({ schema, document })).not.toThrow()
  })

  it('rejects a deliberately expensive query built from many aliased selections', () => {
    // Nesting depth alone is capped by this schema's shape, but aliasing the
    // same field hundreds of times fans a single request out just as an
    // attacker exploiting deep nesting would on a more recursive schema —
    // and a flat per-IP/per-request limiter would never see this coming
    // because it's still exactly one HTTP request.
    let query = 'query {\n'
    for (let i = 0; i < 400; i++) {
      query += `  g${i}: group(id: "any") { id name memberCount contributionAmount isActive createdAt }\n`
    }
    query += '}'
    const document = parse(query)

    expect(() => assertQueryComplexity({ schema, document })).toThrow(QueryComplexityError)

    try {
      assertQueryComplexity({ schema, document })
    } catch (err) {
      expect(err).toBeInstanceOf(QueryComplexityError)
      const graphQLError = err as QueryComplexityError
      expect(graphQLError.extensions.code).toBe('QUERY_TOO_COMPLEX')
      expect(graphQLError.extensions.complexity as number).toBeGreaterThan(MAX_QUERY_COMPLEXITY)
    }
  })

  it('respects a custom maxComplexity override', () => {
    const document = parse(`query { leaderboard(limit: 10) { userId points } }`)

    expect(() =>
      assertQueryComplexity({ schema, document, maxComplexity: 1 })
    ).toThrow(QueryComplexityError)
  })
})
