import type { Meta, StoryObj } from '@storybook/react'
import { ProgressiveImage } from '@/components/ProgressiveImage'

const meta: Meta<typeof ProgressiveImage> = {
  title: 'Components/ProgressiveImage',
  component: ProgressiveImage,
  tags: ['autodocs'],
  argTypes: {
    priority: { control: 'boolean' },
  },
}

export default meta
type Story = StoryObj<typeof ProgressiveImage>

// Tiny 1×1 blue pixel as a blur placeholder
const BLUR_PLACEHOLDER =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

export const WithBlurPlaceholder: Story = {
  render: () => (
    <ProgressiveImage
      src="https://picsum.photos/seed/ajo/600/400"
      alt="Sample landscape"
      width={600}
      height={400}
      blurDataURL={BLUR_PLACEHOLDER}
      wrapperClassName="w-[600px] h-[400px]"
    />
  ),
}

export const WithShimmer: Story = {
  render: () => (
    <ProgressiveImage
      src="https://picsum.photos/seed/group/400/300"
      alt="Group photo"
      width={400}
      height={300}
      wrapperClassName="w-[400px] h-[300px]"
    />
  ),
}

export const FillMode: Story = {
  render: () => (
    <div className="relative w-[500px] h-[300px]">
      <ProgressiveImage
        src="https://picsum.photos/seed/fill/500/300"
        alt="Fill mode image"
        fill
        blurDataURL={BLUR_PLACEHOLDER}
        className="object-cover"
      />
    </div>
  ),
}

export const ErrorState: Story = {
  render: () => (
    <ProgressiveImage
      src="/this-image-does-not-exist.jpg"
      alt="Broken image"
      width={400}
      height={300}
      wrapperClassName="w-[400px] h-[300px]"
    />
  ),
}

export const CustomErrorFallback: Story = {
  render: () => (
    <ProgressiveImage
      src="/broken.jpg"
      alt="Broken with custom fallback"
      width={400}
      height={300}
      wrapperClassName="w-[400px] h-[300px]"
      fallback={
        <div className="text-center text-gray-500">
          <p className="text-sm">Image unavailable</p>
        </div>
      }
    />
  ),
}
