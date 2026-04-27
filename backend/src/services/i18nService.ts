import { logger } from '../utils/logger'
import path from 'path'
import fs from 'fs/promises'

export const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English', nativeName: 'English', rtl: false },
  { code: 'es', name: 'Spanish', nativeName: 'Español', rtl: false },
  { code: 'fr', name: 'French', nativeName: 'Français', rtl: false },
  { code: 'sw', name: 'Swahili', nativeName: 'Kiswahili', rtl: false },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português', rtl: false },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', rtl: true },
  { code: 'zh', name: 'Chinese', nativeName: '中文', rtl: false },
] as const

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]['code']

// In-memory translation cache (keyed by locale code)
const translationCache = new Map<string, Record<string, unknown>>()
const localeCacheTime = new Map<string, number>()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

export function getSupportedLanguages() {
  return SUPPORTED_LANGUAGES
}

export function getLanguageInfo(code: string) {
  return SUPPORTED_LANGUAGES.find(l => l.code === code) ?? null
}

export function isRTLLanguage(code: string): boolean {
  return SUPPORTED_LANGUAGES.find(l => l.code === code)?.rtl ?? false
}

export function getLanguageDirection(code: string): 'ltr' | 'rtl' {
  return isRTLLanguage(code) ? 'rtl' : 'ltr'
}

/**
 * Loads translations for a locale from shared locales directory
 */
export async function getTranslations(locale: string): Promise<Record<string, unknown> | null> {
  if (!SUPPORTED_LANGUAGES.find(l => l.code === locale)) return null

  // Check cache and TTL
  const cacheTime = localeCacheTime.get(locale)
  if (translationCache.has(locale) && cacheTime && Date.now() - cacheTime < CACHE_TTL) {
    return translationCache.get(locale)!
  }

  try {
    const localesDir = path.resolve(__dirname, '../../../packages/shared/locales', locale)
    const files = await fs.readdir(localesDir)
    const translations: Record<string, unknown> = {}

    // Load all JSON files in the locale directory
    for (const file of files) {
      if (file.endsWith('.json')) {
        const namespace = file.replace('.json', '')
        const filePath = path.join(localesDir, file)
        const content = await fs.readFile(filePath, 'utf-8')
        const parsed = JSON.parse(content)
        Object.assign(translations, { [namespace]: parsed[namespace] || parsed })
      }
    }

    translationCache.set(locale, translations)
    localeCacheTime.set(locale, Date.now())
    return translations
  } catch (err) {
    logger.warn('Translation file not found', { locale, error: err instanceof Error ? err.message : String(err) })
    return null
  }
}

/**
 * Detects the preferred language from an Accept-Language header string.
 * Falls back to 'en' if no supported language is found.
 */
export function detectLanguage(acceptLanguageHeader: string | undefined): string {
  if (!acceptLanguageHeader) return 'en'

  const supported = new Set<string>(SUPPORTED_LANGUAGES.map(l => l.code))

  // Parse "en-US,en;q=0.9,es;q=0.8" → [['en', 1], ['es', 0.8], ...]
  const preferences = acceptLanguageHeader
    .split(',')
    .map(part => {
      const [tag, q] = part.trim().split(';q=')
      return { tag: tag.trim().toLowerCase(), q: q ? parseFloat(q) : 1 }
    })
    .sort((a, b) => b.q - a.q)

  for (const { tag } of preferences) {
    if (supported.has(tag)) return tag
    const base = tag.split('-')[0]
    if (supported.has(base)) return base
  }

  return 'en'
}

/**
 * Translates a dot-notation key within a locale's messages.
 * e.g. translateKey('en', 'common.loading') → 'Loading...'
 */
export async function translateKey(locale: string, key: string): Promise<string | null> {
  const messages = await getTranslations(locale)
  if (!messages) return null

  const value = key.split('.').reduce<unknown>((obj, k) => {
    if (obj && typeof obj === 'object') return (obj as Record<string, unknown>)[k]
    return undefined
  }, messages)

  return typeof value === 'string' ? value : null
}

/**
 * Format number for locale
 */
export function formatNumber(value: number, locale: string, options?: Intl.NumberFormatOptions): string {
  const localeMap: Record<string, string> = {
    en: 'en-US',
    es: 'es-ES',
    fr: 'fr-FR',
    sw: 'sw-TZ',
    pt: 'pt-BR',
    ar: 'ar-SA',
    zh: 'zh-CN',
  }
  return new Intl.NumberFormat(localeMap[locale] || 'en-US', options).format(value)
}

/**
 * Format currency for locale
 */
export function formatCurrency(value: number, locale: string, currency: string = 'USD'): string {
  const localeMap: Record<string, string> = {
    en: 'en-US',
    es: 'es-ES',
    fr: 'fr-FR',
    sw: 'sw-TZ',
    pt: 'pt-BR',
    ar: 'ar-SA',
    zh: 'zh-CN',
  }
  return new Intl.NumberFormat(localeMap[locale] || 'en-US', {
    style: 'currency',
    currency,
  }).format(value)
}

/**
 * Format date for locale
 */
export function formatDate(date: Date | string, locale: string, options?: Intl.DateTimeFormatOptions): string {
  const localeMap: Record<string, string> = {
    en: 'en-US',
    es: 'es-ES',
    fr: 'fr-FR',
    sw: 'sw-TZ',
    pt: 'pt-BR',
    ar: 'ar-SA',
    zh: 'zh-CN',
  }
  const dateObj = typeof date === 'string' ? new Date(date) : date
  return new Intl.DateTimeFormat(localeMap[locale] || 'en-US', options).format(dateObj)
}

/**
 * Pluralize key based on count
 */
export async function getPluralKey(locale: string, baseKey: string, count: number): Promise<string | null> {
  // For different languages, plural rules vary
  const rules = {
    en: count === 1 ? 'singular' : 'plural',
    es: count === 1 ? 'singular' : 'plural',
    fr: count <= 1 ? 'singular' : 'plural',
    sw: count === 1 ? 'singular' : 'plural',
    pt: count === 1 ? 'singular' : 'plural',
    ar: count === 1 ? 'singular' : count === 2 ? 'dual' : 'plural',
    zh: 'singular', // Chinese doesn't use plural forms
  }

  const pluralForm = rules[locale as LanguageCode] || 'plural'
  const pluralKey = `${baseKey}_${pluralForm}`
  return translateKey(locale, pluralKey)
}

/** Clears the in-memory translation cache (useful after locale file updates). */
export function clearTranslationCache(locale?: string) {
  if (locale) {
    translationCache.delete(locale)
    localeCacheTime.delete(locale)
  } else {
    translationCache.clear()
    localeCacheTime.clear()
  }
}
