/**
 * Accessibility tests for BadgeDisplay
 */
import React from 'react'
import { render } from '@testing-library/react'
import { axe, toHaveNoViolations } from 'jest-axe'
expect.extend(toHaveNoViolations)

import { BadgeDisplay } from '../../components/BadgeDisplay'

const badges = [
  {
    id: '1',
    name: 'First Deposit',
    description: 'Made your first deposit',
    icon: 'trophy',
    earnedAt: '2026-01-15',
    rarity: 'common' as const,
  },
  {
    id: '2',
    name: 'Loyal Saver',
    description: 'Saved for 6 months straight',
    icon: 'star',
    earnedAt: '2026-03-20',
    rarity: 'epic' as const,
  },
  {
    id: '3',
    name: 'Group Leader',
    description: 'Led a successful group',
    icon: 'award',
    earnedAt: '2026-05-01',
    rarity: 'legendary' as const,
  },
]

describe('BadgeDisplay accessibility', () => {
  it('rendered badges have no violations', async () => {
    const { container } = render(<BadgeDisplay badges={badges} />)
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  it('empty list has no violations', async () => {
    const { container } = render(<BadgeDisplay badges={[]} />)
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  it('single rare badge has no violations', async () => {
    const { container } = render(
      <BadgeDisplay
        badges={[
          {
            id: '4',
            name: 'Rare Badge',
            description: 'A rare achievement',
            icon: 'star',
            earnedAt: '2026-06-01',
            rarity: 'rare' as const,
          },
        ]}
      />
    )
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })
})
