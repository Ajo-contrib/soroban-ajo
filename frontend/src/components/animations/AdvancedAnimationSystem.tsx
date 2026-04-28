'use client';

/**
 * Advanced Animation System (#752)
 *
 * Exports:
 * - ScrollReveal      — reveal on scroll (IntersectionObserver)
 * - GestureCard       — drag + swipe gesture card
 * - LoadingPulse      — skeleton loading animation
 * - SuccessFlare      — success micro-interaction
 * - ErrorShake        — error shake feedback
 * - StaggerGrid       — staggered grid entrance
 * - CountUp           — animated number counter
 */

import React, {
  useRef,
  useEffect,
  useState,
  useCallback,
  ReactNode,
} from 'react';
import {
  motion,
  AnimatePresence,
  useMotionValue,
  useTransform,
  animate,
  type Variants,
} from 'framer-motion';
import { useMotionPreference } from '@/hooks/useMotionPreference';

// ── Variants ──────────────────────────────────────────────────────────────────

const revealVariants: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, ease: [0.22, 0.61, 0.36, 1] },
  },
};

const shakeVariants: Variants = {
  idle: { x: 0 },
  shake: {
    x: [0, -8, 8, -6, 6, -4, 4, 0],
    transition: { duration: 0.45, ease: 'easeInOut' },
  },
};

const staggerContainerVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08 } },
};

const staggerItemVariants: Variants = {
  hidden: { opacity: 0, y: 16, scale: 0.96 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.35, ease: 'easeOut' },
  },
};

// ── ScrollReveal ──────────────────────────────────────────────────────────────

interface ScrollRevealProps {
  children: ReactNode;
  threshold?: number;
  className?: string;
  delay?: number;
}

export function ScrollReveal({
  children,
  threshold = 0.15,
  className,
  delay = 0,
}: ScrollRevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const reducedMotion = useMotionPreference();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);

  if (reducedMotion) return <div className={className}>{children}</div>;

  return (
    <motion.div
      ref={ref}
      className={className}
      variants={revealVariants}
      initial="hidden"
      animate={visible ? 'visible' : 'hidden'}
      transition={{ delay }}
    >
      {children}
    </motion.div>
  );
}

// ── GestureCard ───────────────────────────────────────────────────────────────

interface GestureCardProps {
  children: ReactNode;
  className?: string;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
}

export function GestureCard({
  children,
  className,
  onSwipeLeft,
  onSwipeRight,
}: GestureCardProps) {
  const reducedMotion = useMotionPreference();
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-150, 150], [-12, 12]);
  const opacity = useTransform(x, [-100, 0, 100], [0.5, 1, 0.5]);

  const handleDragEnd = useCallback(
    (_: unknown, info: { offset: { x: number } }) => {
      if (info.offset.x < -80 && onSwipeLeft) {
        onSwipeLeft();
        animate(x, -300, { duration: 0.25 });
      } else if (info.offset.x > 80 && onSwipeRight) {
        onSwipeRight();
        animate(x, 300, { duration: 0.25 });
      } else {
        animate(x, 0, { type: 'spring', stiffness: 400, damping: 30 });
      }
    },
    [x, onSwipeLeft, onSwipeRight]
  );

  if (reducedMotion) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      style={{ x, rotate, opacity, cursor: 'grab' }}
      drag="x"
      dragConstraints={{ left: -150, right: 150 }}
      dragElastic={0.15}
      onDragEnd={handleDragEnd}
      whileTap={{ cursor: 'grabbing', scale: 0.98 }}
    >
      {children}
    </motion.div>
  );
}

// ── LoadingPulse ──────────────────────────────────────────────────────────────

interface LoadingPulseProps {
  lines?: number;
  className?: string;
}

export function LoadingPulse({ lines = 3, className }: LoadingPulseProps) {
  return (
    <div className={className} aria-busy="true" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => (
        <motion.div
          key={i}
          className="h-4 bg-gray-200 dark:bg-gray-700 rounded mb-3"
          style={{ width: `${90 - i * 12}%` }}
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{
            duration: 1.4,
            repeat: Infinity,
            ease: 'easeInOut',
            delay: i * 0.15,
          }}
        />
      ))}
    </div>
  );
}

// ── SuccessFlare ──────────────────────────────────────────────────────────────

interface SuccessFlareProps {
  visible: boolean;
  message?: string;
  onDone?: () => void;
}

export function SuccessFlare({ visible, message = 'Done!', onDone }: SuccessFlareProps) {
  return (
    <AnimatePresence onExitComplete={onDone}>
      {visible && (
        <motion.div
          className="flex flex-col items-center gap-3 py-6"
          initial={{ opacity: 0, scale: 0.7 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          transition={{ type: 'spring', stiffness: 400, damping: 22 }}
        >
          <motion.svg
            width="56"
            height="56"
            viewBox="0 0 56 56"
            fill="none"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
          >
            <circle cx="28" cy="28" r="26" stroke="#22c55e" strokeWidth="3" fill="#dcfce7" />
            <motion.path
              d="M17 28l8 8 14-14"
              stroke="#16a34a"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ delay: 0.15, duration: 0.4 }}
            />
          </motion.svg>
          <motion.p
            className="text-green-700 font-semibold"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            {message}
          </motion.p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── ErrorShake ────────────────────────────────────────────────────────────────

interface ErrorShakeProps {
  children: ReactNode;
  shake: boolean;
  className?: string;
}

export function ErrorShake({ children, shake, className }: ErrorShakeProps) {
  return (
    <motion.div
      className={className}
      variants={shakeVariants}
      animate={shake ? 'shake' : 'idle'}
    >
      {children}
    </motion.div>
  );
}

// ── StaggerGrid ───────────────────────────────────────────────────────────────

interface StaggerGridProps {
  children: ReactNode;
  className?: string;
}

export function StaggerGrid({ children, className }: StaggerGridProps) {
  const reducedMotion = useMotionPreference();

  if (reducedMotion) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      variants={staggerContainerVariants}
      initial="hidden"
      animate="visible"
    >
      {React.Children.map(children, (child) => (
        <motion.div variants={staggerItemVariants}>{child}</motion.div>
      ))}
    </motion.div>
  );
}

// ── CountUp ───────────────────────────────────────────────────────────────────

interface CountUpProps {
  to: number;
  from?: number;
  duration?: number;
  className?: string;
  format?: (n: number) => string;
}

export function CountUp({
  to,
  from = 0,
  duration = 1.2,
  className,
  format = (n) => Math.round(n).toLocaleString(),
}: CountUpProps) {
  const [display, setDisplay] = useState(format(from));
  const reducedMotion = useMotionPreference();

  useEffect(() => {
    if (reducedMotion) {
      setDisplay(format(to));
      return;
    }
    const start = performance.now();
    let frame: number;
    const tick = (now: number) => {
      const progress = Math.min((now - start) / (duration * 1000), 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out-cubic
      setDisplay(format(from + (to - from) * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [to, from, duration, format, reducedMotion]);

  return <span className={className}>{display}</span>;
}
