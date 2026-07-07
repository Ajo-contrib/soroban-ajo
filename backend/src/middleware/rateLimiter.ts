/**
 * IP Limiter Factory
 *
 * Provides a factory function `createIpLimiter` that creates per-tier
 * Redis-backed express-rate-limit middleware instances.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 6.1, 6.3, 6.4, 7.1
 */

import rateLimit from 'express-rate-limit';
import { RequestHandler } from 'express';
import { loadThrottleConfig, ThrottleConfig } from './rateLimitConfig';
import { createRedisStore } from './rateLimitStore';
import { incrementTierCount } from './rateLimitMetrics';
import { createModuleLogger } from '../utils/logger';
import { AuthService } from '../services/authService';

const logger = createModuleLogger('RateLimiter');

// Load config once at module load time
const config = loadThrottleConfig();

/**
 * Creates an IP-based rate limiter for the given throttle tier.
 *
 * - Extracts client IP from X-Forwarded-For (first value) or req.socket.remoteAddress
 * - Skips limiting for IPs in the configured allowlist
 * - Returns structured 429 JSON on violation with no internal details exposed
 */
export function createIpLimiter(tier: keyof ThrottleConfig): RequestHandler {
  const tierConfig = config.throttle[tier];

  return rateLimit({
    windowMs: tierConfig.windowMs,
    max: tierConfig.max,
    standardHeaders: true,
    legacyHeaders: false,
    store: createRedisStore(tier),

    keyGenerator: (req) => {
      // Extract IP from X-Forwarded-For header (first value) when present
      const forwarded = req.headers['x-forwarded-for'];
      if (forwarded) {
        const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)
          .split(',')[0]
          .trim();
        if (first) return first;
      }

      const socketIp = req.socket?.remoteAddress;
      if (socketIp) return socketIp;

      logger.warn('Unable to determine client IP, using "unknown"', {
        path: req.path,
        method: req.method,
      });
      return 'unknown';
    },

    skip: (req) => {
      // Allow allowlisted IPs to bypass rate limiting
      const forwarded = req.headers['x-forwarded-for'];
      let ip: string;
      if (forwarded) {
        ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded).split(',')[0].trim();
      } else {
        ip = req.socket?.remoteAddress ?? 'unknown';
      }
      return config.ipAllowlist.includes(ip);
    },

    handler: (req, res) => {
      const forwarded = req.headers['x-forwarded-for'];
      let ip: string;
      if (forwarded) {
        ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded).split(',')[0].trim();
      } else {
        ip = req.socket?.remoteAddress ?? 'unknown';
      }

      // Increment metrics counter for this tier
      incrementTierCount(tier);

      // Compute retryAfter in seconds from the RateLimit-Reset header if available
      const resetHeader = res.getHeader('RateLimit-Reset');
      let retryAfter = Math.ceil(tierConfig.windowMs / 1000);
      if (resetHeader) {
        const resetTime = Number(resetHeader);
        if (!isNaN(resetTime)) {
          const nowSec = Math.floor(Date.now() / 1000);
          retryAfter = Math.max(1, resetTime - nowSec);
        }
      }

      logger.warn('Rate limit exceeded', {
        ip,
        path: req.path,
        method: req.method,
        tier,
        timestamp: new Date().toISOString(),
      });

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({
        status: 429,
        error: 'Rate limit exceeded. Please slow down your requests.',
        retryAfter,
        limit: tierConfig.max,
      });
    },
  });
}

// Backward-compatible named exports so existing imports in index.ts continue to work
export const apiLimiter: RequestHandler = createIpLimiter('api');
export const strictLimiter: RequestHandler = createIpLimiter('auth');
export const publicReadLimiter: RequestHandler = createIpLimiter('api');
export const analyticsLimiter: RequestHandler = createIpLimiter('api');
export const groupsWriteLimiter: RequestHandler = createIpLimiter('expensive');

/**
 * User Limiter Factory
 *
 * Creates a per-user Redis-backed rate limiter keyed on the JWT publicKey.
 * If the Authorization header is absent, malformed, or the JWT is invalid/expired,
 * user-level enforcement is skipped entirely (IP limits upstream still apply).
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 7.2
 */
export function createUserLimiter(): RequestHandler {
  const tierConfig = config.throttle.api;

  return rateLimit({
    windowMs: tierConfig.windowMs,
    max: tierConfig.max,
    standardHeaders: true,
    legacyHeaders: false,
    store: createRedisStore('user'),

    keyGenerator: (req) => {
      const authHeader = req.headers['authorization'];
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return '';
      }
      const token = authHeader.slice(7);
      try {
        const payload = AuthService.verifyToken(token);
        return payload.publicKey;
      } catch {
        return '';
      }
    },

    skip: (req) => {
      // Skip user-level limiting if no valid JWT is present
      const authHeader = req.headers['authorization'];
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return true;
      }
      const token = authHeader.slice(7);
      try {
        AuthService.verifyToken(token);
        return false;
      } catch {
        return true;
      }
    },

    handler: (req, res) => {
      const authHeader = req.headers['authorization'];
      let userId = 'unknown';
      if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
          const payload = AuthService.verifyToken(authHeader.slice(7));
          userId = payload.publicKey;
        } catch {
          // fallback to 'unknown'
        }
      }

      const forwarded = req.headers['x-forwarded-for'];
      let ip: string;
      if (forwarded) {
        ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded).split(',')[0].trim();
      } else {
        ip = req.socket?.remoteAddress ?? 'unknown';
      }

      const resetHeader = res.getHeader('RateLimit-Reset');
      let retryAfter = Math.ceil(tierConfig.windowMs / 1000);
      if (resetHeader) {
        const resetTime = Number(resetHeader);
        if (!isNaN(resetTime)) {
          const nowSec = Math.floor(Date.now() / 1000);
          retryAfter = Math.max(1, resetTime - nowSec);
        }
      }

      logger.warn('User rate limit exceeded', {
        userId,
        ip,
        path: req.path,
        method: req.method,
        timestamp: new Date().toISOString(),
      });

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({
        status: 429,
        error: 'User rate limit exceeded. Please slow down your requests.',
        retryAfter,
        limit: tierConfig.max,
      });
    },
  });
}
