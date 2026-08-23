/**
 * Accessibility tests for Pagination
 */
import React from 'react'
import { render } from '@testing-library/react'
import { axe, toHaveNoViolations } from 'jest-axe'
expect.extend(toHaveNoViolations)

import Pagination from '../../components/Pagination'

describe('Pagination accessibility', () => {
  it('mid-range pagination has no violations', async () => {
    const { container } = render(
      <Pagination currentPage={3} totalPages={10} onPageChange={() => {}} />
    )
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  it('first page pagination has no violations', async () => {
    const { container } = render(
      <Pagination currentPage={1} totalPages={5} onPageChange={() => {}} />
    )
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  it('last page pagination has no violations', async () => {
    const { container } = render(
      <Pagination currentPage={8} totalPages={8} onPageChange={() => {}} />
    )
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  it('many pages with ellipsis has no violations', async () => {
    const { container } = render(
      <Pagination currentPage={15} totalPages={30} onPageChange={() => {}} />
    )
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })
})
