/**
 * Frontend i18n Configuration
 * Configuration for next-intl in the frontend application
 */

import { getRequestConfig } from 'next-intl/server'

export const SUPPORTED_LOCALES = ['en', 'es', 'fr', 'sw', 'pt', 'ar', 'zh'] as const
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

export const DEFAULT_LOCALE = 'en' as const

export const LOCALE_NAMES: Record<SupportedLocale, { name: string; nativeName: string; rtl: boolean }> = {
  en: { name: 'English', nativeName: 'English', rtl: false },
  es: { name: 'Spanish', nativeName: 'Español', rtl: false },
  fr: { name: 'French', nativeName: 'Français', rtl: false },
  sw: { name: 'Swahili', nativeName: 'Kiswahili', rtl: false },
  pt: { name: 'Portuguese', nativeName: 'Português', rtl: false },
  ar: { name: 'Arabic', nativeName: 'العربية', rtl: true },
  zh: { name: 'Chinese', nativeName: '中文', rtl: false },
}

/**
 * Get request configuration for next-intl
 * This is called by the i18n routing setup
 */
export default getRequestConfig(async ({ locale }) => ({
  messages: (await import(`./locales/${locale}.json`)).default,
  defaultTranslationValues: {
    br: <br />,
    p: (chunks: React.ReactNode) => <p>{chunks}</p>,
    strong: (chunks: React.ReactNode) => <strong>{chunks}</strong>,
  },
  onError: (error: unknown) => {
    if (
      error instanceof Error &&
      !error.message.includes('NEXT_INTL_MISSING_LOCALE') &&
      !error.message.includes('NEXT_INTL_MISSING_NAMESPACE')
    ) {
      console.error('i18n error:', error)
    }
  },
  getMessageFallback: ({ namespace, key, error }) => {
    return `${namespace}.${key} [${error.code}]`
  },
}))
