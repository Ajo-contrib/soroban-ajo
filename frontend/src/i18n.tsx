/**
 * Frontend i18n Configuration
 * Central configuration and utilities for internationalization
 */

import { getRequestConfig } from 'next-intl/server'
import { notFound } from 'next/navigation'

/**
 * List of all supported locales
 */
export const locales = ['en', 'es', 'fr', 'sw', 'pt', 'ar', 'zh'] as const
export type Locale = (typeof locales)[number]

/**
 * Languages that use right-to-left text direction
 */
export const rtlLocales: ReadonlySet<Locale> = new Set(['ar'])

/**
 * Language metadata
 */
export const localeMetadata: Record<
  Locale,
  {
    name: string
    nativeName: string
    region?: string
    rtl: boolean
    currency?: string
  }
> = {
  en: { name: 'English', nativeName: 'English', region: 'US', rtl: false, currency: 'USD' },
  es: { name: 'Spanish', nativeName: 'Español', region: 'ES', rtl: false, currency: 'EUR' },
  fr: { name: 'French', nativeName: 'Français', region: 'FR', rtl: false, currency: 'EUR' },
  sw: { name: 'Swahili', nativeName: 'Kiswahili', region: 'TZ', rtl: false, currency: 'TZS' },
  pt: { name: 'Portuguese', nativeName: 'Português', region: 'BR', rtl: false, currency: 'BRL' },
  ar: { name: 'Arabic', nativeName: 'العربية', region: 'SA', rtl: true, currency: 'SAR' },
  zh: { name: 'Chinese', nativeName: '中文', region: 'CN', rtl: false, currency: 'CNY' },
}

/**
 * Check if a locale uses right-to-left text direction
 */
export function isRtl(locale: Locale | string): boolean {
  return rtlLocales.has(locale as Locale)
}

/**
 * Get text direction for a locale
 */
export function getTextDirection(locale: Locale | string): 'ltr' | 'rtl' {
  return isRtl(locale) ? 'rtl' : 'ltr'
}

/**
 * Get metadata for a locale
 */
export function getLocaleMetadata(locale: Locale | string) {
  return localeMetadata[locale as Locale] || localeMetadata.en
}

/**
 * Validate that a locale is supported
 */
export function isSupportedLocale(locale: string): locale is Locale {
  return locales.includes(locale as Locale)
}

/**
 * Get the default request config for next-intl
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale

  // Validate the locale
  if (!requested || !isSupportedLocale(requested)) {
    notFound()
  }
  const locale = requested as Locale

  try {
    return {
      locale,
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
          console.error('[i18n] Error:', error)
        }
      },
      getMessageFallback: ({ key }) => {
        return `[${key}]`
      },
    }
  } catch (error) {
    console.error(`[i18n] Failed to load locale messages for ${locale}:`, error)
    notFound()
  }
})
