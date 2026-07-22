import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import Script from 'next/script'
import { getLocale } from 'next-intl/server'
import '../styles/globals.css'

const inter = Inter({ subsets: ['latin'] })

const GA_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID

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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // This is the only layout allowed to render <html suppressHydrationWarning>/<body> — every real
  // request is redirected by middleware to a /[locale]/* path, and
  // src/app/[locale]/layout.tsx (nested inside this one) owns the actual
  // app shell (providers, sidebar/nav, etc.). Duplicating <html>/<body> or
  // the app shell here previously double-mounted everything and broke
  // desktop scrolling.
  const locale = await getLocale()

  return (
    <html lang={locale}>
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Ajo" />
        {/* Issue #321: Prevent flash of wrong theme on load */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var stored = localStorage.getItem('soroban-ajo-theme');
                  var theme = stored === 'dark' || stored === 'light' ? stored
                    : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
                  document.documentElement.classList.add(theme);
                } catch(e) {}
              })();
            `,
          }}
        />
      </head>
      <body className={inter.className}>
        {GA_ID && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
              strategy="afterInteractive"
            />
            <Script id="ga-init" strategy="afterInteractive">{`
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('config', '${GA_ID}', { anonymize_ip: true, send_page_view: false });
            `}</Script>
          </>
        )}
        <div className="pattern-overlay gradient-mesh min-h-screen">{children}</div>
      </body>
    </html>
  )
}
