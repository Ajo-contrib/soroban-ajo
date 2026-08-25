import dotenv from "dotenv"
import jwt from 'jsonwebtoken'
dotenv.config();

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d'
const TWO_FACTOR_CHALLENGE_EXPIRES_IN = process.env.TWO_FACTOR_CHALLENGE_EXPIRES_IN || '5m'

export interface JWTPayload {
  publicKey: string
  purpose?: 'auth' | 'two_factor'
  twoFactorVerified?: boolean
  iat?: number
  exp?: number
}

export class AuthService {
  /** Returns the active primary secret used for signing new tokens. */
  static getPrimarySecret(): string {
    const secret = process.env.JWT_SECRET
    if (!secret) {
      throw new Error('JWT_SECRET environment variable is required')
    }
    return secret
  }

  /**
   * Returns an array of valid verification secrets:
   * 1. Primary active secret (`JWT_SECRET`)
   * 2. Optional previous secret for zero-downtime rotation (`JWT_SECRET_PREVIOUS`)
   * 3. Optional comma-separated historical secrets (`JWT_SECRET_FALLBACKS`)
   */
  static getVerificationSecrets(): string[] {
    const secrets: string[] = []
    const primary = process.env.JWT_SECRET
    if (primary) secrets.push(primary)

    const previous = process.env.JWT_SECRET_PREVIOUS
    if (previous && previous !== primary) secrets.push(previous)

    const fallbacks = process.env.JWT_SECRET_FALLBACKS
    if (fallbacks) {
      for (const s of fallbacks.split(',')) {
        const trimmed = s.trim()
        if (trimmed && !secrets.includes(trimmed)) {
          secrets.push(trimmed)
        }
      }
    }

    if (secrets.length === 0) {
      throw new Error('JWT_SECRET environment variable is required')
    }

    return secrets
  }

  /**
   * Generates a signed JWT for a user with specific claims and expiration.
   * 
   * @param publicKey - The Stellar public key of the user
   * @param options - Token configuration options
   * @param options.expiresIn - Duration string (e.g., '1h', '7d')
   * @param options.purpose - The intended use of the token ('auth' or 'two_factor')
   * @param options.twoFactorVerified - Whether 2FA has been successfully passed
   * @returns A signed JWT string
   */
  static generateToken(
    publicKey: string,
    options: {
      expiresIn?: string
      purpose?: 'auth' | 'two_factor'
      twoFactorVerified?: boolean
    } = {}
  ): string {
    const {
      expiresIn = JWT_EXPIRES_IN,
      purpose = 'auth',
      twoFactorVerified = false,
    } = options

    return jwt.sign(
      { publicKey, purpose, twoFactorVerified },
      this.getPrimarySecret(),
      { expiresIn } as jwt.SignOptions
    )
  }

  /**
   * Decodes and validates a JWT string against the primary secret or any configured rotation fallbacks.
   * Supports zero-downtime secret rotation by attempting primary key first, then fallback keys.
   * 
   * @param token - The JWT string to verify
   * @returns The decoded JWTPayload
   * @throws {Error} If the token is invalid or expired across all configured secrets
   */
  static verifyToken(token: string): JWTPayload {
    const secrets = this.getVerificationSecrets()
    let lastError: Error | null = null

    for (const secret of secrets) {
      try {
        return jwt.verify(token, secret) as JWTPayload
      } catch (err: any) {
        lastError = err
        // If token has expired, fail immediately rather than retrying other keys
        if (err?.name === 'TokenExpiredError') {
          throw err
        }
      }
    }

    throw lastError || new Error('JWT verification failed')
  }

  /**
   * Generates a short-lived token specifically for two-factor authentication challenges.
   * 
   * @param publicKey - The Stellar public key of the user
   * @returns A temporary JWT for 2FA verification
   */
  static generateTwoFactorChallenge(publicKey: string): string {
    return this.generateToken(publicKey, {
      expiresIn: TWO_FACTOR_CHALLENGE_EXPIRES_IN,
      purpose: 'two_factor',
      twoFactorVerified: false,
    })
  }

  /**
   * Validates a two-factor challenge token and ensures it matches the expected user.
   * 
   * @param token - The 2FA challenge token
   * @param publicKey - The user's expected public key
   * @returns The validated JWTPayload
   * @throws {Error} If the token is invalid, expired, or doesn't match the user/purpose
   */
  static verifyTwoFactorChallenge(token: string, publicKey: string): JWTPayload {
    const payload = this.verifyToken(token)

    if (payload.purpose !== 'two_factor' || payload.publicKey !== publicKey) {
      throw new Error('Invalid two-factor challenge token')
    }

    return payload
  }
}
