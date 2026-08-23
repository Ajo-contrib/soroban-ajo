/**
 * Accessibility tests for LiveRegion
 */
import React from 'react'
import { render } from '@testing-library/react'
import { axe, toHaveNoViolations } from 'jest-axe'
expect.extend(toHaveNoViolations)

import { LiveRegion } from '../../components/LiveRegion'

describe('LiveRegion accessibility', () => {
  it('rendered live region has no violations', async () => {
    const { container } = render(<LiveRegion />)
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })
})
