import { Request, Response, NextFunction } from 'express'
import { logger } from '../utils/logger'
import { getClientFingerprint } from './fingerprint'

interface AttackPattern {
  count: number
  firstSeen: number
  lastSeen: number
  blocked: boolean
  blockedAt?: number
}

interface FingerprintPattern extends AttackPattern {
  // Distinct IPs seen carrying this fingerprint within the current window —
  // a client rotating IPs to dodge per-IP limits still keeps the same
  // fingerprint, so a high distinct-IP count alongside a high request count
  // is the signature of a distributed attack rather than one busy user.
  ips: Set<string>
}

// In-memory store for attack detection (use Redis in production for multi-instance)
const suspiciousIPs = new Map<string, AttackPattern>()

// Secondary store keyed on a header-derived client fingerprint (see
// ./fingerprint.ts) rather than IP. Catches attackers who distribute
// requests across many source IPs — cheap and common beyond an
// opportunistic attacker — since the fingerprint stays constant even as
// the IP changes.
const suspiciousFingerprints = new Map<string, FingerprintPattern>()

const BLOCK_DURATION_MS = parseInt(process.env.DDOS_BLOCK_DURATION_MS || '3600000', 10) // 1 hour
const ATTACK_THRESHOLD = parseInt(process.env.DDOS_ATTACK_THRESHOLD || '200', 10) // requests
const ATTACK_WINDOW_MS = parseInt(process.env.DDOS_ATTACK_WINDOW_MS || '60000', 10) // 1 minute
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000 // clean up stale entries every 5 min

// A fingerprint is only judged suspicious once it both exceeds the request
// threshold AND has been seen carried by enough distinct IPs — a single
// busy legitimate user (one IP, many requests) never trips this; a script
// rotating through a proxy pool while keeping the same HTTP client does.
const FINGERPRINT_ATTACK_THRESHOLD = parseInt(process.env.DDOS_FINGERPRINT_THRESHOLD || '300', 10)
const FINGERPRINT_MIN_DISTINCT_IPS = parseInt(process.env.DDOS_FINGERPRINT_MIN_IPS || '5', 10)

// Cleanup stale entries periodically
setInterval(() => {
  const now = Date.now()
  for (const [ip, pattern] of suspiciousIPs.entries()) {
    const isExpiredBlock = pattern.blocked && pattern.blockedAt && now - pattern.blockedAt > BLOCK_DURATION_MS
    const isStaleEntry = !pattern.blocked && now - pattern.lastSeen > ATTACK_WINDOW_MS * 2
    if (isExpiredBlock || isStaleEntry) {
      suspiciousIPs.delete(ip)
    }
  }
  for (const [fp, pattern] of suspiciousFingerprints.entries()) {
    const isExpiredBlock = pattern.blocked && pattern.blockedAt && now - pattern.blockedAt > BLOCK_DURATION_MS
    const isStaleEntry = !pattern.blocked && now - pattern.lastSeen > ATTACK_WINDOW_MS * 2
    if (isExpiredBlock || isStaleEntry) {
      suspiciousFingerprints.delete(fp)
    }
  }
}, CLEANUP_INTERVAL_MS)

/**
 * Extracts the real client IP, respecting proxy headers when trust proxy is set
 */
export function getClientIP(req: Request): string {
  return (
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    (req.headers['x-real-ip'] as string) ||
    req.socket.remoteAddress ||
    'unknown'
  )
}

/**
 * Checks the fingerprint pattern for the current request, blocking it if the
 * fingerprint (constant across rotated IPs) has already tripped the
 * distributed-attack threshold, or newly blocking it if this request pushes
 * it over. Returns true if the request was blocked (caller must not call
 * next()).
 */
function checkFingerprint(req: Request, res: Response): boolean {
  const fingerprint = getClientFingerprint(req)
  const ip = getClientIP(req)
  const now = Date.now()

  const pattern = suspiciousFingerprints.get(fingerprint)

  if (!pattern) {
    suspiciousFingerprints.set(fingerprint, {
      count: 1,
      firstSeen: now,
      lastSeen: now,
      blocked: false,
      ips: new Set([ip]),
    })
    return false
  }

  if (pattern.blocked) {
    const elapsed = now - (pattern.blockedAt || 0)
    if (elapsed < BLOCK_DURATION_MS) {
      const retryAfter = Math.ceil((BLOCK_DURATION_MS - elapsed) / 1000)
      res.set('Retry-After', String(retryAfter))
      res.status(429).json({
        success: false,
        error: 'Access temporarily blocked due to suspicious activity.',
        code: 'FINGERPRINT_BLOCKED',
        retryAfter,
      })
      return true
    }
    // Block expired — reset
    pattern.blocked = false
    pattern.count = 1
    pattern.firstSeen = now
    pattern.lastSeen = now
    pattern.ips = new Set([ip])
    return false
  }

  // Reset window if outside attack window
  if (now - pattern.firstSeen > ATTACK_WINDOW_MS) {
    pattern.count = 1
    pattern.firstSeen = now
    pattern.lastSeen = now
    pattern.ips = new Set([ip])
    return false
  }

  pattern.count++
  pattern.lastSeen = now
  pattern.ips.add(ip)

  // Only treat as an attack once the request volume is high AND it's spread
  // across enough distinct IPs — that combination is what distinguishes a
  // client rotating IPs from a single legitimate high-traffic user.
  if (pattern.count > FINGERPRINT_ATTACK_THRESHOLD && pattern.ips.size >= FINGERPRINT_MIN_DISTINCT_IPS) {
    pattern.blocked = true
    pattern.blockedAt = now
    logger.warn('Distributed DDoS attack detected via fingerprint correlation — client blocked across rotated IPs', {
      fingerprint,
      requestCount: pattern.count,
      distinctIPs: pattern.ips.size,
      windowMs: ATTACK_WINDOW_MS,
      blockDurationMs: BLOCK_DURATION_MS,
      path: req.path,
      userAgent: req.headers['user-agent'],
    })
    res.status(429).json({
      success: false,
      error: 'Access temporarily blocked due to suspicious activity.',
      code: 'FINGERPRINT_BLOCKED',
      retryAfter: Math.ceil(BLOCK_DURATION_MS / 1000),
    })
    return true
  }

  return false
}

/**
 * DDoS attack detection middleware.
 * Tracks request rates per IP and blocks IPs that exceed the threshold.
 * Also correlates requests by a header-derived client fingerprint (see
 * ./fingerprint.ts) so that an attacker distributing requests across many
 * source IPs — cheap and common for anything beyond an opportunistic
 * attacker — is still caught once their fingerprint's volume and
 * distinct-IP spread crosses the distributed-attack threshold.
 */
export function ddosProtection(req: Request, res: Response, next: NextFunction): void {
  if (checkFingerprint(req, res)) {
    return
  }

  const ip = getClientIP(req)
  const now = Date.now()

  let pattern = suspiciousIPs.get(ip)

  if (!pattern) {
    pattern = { count: 1, firstSeen: now, lastSeen: now, blocked: false }
    suspiciousIPs.set(ip, pattern)
    return next()
  }

  // Check if currently blocked
  if (pattern.blocked) {
    const elapsed = now - (pattern.blockedAt || 0)
    if (elapsed < BLOCK_DURATION_MS) {
      const retryAfter = Math.ceil((BLOCK_DURATION_MS - elapsed) / 1000)
      res.set('Retry-After', String(retryAfter))
      res.status(429).json({
        success: false,
        error: 'Your IP has been temporarily blocked due to suspicious activity.',
        code: 'IP_BLOCKED',
        retryAfter,
      })
      return
    }
    // Block expired — reset
    pattern.blocked = false
    pattern.count = 1
    pattern.firstSeen = now
    pattern.lastSeen = now
    return next()
  }

  // Reset window if outside attack window
  if (now - pattern.firstSeen > ATTACK_WINDOW_MS) {
    pattern.count = 1
    pattern.firstSeen = now
    pattern.lastSeen = now
    return next()
  }

  pattern.count++
  pattern.lastSeen = now

  // Detect attack
  if (pattern.count > ATTACK_THRESHOLD) {
    pattern.blocked = true
    pattern.blockedAt = now
    logger.warn('DDoS attack detected — IP blocked', {
      ip,
      requestCount: pattern.count,
      windowMs: ATTACK_WINDOW_MS,
      blockDurationMs: BLOCK_DURATION_MS,
      path: req.path,
      userAgent: req.headers['user-agent'],
    })
    res.status(429).json({
      success: false,
      error: 'Your IP has been temporarily blocked due to suspicious activity.',
      code: 'IP_BLOCKED',
      retryAfter: Math.ceil(BLOCK_DURATION_MS / 1000),
    })
    return
  }

  next()
}

/**
 * IP blocklist middleware — blocks manually added IPs.
 * Reads from BLOCKED_IPS env var (comma-separated).
 */
const blockedIPs = new Set<string>(
  (process.env.BLOCKED_IPS || '').split(',').map((ip) => ip.trim()).filter(Boolean)
)

export function ipBlocklist(req: Request, res: Response, next: NextFunction): void {
  const ip = getClientIP(req)
  if (blockedIPs.has(ip)) {
    logger.warn('Blocked IP attempted access', { ip, path: req.path })
    res.status(403).json({
      success: false,
      error: 'Access denied.',
      code: 'IP_BLOCKED',
    })
    return
  }
  next()
}

/**
 * Returns current DDoS stats (for admin/monitoring use)
 */
export function getDdosStats() {
  const now = Date.now()
  let blocked = 0
  let suspicious = 0
  for (const pattern of suspiciousIPs.values()) {
    if (pattern.blocked && now - (pattern.blockedAt || 0) < BLOCK_DURATION_MS) blocked++
    else if (pattern.count > ATTACK_THRESHOLD / 2) suspicious++
  }

  let fingerprintsBlocked = 0
  let fingerprintsSuspicious = 0
  for (const pattern of suspiciousFingerprints.values()) {
    if (pattern.blocked && now - (pattern.blockedAt || 0) < BLOCK_DURATION_MS) fingerprintsBlocked++
    else if (pattern.count > FINGERPRINT_ATTACK_THRESHOLD / 2 && pattern.ips.size >= FINGERPRINT_MIN_DISTINCT_IPS)
      fingerprintsSuspicious++
  }

  return {
    totalTracked: suspiciousIPs.size,
    blocked,
    suspicious,
    fingerprints: {
      totalTracked: suspiciousFingerprints.size,
      blocked: fingerprintsBlocked,
      suspicious: fingerprintsSuspicious,
    },
  }
}
