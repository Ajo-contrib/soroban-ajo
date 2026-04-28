import { Request, Response, NextFunction } from 'express'
import { securityService } from '../services/securityService'
import { logger } from '../utils/logger'

declare global {
  namespace Express {
    interface Request {
      apiKey?: { id: string; name: string; rateLimit: number }
    }
  }
}

/**
 * API key authentication middleware.
 * Reads x-api-key header, validates via securityService, and attaches key data to req.
 */
export async function apiKeyAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const apiKey = req.headers['x-api-key'] as string | undefined

  if (!apiKey) {
    res.status(401).json({ success: false, error: 'API key required' })
    return
  }

  try {
    const keyData = await securityService.validateApiKey(apiKey)
    if (!keyData) {
      logger.warn('Invalid API key attempt', { path: req.path, ip: req.ip })
      res.status(401).json({ success: false, error: 'Invalid API key' })
      return
    }

    if (!keyData.active) {
      res.status(401).json({ success: false, error: 'API key inactive' })
      return
    }

    const withinLimit = await securityService.checkApiKeyRateLimit(apiKey, keyData.rateLimit)
    if (!withinLimit) {
      res.status(429).json({ success: false, error: 'API key rate limit exceeded' })
      return
    }

    req.apiKey = keyData
    next()
  } catch (err) {
    logger.error('API key auth error', { error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ success: false, error: 'Authentication error' })
  }
}
