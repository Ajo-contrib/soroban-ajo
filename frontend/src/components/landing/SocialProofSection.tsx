'use client'

import React from 'react'
import { motion } from 'framer-motion'

const testimonials = [
  {
    name: 'Amara Osei',
    role: 'Group Organizer, Ghana',
    avatar: '🇬🇭',
    quote: 'Ajo transformed how our community saves. The transparency on-chain means everyone trusts the process — no more disputes.',
    rating: 5,
  },
  {
    name: 'Fatima Al-Hassan',
    role: 'Member, Nigeria',
    avatar: '🇳🇬',
    quote: 'I received my payout in seconds. With traditional Ajo it took days. This is the future of community savings.',
    rating: 5,
  },
  {
    name: 'Carlos Mendez',
    role: 'Group Admin, Mexico',
    avatar: '🇲🇽',
    quote: 'The analytics dashboard helps me keep track of every member\'s contributions. Managing 20 people has never been easier.',
    rating: 5,
  },
  {
    name: 'Priya Sharma',
    role: 'Member, India',
    avatar: '🇮🇳',
    quote: 'I love that I can join groups from anywhere. The Stellar wallet integration is seamless and the fees are almost zero.',
    rating: 5,
  },
  {
    name: 'Kwame Asante',
    role: 'Community Leader, Kenya',
    avatar: '🇰🇪',
    quote: 'We\'ve saved over $50,000 as a community in just 6 months. The dispute resolution feature saved us twice already.',
    rating: 5,
  },
  {
    name: 'Sofia Reyes',
    role: 'Organizer, Colombia',
    avatar: '🇨🇴',
    quote: 'Setting up our first group took 5 minutes. The templates are perfect for our rotating savings circle.',
    rating: 5,
  },
]

const container = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08 } },
}

const item = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' } },
}

export const SocialProofSection: React.FC = () => (
  <section className="py-24 px-4 bg-slate-900">
    <div className="max-w-6xl mx-auto">
      <motion.div
        className="text-center mb-16"
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.6 }}
      >
        <p className="text-purple-400 font-semibold text-sm uppercase tracking-widest mb-3">Trusted Worldwide</p>
        <h2 className="text-3xl md:text-5xl font-extrabold text-white mb-4">
          Communities love Ajo
        </h2>
        <p className="text-white/50 text-lg max-w-xl mx-auto">
          Thousands of savings groups across the globe rely on Ajo every day.
        </p>
      </motion.div>

      <motion.div
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
        variants={container}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: '-60px' }}
      >
        {testimonials.map(({ name, role, avatar, quote, rating }) => (
          <motion.div
            key={name}
            variants={item}
            className="rounded-2xl bg-white/5 border border-white/10 p-6 flex flex-col gap-4 hover:bg-white/8 transition-colors"
            whileHover={{ y: -3 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          >
            {/* Stars */}
            <div className="flex gap-0.5">
              {Array.from({ length: rating }).map((_, i) => (
                <span key={i} className="text-yellow-400 text-sm">★</span>
              ))}
            </div>

            <p className="text-white/70 text-sm leading-relaxed flex-1">"{quote}"</p>

            <div className="flex items-center gap-3 pt-2 border-t border-white/10">
              <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-xl">
                {avatar}
              </div>
              <div>
                <p className="text-white font-semibold text-sm">{name}</p>
                <p className="text-white/40 text-xs">{role}</p>
              </div>
            </div>
          </motion.div>
        ))}
      </motion.div>
    </div>
  </section>
)
