/**
 * Accessibility tests for LoadingSpinner
 * Verifies all spinner variants: spinner, dots, pulse, progress
 */
import React from 'react'
import { render } from '@testing-library/react'
import { axe, toHaveNoViolations } from 'jest-axe'
expect.extend(toHaveNoViolations)

import { LoadingSpinner, ButtonSpinner } from '../../components/LoadingSpinner'

describe('LoadingSpinner accessibility', () => {
  it('default spinner has no violations', async () => {
    const { container } = render(<LoadingSpinner />)
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  it('dots variant has no violations', async () => {
    const { container } = render(<LoadingSpinner variant="dots" />)
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  it('pulse variant has no violations', async () => {
    const { container } = render(<LoadingSpinner variant="pulse" />)
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  it('progress variant has no violations', async () => {
    const { container } = render(<LoadingSpinner variant="progress" progress={65} />)
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  it('custom label has no violations', async () => {
    const { container } = render(<LoadingSpinner label="Fetching data..." />)
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  it('ButtonSpinner has no violations', async () => {
    const { container } = render(<ButtonSpinner />)
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })
})
