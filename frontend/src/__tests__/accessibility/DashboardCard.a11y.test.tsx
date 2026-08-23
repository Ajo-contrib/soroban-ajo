/**
 * Accessibility tests for DashboardCard
 */
import React from 'react'
import { render } from '@testing-library/react'
import { axe, toHaveNoViolations } from 'jest-axe'
expect.extend(toHaveNoViolations)

import { DashboardCard } from '../../components/DashboardCard'

describe('DashboardCard accessibility', () => {
  it('default card has no violations', async () => {
    const { container } = render(<DashboardCard>Dashboard content</DashboardCard>)
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  it('glass variant has no violations', async () => {
    const { container } = render(<DashboardCard glass>Glass card content</DashboardCard>)
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })
})
