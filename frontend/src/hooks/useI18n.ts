/**
 * Custom i18n Hooks
 * Additional hooks for i18n functionality beyond next-intl
 */

'use client'

import { useCallback, useMemo } from 'react'
import { useLocale } from 'next-intl'
import { isRtl, getTextDirection, localeMetadata, getLocaleMetadata } from '@/i18n'
import { useRouter, usePathname } from 'next/navigation'

/**
 * Hook to check if current locale is RTL
 */
export function useIsRTL() {
  const locale = useLocale()
  return useMemo(() => isRtl(locale), [locale])
}

/**
 * Hook to get text direction
 */
export function useTextDirection() {
  const locale = useLocale()
  return useMemo(() => getTextDirection(locale), [locale])
}

/**
 * Hook to get current locale metadata
 */
export function useLocaleMetadata() {
  const locale = useLocale()
  return useMemo(() => getLocaleMetadata(locale), [locale])
}

/**
 * Hook for language switching
 */
export function useLanguageSwitch() {
  const locale = useLocale()
  const pathname = usePathname()
  const router = useRouter()

  const switchLanguage = useCallback(
    (newLocale: string) => {
      const newPathname = pathname.replace(`/${locale}`, `/${newLocale}`)
      router.push(newPathname)
    },
    [locale, pathname, router]
  )

  return {
    currentLocale: locale,
    switchLanguage,
    availableLocales: Object.keys(localeMetadata),
  }
}

/**
 * Hook for number formatting
 */
export function useNumberFormat() {
  const locale = useLocale()

  const localeMap: Record<string, string> = {
    en: 'en-US',
    es: 'es-ES',
    fr: 'fr-FR',
    sw: 'sw-TZ',
    pt: 'pt-BR',
    ar: 'ar-SA',
    zh: 'zh-CN',
  }

  const format = useCallback(
    (value: number, options?: Intl.NumberFormatOptions) => {
      return new Intl.NumberFormat(localeMap[locale] || 'en-US', options).format(value)
    },
    [locale]
  )

  return { format }
}

/**
 * Hook for currency formatting
 */
export function useCurrencyFormat() {
  const locale = useLocale()
  const metadata = getLocaleMetadata(locale)

  const localeMap: Record<string, string> = {
    en: 'en-US',
    es: 'es-ES',
    fr: 'fr-FR',
    sw: 'sw-TZ',
    pt: 'pt-BR',
    ar: 'ar-SA',
    zh: 'zh-CN',
  }

  const format = useCallback(
    (value: number, currency: string = metadata.currency || 'USD') => {
      return new Intl.NumberFormat(localeMap[locale] || 'en-US', {
        style: 'currency',
        currency,
      }).format(value)
    },
    [locale, metadata.currency]
  )

  return { format, defaultCurrency: metadata.currency || 'USD' }
}

/**
 * Hook for date formatting
 */
export function useDateFormat() {
  const locale = useLocale()

  const localeMap: Record<string, string> = {
    en: 'en-US',
    es: 'es-ES',
    fr: 'fr-FR',
    sw: 'sw-TZ',
    pt: 'pt-BR',
    ar: 'ar-SA',
    zh: 'zh-CN',
  }

  const format = useCallback(
    (date: Date | string, options?: Intl.DateTimeFormatOptions) => {
      const dateObj = typeof date === 'string' ? new Date(date) : date
      return new Intl.DateTimeFormat(localeMap[locale] || 'en-US', options).format(dateObj)
    },
    [locale]
  )

  const formatRelative = useCallback(
    (date: Date | number, unit: Intl.RelativeTimeFormatUnit = 'day') => {
      const now = Date.now()
      const target = typeof date === 'number' ? date : date.getTime()
      const diff = (target - now) / 1000

      const formatter = new Intl.RelativeTimeFormat(localeMap[locale] || 'en-US', {
        numeric: 'auto',
      })

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
    },
    [locale]
  )

  return { format, formatRelative }
}

/**
 * Hook for RTL-aware styles
 */
export function useRTLStyles() {
  const isRTL = useIsRTL()

  return useMemo(
    () => ({
      marginStart: (value: string | number) => ({
        marginLeft: !isRTL ? value : 0,
        marginRight: isRTL ? value : 0,
      }),
      marginEnd: (value: string | number) => ({
        marginLeft: isRTL ? value : 0,
        marginRight: !isRTL ? value : 0,
      }),
      paddingStart: (value: string | number) => ({
        paddingLeft: !isRTL ? value : 0,
        paddingRight: isRTL ? value : 0,
      }),
      paddingEnd: (value: string | number) => ({
        paddingLeft: isRTL ? value : 0,
        paddingRight: !isRTL ? value : 0,
      }),
      textAlign: (alignment: 'start' | 'end') => ({
        textAlign: alignment === 'start' ? (!isRTL ? 'left' : 'right') : !isRTL ? 'right' : 'left',
      }),
      direction: isRTL ? 'rtl' : 'ltr',
    }),
    [isRTL]
  )
}

/**
 * Hook for responsive locale-aware values
 */
export function useLocaleValue<T>(values: Record<string, T>): T {
  const locale = useLocale()
  return values[locale] ?? values.en
}
