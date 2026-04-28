'use client'

import Image, { ImageProps } from 'next/image'
import { useState } from 'react'
import { clsx } from 'clsx'

export interface ProgressiveImageProps extends Omit<ImageProps, 'onLoad' | 'onError'> {
  /** Base64 blur placeholder (data URL). Falls back to a CSS shimmer if omitted. */
  blurDataURL?: string
  /** Extra class applied to the wrapper div */
  wrapperClassName?: string
  /** Rendered when the image fails to load */
  fallback?: React.ReactNode
}

/**
 * ProgressiveImage
 *
 * Wraps next/image with:
 * - blur-up placeholder (uses blurDataURL when provided, shimmer otherwise)
 * - smooth opacity transition on load
 * - pulse skeleton while loading
 * - error state with optional fallback UI
 */
export function ProgressiveImage({
  src,
  alt,
  blurDataURL,
  wrapperClassName,
  fallback,
  className,
  fill,
  width,
  height,
  ...props
}: ProgressiveImageProps) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading')

  const isLoading = status === 'loading'
  const hasError = status === 'error'

  return (
    <div className={clsx('relative overflow-hidden', wrapperClassName)}>
      {/* Shimmer skeleton shown while loading */}
      {isLoading && (
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gray-200 dark:bg-gray-700 animate-pulse"
        />
      )}

      {/* Error fallback */}
      {hasError && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100 dark:bg-gray-800">
          {fallback ?? (
            <svg
              className="w-10 h-10 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-label="Image failed to load"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
          )}
        </div>
      )}

      {/* The actual image */}
      {!hasError && (
        <Image
          src={src}
          alt={alt}
          fill={fill}
          width={!fill ? width : undefined}
          height={!fill ? height : undefined}
          placeholder={blurDataURL ? 'blur' : 'empty'}
          blurDataURL={blurDataURL}
          onLoad={() => setStatus('loaded')}
          onError={() => setStatus('error')}
          className={clsx(
            'transition-opacity duration-500',
            isLoading ? 'opacity-0' : 'opacity-100',
            className
          )}
          {...props}
        />
      )}
    </div>
  )
}
