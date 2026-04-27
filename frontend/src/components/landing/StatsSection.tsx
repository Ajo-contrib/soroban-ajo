'use client'

import React, { useEffect, useRef, useState } from 'react'
import { motion, useInView } from 'framer-motion'

const stats = [
  { end: 10000, suffix: '+', label: 'Active Members', icon: '👥' },
  { end: 2, prefix: '$', suffix: 'M+', label: 'Total Saved', icon: '💰' },
  { end: 500, suffix: '+', label: 'Groups Created', icon: '🏦' },
  { end: 99.9, suffix: '%', label: 'Uptime', icon: '⚡', decimals: 1 },
]

function CountUp({ end, prefix = '', suffix = '', decimals = 0 }: { end: number; prefix?: string; suffix?: string; decimals?: number }) {
  const [count, setCount] = useState(0)
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true })

  useEffect(() => {
    if (!inView) return
    const duration = 1800
    const start = performance.now()
    const frame = (now: number) => {
      const progress = Math.min((now - start) / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setCount(parseFloat((eased * end).toFixed(decimals)))
      if (progress < 1) requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  }, [inView, end, decimals])

  return (
    <span ref={ref}>
      {prefix}{count.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{suffix}
    </span>
  )
}

export const StatsSection: React.FC = () => (
  <section className="py-16 px-4 bg-gradient-to-r from-indigo-900 to-purple-900 border-y border-white/10">
    <div className="max-w-5xl mx-auto">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
        {stats.map(({ end, prefix, suffix, label, icon, decimals }, i) => (
          <motion.div
            key={label}
            className="text-center"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: i * 0.1 }}
          >
            <div className="text-3xl mb-2">{icon}</div>
            <p className="text-3xl md:text-4xl font-extrabold text-white mb-1">
              <CountUp end={end} prefix={prefix} suffix={suffix} decimals={decimals} />
            </p>
            <p className="text-white/50 text-sm">{label}</p>
          </motion.div>
        ))}
      </div>
    </div>
  </section>
)
