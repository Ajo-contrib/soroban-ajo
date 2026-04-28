import crypto from 'crypto'
import { prisma } from '../config/database'
import { logger } from '../utils/logger'

interface ApiKeyData {
  id: string
  name: string
  rateLimit: number
  active: boolean
}

// In-memory rate limit counters (use Redis in production for multi-instance)
const apiKeyUsage = new Map<string, { count: number; windowStart: number }>()
const RATE_WINDOW_MS = 60 * 60 * 1000 // 1 hour

export class SecurityService {
  /**
   * Validates an API key and returns its metadata, or null if invalid.
   * Looks up the hashed key in the database.
   */
  async validateApiKey(rawKey: string): Promise<ApiKeyData | null> {
    const hashed = this.hashKey(rawKey)
    try {
      const record = await prisma.apiKey.findUnique({ where: { keyHash: hashed } })
      if (!record) return null
      return { id: record.id, name: record.name, rateLimit: record.rateLimit, active: record.active }
    } catch (err) {
      logger.error('API key lookup failed', { error: err instanceof Error ? err.message : String(err) })
      return null
    }
  }

  /**
   * Checks whether the API key is within its per-hour rate limit.
   * Returns true if the request is allowed, false if the limit is exceeded.
   */
  checkApiKeyRateLimit(rawKey: string, limit: number): boolean {
    const now = Date.now()
    const entry = apiKeyUsage.get(rawKey)

    if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
      apiKeyUsage.set(rawKey, { count: 1, windowStart: now })
      return true
    }

    entry.count++
    return entry.count <= limit
  }

  /**
   * Creates a new API key, stores the hash in the database, and returns the raw key once.
   */
  async createApiKey(name: string, rateLimit = 1000): Promise<{ rawKey: string; id: string }> {
    const rawKey = `ajo_${crypto.randomBytes(32).toString('hex')}`
    const keyHash = this.hashKey(rawKey)

    const record = await prisma.apiKey.create({
      data: { name, keyHash, rateLimit, active: true },
    })

    logger.info('API key created', { id: record.id, name })
    return { rawKey, id: record.id }
  }

  /**
   * Revokes an API key by setting it inactive.
   */
  async revokeApiKey(id: string): Promise<void> {
    await prisma.apiKey.update({ where: { id }, data: { active: false } })
    logger.info('API key revoked', { id })
  }

  /**
   * Lists all API keys (without exposing hashes).
   */
  async listApiKeys() {
    return prisma.apiKey.findMany({
      select: { id: true, name: true, rateLimit: true, active: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    })
  }

  private hashKey(rawKey: string): string {
    return crypto.createHash('sha256').update(rawKey).digest('hex')
  }
}

export const securityService = new SecurityService()
