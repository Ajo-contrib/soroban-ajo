import { Request, Response } from 'express'
import { ddosProtection, getDdosStats } from '../ddosProtection'

function makeReqRes(ip: string, userAgent: string) {
  const headers: Record<string, string> = {
    'user-agent': userAgent,
    'x-forwarded-for': ip,
  }
  const req = { headers, socket: { remoteAddress: ip }, path: '/api/test' } as unknown as Request

  let statusCode = 200
  let body: unknown = null
  const res = {
    set: jest.fn().mockReturnThis(),
    status: jest.fn().mockImplementation((code: number) => {
      statusCode = code
      return res
    }),
    json: jest.fn().mockImplementation((b: unknown) => {
      body = b
      return res
    }),
  } as unknown as Response

  return { req, res, getResult: () => ({ statusCode, body }) }
}

function fire(ip: string, userAgent: string) {
  const { req, res, getResult } = makeReqRes(ip, userAgent)
  const next = jest.fn()
  ddosProtection(req, res, next)
  return { called: next.mock.calls.length > 0, result: getResult() }
}

describe('ddosProtection — fingerprint correlation', () => {
  it('does not block a single low-volume client', () => {
    const ua = `single-client-${Date.now()}`
    for (let i = 0; i < 5; i++) {
      const { called } = fire('203.0.113.10', ua)
      expect(called).toBe(true)
    }
  })

  it('blocks a client that rotates IPs while keeping the same fingerprint, once volume and IP-spread thresholds are crossed', () => {
    // Unique user-agent per test run so state from other tests in this file
    // (sharing the module-level maps) can't interfere.
    const ua = `distributed-attacker-${Date.now()}-${Math.random()}`
    const ipCount = 8

    let sawBlock = false
    let blockedResult: { statusCode: number; body: unknown } | null = null

    // Default thresholds: FINGERPRINT_ATTACK_THRESHOLD=300, MIN_DISTINCT_IPS=5,
    // per-IP ATTACK_THRESHOLD=200. Spread 400 requests across 8 IPs (50 each,
    // safely under the per-IP threshold) so only the fingerprint-level
    // correlation trips, not per-IP detection.
    for (let i = 0; i < 400; i++) {
      const ip = `198.51.100.${i % ipCount}`
      const { called, result } = fire(ip, ua)
      if (!called) {
        sawBlock = true
        blockedResult = result
        break
      }
    }

    expect(sawBlock).toBe(true)
    expect(blockedResult?.statusCode).toBe(429)
    expect(blockedResult?.body).toMatchObject({ code: 'FINGERPRINT_BLOCKED' })
  })

  it('a single-IP client with a distinct fingerprint is unaffected by another fingerprint being blocked', () => {
    const attackerUa = `distributed-attacker-2-${Date.now()}-${Math.random()}`
    for (let i = 0; i < 400; i++) {
      fire(`192.0.2.${i % 8}`, attackerUa)
    }

    const normalUa = `normal-client-${Date.now()}-${Math.random()}`
    const { called } = fire('192.0.2.99', normalUa)
    expect(called).toBe(true)
  })

  it('getDdosStats reports fingerprint tracking data', () => {
    const stats = getDdosStats()
    expect(stats.fingerprints).toBeDefined()
    expect(typeof stats.fingerprints.totalTracked).toBe('number')
    expect(typeof stats.fingerprints.blocked).toBe('number')
    expect(typeof stats.fingerprints.suspicious).toBe('number')
  })
})
