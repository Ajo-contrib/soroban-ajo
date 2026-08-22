import type { StorybookConfig } from '@storybook/nextjs'

/**
 * Storybook configuration for Next.js (#75)
 * Uses @storybook/nextjs for Next.js 14 (Image, Router, aliases, Tailwind).
 *  * Uses @storybook/nextjs for Next.js 14 (Image, Router, aliases, Tailwind).....
 */
const config: StorybookConfig = {
  stories: [
    '../stories/**/*.mdx',
    '../stories/**/*.stories.@(js|jsx|mjs|ts|tsx)',
    '../src/**/*.stories.@(js|jsx|mjs|ts|tsx)',
  ],
  addons: [
    '@storybook/addon-onboarding',
    '@storybook/addon-links',
    '@storybook/addon-essentials',
    '@storybook/addon-interactions',
  ],
  framework: {
    name: '@storybook/nextjs',
    options: {},
  },
  staticDirs: ['../public'],
  docs: {
    autodocs: 'tag',
  },
}

export default config
