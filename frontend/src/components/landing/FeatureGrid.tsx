'use client'

import React from 'react'
import { motion } from 'framer-motion'

const features = [
  {
    icon: '🔒',
    title: 'Fully Transparent',
    description: 'Every transaction is recorded on the Stellar blockchain — no hidden fees, no surprises.',
    gradient: 'from-indigo-500 to-purple-600',
  },
  {
    icon: '⚡',
    title: 'Instant Payouts',
    description: "Receive your payout in seconds with Stellar's fast settlement network.",
    gradient: 'from-pink-500 to-rose-600',
  },
  {
    icon: '🌍',
    title: 'Global Access',
    description: 'Join savings groups from anywhere in the world with just a Stellar wallet.',
    gradient: 'from-amber-500 to-orange-600',
  },
  {
    icon: '🤝',
    title: 'Community Driven',
    description: 'Groups are governed by members — set your own rules, cycles, and contribution amounts.',
    gradient: 'from-teal-500 to-cyan-600',
  },
  {
    icon: '📊',
    title: 'Rich Analytics',
    description: 'Track your savings progress, group performance, and contribution history in real time.',
    gradient: 'from-violet-500 to-purple-600',
  },
  {
    icon: '🛡️',
    title: 'Dispute Resolution',
    description: 'Built-in arbitration system ensures fair outcomes for all group members.',
    gradient: 'from-emerald-500 to-teal-600',
  },
]

const container = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.1 } },
}

const card = {
  hidden: { opacity: 0, y: 40 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' } },
}

export const FeatureGrid: React.FC = () => (
  <section className="py-24 px-4 bg-slate-950">
    <div className="max-w-6xl mx-auto">
      <motion.div
        className="text-center mb-16"
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.6 }}
      >
        <h2 className="text-3xl md:text-5xl font-extrabold text-white mb-4">
          Everything you need to save smarter
        </h2>
        <p className="text-white/50 text-lg max-w-2xl mx-auto">
          Built on Stellar blockchain with modern UX — powerful features without the complexity.
        </p>
      </motion.div>

      <motion.div
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
        variants={container}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: '-60px' }}
      >
        {features.map(({ icon, title, description, gradient }) => (
          <motion.div
            key={title}
            variants={card}
            className="relative overflow-hidden rounded-2xl bg-white/5 border border-white/10 p-6 hover:bg-white/10 transition-colors duration-300 group"
            whileHover={{ y: -4 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          >
            <div className={`absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r ${gradient} opacity-60 group-hover:opacity-100 transition-opacity`} />
            <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center text-2xl mb-4`}>
              {icon}
            </div>
            <h3 className="text-white font-bold text-lg mb-2">{title}</h3>
            <p className="text-white/50 text-sm leading-relaxed">{description}</p>
          </motion.div>
        ))}
      </motion.div>
    </div>
  </section>
)
