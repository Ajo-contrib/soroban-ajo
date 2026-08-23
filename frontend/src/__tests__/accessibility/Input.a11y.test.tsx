/**
 * Accessibility tests for the Input component
 * Verifies label, error, helper text, and character count variants
 */
import React from 'react'
import { render } from '@testing-library/react'
import { axe, toHaveNoViolations } from 'jest-axe'
expect.extend(toHaveNoViolations)

import { Input } from '../../components/Input'

describe('Input accessibility', () => {
  it('basic input with label has no violations', async () => {
    const { container } = render(<Input label="Email" id="email" />)
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  it('input with error has no violations', async () => {
    const { container } = render(<Input label="Email" id="email" error="Invalid email address" />)
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  it('input with helper text has no violations', async () => {
    const { container } = render(
      <Input label="Password" id="password" helperText="At least 8 characters" />
    )
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  it('input with character count has no violations', async () => {
    const { container } = render(<Input label="Bio" id="bio" maxLength={160} showCharCount />)
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  it('disabled input has no violations', async () => {
    const { container } = render(<Input label="Disabled" id="disabled" disabled />)
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  it('input with success state has no violations', async () => {
    const { container } = render(<Input label="Username" id="username" success />)
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })
})
