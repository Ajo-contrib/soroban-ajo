import React from 'react'
import { analytics } from '../services/analytics'
import { monitoring } from '../services/monitoring'
import * as Sentry from '@sentry/nextjs'

interface ErrorBoundaryProps {
  children: React.ReactNode
  fallback?: React.ReactNode
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void
}

interface ErrorBoundaryState {
  hasError: boolean
  error?: Error
  errorInfo?: React.ErrorInfo
  retryCount: number
  isRecovering: boolean
}

const MAX_RETRY_ATTEMPTS = 3
const RETRY_DELAY = 1000

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  private retryTimeout?: ReturnType<typeof setTimeout>

  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = {
      hasError: false,
      retryCount: 0,
      isRecovering: false,
    }
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log error to monitoring service
    this.logError(error, errorInfo)

    // Store error info for display
    this.setState({ errorInfo })

    // Call custom error handler if provided
    this.props.onError?.(error, errorInfo)

    // Attempt automatic recovery for certain error types
    this.attemptRecovery(error)
  }

  componentWillUnmount() {
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout)
    }
  }

  private logError(error: Error, errorInfo: React.ErrorInfo) {
    // Track error in analytics with detailed context
    analytics.trackError(error, {
      componentStack: errorInfo.componentStack,
      errorBoundary: true,
      retryCount: this.state.retryCount,
      timestamp: new Date().toISOString(),
      url: window.location.href,
      userAgent: navigator.userAgent,
    }, 'critical')

    // Log to console in development
    if (process.env.NODE_ENV === 'development') {
      console.group('🚨 ErrorBoundary caught error')
      console.error('Error:', error)
      console.error('Component Stack:', errorInfo.componentStack)
      console.error('Retry Count:', this.state.retryCount)
      console.groupEnd()
    }

    // Send to external monitoring service (e.g., Sentry, LogRocket)
    this.sendToMonitoringService(error, errorInfo)
  }

  private sendToMonitoringService(error: Error, errorInfo: React.ErrorInfo) {
    // Report to Sentry with component stack context
    Sentry.withScope((scope) => {
      scope.setExtras({
        componentStack: errorInfo.componentStack,
        retryCount: this.state.retryCount,
      })
      scope.setTag('errorBoundary', 'true')
      Sentry.captureException(error)
    })

    monitoring.captureError({
      error,
      severity: 'high',
      context: {
        componentStack: errorInfo.componentStack,
        retryCount: this.state.retryCount,
        timestamp: Date.now(),
        sessionId: analytics.getStats().sessionId,
        userId: analytics.getStats().userId,
      },
    })
  }

  private attemptRecovery(error: Error) {
    const { retryCount } = this.state

    // Check if error is recoverable
    if (this.isRecoverableError(error) && retryCount < MAX_RETRY_ATTEMPTS) {
      this.setState({ isRecovering: true })

      // Exponential backoff for retries
      const delay = RETRY_DELAY * Math.pow(2, retryCount)

      this.retryTimeout = setTimeout(() => {
        console.log(`[ErrorBoundary] Attempting recovery (${retryCount + 1}/${MAX_RETRY_ATTEMPTS})`)
        
        this.setState({
          hasError: false,
          error: undefined,
          errorInfo: undefined,
          retryCount: retryCount + 1,
          isRecovering: false,
        })

        // Track recovery attempt
        analytics.trackEvent({
          category: 'ErrorBoundary',
          action: 'Recovery Attempt',
          label: error.message,
          value: retryCount + 1,
        })
      }, delay)
    }
  }

  private isRecoverableError(error: Error): boolean {
    // Define recoverable error patterns
    const recoverablePatterns = [
      /network/i,
      /timeout/i,
      /fetch/i,
      /loading chunk failed/i,
      /dynamically imported module/i,
    ]

    return recoverablePatterns.some(pattern => 
      pattern.test(error.message) || pattern.test(error.name)
    )
  }

  private getErrorMessage(error?: Error): string {
    if (!error) return 'An unexpected error occurred'

    // Provide user-friendly messages for common errors
    if (/network/i.test(error.message)) {
      return 'Network connection issue. Please check your internet connection.'
    }
    if (/loading chunk failed/i.test(error.message)) {
      return 'Failed to load application resources. Please refresh the page.'
    }
    if (/timeout/i.test(error.message)) {
      return 'Request timed out. Please try again.'
    }

    return 'An unexpected error occurred. Our team has been notified.'
  }

  private getRecoveryActions(): Array<{ label: string; action: () => void; primary?: boolean }> {
    const { error, retryCount } = this.state

    const actions = []

    // Retry action for recoverable errors
    if (error && this.isRecoverableError(error) && retryCount < MAX_RETRY_ATTEMPTS) {
      actions.push({
        label: `Retry (${retryCount}/${MAX_RETRY_ATTEMPTS})`,
        action: () => this.handleRetry(),
        primary: true,
      })
    }

    // Go back action
    actions.push({
      label: 'Go Back',
      action: () => window.history.back(),
    })

    // Reload action
    actions.push({
      label: 'Reload Page',
      action: () => window.location.reload(),
      primary: actions.length === 0,
    })

    return actions
  }

  handleRetry = () => {
    const { error } = this.state
    if (error) {
      this.attemptRecovery(error)
    }
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: undefined,
      errorInfo: undefined,
      retryCount: 0,
      isRecovering: false,
    })
  }

  render() {
    const { hasError, error, isRecovering } = this.state
    const { children, fallback } = this.props

    if (hasError) {
      // Use custom fallback if provided
      if (fallback) {
        return fallback
      }

      const errorMessage = this.getErrorMessage(error)
      const actions = this.getRecoveryActions()

      return (
        <div className="min-h-[400px] flex items-center justify-center p-4">
          <div className="text-center max-w-md">
            <div className="mb-4">
              <svg
                className="w-16 h-16 text-red-500 mx-auto"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>

            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              Something went wrong
            </h2>
            
            <p className="text-gray-600 mb-4">
              {errorMessage}
            </p>

            {process.env.NODE_ENV === 'development' && error && (
              <details className="text-left mb-4">
                <summary className="cursor-pointer text-sm text-gray-500 hover:text-gray-700 mb-2">
                  Technical Details
                </summary>
                <pre className="text-xs text-gray-700 bg-gray-100 p-3 rounded overflow-auto max-h-40">
                  {error.message}
                  {error.stack && `\n\n${error.stack}`}
                </pre>
              </details>
            )}

            {isRecovering && (
              <div className="mb-4 text-blue-600">
                <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mr-2"></div>
                Attempting to recover...
              </div>
            )}

            <div className="flex flex-wrap gap-2 justify-center">
              {actions.map((action, index) => (
                <button
                  key={index}
                  onClick={action.action}
                  disabled={isRecovering}
                  className={`px-4 py-2 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    action.primary
                      ? 'bg-blue-600 hover:bg-blue-700 text-white'
                      : 'bg-gray-200 hover:bg-gray-300 text-gray-800'
                  }`}
                >
                  {action.label}
                </button>
              ))}
            </div>

            <p className="text-xs text-gray-500 mt-4">
              Error ID: {analytics.getStats().sessionId}
            </p>
          </div>
        </div>
      )
    }

    return children
  }
}
