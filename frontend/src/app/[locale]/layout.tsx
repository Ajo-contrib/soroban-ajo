import { NextIntlClientProvider } from 'next-intl'
import { getMessages } from 'next-intl/server'
import { notFound } from 'next/navigation'
import type { Metadata, Viewport } from 'next'
import { Providers } from '../providers'
import { AppLayout } from '@/components/AppLayout'
import { InstallPrompt } from '@/components/InstallPrompt'
import { OfflineIndicator } from '@/components/OfflineIndicator'
import { OnboardingFlow } from '@/components/onboarding'
import { locales } from '@/i18n'

export const metadata: Metadata = {
  title: 'Ajo - Decentralized Savings Groups',
  description: 'Join and manage savings groups on the Stellar blockchain',
  manifest: '/manifest.json',
  icons: {
    icon: '/favicon.ico',
    apple: '/apple-touch-icon.png',
    other: [
      {
        rel: 'icon',
        type: 'image/png',
        sizes: '192x192',
        url: '/icon-192.png',
      },
      {
        rel: 'icon',
        type: 'image/png',
        sizes: '512x512',
        url: '/icon-512.png',
      },
    ],
  },
  openGraph: {
    title: 'Ajo - Decentralized Savings Groups',
    description: 'Join and manage savings groups on the Stellar blockchain',
    url: 'https://ajo.stellar.org',
    siteName: 'Ajo',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
      },
    ],
    locale: 'en_US',
    type: 'website',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Ajo',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#3b82f6' },
    { media: '(prefers-color-scheme: dark)', color: '#1e40af' },
  ],
}

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }))
}

export default async function LocaleLayout({
  children,
  params: { locale },
}: {
  children: React.ReactNode
  params: { locale: string }
}) {
  if (!locales.includes(locale as any)) {
    notFound()
  }

  const messages = await getMessages()

  // NOTE: no <html>/<body> here — the root layout (src/app/layout.tsx) is
  // the only place those may appear. This layout is always nested inside
  // it (middleware redirects every request to a /[locale]/* path), so
  // rendering a second <html>/<body> here would produce invalid nested
  // document elements and double-mount every provider/app-shell component
  // below (wallet connections, sidebar, etc. twice) — this previously broke
  // the page's scroll/layout on desktop.
  return (
    <NextIntlClientProvider messages={messages}>
      <Providers>
        <AppLayout>{children}</AppLayout>
        <OnboardingFlow />
        <InstallPrompt />
        <OfflineIndicator />
      </Providers>
    </NextIntlClientProvider>
  )
}
