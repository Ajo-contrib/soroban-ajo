import Redis from 'ioredis'
import { createModuleLogger } from '../utils/logger'

const logger = createModuleLogger('RealtimePresence')

/**
 * Shared, cross-instance presence store for the WebSocket layer.
 *
 * chatService and notificationService previously each kept their own
 * `Map<userId, Set<socketId>>` in process memory. That is correct for a
 * single backend instance but wrong the moment more than one instance runs
 * behind a load balancer: a user's socket connected to instance B is
 * invisible to instance A's map, so "is this user online" and "who is in
 * this group" answers differ per instance. Backing this with Redis makes
 * both questions instance-independent.
 *
 * Connection/membership counts are reference-counted (hash field = count),
 * not booleans, because a single user can hold multiple sockets at once
 * (multiple tabs, or sockets spread across instances) — the user is only
 * offline once every socket, on every instance, has disconnected.
 */

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379')
redis.on('error', (err) => logger.warn('Redis error', { error: err.message }))

const ONLINE_KEY = 'realtime:presence:online'
const groupKey = (groupId: string): string => `realtime:presence:group:${groupId}`

async function incr(key: string, field: string, by: number): Promise<number> {
  const count = await redis.hincrby(key, field, by)
  if (count <= 0) {
    await redis.hdel(key, field)
    return 0
  }
  return count
}

async function members(key: string): Promise<string[]> {
  const all = await redis.hgetall(key)
  return Object.entries(all)
    .filter(([, count]) => Number(count) > 0)
    .map(([id]) => id)
}

export const presenceService = {
  /** Register a new socket connection for a user. Returns the new count. */
  addConnection(userId: string): Promise<number> {
    return incr(ONLINE_KEY, userId, 1)
  },

  /** Drop a socket connection for a user. Returns the remaining count. */
  removeConnection(userId: string): Promise<number> {
    return incr(ONLINE_KEY, userId, -1)
  },

  async isOnline(userId: string): Promise<boolean> {
    const value = await redis.hget(ONLINE_KEY, userId)
    return value !== null && Number(value) > 0
  },

  getOnlineUsers(): Promise<string[]> {
    return members(ONLINE_KEY)
  },

  /** Track that a user's socket joined a group room (shared membership). */
  joinGroup(userId: string, groupId: string): Promise<number> {
    return incr(groupKey(groupId), userId, 1)
  },

  leaveGroup(userId: string, groupId: string): Promise<number> {
    return incr(groupKey(groupId), userId, -1)
  },

  getGroupMembers(groupId: string): Promise<string[]> {
    return members(groupKey(groupId))
  },
}
