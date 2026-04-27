/**
 * i18n Utility Helpers
 * Helper functions for working with internationalization
 */

import { I18N_CONFIG, type LanguageCode } from '../config/i18n.config'

/**
 * Parse Accept-Language header and return sorted array of language preferences
 */
export function parseAcceptLanguage(header: string | undefined): Array<{ lang: string; quality: number }> {
  if (!header) return []

  return header
    .split(',')
    .map(lang => {
      const parts = lang.trim().split(';')
      const code = parts[0].trim().toLowerCase()
      const qPart = parts.find(p => p.includes('q='))
      const quality = qPart ? parseFloat(qPart.split('=')[1]) : 1
      return { lang: code, quality: isNaN(quality) ? 0 : quality }
    })
    .sort((a, b) => b.quality - a.quality)
}

/**
 * Extract base language code from full locale string
 * e.g., "en-US" → "en"
 */
export function getBaseLanguage(locale: string): string {
  return locale.split('-')[0].toLowerCase()
}

/**
 * Check if a language is in the supported languages list
 */
export function isSupportedLanguage(lang: string): lang is LanguageCode {
  return ['en', 'es', 'fr', 'sw', 'pt', 'ar', 'zh'].includes(lang)
}

/**
 * Get the appropriate pluralization form for a language
 */
export function getPluralForm(language: LanguageCode, count: number): string {
  if (count === 0) return 'zero'
  
  const forms = I18N_CONFIG.pluralizationRules[language]
  
  if (forms === 'other') return 'other'
  if (forms === 'one_other') return count === 1 ? 'one' : 'other'
  if (forms === 'one_two_few_other') {
    // Arabic plural rules
    if (count === 1) return 'one'
    if (count === 2) return 'two'
    if (count % 100 >= 3 && count % 100 <= 10) return 'few'
    return 'other'
  }
  
  return 'other'
}

/**
 * Create a locale string from language code and optional region
 */
export function getLocaleString(language: LanguageCode, region?: string): string {
  if (!region) {
    // Return predefined locale for language
    const localeMap: Record<LanguageCode, string> = {
      en: 'en-US',
      es: 'es-ES',
      fr: 'fr-FR',
      sw: 'sw-TZ',
      pt: 'pt-BR',
      ar: 'ar-SA',
      zh: 'zh-CN',
    }
    return localeMap[language]
  }
  return `${language}-${region.toUpperCase()}`
}

/**
 * Get text direction for a language
 */
export function getTextDirection(language: string): 'ltr' | 'rtl' {
  return I18N_CONFIG.rtlLanguages.includes(language) ? 'rtl' : 'ltr'
}

/**
 * Convert number to word representation (for specific contexts)
 * Currently just formats the number, can be expanded with word representations
 */
export function numberToWords(num: number, language: LanguageCode): string {
  const localeString = getLocaleString(language)
  return new Intl.NumberFormat(localeString).format(num)
}

/**
 * Format a relative time string (e.g., "2 hours ago")
 */
export function formatRelativeTime(date: Date | number, language: LanguageCode, unit: Intl.RelativeTimeFormatUnit = 'day'): string {
  const now = Date.now()
  const target = typeof date === 'number' ? date : date.getTime()
  const diff = (target - now) / 1000 // Convert to seconds

  const localeString = getLocaleString(language)
  const formatter = new Intl.RelativeTimeFormat(localeString, { numeric: 'auto' })

  // Convert seconds to appropriate unit
  const unitDivisors: Record<Intl.RelativeTimeFormatUnit, number> = {
    second: 1,
    minute: 60,
    hour: 60 * 60,
    day: 60 * 60 * 24,
    week: 60 * 60 * 24 * 7,
    month: 60 * 60 * 24 * 30,
    quarter: 60 * 60 * 24 * 90,
    year: 60 * 60 * 24 * 365,
  }

  const unitValue = Math.round(diff / unitDivisors[unit])
  return formatter.format(unitValue, unit)
}

/**
 * Normalize and validate a language code
 */
export function normalizeLanguageCode(code: string | undefined | null): LanguageCode {
  if (!code) return I18N_CONFIG.defaultLanguage as LanguageCode

  const normalized = getBaseLanguage(code)
  if (isSupportedLanguage(normalized)) return normalized
  
  return I18N_CONFIG.defaultLanguage as LanguageCode
}

/**
 * Get currency code for a language
 */
export function getCurrencyForLanguage(language: LanguageCode): string {
  const setting = I18N_CONFIG.languageSettings[language]
  return setting?.currency || I18N_CONFIG.languageSettings.en.currency
}

/**
 * Escape special characters in translation strings
 */
export function escapeTranslation(str: string): string {
  const escapeMap: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }
  return str.replace(/[&<>"']/g, char => escapeMap[char])
}

/**
 * Interpolate values into a translation string
 * e.g., "Hello {name}, you have {count} messages" → "Hello John, you have 5 messages"
 */
export function interpolate(template: string, values: Record<string, string | number>): string {
  let result = template
  for (const [key, value] of Object.entries(values)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value))
  }
  return result
}

/**
 * Split a compound translation key into namespace and key
 * e.g., "common.loading" → { namespace: "common", key: "loading" }
 */
export function splitTranslationKey(keyPath: string): { namespace: string; key: string } {
  const parts = keyPath.split('.')
  const namespace = parts[0]
  const key = parts.slice(1).join('.')
  return { namespace, key }
}
