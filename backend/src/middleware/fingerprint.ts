/**
 * Client fingerprinting utility.
 *
 * Derives a stable identifier from request headers that stays constant
 * across source IPs. Used to correlate traffic from a single client/script
 * that is deliberately rotating its IP address to evade IP-keyed rate
 * limiting and DDoS detection — the fingerprint doesn't change just because
 * the IP does.
 *
 * This is intentionally coarse: it is a secondary, corroborating signal
 * (combined with request-volume and distinct-IP-count checks) rather than
 * a unique per-device identifier, since many legitimate clients can share
 * the same header combination.
 */

import { Request } from 'express'
import { createHash } from 'crypto'

export function getClientFingerprint(req: Request): string {
  const parts = [
    req.headers['user-agent'] || '',
    req.headers['accept'] || '',
    req.headers['accept-language'] || '',
    req.headers['accept-encoding'] || '',
    req.headers['sec-ch-ua'] || '',
    req.headers['sec-ch-ua-platform'] || '',
  ]
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32)
}
