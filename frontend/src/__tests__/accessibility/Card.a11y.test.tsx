/**
 * Accessibility tests for the Card component family
 * Verifies Card, CardHeader, CardBody, CardFooter, and clickable/hoverable variants
 */
import React from 'react'
import { render } from '@testing-library/react'
import { axe, toHaveNoViolations } from 'jest-axe'
expect.extend(toHaveNoViolations)

import { Card, CardHeader, CardBody, CardFooter } from '../../components/Card'

describe('Card accessibility', () => {
  it('default card has no violations', async () => {
    const { container } = render(<Card>Card content</Card>)
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  it('outline card has no violations', async () => {
    const { container } = render(<Card variant="outline">Card content</Card>)
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  it('elevated card has no violations', async () => {
    const { container } = render(<Card variant="elevated">Card content</Card>)
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  it('glass card has no violations', async () => {
    const { container } = render(<Card variant="glass">Card content</Card>)
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  it('clickable card has no violations', async () => {
    const { container } = render(<Card onClick={() => {}}>Clickable card</Card>)
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  it('card with header, body, footer has no violations', async () => {
    const { container } = render(
      <Card>
        <CardHeader>Header</CardHeader>
        <CardBody>Body content here</CardBody>
        <CardFooter>Footer</CardFooter>
      </Card>
    )
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })
})
