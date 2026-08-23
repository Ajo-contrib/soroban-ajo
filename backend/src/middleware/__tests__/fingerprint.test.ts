import { Request } from 'express'
import { getClientFingerprint } from '../fingerprint'

function makeRequest(headers: Record<string, string>): Request {
  return { headers } as unknown as Request
}

describe('getClientFingerprint', () => {
  it('returns the same fingerprint for identical header sets', () => {
    const headers = {
      'user-agent': 'Mozilla/5.0 (Test)',
      accept: 'application/json',
      'accept-language': 'en-US',
      'accept-encoding': 'gzip',
    }
    const a = getClientFingerprint(makeRequest(headers))
    const b = getClientFingerprint(makeRequest({ ...headers }))
    expect(a).toBe(b)
  })

  it('is independent of IP-related headers', () => {
    const headers = {
      'user-agent': 'Mozilla/5.0 (Test)',
      accept: 'application/json',
      'accept-language': 'en-US',
      'accept-encoding': 'gzip',
    }
    const a = getClientFingerprint(makeRequest({ ...headers, 'x-forwarded-for': '1.2.3.4' }))
    const b = getClientFingerprint(makeRequest({ ...headers, 'x-forwarded-for': '5.6.7.8' }))
    expect(a).toBe(b)
  })

  it('differs when the user-agent differs', () => {
    const a = getClientFingerprint(makeRequest({ 'user-agent': 'ClientA' }))
    const b = getClientFingerprint(makeRequest({ 'user-agent': 'ClientB' }))
    expect(a).not.toBe(b)
  })

  it('returns a fixed-length hex string even with no headers at all', () => {
    const fp = getClientFingerprint(makeRequest({}))
    expect(fp).toMatch(/^[0-9a-f]{32}$/)
  })
})
