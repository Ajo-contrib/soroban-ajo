/**
 * Accessibility tests for ErrorDisplay
 */
import React from 'react'
import { render } from '@testing-library/react'
import { axe, toHaveNoViolations } from 'jest-axe'
expect.extend(toHaveNoViolations)

import { ErrorDisplay } from '../../components/ErrorDisplay'

describe('ErrorDisplay accessibility', () => {
  it('basic error has no violations', async () => {
    const { container } = render(<ErrorDisplay error={new Error('Something went wrong')} />)
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  it('error with retry has no violations', async () => {
    const { container } = render(
      <ErrorDisplay error={new Error('Network error')} onRetry={() => {}} />
    )
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  it('compact error has no violations', async () => {
    const { container } = render(<ErrorDisplay error={new Error('Short error')} compact />)
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  it('retryable error with attempts has no violations', async () => {
    const { container } = render(
      <ErrorDisplay error={new Error('Timeout')} onRetry={() => {}} attempt={2} maxAttempts={3} />
    )
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })
})
