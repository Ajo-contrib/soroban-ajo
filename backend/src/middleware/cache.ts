import { Request, Response, NextFunction } from 'express'
import { cacheGet, cacheSet } from '../services/cacheService'
import { createModuleLogger } from '../utils/logger'

const logger = createModuleLogger('CacheMiddleware')

export interface CacheMiddlewareOptions {
  ttl?: number // TTL in seconds (default: 300)
  exclude?: (req: Request) => boolean // Function to exclude certain requests
  includeQuery?: boolean // Include query params in cache key (default: true)
  includeHeaders?: string[] // Specific headers to include in cache key
  keyPrefix?: string // Prefix for cache keys (default: 'route:')
  statusCodes?: number[] // Which status codes to cache (default: [200])
}

/**
 * Enhanced caching middleware using Redis.
 * 
 * Features:
 * - Cache GET requests with configurable TTL
 * - Exclude specific requests
 * - Include query parameters in cache key
 * - Cache-busting based on custom headers
 * - Response header indicators (X-Cache: HIT/MISS)
 */
export const cacheMiddleware = (options: CacheMiddlewareOptions = {}) => {
  const {
    ttl = 300,
    exclude = () => false,
    includeQuery = true,
    includeHeaders = [],
    keyPrefix = 'route:',
    statusCodes = [200],
  } = options

  return async (req: Request, res: Response, next: NextFunction) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next()
    }

    // Check if request should be excluded
    if (exclude(req)) {
      return next()
    }

    // Build cache key
    let cacheKey = `${keyPrefix}${req.originalUrl}`
    if (!includeQuery && req.url.includes('?')) {
      cacheKey = `${keyPrefix}${req.baseUrl}${req.path}`
    }

    // Include specific headers in cache key
    if (includeHeaders.length > 0) {
      const headerValues = includeHeaders
        .map((h) => req.get(h))
        .filter(Boolean)
        .join(':')
      if (headerValues) {
        cacheKey += `:${headerValues}`
      }
    }

    try {
      // Try to get from cache
      const cached = await cacheGet(cacheKey)
      if (cached) {
        res.setHeader('X-Cache', 'HIT')
        res.setHeader('X-Cache-Key', cacheKey)
        return res.json(JSON.parse(cached))
      }
    } catch (err) {
      logger.warn('Cache lookup failed', { error: err, key: cacheKey })
    }

    // Intercept res.json to cache the response
    const originalJson = res.json.bind(res)
    let responseCached = false

    res.json = function (body: unknown) {
      // Only cache successful responses
      if (!responseCached && statusCodes.includes(res.statusCode)) {
        try {
          cacheSet(cacheKey, JSON.stringify(body), ttl)
          res.setHeader('X-Cache', 'MISS')
          res.setHeader('X-Cache-Key', cacheKey)
          responseCached = true
        } catch (err) {
          logger.warn('Cache set failed', { error: err, key: cacheKey })
        }
      }
      return originalJson(body)
    }

    next()
  }
}

/**
 * Specific cache middleware for API endpoints with common patterns
 */
export const apiCacheMiddleware = (ttl = 300) => {
  return cacheMiddleware({
    ttl,
    exclude: (req) => {
      // Exclude if cache-control header says no-cache
      const cacheControl = req.get('cache-control')
      return cacheControl?.includes('no-cache') ?? false
    },
    includeQuery: true,
    statusCodes: [200],
  })
}

/**
 * Cache middleware for list endpoints (with pagination)
 */
export const listCacheMiddleware = (ttl = 300) => {
  return cacheMiddleware({
    ttl,
    includeQuery: true, // Include pagination params
    statusCodes: [200],
  })
}

/**
 * Cache middleware for detail endpoints
 */
export const detailCacheMiddleware = (ttl = 600) => {
  return cacheMiddleware({
    ttl,
    includeQuery: false,
    statusCodes: [200],
  })
}
