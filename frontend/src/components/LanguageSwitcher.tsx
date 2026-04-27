/**
 * Language Switcher Component
 * Allows users to change their preferred language
 */

'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useRouter, usePathname } from 'next/navigation'
import { locales, localeMetadata, getTextDirection } from '@/i18n'
import { useState, useTransition } from 'react'
import Link from 'next/link'
import clsx from 'clsx'

interface LanguageSwitcherProps {
  variant?: 'dropdown' | 'inline' | 'modal'
  size?: 'sm' | 'md' | 'lg'
  showFlags?: boolean
  className?: string
}

/**
 * Language Switcher Dropdown Component
 */
function LanguageSwitcherDropdown({ size = 'md', showFlags = true, className }: LanguageSwitcherProps) {
  const locale = useLocale()
  const pathname = usePathname()
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const handleLanguageChange = (newLocale: string) => {
    startTransition(() => {
      // Replace the locale in the pathname
      const newPathname = pathname.replace(`/${locale}`, `/${newLocale}`)
      router.push(newPathname)
      setIsOpen(false)
    })
  }

  const currentMetadata = localeMetadata[locale as never]
  const sizeClasses = {
    sm: 'py-1 px-2 text-xs',
    md: 'py-2 px-3 text-sm',
    lg: 'py-3 px-4 text-base',
  }

  return (
    <div className={clsx('relative inline-block', className)}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={isPending}
        className={clsx(
          'flex items-center gap-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50',
          sizeClasses[size]
        )}
        title={`Current language: ${currentMetadata.nativeName}`}
      >
        {showFlags && <LanguageFlag locale={locale as never} size={size} />}
        <span className="font-medium">{currentMetadata.nativeName}</span>
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-48 rounded-lg border border-gray-200 bg-white shadow-lg">
          {locales.map(lang => {
            const metadata = localeMetadata[lang]
            const isSelected = locale === lang
            return (
              <button
                key={lang}
                onClick={() => handleLanguageChange(lang)}
                disabled={isPending}
                className={clsx(
                  'w-full px-4 py-2 text-left text-sm hover:bg-gray-100 disabled:opacity-50 first:rounded-t-lg last:rounded-b-lg',
                  isSelected && 'bg-primary-50 font-semibold text-primary-700'
                )}
              >
                <div className="flex items-center gap-2">
                  {showFlags && <LanguageFlag locale={lang} size="sm" />}
                  <div>
                    <div className="font-medium">{metadata.nativeName}</div>
                    <div className="text-xs text-gray-500">{metadata.name}</div>
                  </div>
                  {isSelected && (
                    <svg className="ml-auto h-4 w-4 text-primary-700" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * Language Switcher Inline Component
 */
function LanguageSwitcherInline({ showFlags = true, className }: LanguageSwitcherProps) {
  const locale = useLocale()
  const pathname = usePathname()
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const handleLanguageChange = (newLocale: string) => {
    startTransition(() => {
      const newPathname = pathname.replace(`/${locale}`, `/${newLocale}`)
      router.push(newPathname)
    })
  }

  return (
    <div className={clsx('flex flex-wrap gap-2', className)}>
      {locales.map(lang => {
        const metadata = localeMetadata[lang]
        const isSelected = locale === lang
        return (
          <button
            key={lang}
            onClick={() => handleLanguageChange(lang)}
            disabled={isPending}
            className={clsx(
              'flex items-center gap-1 rounded px-3 py-1 text-sm font-medium transition-colors disabled:opacity-50',
              isSelected
                ? 'bg-primary-500 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            )}
            title={`Switch to ${metadata.name}`}
          >
            {showFlags && <LanguageFlag locale={lang} size="sm" />}
            {metadata.nativeName}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Language Flag Component
 */
function LanguageFlag({ locale, size = 'md' }: { locale: keyof typeof localeMetadata; size?: 'sm' | 'md' | 'lg' }) {
  const flagMap: Record<string, string> = {
    en: '🇺🇸',
    es: '🇪🇸',
    fr: '🇫🇷',
    sw: '🇹🇿',
    pt: '🇧🇷',
    ar: '🇸🇦',
    zh: '🇨🇳',
  }

  const sizeClasses = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-lg',
  }

  return <span className={sizeClasses[size]}>{flagMap[locale] || '🌐'}</span>
}

/**
 * Main Language Switcher Component
 */
export function LanguageSwitcher({
  variant = 'dropdown',
  size = 'md',
  showFlags = true,
  className,
}: LanguageSwitcherProps) {
  return variant === 'inline' ? (
    <LanguageSwitcherInline size={size} showFlags={showFlags} className={className} />
  ) : (
    <LanguageSwitcherDropdown size={size} showFlags={showFlags} className={className} />
  )
}

export default LanguageSwitcher
