/**
 * Frontend i18n Configuration
 * Configuration for next-intl in the frontend application
 */

export const SUPPORTED_LOCALES = ['en', 'es', 'fr', 'sw', 'pt', 'ar', 'zh'] as const
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

export const DEFAULT_LOCALE = 'en' as const

export const LOCALE_NAMES: Record<
  SupportedLocale,
  { name: string; nativeName: string; rtl: boolean }
> = {
  en: { name: 'English', nativeName: 'English', rtl: false },
  es: { name: 'Spanish', nativeName: 'Español', rtl: false },
  fr: { name: 'French', nativeName: 'Français', rtl: false },
  sw: { name: 'Swahili', nativeName: 'Kiswahili', rtl: false },
  pt: { name: 'Portuguese', nativeName: 'Português', rtl: false },
  ar: { name: 'Arabic', nativeName: 'العربية', rtl: true },
  zh: { name: 'Chinese', nativeName: '中文', rtl: false },
}
