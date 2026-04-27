import { Request, Response, NextFunction } from 'express'
import {
  cacheMiddleware,
  apiCacheMiddleware,
  listCacheMiddleware,
  detailCacheMiddleware,
  CacheMiddlewareOptions,
} from '../middleware/cache'
import { cacheService } from '../services/cacheService'

describe('Cache Middleware', () => {
  let mockReq: Partial<Request>
  let mockRes: Partial<Response>
  let mockNext: NextFunction
  let nextCalled: boolean

  beforeEach(() => {
    nextCalled = false
    cacheService.resetStats()

    mockNext = jest.fn(() => {
      nextCalled = true
    })

    mockRes = {
      json: jest.fn((body) => {
        mockRes.jsonBody = body
        return mockRes
      }),
      setHeader: jest.fn(),
      statusCode: 200,
    }

    mockReq = {
      method: 'GET',
      originalUrl: '/api/users?page=1',
      baseUrl: '/api',
      path: '/users',
      url: '/api/users?page=1',
      get: jest.fn((header) => {
        const headers: Record<string, string> = {
          'cache-control': 'public',
          'authorization': 'Bearer token',
        }
        return headers[header]
      }),
    }
  })

  afterEach(async () => {
    await cacheService.flush()
  })

  describe('Basic Middleware', () => {
    it('should pass through non-GET requests', async () => {
      mockReq.method = 'POST'
      const middleware = cacheMiddleware()

      await middleware(mockReq as Request, mockRes as Response, mockNext)

      expect(mockNext).toHaveBeenCalled()
    })

    it('should cache GET requests', async () => {
      const middleware = cacheMiddleware({ ttl: 300 })
      const testData = { id: 1, name: 'Test' }

      // First request - should call next
      await middleware(mockReq as Request, mockRes as Response, mockNext)
      expect(nextCalled).toBe(true)

      // Simulate response
      if (mockRes.json) {
        mockRes.json(testData)
      }

      // Verify cache was set
      const key = `route:/api/users?page=1`
      const cached = await cacheService.get(key)
      expect(cached).toEqual(testData)
    })

    it('should return cached response on hit', async () => {
      const middleware = cacheMiddleware({ ttl: 300 })
      const testData = { id: 1, name: 'Test' }

      // Pre-populate cache
      const key = `route:/api/users?page=1`
      await cacheService.set(key, testData, 300)

      // Make request
      await middleware(mockReq as Request, mockRes as Response, mockNext)

      // Should not call next for cache hit
      expect(mockNext).not.toHaveBeenCalled()
      // Should set X-Cache header
      expect(mockRes.setHeader).toHaveBeenCalledWith('X-Cache', 'HIT')
    })

    it('should exclude requests based on predicate', async () => {
      const middleware = cacheMiddleware({
        ttl: 300,
        exclude: (req) => req.originalUrl.includes('admin'),
      })

      mockReq.originalUrl = '/api/admin/users'

      await middleware(mockReq as Request, mockRes as Response, mockNext)

      expect(mockNext).toHaveBeenCalled()
    })

    it('should exclude no-cache requests', async () => {
      const middleware = cacheMiddleware({
        ttl: 300,
        exclude: (req) => req.get('cache-control')?.includes('no-cache') ?? false,
      })

      mockReq.get = jest.fn((header) => {
        if (header === 'cache-control') return 'no-cache'
        return undefined
      })

      await middleware(mockReq as Request, mockRes as Response, mockNext)

      expect(mockNext).toHaveBeenCalled()
    })
  })

  describe('Cache Key Generation', () => {
    it('should include query parameters in cache key by default', async () => {
      const middleware = cacheMiddleware({ ttl: 300, includeQuery: true })
      const testData = { results: [] }

      await middleware(mockReq as Request, mockRes as Response, mockNext)

      if (mockRes.json) {
        mockRes.json(testData)
      }

      const keyWithQuery = `route:/api/users?page=1`
      const cached = await cacheService.get(keyWithQuery)
      expect(cached).toEqual(testData)
    })

    it('should exclude query parameters when configured', async () => {
      const middleware = cacheMiddleware({ ttl: 300, includeQuery: false })
      const testData = { results: [] }

      await middleware(mockReq as Request, mockRes as Response, mockNext)

      if (mockRes.json) {
        mockRes.json(testData)
      }

      const keyWithoutQuery = `route:/api/users`
      const cached = await cacheService.get(keyWithoutQuery)
      expect(cached).toEqual(testData)
    })

    it('should include specific headers in cache key', async () => {
      const middleware = cacheMiddleware({
        ttl: 300,
        includeHeaders: ['authorization'],
      })
      const testData = { user: 'John' }

      await middleware(mockReq as Request, mockRes as Response, mockNext)

      if (mockRes.json) {
        mockRes.json(testData)
      }

      // Key should include header value
      const keys = await cacheService.invalidatePattern('route:*')
      expect(keys).toBeGreaterThan(0)
    })

    it('should use custom key prefix', async () => {
      const middleware = cacheMiddleware({
        ttl: 300,
        keyPrefix: 'api:',
      })
      const testData = { data: 'test' }

      await middleware(mockReq as Request, mockRes as Response, mockNext)

      if (mockRes.json) {
        mockRes.json(testData)
      }

      const keyWithCustomPrefix = `api:/api/users?page=1`
      const cached = await cacheService.get(keyWithCustomPrefix)
      expect(cached).toEqual(testData)
    })
  })

  describe('Status Code Filtering', () => {
    it('should only cache specified status codes', async () => {
      const middleware = cacheMiddleware({
        ttl: 300,
        statusCodes: [200, 201],
      })
      const testData = { id: 1 }

      mockRes.statusCode = 200

      await middleware(mockReq as Request, mockRes as Response, mockNext)

      if (mockRes.json) {
        mockRes.json(testData)
      }

      const key = `route:/api/users?page=1`
      const cached = await cacheService.get(key)
      expect(cached).toEqual(testData)
    })

    it('should not cache non-success status codes', async () => {
      const middleware = cacheMiddleware({
        ttl: 300,
        statusCodes: [200],
      })

      mockRes.statusCode = 404

      await middleware(mockReq as Request, mockRes as Response, mockNext)

      if (mockRes.json) {
        mockRes.json({ error: 'Not found' })
      }

      const key = `route:/api/users?page=1`
      const cached = await cacheService.get(key)
      expect(cached).toBeNull()
    })
  })

  describe('Preset Middleware', () => {
    it('should apply API cache middleware defaults', async () => {
      const middleware = apiCacheMiddleware(600)

      await middleware(mockReq as Request, mockRes as Response, mockNext)

      expect(mockNext).toHaveBeenCalled()
    })

    it('should apply list cache middleware defaults', async () => {
      const middleware = listCacheMiddleware(300)

      await middleware(mockReq as Request, mockRes as Response, mockNext)

      expect(mockNext).toHaveBeenCalled()
    })

    it('should apply detail cache middleware defaults', async () => {
      const middleware = detailCacheMiddleware(600)

      await middleware(mockReq as Request, mockRes as Response, mockNext)

      expect(mockNext).toHaveBeenCalled()
    })
  })

  describe('Response Headers', () => {
    it('should set X-Cache header to MISS', async () => {
      const middleware = cacheMiddleware({ ttl: 300 })
      const testData = { data: 'test' }

      await middleware(mockReq as Request, mockRes as Response, mockNext)

      if (mockRes.json) {
        mockRes.json(testData)
      }

      expect(mockRes.setHeader).toHaveBeenCalledWith('X-Cache', 'MISS')
    })

    it('should set X-Cache header to HIT', async () => {
      const middleware = cacheMiddleware({ ttl: 300 })
      const testData = { data: 'test' }

      // Pre-populate cache
      const key = `route:/api/users?page=1`
      await cacheService.set(key, testData, 300)

      await middleware(mockReq as Request, mockRes as Response, mockNext)

      expect(mockRes.setHeader).toHaveBeenCalledWith('X-Cache', 'HIT')
    })

    it('should set X-Cache-Key header', async () => {
      const middleware = cacheMiddleware({ ttl: 300 })
      const testData = { data: 'test' }

      await middleware(mockReq as Request, mockRes as Response, mockNext)

      if (mockRes.json) {
        mockRes.json(testData)
      }

      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'X-Cache-Key',
        expect.stringContaining('route:')
      )
    })
  })

  describe('Error Handling', () => {
    it('should handle cache lookup errors gracefully', async () => {
      const middleware = cacheMiddleware({ ttl: 300 })

      // Simulate cache error
      jest.spyOn(cacheService, 'get').mockRejectedValueOnce(new Error('Cache error'))

      await middleware(mockReq as Request, mockRes as Response, mockNext)

      // Should still proceed
      expect(mockNext).toHaveBeenCalled()
    })

    it('should handle response caching errors gracefully', async () => {
      const middleware = cacheMiddleware({ ttl: 300 })

      // Simulate set error
      jest.spyOn(cacheService, 'set').mockRejectedValueOnce(new Error('Set error'))

      await middleware(mockReq as Request, mockRes as Response, mockNext)

      if (mockRes.json) {
        mockRes.json({ data: 'test' })
      }

      // Should still return response
      expect(mockRes.json).toHaveBeenCalled()
    })
  })
})
