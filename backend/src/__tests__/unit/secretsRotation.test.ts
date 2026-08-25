import jwt from 'jsonwebtoken'
import { AuthService } from '../../services/authService'

describe('JWT Secret Rotation & Dual-Secret Verification', () => {
  const SECRET_A = 'secret-a-initial-active-key-32-bytes-long'
  const SECRET_B = 'secret-b-rotated-active-key-32-bytes-long'
  const SECRET_C = 'secret-c-historical-fallback-key-32-bytes'

  const originalEnv = process.env

  beforeEach(() => {
    jest.resetModules()
    process.env = { ...originalEnv }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('signs and verifies tokens using the primary active secret', () => {
    process.env.JWT_SECRET = SECRET_A
    delete process.env.JWT_SECRET_PREVIOUS
    delete process.env.JWT_SECRET_FALLBACKS

    const token = AuthService.generateToken('GUSER123', { expiresIn: '1h' })
    const payload = AuthService.verifyToken(token)

    expect(payload.publicKey).toBe('GUSER123')
    expect(payload.purpose).toBe('auth')
  })

  it('verifies existing tokens signed with previous secret during zero-downtime rotation', () => {
    // 1. Token was signed before rotation under SECRET_A
    const legacyToken = jwt.sign({ publicKey: 'GLEGACY_USER', purpose: 'auth' }, SECRET_A, {
      expiresIn: '7d',
    })

    // 2. Secret rotation occurs: SECRET_B is primary, SECRET_A is previous
    process.env.JWT_SECRET = SECRET_B
    process.env.JWT_SECRET_PREVIOUS = SECRET_A

    // 3. New token generated uses SECRET_B
    const newToken = AuthService.generateToken('GNEW_USER', { expiresIn: '7d' })

    // Both legacy token and new token verify successfully!
    const legacyPayload = AuthService.verifyToken(legacyToken)
    expect(legacyPayload.publicKey).toBe('GLEGACY_USER')

    const newPayload = AuthService.verifyToken(newToken)
    expect(newPayload.publicKey).toBe('GNEW_USER')
  })

  it('verifies tokens signed with historical fallback secrets in JWT_SECRET_FALLBACKS', () => {
    const historicalToken = jwt.sign({ publicKey: 'GHISTORICAL_USER', purpose: 'auth' }, SECRET_C, {
      expiresIn: '7d',
    })

    process.env.JWT_SECRET = SECRET_B
    process.env.JWT_SECRET_PREVIOUS = SECRET_A
    process.env.JWT_SECRET_FALLBACKS = `${SECRET_C}, some-other-secret`

    const payload = AuthService.verifyToken(historicalToken)
    expect(payload.publicKey).toBe('GHISTORICAL_USER')
  })

  it('rejects tokens signed with an unknown or attacker-controlled secret', () => {
    const attackerToken = jwt.sign({ publicKey: 'GATTACKER', purpose: 'auth' }, 'attacker-fake-secret', {
      expiresIn: '1h',
    })

    process.env.JWT_SECRET = SECRET_B
    process.env.JWT_SECRET_PREVIOUS = SECRET_A

    expect(() => AuthService.verifyToken(attackerToken)).toThrow()
  })

  it('immediately rejects expired tokens without continuing fallback key verification', () => {
    const expiredToken = jwt.sign(
      { publicKey: 'GEXPIRED_USER', purpose: 'auth', exp: Math.floor(Date.now() / 1000) - 100 },
      SECRET_B
    )

    process.env.JWT_SECRET = SECRET_B
    process.env.JWT_SECRET_PREVIOUS = SECRET_A

    expect(() => AuthService.verifyToken(expiredToken)).toThrow('jwt expired')
  })
})
