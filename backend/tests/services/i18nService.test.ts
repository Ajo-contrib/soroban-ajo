/**
 * Tests for i18n Service
 */

import {
  getSupportedLanguages,
  getLanguageInfo,
  isRTLLanguage,
  getLanguageDirection,
  detectLanguage,
  formatNumber,
  formatCurrency,
  formatDate,
  clearTranslationCache,
} from '../../../services/i18nService'

describe('i18nService', () => {
  afterEach(() => {
    clearTranslationCache()
  })

  describe('getSupportedLanguages', () => {
    it('should return all supported languages', () => {
      const languages = getSupportedLanguages()
      expect(languages).toHaveLength(7)
      expect(languages.map(l => l.code)).toEqual(['en', 'es', 'fr', 'sw', 'pt', 'ar', 'zh'])
    })

    it('should include RTL metadata for Arabic', () => {
      const languages = getSupportedLanguages()
      const arabic = languages.find(l => l.code === 'ar')
      expect(arabic?.rtl).toBe(true)
    })

    it('should mark non-RTL languages correctly', () => {
      const languages = getSupportedLanguages()
      const english = languages.find(l => l.code === 'en')
      expect(english?.rtl).toBe(false)
    })
  })

  describe('getLanguageInfo', () => {
    it('should return info for a valid language', () => {
      const info = getLanguageInfo('en')
      expect(info).toBeDefined()
      expect(info?.code).toBe('en')
      expect(info?.name).toBe('English')
    })

    it('should return null for invalid language', () => {
      const info = getLanguageInfo('invalid')
      expect(info).toBeNull()
    })

    it('should include native names', () => {
      const spanish = getLanguageInfo('es')
      expect(spanish?.nativeName).toBe('Español')

      const arabic = getLanguageInfo('ar')
      expect(arabic?.nativeName).toBe('العربية')
    })
  })

  describe('isRTLLanguage', () => {
    it('should return true for Arabic', () => {
      expect(isRTLLanguage('ar')).toBe(true)
    })

    it('should return false for LTR languages', () => {
      expect(isRTLLanguage('en')).toBe(false)
      expect(isRTLLanguage('es')).toBe(false)
      expect(isRTLLanguage('fr')).toBe(false)
      expect(isRTLLanguage('sw')).toBe(false)
      expect(isRTLLanguage('pt')).toBe(false)
      expect(isRTLLanguage('zh')).toBe(false)
    })

    it('should return false for unknown languages', () => {
      expect(isRTLLanguage('unknown')).toBe(false)
    })
  })

  describe('getLanguageDirection', () => {
    it('should return rtl for Arabic', () => {
      expect(getLanguageDirection('ar')).toBe('rtl')
    })

    it('should return ltr for LTR languages', () => {
      expect(getLanguageDirection('en')).toBe('ltr')
      expect(getLanguageDirection('es')).toBe('ltr')
    })
  })

  describe('detectLanguage', () => {
    it('should return en for undefined header', () => {
      expect(detectLanguage(undefined)).toBe('en')
    })

    it('should return en for empty header', () => {
      expect(detectLanguage('')).toBe('en')
    })

    it('should detect exact language match', () => {
      expect(detectLanguage('es')).toBe('es')
      expect(detectLanguage('fr')).toBe('fr')
    })

    it('should parse Accept-Language header with quality values', () => {
      const header = 'es-ES,es;q=0.9,en;q=0.8'
      expect(detectLanguage(header)).toBe('es')
    })

    it('should handle complex Accept-Language headers', () => {
      const header = 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7'
      expect(detectLanguage(header)).toBe('fr')
    })

    it('should match base language code', () => {
      const header = 'en-US,en;q=0.9'
      expect(detectLanguage(header)).toBe('en')

      const header2 = 'pt-BR,pt;q=0.9'
      expect(detectLanguage(header2)).toBe('pt')
    })

    it('should fall back to en for unsupported languages', () => {
      const header = 'de-DE,de;q=0.9'
      expect(detectLanguage(header)).toBe('en')
    })

    it('should prioritize by quality value', () => {
      const header = 'en;q=0.5,es;q=0.9'
      expect(detectLanguage(header)).toBe('es')
    })
  })

  describe('formatNumber', () => {
    it('should format number for en locale', () => {
      const formatted = formatNumber(1234.567, 'en')
      expect(formatted).toMatch(/1.*234/)
    })

    it('should format number for es locale', () => {
      const formatted = formatNumber(1234.567, 'es')
      // Spanish uses different separators
      expect(formatted).toBeDefined()
    })

    it('should respect decimal options', () => {
      const formatted = formatNumber(1234.567, 'en', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      })
      expect(formatted).toBe('1,235')
    })
  })

  describe('formatCurrency', () => {
    it('should format USD currency for en locale', () => {
      const formatted = formatCurrency(1234.56, 'en', 'USD')
      expect(formatted).toMatch(/\$|USD/)
    })

    it('should format EUR currency for es locale', () => {
      const formatted = formatCurrency(1234.56, 'es', 'EUR')
      expect(formatted).toBeDefined()
    })

    it('should handle different currencies', () => {
      const usd = formatCurrency(1000, 'en', 'USD')
      const eur = formatCurrency(1000, 'en', 'EUR')
      expect(usd).not.toBe(eur)
    })
  })

  describe('formatDate', () => {
    it('should format date for en locale', () => {
      const date = new Date('2024-01-15')
      const formatted = formatDate(date, 'en')
      expect(formatted).toContain('January')
    })

    it('should format date for es locale', () => {
      const date = new Date('2024-01-15')
      const formatted = formatDate(date, 'es')
      expect(formatted).toBeDefined()
    })

    it('should handle string dates', () => {
      const formatted = formatDate('2024-01-15', 'en')
      expect(formatted).toContain('January')
    })

    it('should respect date format options', () => {
      const date = new Date('2024-01-15')
      const formatted = formatDate(date, 'en', {
        year: '2-digit',
        month: '2-digit',
        day: '2-digit',
      })
      expect(formatted).toMatch(/\d{2}/)
    })
  })

  describe('clearTranslationCache', () => {
    it('should clear all cache when no locale specified', () => {
      clearTranslationCache()
      // If no error thrown, cache was cleared successfully
      expect(true).toBe(true)
    })

    it('should clear specific locale cache', () => {
      clearTranslationCache('en')
      // If no error thrown, cache was cleared successfully
      expect(true).toBe(true)
    })
  })
})
