import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { Modal } from '@/components/Modal'
import { Button } from '@/components/Button'

const meta: Meta<typeof Modal> = {
  title: 'Components/Modal',
  component: Modal,
  tags: ['autodocs'],
  argTypes: {
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg', 'full'],
    },
    disableBackdropClose: { control: 'boolean' },
    onClose: { action: 'closed' },
  },
  parameters: { layout: 'fullscreen' },
}

export default meta
type Story = StoryObj<typeof Modal>

// Interactive wrapper so the modal can open/close in Storybook
const ModalDemo = ({ title, size, disableBackdropClose, content }: {
  title?: string
  size?: 'sm' | 'md' | 'lg' | 'full'
  disableBackdropClose?: boolean
  content?: React.ReactNode
}) => {
  const [open, setOpen] = useState(false)
  return (
    <div className="p-8">
      <Button onClick={() => setOpen(true)}>Open Modal</Button>
      <Modal isOpen={open} onClose={() => setOpen(false)} title={title} size={size} disableBackdropClose={disableBackdropClose}>
        {content ?? (
          <p className="text-gray-600 dark:text-gray-400">
            This is the modal body. Press Escape or click outside to close.
          </p>
        )}
      </Modal>
    </div>
  )
}

export const Default: Story = {
  render: () => <ModalDemo title="Confirm Action" />,
}

export const Small: Story = {
  render: () => <ModalDemo title="Small Modal" size="sm" />,
}

export const Large: Story = {
  render: () => <ModalDemo title="Large Modal" size="lg" />,
}

export const NoTitle: Story = {
  render: () => <ModalDemo content={<p className="text-gray-600">Modal without a title bar.</p>} />,
}

export const WithActions: Story = {
  render: () => {
    const [open, setOpen] = useState(false)
    return (
      <div className="p-8">
        <Button onClick={() => setOpen(true)}>Open</Button>
        <Modal isOpen={open} onClose={() => setOpen(false)} title="Delete Group">
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            Are you sure you want to delete this group? This action cannot be undone.
          </p>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => setOpen(false)}>Delete</Button>
          </div>
        </Modal>
      </div>
    )
  },
}
