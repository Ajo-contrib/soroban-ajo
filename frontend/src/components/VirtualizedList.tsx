'use client';

/**
 * VirtualizedList (#753)
 *
 * High-performance list using @tanstack/react-virtual.
 * Supports dynamic row heights, infinite scroll, search/filter integration,
 * and a smooth scrolling experience via CSS scroll-behavior.
 */

import { useRef, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx } from 'clsx';

export interface VirtualizedListProps<T> {
  items: T[];
  /** Estimated height per row (px). Used for initial layout; actual height is measured. */
  estimateSize?: number;
  /** Number of off-screen items to render above and below the viewport. */
  overscan?: number;
  /** Render function for each item. */
  renderItem: (item: T, index: number) => React.ReactNode;
  /** Called when scroll reaches within `threshold`px of the bottom. */
  onEndReached?: () => void;
  endReachedThreshold?: number;
  /** Shown at the bottom while loading more. */
  isLoadingMore?: boolean;
  /** Container className. The container MUST have an explicit height. */
  className?: string;
  /** Empty state element. */
  emptyState?: React.ReactNode;
}

function DefaultEmpty() {
  return (
    <div className="flex flex-col items-center justify-center h-40 text-gray-500 dark:text-gray-400 gap-2">
      <span className="text-2xl">📭</span>
      <p className="text-sm">No items found</p>
    </div>
  );
}

export function VirtualizedList<T>({
  items,
  estimateSize = 80,
  overscan = 5,
  renderItem,
  onEndReached,
  endReachedThreshold = 300,
  isLoadingMore = false,
  className,
  emptyState = <DefaultEmpty />,
}: VirtualizedListProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan,
    // Enable dynamic height measurement
    measureElement:
      typeof window !== 'undefined' && navigator.userAgent.indexOf('Firefox') === -1
        ? (element) => element?.getBoundingClientRect().height
        : undefined,
  });

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      if (!onEndReached) return;
      const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
      if (scrollHeight - scrollTop - clientHeight < endReachedThreshold) {
        onEndReached();
      }
    },
    [onEndReached, endReachedThreshold]
  );

  if (items.length === 0) {
    return <div className={className}>{emptyState}</div>;
  }

  return (
    <div
      ref={parentRef}
      onScroll={handleScroll}
      className={clsx('overflow-auto', className)}
      style={{ scrollBehavior: 'smooth' }}
    >
      {/* Total height spacer */}
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            ref={virtualizer.measureElement}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            {renderItem(items[virtualRow.index], virtualRow.index)}
          </div>
        ))}
      </div>

      {/* Infinite scroll loading indicator */}
      <AnimatePresence>
        {isLoadingMore && (
          <motion.div
            className="flex justify-center py-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="flex gap-1.5">
              {[0, 1, 2].map((i) => (
                <motion.div
                  key={i}
                  className="w-2 h-2 bg-indigo-500 rounded-full"
                  animate={{ y: [0, -6, 0] }}
                  transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15 }}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
