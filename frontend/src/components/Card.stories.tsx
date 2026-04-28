import type { Meta, StoryObj } from '@storybook/react'
import { Card } from '@/components/Card'

const meta: Meta<typeof Card> = {
  title: 'Components/Card',
  component: Card,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'outline', 'elevated', 'glass'],
    },
    padding: {
      control: 'select',
      options: ['none', 'sm', 'md', 'lg'],
    },
    hoverable: { control: 'boolean' },
    animateIn: { control: 'boolean' },
    onClick: { action: 'clicked' },
  },
}

export default meta
type Story = StoryObj<typeof Card>

const SampleContent = () => (
  <>
    <h3 className="text-lg font-semibold mb-2">Card Title</h3>
    <p className="text-gray-600 dark:text-gray-400 text-sm">
      This is some card content demonstrating the component.
    </p>
  </>
)

export const Default: Story = {
  args: { variant: 'default', children: <SampleContent /> },
}

export const Elevated: Story = {
  args: { variant: 'elevated', children: <SampleContent /> },
}

export const Outline: Story = {
  args: { variant: 'outline', children: <SampleContent /> },
}

export const Glass: Story = {
  args: { variant: 'glass', children: <SampleContent /> },
  parameters: { backgrounds: { default: 'gray' } },
}

export const Hoverable: Story = {
  args: { variant: 'elevated', hoverable: true, children: <SampleContent /> },
}

export const Interactive: Story = {
  args: {
    variant: 'elevated',
    hoverable: true,
    onClick: () => {},
    children: <SampleContent />,
  },
}

export const AllVariants: Story = {
  render: () => (
    <div className="grid grid-cols-2 gap-4 w-[500px]">
      {(['default', 'outline', 'elevated', 'glass'] as const).map((v) => (
        <Card key={v} variant={v}>
          <p className="font-medium capitalize">{v}</p>
          <p className="text-sm text-gray-500">Card variant</p>
        </Card>
      ))}
    </div>
  ),
}
