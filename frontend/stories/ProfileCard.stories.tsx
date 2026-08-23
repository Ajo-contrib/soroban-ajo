import type { Meta, StoryObj } from '@storybook/react'
import { ProfileCard } from '@/components/ProfileCard'
import type { UserProfile } from '@/types/profile'
import { defaultEmailPreferences } from '@/types/profile'

const defaultProfile: UserProfile = {
  address: 'GABC1234567890ABCDEF',
  displayName: 'Alex Rivera',
  bio: 'Building on Stellar.',
  joinedAt: '2025-01-15T00:00:00Z',
  preferences: {
    notifications: {
      email: true,
      push: true,
      groupUpdates: true,
      payoutReminders: true,
      contributionReminders: true,
    },
    emailNotifications: defaultEmailPreferences,
    privacy: {
      showProfile: true,
      showActivity: true,
      showStats: true,
    },
    display: {
      theme: 'light',
      language: 'en',
      currency: 'USD',
    },
  },
  stats: {
    totalGroups: 3,
    activeGroups: 2,
    completedGroups: 1,
    totalContributions: 1250,
    totalPayouts: 800,
    successRate: 95,
  },
}

const meta: Meta<typeof ProfileCard> = {
  title: 'Components/ProfileCard',
  component: ProfileCard,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    isLoading: { control: 'boolean' },
  },
}
export default meta

type Story = StoryObj<typeof ProfileCard>

export const Default: Story = {
  args: {
    profile: defaultProfile,
  },
}

export const WithAvatar: Story = {
  args: {
    profile: {
      ...defaultProfile,
      avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Alex',
    },
  },
}

export const Anonymous: Story = {
  args: {
    profile: {
      ...defaultProfile,
      displayName: undefined,
      bio: undefined,
    },
  },
}

export const Loading: Story = {
  args: {
    profile: defaultProfile,
    isLoading: true,
  },
}
