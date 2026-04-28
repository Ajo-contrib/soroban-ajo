import type { Meta, StoryObj } from '@storybook/react'
import { Input } from '@/components/Input'

const meta: Meta<typeof Input> = {
  title: 'Components/Input',
  component: Input,
  tags: ['autodocs'],
  argTypes: {
    inputSize: {
      control: 'select',
      options: ['sm', 'md', 'lg'],
    },
    disabled: { control: 'boolean' },
    success: { control: 'boolean' },
    showCharCount: { control: 'boolean' },
  },
}

export default meta
type Story = StoryObj<typeof Input>

export const Default: Story = {
  args: { label: 'Email', placeholder: 'you@example.com', type: 'email' },
}

export const WithHelperText: Story = {
  args: { label: 'Username', helperText: 'Must be at least 3 characters', placeholder: 'johndoe' },
}

export const WithError: Story = {
  args: { label: 'Password', error: 'Password is required', type: 'password' },
}

export const WithSuccess: Story = {
  args: { label: 'Email', success: true, value: 'valid@example.com', readOnly: true },
}

export const WithCharCount: Story = {
  args: { label: 'Bio', showCharCount: true, maxLength: 100, placeholder: 'Tell us about yourself' },
}

export const Disabled: Story = {
  args: { label: 'Disabled', disabled: true, value: 'Cannot edit', readOnly: true },
}

export const AllSizes: Story = {
  render: () => (
    <div className="flex flex-col gap-4 w-72">
      <Input inputSize="sm" placeholder="Small" label="Small" />
      <Input inputSize="md" placeholder="Medium" label="Medium" />
      <Input inputSize="lg" placeholder="Large" label="Large" />
    </div>
  ),
}
