/**
 * i18n Configuration
 * Centralized i18n settings for backend services
 */

export const I18N_CONFIG = {
  // Default language for the application
  defaultLanguage: 'en',

  // Fallback language if translation is missing
  fallbackLanguage: 'en',

  // Cookie name for storing user's language preference
  languageCookieName: 'ajo_language',

  // Cookie options
  cookieOptions: {
    maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year
    httpOnly: false, // Accessible from frontend
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/',
  },

  // Header name for Accept-Language
  acceptLanguageHeader: 'accept-language',

  // Header name for language preference in requests
  languageHeader: 'x-language',

  // Cache settings
  cache: {
    enabled: true,
    ttl: 5 * 60 * 1000, // 5 minutes
  },

  // Number formatting defaults
  numberFormat: {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  },

  // Currency formatting defaults
  currencyFormat: {
    style: 'currency',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  },

  // Date formatting defaults
  dateFormat: {
    year: 'numeric' as const,
    month: 'long' as const,
    day: 'numeric' as const,
  },

  // RTL languages (right-to-left text direction)
  rtlLanguages: ['ar'],

  // Language-specific settings
  languageSettings: {
    en: { currency: 'USD', region: 'US' },
    es: { currency: 'EUR', region: 'ES' },
    fr: { currency: 'EUR', region: 'FR' },
    sw: { currency: 'TZS', region: 'TZ' },
    pt: { currency: 'BRL', region: 'BR' },
    ar: { currency: 'SAR', region: 'SA' },
    zh: { currency: 'CNY', region: 'CN' },
  },

  // Pluralization rules for each language
  pluralizationRules: {
    en: 'one_other',
    es: 'one_other',
    fr: 'one_other',
    sw: 'one_other',
    pt: 'one_other',
    ar: 'one_two_few_other',
    zh: 'other',
  },
} as const

export type LanguageCode = 'en' | 'es' | 'fr' | 'sw' | 'pt' | 'ar' | 'zh'

export function isRTL(language: string): boolean {
  return I18N_CONFIG.rtlLanguages.includes(language)
}

export function getLanguageSetting(language: LanguageCode, key: keyof typeof I18N_CONFIG.languageSettings.en) {
  const settings = I18N_CONFIG.languageSettings[language]
  return settings ? settings[key] : I18N_CONFIG.languageSettings.en[key]
}
