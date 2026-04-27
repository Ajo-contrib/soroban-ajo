/**
 * i18n Routes
 * API endpoints for language management and internationalization
 */

import { Router, Request, Response } from 'express'
import { getSupportedLanguages, getTranslations, getLanguageInfo } from '../services/i18nService'
import { getSupportedLanguagesHandler, I18nRequest } from '../middleware/i18n'
import { logger } from '../utils/logger'
import { I18N_CONFIG } from '../config/i18n.config'
import { normalizeLanguageCode, getCurrencyForLanguage } from '../utils/i18nHelpers'

const router = Router()

/**
 * GET /api/i18n/languages
 * Get list of supported languages
 */
router.get('/languages', async (req: Request, res: Response): Promise<void> => {
  try {
    const baseRequest = req as I18nRequest
    const languages = getSupportedLanguages().map(lang => ({
      code: lang.code,
      name: lang.name,
      nativeName: lang.nativeName,
      rtl: lang.rtl,
      currency: getCurrencyForLanguage(lang.code as any),
    }))

    res.json({
      success: true,
      data: {
        languages,
        currentLanguage: baseRequest.language,
        defaultLanguage: I18N_CONFIG.defaultLanguage,
      },
    })
  } catch (error) {
    logger.error('Error getting languages', { error: error instanceof Error ? error.message : String(error) })
    res.status(500).json({
      success: false,
      error: 'Failed to get supported languages',
    })
  }
})

/**
 * GET /api/i18n/current
 * Get current user's language information
 */
router.get('/current', (req: Request, res: Response): void => {
  try {
    const baseRequest = req as I18nRequest
    const langInfo = getLanguageInfo(baseRequest.language)

    res.json({
      success: true,
      data: {
        code: baseRequest.language,
        direction: baseRequest.textDirection,
        rtl: baseRequest.isRTL,
        ...langInfo,
      },
    })
  } catch (error) {
    logger.error('Error getting current language', { error: error instanceof Error ? error.message : String(error) })
    res.status(500).json({
      success: false,
      error: 'Failed to get current language',
    })
  }
})

/**
 * POST /api/i18n/set-language
 * Set user's preferred language (stores in cookie and optional user preferences)
 */
router.post('/set-language', (req: Request, res: Response): void => {
  try {
    const { language } = req.body
    const baseRequest = req as I18nRequest

    if (!language) {
      res.status(400).json({
        success: false,
        error: 'Language code is required',
      })
      return
    }

    const normalized = normalizeLanguageCode(language)
    const langInfo = getLanguageInfo(normalized)

    if (!langInfo) {
      res.status(400).json({
        success: false,
        error: 'Unsupported language',
        supported: getSupportedLanguages().map(l => l.code),
      })
      return
    }

    // Set cookie
    res.cookie(I18N_CONFIG.languageCookieName, normalized, I18N_CONFIG.cookieOptions)

    // If user is authenticated, update their preference in the database
    if ((req as any).user?.id) {
      // This would typically call a service to update the user's language preference
      logger.info('User language preference updated', {
        userId: (req as any).user.id,
        language: normalized,
      })
    }

    res.json({
      success: true,
      data: {
        language: normalized,
        direction: langInfo.rtl ? 'rtl' : 'ltr',
        ...langInfo,
      },
    })
  } catch (error) {
    logger.error('Error setting language', { error: error instanceof Error ? error.message : String(error) })
    res.status(500).json({
      success: false,
      error: 'Failed to set language',
    })
  }
})

/**
 * GET /api/i18n/translations/:language
 * Get all translations for a specific language
 */
router.get('/translations/:language', async (req: Request, res: Response): Promise<void> => {
  try {
    const { language } = req.params
    const normalized = normalizeLanguageCode(language)

    const translations = await getTranslations(normalized)

    if (!translations) {
      res.status(404).json({
        success: false,
        error: 'Translations not found for language',
      })
      return
    }

    res.json({
      success: true,
      data: {
        language: normalized,
        translations,
      },
    })
  } catch (error) {
    logger.error('Error getting translations', { error: error instanceof Error ? error.message : String(error) })
    res.status(500).json({
      success: false,
      error: 'Failed to get translations',
    })
  }
})

/**
 * GET /api/i18n/translations/:language/:namespace
 * Get translations for a specific namespace and language
 */
router.get('/translations/:language/:namespace', async (req: Request, res: Response): Promise<void> => {
  try {
    const { language, namespace } = req.params
    const normalized = normalizeLanguageCode(language)

    const translations = await getTranslations(normalized)

    if (!translations) {
      res.status(404).json({
        success: false,
        error: 'Translations not found for language',
      })
      return
    }

    const namespaceTranslations = (translations as Record<string, unknown>)[namespace]

    if (!namespaceTranslations) {
      res.status(404).json({
        success: false,
        error: 'Namespace not found',
        available: Object.keys(translations),
      })
      return
    }

    res.json({
      success: true,
      data: {
        language: normalized,
        namespace,
        translations: namespaceTranslations,
      },
    })
  } catch (error) {
    logger.error('Error getting namespace translations', { error: error instanceof Error ? error.message : String(error) })
    res.status(500).json({
      success: false,
      error: 'Failed to get namespace translations',
    })
  }
})

/**
 * GET /api/i18n/language-info/:code
 * Get detailed information about a specific language
 */
router.get('/language-info/:code', (req: Request, res: Response): void => {
  try {
    const { code } = req.params
    const normalized = normalizeLanguageCode(code)
    const langInfo = getLanguageInfo(normalized)

    if (!langInfo) {
      res.status(404).json({
        success: false,
        error: 'Language not found',
      })
      return
    }

    res.json({
      success: true,
      data: {
        ...langInfo,
        currency: getCurrencyForLanguage(normalized as any),
        numberFormat: I18N_CONFIG.numberFormat,
        dateFormat: I18N_CONFIG.dateFormat,
        pluralizationRule: I18N_CONFIG.pluralizationRules[normalized as 'en' | 'es' | 'fr' | 'sw' | 'pt' | 'ar' | 'zh'],
      },
    })
  } catch (error) {
    logger.error('Error getting language info', { error: error instanceof Error ? error.message : String(error) })
    res.status(500).json({
      success: false,
      error: 'Failed to get language information',
    })
  }
})

export default router
