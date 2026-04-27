import { Request, Response, NextFunction } from 'express'
import {
  detectLanguage,
  getLanguageDirection,
  isRTLLanguage,
  SUPPORTED_LANGUAGES,
  getSupportedLanguages,
  getTranslations,
} from '../services/i18nService'
import { logger } from '../utils/logger'
import { I18N_CONFIG } from '../config/i18n.config'
import { normalizeLanguageCode } from '../utils/i18nHelpers'

export interface I18nRequest extends Request {
  locale: string
  language: string
  textDirection: 'ltr' | 'rtl'
  isRTL: boolean
  t: (key: string) => Promise<string | null>
}

export interface I18nMiddlewareOptions {
  cookieName?: string
  defaultLanguage?: string
  enableCookie?: boolean
  useQuery?: boolean
}

/**
 * Express middleware for handling internationalization.
 * Detects the preferred language from (in order of priority):
 * 1. x-language header (explicit request override)
 * 2. Accept-Language header (browser preference)
 * 3. Language cookie (user saved preference)
 * 4. Query parameter (?lang=es)
 * 5. Default language (fallback to 'en')
 *
 * Attaches language info to request for use in route handlers.
 */
export function i18nMiddleware(options: I18nMiddlewareOptions = {}) {
  const {
    cookieName = I18N_CONFIG.languageCookieName,
    defaultLanguage = I18N_CONFIG.defaultLanguage,
    enableCookie = true,
    useQuery = true,
  } = options

  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const baseRequest = req as I18nRequest

      // 1. Check explicit language header
      let language = (req.headers[I18N_CONFIG.languageHeader] as string) || ''

      // 2. Check query parameter (if enabled)
      if (!language && useQuery) {
        language = (req.query.lang as string) || ''
      }

      // 3. Check language cookie
      if (!language && enableCookie && req.cookies) {
        language = (req.cookies[cookieName] as string) || ''
      }

      // 4. Detect from Accept-Language header
      if (!language) {
        language = detectLanguage(req.headers['accept-language'] as string)
      }

      // 5. Normalize and validate the language code
      language = normalizeLanguageCode(language)

      // Attach to request object
      baseRequest.locale = language
      baseRequest.language = language
      baseRequest.isRTL = isRTLLanguage(language)
      baseRequest.textDirection = getLanguageDirection(language)

      // Add translation helper
      baseRequest.t = async (key: string) => {
        const translations = await getTranslations(language)
        if (!translations) return null

        return key.split('.').reduce<unknown>((obj, k) => {
          if (obj && typeof obj === 'object') return (obj as Record<string, unknown>)[k]
          return undefined
        }, translations) as string | null
      }

      // Set response headers for client awareness
      res.setHeader('Content-Language', language)
      res.setHeader('X-Language', language)
      res.setHeader('X-Text-Direction', baseRequest.textDirection)

      // Set language cookie in response (for next request)
      if (enableCookie) {
        res.cookie(cookieName, language, {
          maxAge: I18N_CONFIG.cookieOptions.maxAge,
          httpOnly: I18N_CONFIG.cookieOptions.httpOnly,
          secure: I18N_CONFIG.cookieOptions.secure,
          sameSite: I18N_CONFIG.cookieOptions.sameSite,
          path: I18N_CONFIG.cookieOptions.path,
        })
      }

      logger.debug('i18n middleware', {
        locale: baseRequest.locale,
        rtl: baseRequest.isRTL,
        direction: baseRequest.textDirection,
      })

      next()
    } catch (error) {
      logger.error('Error in i18n middleware', { error: error instanceof Error ? error.message : String(error) })
      next(error)
    }
  }
}

/**
 * Alternative middleware that validates language and returns error if unsupported
 */
export function i18nValidateMiddleware(options?: I18nMiddlewareOptions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const language = (req.query.lang as string) || (req.params.lang as string) || ''

    if (language && !SUPPORTED_LANGUAGES.find(l => l.code === language)) {
      return res.status(400).json({
        error: 'Unsupported language',
        supported: SUPPORTED_LANGUAGES.map(l => l.code),
        provided: language,
      })
    }

    // Call main middleware
    const middleware = i18nMiddleware(options)
    middleware(req, res, next)
  }
}

/**
 * Middleware to enforce a specific language (useful for admin/dev endpoints)
 */
export function i18nForceLanguage(forcedLanguage: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const baseRequest = req as I18nRequest
    const normalized = normalizeLanguageCode(forcedLanguage)

    baseRequest.locale = normalized
    baseRequest.language = normalized
    baseRequest.isRTL = isRTLLanguage(normalized)
    baseRequest.textDirection = getLanguageDirection(normalized)

    res.setHeader('Content-Language', normalized)
    res.setHeader('X-Language', normalized)
    res.setHeader('X-Text-Direction', baseRequest.textDirection)

    logger.debug('i18n forced language', { language: normalized })
    next()
  }
}

/**
 * Handler to return list of supported languages
 */
export async function getSupportedLanguagesHandler(req: Request, res: Response): Promise<void> {
  try {
    const languages = getSupportedLanguages().map(lang => ({
      code: lang.code,
      name: lang.name,
      nativeName: lang.nativeName,
      rtl: lang.rtl,
      direction: getLanguageDirection(lang.code),
    }))

    const baseRequest = req as I18nRequest

    res.json({
      supportedLanguages: languages,
      currentLanguage: baseRequest.language,
      currentDirection: baseRequest.textDirection,
    })
  } catch (error) {
    logger.error('Error getting supported languages', { error: error instanceof Error ? error.message : String(error) })
    res.status(500).json({ error: 'Failed to get supported languages' })
  }
}

export default i18nMiddleware
