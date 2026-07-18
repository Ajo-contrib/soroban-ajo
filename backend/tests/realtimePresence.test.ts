/**
 * Unit tests for the Redis-backed presence store that replaced the
 * per-instance in-memory `userSockets`/`roomParticipants` Maps in
 * chatService.ts and notificationService.ts (see #811). Mocks ioredis with an
 * in-memory hash implementation so the reference-counting logic is verified
 * behaviorally, following this repo's existing ioredis-mocking convention
 * (see src/__tests__/integration/rewards.test.ts).
 */
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => {
    const hashes = new Map<string, Map<string, number>>()

    const getHash = (key: string): Map<string, number> => {
      if (!hashes.has(key)) hashes.set(key, new Map())
      return hashes.get(key)!
    }

    return {
      on: jest.fn(),
      hincrby: jest.fn(async (key: string, field: string, by: number) => {
        const hash = getHash(key)
        const next = (hash.get(field) ?? 0) + by
        hash.set(field, next)
        return next
      }),
      hget: jest.fn(async (key: string, field: string) => {
        const value = getHash(key).get(field)
        return value === undefined ? null : String(value)
      }),
      hgetall: jest.fn(async (key: string) => {
        return Object.fromEntries([...getHash(key).entries()].map(([f, v]) => [f, String(v)]))
      }),
      hdel: jest.fn(async (key: string, field: string) => {
        getHash(key).delete(field)
        return 1
      }),
    }
  })
})

import { presenceService } from '../src/services/realtimePresence'

describe('presenceService', () => {
  it('reference-counts connections so a user stays online until the last socket drops', async () => {
    expect(await presenceService.isOnline('user1')).toBe(false)

    expect(await presenceService.addConnection('user1')).toBe(1)
    expect(await presenceService.addConnection('user1')).toBe(2)
    expect(await presenceService.isOnline('user1')).toBe(true)

    // First socket drops (e.g. one tab, or one instance's connection) — still online.
    expect(await presenceService.removeConnection('user1')).toBe(1)
    expect(await presenceService.isOnline('user1')).toBe(true)

    // Last socket drops — now offline.
    expect(await presenceService.removeConnection('user1')).toBe(0)
    expect(await presenceService.isOnline('user1')).toBe(false)
  })

  it('never goes negative on over-removal', async () => {
    expect(await presenceService.removeConnection('ghost-user')).toBe(0)
    expect(await presenceService.isOnline('ghost-user')).toBe(false)
  })

  it('reports the set of online users', async () => {
    await presenceService.addConnection('alice')
    await presenceService.addConnection('bob')
    const users = await presenceService.getOnlineUsers()
    expect(users.sort()).toEqual(['alice', 'bob'])
  })

  it('tracks group membership with reference counting, independent of online status', async () => {
    await presenceService.joinGroup('alice', 'group1')
    await presenceService.joinGroup('alice', 'group1') // two sockets in the same group
    await presenceService.joinGroup('bob', 'group1')
    expect((await presenceService.getGroupMembers('group1')).sort()).toEqual(['alice', 'bob'])

    await presenceService.leaveGroup('alice', 'group1') // one of alice's two sockets leaves
    expect((await presenceService.getGroupMembers('group1')).sort()).toEqual(['alice', 'bob'])

    await presenceService.leaveGroup('alice', 'group1') // alice's last socket leaves
    expect(await presenceService.getGroupMembers('group1')).toEqual(['bob'])
  })
})
