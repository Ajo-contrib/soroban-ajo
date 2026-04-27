/**
 * RTL-Aware Layout Component
 * Handles proper styling and layout for right-to-left languages
 */

'use client'

import { useLocale } from 'next-intl'
import { isRtl, getTextDirection } from '@/i18n'
import { ReactNode, useEffect } from 'react'

interface RTLLayoutProps {
  children: ReactNode
  className?: string
  applyGlobal?: boolean
}

/**
 * RTL Layout Wrapper
 * Automatically applies RTL classes and attributes based on current locale
 */
export function RTLLayout({ children, className = '', applyGlobal = true }: RTLLayoutProps) {
  const locale = useLocale()
  const isRTL = isRtl(locale)
  const direction = getTextDirection(locale)

  useEffect(() => {
    if (applyGlobal) {
      const htmlElement = document.documentElement
      htmlElement.dir = direction
      htmlElement.lang = locale

      if (isRTL) {
        htmlElement.classList.add('rtl')
        document.body.style.direction = 'rtl'
      } else {
        htmlElement.classList.remove('rtl')
        document.body.style.direction = 'ltr'
      }
    }
  }, [locale, direction, isRTL, applyGlobal])

  return (
    <div
      dir={direction}
      lang={locale}
      className={`${isRTL ? 'rtl' : 'ltr'} ${className}`}
      style={{
        direction,
      }}
    >
      {children}
    </div>
  )
}

/**
 * RTL-aware text component
 * Handles text alignment and spacing for RTL languages
 */
export function RTLText({ children, className = '' }: { children: ReactNode; className?: string }) {
  const locale = useLocale()
  const isRTL = isRtl(locale)

  return (
    <p
      className={`${isRTL ? 'text-right' : 'text-left'} ${className}`}
      style={{
        textAlign: isRTL ? 'right' : 'left',
      }}
    >
      {children}
    </p>
  )
}

/**
 * RTL-aware flex container
 * Reverses flex direction for RTL languages
 */
export function RTLFlex({
  children,
  className = '',
  direction = 'row',
}: {
  children: ReactNode
  className?: string
  direction?: 'row' | 'col'
}) {
  const locale = useLocale()
  const isRTL = isRtl(locale)

  const directionClass = {
    row: isRTL ? 'flex-row-reverse' : 'flex-row',
    col: 'flex-col', // Column doesn't need reversal
  }

  return <div className={`flex ${directionClass[direction]} ${className}`}>{children}</div>
}

/**
 * RTL-aware margin helper
 * Applies margin to the appropriate side based on text direction
 */
export function useRTLMargin(
  marginValue: string | number,
  side: 'start' | 'end' = 'start'
) {
  const locale = useLocale()
  const isRTL = isRtl(locale)

  if (side === 'start') {
    return {
      marginLeft: !isRTL ? marginValue : 0,
      marginRight: isRTL ? marginValue : 0,
    }
  } else {
    return {
      marginLeft: isRTL ? marginValue : 0,
      marginRight: !isRTL ? marginValue : 0,
    }
  }
}

/**
 * RTL-aware padding helper
 * Applies padding to the appropriate side based on text direction
 */
export function useRTLPadding(
  paddingValue: string | number,
  side: 'start' | 'end' = 'start'
) {
  const locale = useLocale()
  const isRTL = isRtl(locale)

  if (side === 'start') {
    return {
      paddingLeft: !isRTL ? paddingValue : 0,
      paddingRight: isRTL ? paddingValue : 0,
    }
  } else {
    return {
      paddingLeft: isRTL ? paddingValue : 0,
      paddingRight: !isRTL ? paddingValue : 0,
    }
  }
}

/**
 * RTL-aware transform utility
 * Handles CSS transforms (like translate) for RTL languages
 */
export function useRTLTransform(value: number | string) {
  const locale = useLocale()
  const isRTL = isRtl(locale)

  if (typeof value === 'number') {
    return isRTL ? -value : value
  }

  // Handle string values like "10px"
  const numValue = parseInt(value)
  const unit = value.replace(/[\d-]/g, '')

  return isRTL ? `-${numValue}${unit}` : `${value}`
}

/**
 * RTL-aware CSS class generator
 * Returns appropriate classes based on text direction
 */
export function getRTLClass(ltrClass: string, rtlClass: string) {
  const locale = useLocale()
  return isRtl(locale) ? rtlClass : ltrClass
}

export default RTLLayout
