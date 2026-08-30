import { Request, Response, NextFunction } from 'express'
import { logger } from '../utils/logger'
import { sanitizeLogData, buildRequestContext } from '../utils/logHelpers'

/**
 * Enhanced request/response logging middleware with performance metrics
 * and sensitive data masking
 */
export function enhancedLoggingMiddleware(req: Request, res: Response, next: NextFunction) {
  const startTime = Date.now()
  const startMemory = process.memoryUsage().heapUsed

  // Capture original response methods
  const originalJson = res.json.bind(res)
  const originalSend = res.send.bind(res)

  let responseBody: any = null
  let responseSize = 0

  // Override json method to capture response
  res.json = function (body: any) {
    responseBody = body
    responseSize = JSON.stringify(body).length
    return originalJson(body)
  }

  // Override send method to capture response
  res.send = function (body: any) {
    responseBody = body
    responseSize = typeof body === 'string' ? body.length : JSON.stringify(body).length
    return originalSend(body)
  }

  // Log on response finish
  res.on('finish', () => {
    const duration = Date.now() - startTime
    const endMemory = process.memoryUsage().heapUsed
    const memoryDelta = (endMemory - startMemory) / 1024 / 1024 // Convert to MB

    const logLevel =
      res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : res.statusCode >= 300 ? 'info' : 'http'

    const logData = {
      ...buildRequestContext(req),
      statusCode: res.statusCode,
      durationMs: duration,
      memoryDeltaMB: memoryDelta.toFixed(2),
      responseSize: responseSize,
      contentType: res.getHeader('content-type'),
      // Only log response body for errors
      ...(res.statusCode >= 400 && responseBody && { responseBody: sanitizeLogData(responseBody) }),
    }

    logger.log(logLevel, `HTTP ${req.method} ${req.path}`, logData)
  })

  next()
}

/**
 * Error response logging middleware
 * Logs detailed error information for debugging
 */
export function errorLoggingMiddleware(err: any, req: Request, res: Response, next: NextFunction) {
  const errorData = {
    ...buildRequestContext(req),
    error: {
      name: err.name,
      message: err.message,
      code: err.code,
      statusCode: err.statusCode || 500,
      stack: err.stack,
      details: sanitizeLogData(err.details || {}),
    },
    timestamp: new Date().toISOString(),
  }

  logger.error(`Error in ${req.method} ${req.path}`, errorData)

  next(err)
}

/**
 * Performance monitoring middleware
 * Tracks slow requests and logs performance metrics
 */
export function performanceMonitoringMiddleware(slowThresholdMs: number = 1000) {
  return (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now()

    res.on('finish', () => {
      const duration = Date.now() - startTime

      if (duration > slowThresholdMs) {
        logger.warn(`Slow request detected: ${req.method} ${req.path}`, {
          ...buildRequestContext(req),
          durationMs: duration,
          threshold: slowThresholdMs,
        })
      }
    })

    next()
  }
}

/**
 * Request body logging middleware
 * Logs request body for debugging (with sensitive data masking)
 */
export function requestBodyLoggingMiddleware(req: Request, res: Response, next: NextFunction) {
  if (
    req.method !== 'GET' &&
    req.method !== 'HEAD' &&
    req.body &&
    typeof req.body === 'object' &&
    Object.keys(req.body).length > 0
  ) {
    logger.debug(`Request body for ${req.method} ${req.path}`, {
      ...buildRequestContext(req),
      body: sanitizeLogData(req.body),
    })
  }

  next()
}

/**
 * Response header logging middleware
 * Logs important response headers for debugging
 */
export function responseHeaderLoggingMiddleware(req: Request, res: Response, next: NextFunction) {
  res.on('finish', () => {
    const importantHeaders = {
      'content-type': res.getHeader('content-type'),
      'content-length': res.getHeader('content-length'),
      'cache-control': res.getHeader('cache-control'),
      'x-request-id': res.getHeader('x-request-id'),
      'x-api-version': res.getHeader('x-api-version'),
    }

    logger.debug(`Response headers for ${req.method} ${req.path}`, {
      ...buildRequestContext(req),
      headers: importantHeaders,
    })
  })

  next()
}
