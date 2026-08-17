'use client'

import { AuthProvider } from '@/context/AuthContext'
import { ThemeProvider } from '@/context/ThemeContext'
import { OfflineProvider } from '@/context/OfflineContext'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import { useOnboarding } from '@/hooks/useOnboarding'
import { NotificationProvider } from '@/components/NotificationProvider'
import { HelpProvider } from '@/contexts/HelpContext'
import HelpPanel from '@/components/help/HelpPanel'
import { ToastProvider } from '@/components/toast'
import { initSentryClient } from '@/config/sentry'
import { initGoogleAnalytics, trackWebVital } from '@/utils/googleAnalytics'
import { observeWebVitals, observeResourceTiming, measurePageLoad, WebVitalsMetric } from '@/utils/monitoring'

function OnboardingInitializer() {
  const startOnboardingIfNew = useOnboarding((s) => s.startOnboardingIfNew)
  useEffect(() => {
    startOnboardingIfNew()
  }, [startOnboardingIfNew])
  return null
}

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Init third-party monitoring tools
    initSentryClient()
    initGoogleAnalytics()

    // Observe Core Web Vitals — forward to GA4 as well
    observeWebVitals((metric: WebVitalsMetric) => {
      trackWebVital(metric.name, metric.value, metric.rating)
    })

    observeResourceTiming()

    if (document.readyState === 'complete') {
      measurePageLoad()
    } else {
      window.addEventListener('load', measurePageLoad, { once: true })
    }
  }, [])

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            refetchOnWindowFocus: false,
          },
        },
      })
  )

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <OfflineProvider>
            <HelpProvider>
              <ToastProvider defaultPosition="top-right" maxVisible={5}>
                <NotificationProvider>
                  <OnboardingInitializer />
                  {children}
                  <HelpPanel />
                </NotificationProvider>
              </ToastProvider>
            </HelpProvider>
          </OfflineProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
