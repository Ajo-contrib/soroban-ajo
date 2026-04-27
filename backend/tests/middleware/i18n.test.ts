/**
 * Tests for i18n Middleware
 */

import { Request, Response, NextFunction } from 'express'
import {
  i18nMiddleware,
  i18nValidateMiddleware,
  i18nForceLanguage,
  I18nRequest,
} from '../../../middleware/i18n'
import { clearTranslationCache } from '../../../services/i18nService'

describe('i18nMiddleware', () => {
  let mockReq: Partial<Request>
  let mockRes: Partial<Response>
  let mockNext: NextFunction
  let setCookieSpy: jest.Mock

  beforeEach(() => {
    setCookieSpy = jest.fn().mockReturnThis()

    mockReq = {
      headers: {},
      cookies: {},
      query: {},
      params: {},
    }

    mockRes = {
      setHeader: jest.fn(),
      cookie: setCookieSpy,
    }

    mockNext = jest.fn()
    clearTranslationCache()
  })

  describe('basic language detection', () => {
    it('should default to en when no language is provided', () => {
      const middleware = i18nMiddleware()
      middleware(mockReq as Request, mockRes as Response, mockNext)

      const req = mockReq as I18nRequest
      expect(req.language).toBe('en')
      expect(req.locale).toBe('en')
      expect(mockNext).toHaveBeenCalled()
    })

    it('should set text direction for detected language', () => {
      const middleware = i18nMiddleware()
      middleware(mockReq as Request, mockRes as Response, mockNext)

      const req = mockReq as I18nRequest
      expect(req.textDirection).toBe('ltr')
    })

    it('should set RTL flag for Arabic', () => {
      mockReq.headers = { 'accept-language': 'ar' }
      const middleware = i18nMiddleware()
      middleware(mockReq as Request, mockRes as Response, mockNext)

      const req = mockReq as I18nRequest
      expect(req.language).toBe('ar')
      expect(req.isRTL).toBe(true)
      expect(req.textDirection).toBe('rtl')
    })
  })

  describe('language detection priority', () => {
    it('should prioritize x-language header over Accept-Language', () => {
      mockReq.headers = {
        'x-language': 'es',
        'accept-language': 'fr',
      }
      const middleware = i18nMiddleware()
      middleware(mockReq as Request, mockRes as Response, mockNext)

      const req = mockReq as I18nRequest
      expect(req.language).toBe('es')
    })

    it('should use language cookie if no header provided', () => {
      mockReq.cookies = { ajo_language: 'pt' }
      const middleware = i18nMiddleware()
      middleware(mockReq as Request, mockRes as Response, mockNext)

      const req = mockReq as I18nRequest
      expect(req.language).toBe('pt')
    })

    it('should use query parameter if enabled', () => {
      mockReq.query = { lang: 'sw' }
      const middleware = i18nMiddleware({ useQuery: true })
      middleware(mockReq as Request, mockRes as Response, mockNext)

      const req = mockReq as I18nRequest
      expect(req.language).toBe('sw')
    })

    it('should not use query parameter if disabled', () => {
      mockReq.query = { lang: 'sw' }
      mockReq.headers = { 'accept-language': 'en' }
      const middleware = i18nMiddleware({ useQuery: false })
      middleware(mockReq as Request, mockRes as Response, mockNext)

      const req = mockReq as I18nRequest
      expect(req.language).toBe('en')
    })
  })

  describe('response headers', () => {
    it('should set Content-Language header', () => {
      const middleware = i18nMiddleware()
      middleware(mockReq as Request, mockRes as Response, mockNext)

      expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Language', 'en')
    })

    it('should set X-Language header', () => {
      mockReq.headers = { 'accept-language': 'es' }
      const middleware = i18nMiddleware()
      middleware(mockReq as Request, mockRes as Response, mockNext)

      expect(mockRes.setHeader).toHaveBeenCalledWith('X-Language', 'es')
    })

    it('should set X-Text-Direction header', () => {
      mockReq.headers = { 'accept-language': 'ar' }
      const middleware = i18nMiddleware()
      middleware(mockReq as Request, mockRes as Response, mockNext)

      expect(mockRes.setHeader).toHaveBeenCalledWith('X-Text-Direction', 'rtl')
    })
  })

  describe('cookie handling', () => {
    it('should set language cookie by default', () => {
      const middleware = i18nMiddleware()
      middleware(mockReq as Request, mockRes as Response, mockNext)

      expect(setCookieSpy).toHaveBeenCalledWith(
        'ajo_language',
        'en',
        expect.objectContaining({
          path: '/',
        })
      )
    })

    it('should not set cookie if disabled', () => {
      const middleware = i18nMiddleware({ enableCookie: false })
      middleware(mockReq as Request, mockRes as Response, mockNext)

      expect(setCookieSpy).not.toHaveBeenCalled()
    })

    it('should use custom cookie name', () => {
      const middleware = i18nMiddleware({ cookieName: 'custom_lang' })
      middleware(mockReq as Request, mockRes as Response, mockNext)

      expect(setCookieSpy).toHaveBeenCalledWith(
        'custom_lang',
        'en',
        expect.any(Object)
      )
    })
  })

  describe('translation helper', () => {
    it('should add t function to request', () => {
      const middleware = i18nMiddleware()
      middleware(mockReq as Request, mockRes as Response, mockNext)

      const req = mockReq as I18nRequest
      expect(req.t).toBeDefined()
      expect(typeof req.t).toBe('function')
    })

    it('should be an async function', () => {
      const middleware = i18nMiddleware()
      middleware(mockReq as Request, mockRes as Response, mockNext)

      const req = mockReq as I18nRequest
      const result = req.t('test.key')
      expect(result instanceof Promise).toBe(true)
    })
  })
})

describe('i18nValidateMiddleware', () => {
  let mockReq: Partial<Request>
  let mockRes: Partial<Response>
  let mockNext: NextFunction
  let jsonSpy: jest.Mock
  let statusSpy: jest.Mock

  beforeEach(() => {
    jsonSpy = jest.fn()
    statusSpy = jest.fn().mockReturnThis()
    statusSpy.json = jsonSpy

    mockReq = {
      headers: {},
      cookies: {},
      query: {},
      params: {},
    }

    mockRes = {
      setHeader: jest.fn(),
      cookie: jest.fn(),
      status: statusSpy,
      json: jsonSpy,
    }

    mockNext = jest.fn()
  })

  it('should reject unsupported language in query', () => {
    mockReq.query = { lang: 'invalid-lang' }
    const middleware = i18nValidateMiddleware()
    middleware(mockReq as Request, mockRes as Response, mockNext)

    expect(statusSpy).toHaveBeenCalledWith(400)
    expect(jsonSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Unsupported language',
      })
    )
  })

  it('should accept valid language', () => {
    mockReq.query = { lang: 'es' }
    const middleware = i18nValidateMiddleware()
    middleware(mockReq as Request, mockRes as Response, mockNext)

    expect(mockNext).toHaveBeenCalled()
  })
})

describe('i18nForceLanguage', () => {
  let mockReq: Partial<Request>
  let mockRes: Partial<Response>
  let mockNext: NextFunction

  beforeEach(() => {
    mockReq = {
      headers: {},
      cookies: {},
    }

    mockRes = {
      setHeader: jest.fn(),
    }

    mockNext = jest.fn()
  })

  it('should force specified language', () => {
    const middleware = i18nForceLanguage('ar')
    middleware(mockReq as Request, mockRes as Response, mockNext)

    const req = mockReq as I18nRequest
    expect(req.language).toBe('ar')
    expect(req.isRTL).toBe(true)
  })

  it('should set correct text direction', () => {
    const middleware = i18nForceLanguage('ar')
    middleware(mockReq as Request, mockRes as Response, mockNext)

    const req = mockReq as I18nRequest
    expect(req.textDirection).toBe('rtl')
  })

  it('should call next', () => {
    const middleware = i18nForceLanguage('en')
    middleware(mockReq as Request, mockRes as Response, mockNext)

    expect(mockNext).toHaveBeenCalled()
  })
})
