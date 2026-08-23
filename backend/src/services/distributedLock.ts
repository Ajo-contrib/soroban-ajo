import { randomUUID } from 'crypto'
import { redisClient } from './cacheService'

const RELEASE_SCRIPT = `
  if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
  end
  return 0
`

const RENEW_SCRIPT = `
  if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('pexpire', KEYS[1], ARGV[2])
  end
  return 0
`

export interface DistributedLockOptions {
  ttlMs?: number
  renewIntervalMs?: number
  onLost?: () => void | Promise<void>
}

/** A Redis-backed lease that coordinates work across backend processes. */
export class DistributedLock {
  private readonly key: string
  private readonly token = randomUUID()
  private readonly ttlMs: number
  private readonly renewIntervalMs: number
  private readonly onLost?: () => void | Promise<void>
  private renewTimer: ReturnType<typeof setInterval> | null = null
  private held = false

  constructor(key: string, options: DistributedLockOptions = {}) {
    this.key = key
    this.ttlMs = options.ttlMs ?? 30_000
    this.renewIntervalMs = options.renewIntervalMs ?? Math.floor(this.ttlMs / 3)
    this.onLost = options.onLost
  }

  async acquire(): Promise<boolean> {
    const result = await redisClient.set(this.key, this.token, 'PX', this.ttlMs, 'NX')
    if (result !== 'OK') return false

    this.held = true
    this.renewTimer = setInterval(() => {
      this.renew().catch(() => this.handleLostLease())
    }, this.renewIntervalMs)
    this.renewTimer.unref?.()
    return true
  }

  async release(): Promise<void> {
    if (!this.held) return
    this.held = false
    this.stopRenewal()
    await redisClient.eval(RELEASE_SCRIPT, 1, this.key, this.token)
  }

  private async renew(): Promise<void> {
    if (!this.held) return
    const renewed = await redisClient.eval(
      RENEW_SCRIPT,
      1,
      this.key,
      this.token,
      String(this.ttlMs)
    )
    if (renewed !== 1) this.handleLostLease()
  }

  private handleLostLease(): void {
    if (!this.held) return
    this.held = false
    this.stopRenewal()
    void this.onLost?.()
  }

  private stopRenewal(): void {
    if (!this.renewTimer) return
    clearInterval(this.renewTimer)
    this.renewTimer = null
  }
}