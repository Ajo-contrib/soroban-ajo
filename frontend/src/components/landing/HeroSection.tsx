'use client'

import React from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: (delay = 0) => ({ opacity: 1, y: 0, transition: { duration: 0.6, delay, ease: 'easeOut' } }),
}

export const HeroSection: React.FC = () => (
  <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
    {/* Gradient background */}
    <div className="absolute inset-0 bg-gradient-to-br from-purple-600 via-pink-500 to-orange-400" />

    {/* Animated blobs */}
    <motion.div
      className="absolute top-20 left-20 w-72 h-72 bg-purple-300 rounded-full mix-blend-multiply filter blur-xl opacity-70"
      animate={{ scale: [1, 1.2, 1], x: [0, 20, 0], y: [0, -20, 0] }}
      transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
    />
    <motion.div
      className="absolute top-40 right-20 w-72 h-72 bg-yellow-300 rounded-full mix-blend-multiply filter blur-xl opacity-70"
      animate={{ scale: [1, 1.15, 1], x: [0, -20, 0], y: [0, 20, 0] }}
      transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
    />
    <motion.div
      className="absolute bottom-20 left-1/2 w-72 h-72 bg-pink-300 rounded-full mix-blend-multiply filter blur-xl opacity-70"
      animate={{ scale: [1, 1.1, 1], x: [0, 15, 0] }}
      transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut', delay: 4 }}
    />

    {/* Grid overlay */}
    <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSAwIDEwIEwgNDAgMTAgTSAxMCAwIEwgMTAgNDAgTSAwIDIwIEwgNDAgMjAgTSAyMCAwIEwgMjAgNDAgTSAwIDMwIEwgNDAgMzAgTSAzMCAwIEwgMzAgNDAiIGZpbGw9Im5vbmUiIHN0cm9rZT0id2hpdGUiIHN0cm9rZS13aWR0aD0iMC4yIiBvcGFjaXR5PSIwLjMiLz48L3BhdHRlcm4+PC9kZWZzPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9InVybCgjZ3JpZCkiLz48L3N2Zz4=')] opacity-30" />

    {/* Content */}
    <div className="relative z-10 text-center px-4 max-w-5xl mx-auto">
      <motion.div
        className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/20 backdrop-blur-sm border border-white/30 text-white text-sm font-medium mb-8"
        variants={fadeUp}
        initial="hidden"
        animate="visible"
        custom={0}
      >
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        Powered by Stellar Blockchain
      </motion.div>

      <motion.h1
        className="text-5xl md:text-7xl lg:text-8xl font-extrabold text-white mb-6 leading-tight"
        variants={fadeUp}
        initial="hidden"
        animate="visible"
        custom={0.15}
      >
        Save Together,
        <span className="block bg-gradient-to-r from-yellow-200 to-pink-200 bg-clip-text text-transparent">
          Grow Together
        </span>
      </motion.h1>

      <motion.p
        className="text-lg md:text-xl text-white/90 mb-10 max-w-2xl mx-auto leading-relaxed"
        variants={fadeUp}
        initial="hidden"
        animate="visible"
        custom={0.3}
      >
        Join decentralized savings groups powered by Stellar blockchain. Transparent, secure, and community-driven.
      </motion.p>

      <motion.div
        className="flex flex-col sm:flex-row gap-4 justify-center"
        variants={fadeUp}
        initial="hidden"
        animate="visible"
        custom={0.45}
      >
        <Link
          href="/dashboard"
          className="bg-white text-purple-600 px-8 py-4 rounded-full font-bold text-lg hover:scale-105 transition-transform shadow-2xl"
        >
          Get Started Free
        </Link>
        <Link
          href="/groups"
          className="bg-white/20 backdrop-blur-sm text-white border border-white/30 px-8 py-4 rounded-full font-bold text-lg hover:bg-white/30 transition-colors"
        >
          Explore Groups
        </Link>
      </motion.div>

      {/* Inline stats */}
      <motion.div
        className="mt-16 flex flex-col sm:flex-row items-center justify-center gap-8 text-white/80"
        variants={fadeUp}
        initial="hidden"
        animate="visible"
        custom={0.6}
      >
        {[
          { value: '10K+', label: 'Active Members' },
          { value: '$2M+', label: 'Total Saved' },
          { value: '500+', label: 'Groups Created' },
        ].map(({ value, label }) => (
          <div key={label} className="text-center">
            <p className="text-3xl font-extrabold text-white">{value}</p>
            <p className="text-sm text-white/60">{label}</p>
          </div>
        ))}
      </motion.div>
    </div>

    {/* Scroll indicator */}
    <motion.div
      className="absolute bottom-8 left-1/2 -translate-x-1/2"
      animate={{ y: [0, 8, 0] }}
      transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
    >
      <svg className="w-6 h-6 text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    </motion.div>
  </section>
)
