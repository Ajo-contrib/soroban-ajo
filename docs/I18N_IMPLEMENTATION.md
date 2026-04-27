# i18n Implementation Documentation

This document provides comprehensive guidance on the internationalization (i18n) implementation across the Ajo platform.

## Table of Contents

1. [Overview](#overview)
2. [Supported Languages](#supported-languages)
3. [Architecture](#architecture)
4. [Backend Implementation](#backend-implementation)
5. [Frontend Implementation](#frontend-implementation)
6. [Mobile Implementation](#mobile-implementation)
7. [Translation Management](#translation-management)
8. [RTL Support](#rtl-support)
9. [Testing](#testing)
10. [Deployment](#deployment)

## Overview

The Ajo platform supports 7 languages with full internationalization support:
- English (en) - Left-to-Right
- Spanish (es) - Left-to-Right
- French (fr) - Left-to-Right
- Swahili (sw) - Left-to-Right
- Portuguese (pt) - Left-to-Right
- Arabic (ar) - **Right-to-Left**
- Chinese Simplified (zh) - Left-to-Right

Language detection is automatic based on:
1. User's explicit language selection
2. Accept-Language HTTP header
3. Browser/system preferences
4. Saved language preference
5. Default fallback to English

## Supported Languages

Each language has complete metadata including:
- Native name and English name
- RTL/LTR text direction
- Default currency
- Locale code for Intl APIs

### Language Metadata

```json
{
  "en": { "name": "English", "nativeName": "English", "rtl": false, "currency": "USD" },
  "es": { "name": "Spanish", "nativeName": "Español", "rtl": false, "currency": "EUR" },
  "fr": { "name": "French", "nativeName": "Français", "rtl": false, "currency": "EUR" },
  "sw": { "name": "Swahili", "nativeName": "Kiswahili", "rtl": false, "currency": "TZS" },
  "pt": { "name": "Portuguese", "nativeName": "Português", "rtl": false, "currency": "BRL" },
  "ar": { "name": "Arabic", "nativeName": "العربية", "rtl": true, "currency": "SAR" },
  "zh": { "name": "Chinese", "nativeName": "中文", "rtl": false, "currency": "CNY" }
}
```

## Architecture

### Directory Structure

```
ajo/
├── packages/shared/locales/           # Shared translation files
│   ├── en/                            # English translations
│   │   ├── common.json                # Common UI strings
│   │   ├── auth.json                  # Authentication strings
│   │   ├── groups.json                # Group management
│   │   ├── contributions.json         # Contributions
│   │   ├── leaderboard.json          # Leaderboard
│   │   ├── gamification.json         # Gamification
│   │   ├── wallet.json               # Wallet/Balance
│   │   ├── activity.json             # Activity Feed
│   │   ├── profile.json              # User Profile
│   │   └── errors.json               # Error Messages
│   ├── es/, fr/, sw/, pt/, ar/, zh/  # Other language directories
│
├── backend/
│   ├── src/
│   │   ├── config/
│   │   │   └── i18n.config.ts         # Backend i18n configuration
│   │   ├── middleware/
│   │   │   └── i18n.ts                # Express i18n middleware
│   │   ├── services/
│   │   │   └── i18nService.ts         # Translation service
│   │   ├── utils/
│   │   │   └── i18nHelpers.ts         # i18n utility functions
│   │   └── routes/api/
│   │       └── i18n.ts                # i18n API endpoints
│   └── tests/
│       ├── services/
│       │   └── i18nService.test.ts
│       └── middleware/
│           └── i18n.test.ts
│
├── frontend/
│   ├── i18n.config.ts                 # Frontend i18n config
│   ├── src/
│   │   ├── i18n.ts                    # i18n utilities
│   │   ├── middleware.ts              # next-intl middleware
│   │   ├── components/
│   │   │   ├── LanguageSwitcher.tsx   # Language switcher component
│   │   │   └── RTLLayout.tsx          # RTL-aware layout
│   │   ├── hooks/
│   │   │   └── useI18n.ts             # Custom i18n hooks
│   │   └── locales/
│   │       ├── en.json
│   │       ├── es.json
│   │       └── ... (other languages)
│   └── public/
│       ├── locales/                   # Public translation files
│       └── flags/                     # Country flags
│
└── mobile/
    ├── app.json
    ├── i18n.config.ts                 # Mobile i18n config
    └── src/
        ├── i18n/
        │   └── localization.ts
        ├── components/
        │   └── LanguageSwitcher.tsx
        └── hooks/
            └── useI18n.ts
```

## Backend Implementation

### i18n Service

The backend `i18nService` provides core translation functionality:

```typescript
import {
  getSupportedLanguages,
  getLanguageInfo,
  isRTLLanguage,
  detectLanguage,
  getTranslations,
  translateKey,
  formatNumber,
  formatCurrency,
  formatDate,
} from '../services/i18nService'

// Get all supported languages
const languages = getSupportedLanguages()

// Detect language from Accept-Language header
const lang = detectLanguage('en-US,en;q=0.9,es;q=0.8')

// Get translations for a locale
const translations = await getTranslations('es')

// Translate a specific key
const message = await translateKey('en', 'auth.login')

// Format numbers, currency, and dates
const formatted = formatNumber(1234.56, 'es')
const currency = formatCurrency(100, 'es', 'EUR')
const date = formatDate(new Date(), 'fr')
```

### i18n Middleware

Apply the middleware to your Express app:

```typescript
import i18nMiddleware from '../middleware/i18n'

// Apply middleware
app.use(i18nMiddleware())

// In route handlers, access language from request
app.get('/api/data', (req: Request, res: Response) => {
  const baseReq = req as I18nRequest
  console.log(`User language: ${baseReq.language}`)
  console.log(`Is RTL: ${baseReq.isRTL}`)
  console.log(`Text direction: ${baseReq.textDirection}`)
})
```

### i18n API Endpoints

The backend provides REST API endpoints for language management:

```
GET  /api/i18n/languages           # Get all supported languages
GET  /api/i18n/current             # Get current user's language
POST /api/i18n/set-language        # Set user's preferred language
GET  /api/i18n/translations/:lang  # Get all translations for a language
GET  /api/i18n/language-info/:code # Get detailed language info
```

### Example Usage

```bash
# Get all supported languages
curl http://localhost:3000/api/i18n/languages

# Set user language to Spanish
curl -X POST http://localhost:3000/api/i18n/set-language \
  -H "Content-Type: application/json" \
  -d '{"language": "es"}'

# Get translations for Spanish
curl http://localhost:3000/api/i18n/translations/es
```

## Frontend Implementation

### Using next-intl

The frontend uses `next-intl` for server-side and client-side translations:

```typescript
import { useTranslations } from 'next-intl'

export default function HomePage() {
  const t = useTranslations()
  
  return (
    <div>
      <h1>{t('common.app_name')}</h1>
      <p>{t('common.app_slogan')}</p>
    </div>
  )
}
```

### Language Switcher Component

```typescript
import { LanguageSwitcher } from '@/components/LanguageSwitcher'

export function Header() {
  return (
    <header>
      <h1>Ajo</h1>
      <LanguageSwitcher 
        variant="dropdown"    // or 'inline'
        size="md"
        showFlags={true}
      />
    </header>
  )
}
```

### RTL Support

```typescript
import { RTLLayout, useIsRTL, useTextDirection } from '@/components/RTLLayout'

export function MyComponent() {
  const isRTL = useIsRTL()
  const direction = useTextDirection()
  
  return (
    <RTLLayout>
      <div className={isRTL ? 'text-right' : 'text-left'}>
        Content
      </div>
    </RTLLayout>
  )
}
```

### Custom Hooks

```typescript
import {
  useIsRTL,
  useTextDirection,
  useLanguageSwitch,
  useNumberFormat,
  useCurrencyFormat,
  useDateFormat,
} from '@/hooks/useI18n'

export function MyComponent() {
  const isRTL = useIsRTL()
  const { format: formatNumber } = useNumberFormat()
  const { format: formatCurrency } = useCurrencyFormat()
  const { format: formatDate } = useDateFormat()
  
  return (
    <div>
      <p>{formatNumber(1234)}</p>
      <p>{formatCurrency(100)}</p>
      <p>{formatDate(new Date())}</p>
    </div>
  )
}
```

### Layout Setup

Wrap your app with the RTL layout:

```typescript
// app/[locale]/layout.tsx
import { RTLLayout } from '@/components/RTLLayout'

export default function LocaleLayout({ children, params: { locale } }) {
  return (
    <html lang={locale}>
      <body>
        <RTLLayout applyGlobal={true}>
          {children}
        </RTLLayout>
      </body>
    </html>
  )
}
```

## Mobile Implementation

### Expo/React Native i18n

For the mobile app, use `react-i18next` or `expo-localization`:

```typescript
import { useLocales } from 'expo-localization'
import { I18n } from 'i18n-js'

const translations = {
  en: { greeting: 'Hello' },
  es: { greeting: 'Hola' },
  // ... other languages
}

const i18n = new I18n(translations)
i18n.locale = useLocales()[0]?.languageTag || 'en'

export function App() {
  return <Text>{i18n.t('greeting')}</Text>
}
```

## Translation Management

### Adding New Translations

1. Add the key/value to `packages/shared/locales/en/{namespace}.json`
2. Translate to other languages in respective directories
3. Use in code with the full path: `namespace.key`

Example:
```json
// packages/shared/locales/en/common.json
{
  "common": {
    "app_name": "Ajo",
    "loading": "Loading...",
    "save": "Save",
    "cancel": "Cancel"
  }
}
```

```typescript
// In frontend
const t = useTranslations()
t('common.app_name')  // "Ajo"
t('common.loading')   // "Loading..."
```

### Translation File Structure

Each namespace should be organized by feature:

- **common.json** - General UI strings (button labels, common actions)
- **auth.json** - Authentication related strings
- **groups.json** - Group management strings
- **contributions.json** - Contribution/savings related strings
- **leaderboard.json** - Ranking and leaderboard strings
- **gamification.json** - Points, badges, rewards
- **wallet.json** - Wallet and balance related strings
- **activity.json** - Activity feed and notifications
- **profile.json** - User profile and settings
- **errors.json** - Error messages and validation

### Pluralization

For languages with complex pluralization rules (like Arabic), use the `getPluralKey` function:

```typescript
const key = await getPluralKey('ar', 'messages.new_messages', count)
const message = await translateKey('ar', key)
```

## RTL Support

### CSS RTL Classes

Add RTL-specific CSS classes:

```css
/* Use logical properties */
.sidebar {
  margin-inline-start: 2rem;  /* Works for both LTR and RTL */
  padding-inline-end: 1rem;
}

/* Or use RTL selector */
.rtl .sidebar {
  transform: scaleX(-1);
}
```

### Tailwind CSS RTL

Use `dir-rtl` class:

```html
<div class="dir-rtl text-right">Right-aligned text for Arabic</div>
```

### Flexbox RTL

```typescript
// Use flex-row-reverse for RTL
<div className={isRTL ? 'flex flex-row-reverse' : 'flex flex-row'}>
  {/* items */}
</div>
```

## Testing

### Backend Tests

```bash
# Run i18n service tests
npm test -- i18nService.test.ts

# Run i18n middleware tests
npm test -- middleware/i18n.test.ts
```

### Frontend Tests

```bash
# Test language switching
npm test -- LanguageSwitcher.test.tsx

# Test RTL layout
npm test -- RTLLayout.test.tsx
```

### i18n Testing Checklist

- [ ] All 7 languages load correctly
- [ ] Language switching works smoothly
- [ ] RTL layout renders correctly for Arabic
- [ ] Accept-Language header detection works
- [ ] Translations are complete (no fallbacks)
- [ ] Date/number formatting is locale-specific
- [ ] Currency formatting shows correct symbols
- [ ] Cookie persistence works
- [ ] Mobile layout adapts to RTL
- [ ] API endpoints return correct locale data

## Deployment

### Environment Variables

```env
# Backend
I18N_DEFAULT_LANGUAGE=en
I18N_CACHE_TTL=300000
I18N_SUPPORTED_LANGUAGES=en,es,fr,sw,pt,ar,zh

# Frontend
NEXT_PUBLIC_I18N_DEFAULT_LOCALE=en
NEXT_PUBLIC_SUPPORTED_LOCALES=en,es,fr,sw,pt,ar,zh
```

### Production Checklist

- [ ] All translation files are included in build
- [ ] Language detection works on production domain
- [ ] Cookies are set with `secure: true` on HTTPS
- [ ] RTL styling is applied correctly
- [ ] Performance: Translation cache is working
- [ ] Monitoring: Language usage metrics tracked
- [ ] Fallback: English translations for missing keys
- [ ] CDN: Static translation files cached appropriately

### Performance Considerations

1. **Caching**: Translation files are cached for 5 minutes
2. **Lazy Loading**: Load translations only for current locale
3. **Code Splitting**: Language-specific components loaded on demand
4. **Font Optimization**: Load Arabic fonts only when needed

## Troubleshooting

### Language Not Detected

Check:
- Accept-Language header is sent by browser
- Language cookie is not conflicting
- Middleware is applied before route handlers

### RTL Styles Not Applied

Check:
- `dir="rtl"` attribute is set on HTML element
- CSS uses logical properties or RTL selectors
- Mobile layout respects text direction

### Missing Translations

Check:
- Translation file exists in correct locale directory
- Key path is correct (use dot notation)
- Translation service cache is cleared

### Performance Issues

Check:
- Translation cache TTL is appropriate
- Database queries are optimized
- Lazy loading is enabled for locales
- Static assets are minified

## References

- [next-intl Documentation](https://next-intl-docs.vercel.app/)
- [MDN Intl API](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl)
- [React i18next](https://www.i18next.com/)
- [Expo i18n](https://docs.expo.dev/)

## Contributing

When adding new features that require translations:

1. Create the key in `packages/shared/locales/en/{namespace}.json`
2. Translate to all 6 other languages
3. Add unit tests for new translation keys
4. Update this documentation if needed
5. Submit PR with all translations complete

## Support

For i18n-related issues:

1. Check the troubleshooting section
2. Review existing translation files for patterns
3. Test in development environment
4. File GitHub issue with language and reproduction steps
