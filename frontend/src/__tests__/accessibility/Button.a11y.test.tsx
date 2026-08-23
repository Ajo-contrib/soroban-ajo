/**
 * Accessibility tests for the Button component
 * Uses jest-axe to verify WCAG compliance across all variants
 */
import React from 'react'
import { render } from '@testing-library/react'
import { axe, toHaveNoViolations } from 'jest-axe'
expect.extend(toHaveNoViolations)

import { Button } from '../../components/Button'

describe('Button accessibility', () => {
  it('primary variant has no violations', async () => {
    const { container } = render(<Button variant="primary">Primary</Button>)
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  it('secondary variant has no violations', async () => {
    const { container } = render(<Button variant="secondary">Secondary</Button>)
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  it('danger variant has no violations', async () => {
    const { container } = render(<Button variant="danger">Danger</Button>)
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  it('ghost variant has no violations', async () => {
    const { container } = render(<Button variant="ghost">Ghost</Button>)
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  it('loading state has no violations', async () => {
    const { container } = render(<Button isLoading>Loading</Button>)
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  it('disabled state has no violations', async () => {
    const { container } = render(<Button disabled>Disabled</Button>)
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  it('with left icon has no violations', async () => {
    const { container } = render(
      <Button leftIcon={<span aria-hidden="true">🔍</span>}>Search</Button>
    )
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  it('with right icon has no violations', async () => {
    const { container } = render(
      <Button rightIcon={<span aria-hidden="true">→</span>}>Next</Button>
    )
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  it('small size has no violations', async () => {
    const { container } = render(<Button size="sm">Small</Button>)
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  it('large size has no violations', async () => {
    const { container } = render(<Button size="lg">Large</Button>)
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })
})
