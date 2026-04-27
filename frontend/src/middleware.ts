/**
 * i18n Routing Middleware
 * Middleware for next-intl routing and language detection
 */

import createMiddleware from 'next-intl/middleware'
import { SUPPORTED_LOCALES } from '../i18n.config'

/**
 * Create next-intl middleware
 * Handles:
 * - Language prefix in URLs (/en/..., /es/..., etc.)
 * - Automatic language detection from Accept-Language header
 * - Locale cookie persistence
 * - RTL support
 */
export default createMiddleware({
  // List of supported locales
  locales: SUPPORTED_LOCALES,

  // Default locale when not specified
  defaultLocale: 'en',

  // Localization prefix strategy:
  // 'always' - always include locale in URL path
  // 'as-needed' - only include non-default locales
  localePrefix: 'always',

  // Language detection settings
  localeDetection: true,

  // Handle locale cookie
  localeCookie: 'NEXT_LOCALE',
})

/**
 * Configuration for route matching
 * Ensures middleware only runs on localized routes
 */
export const config = {
  matcher: [
    // Match all request paths except for:
    '/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)',
  ],
}
