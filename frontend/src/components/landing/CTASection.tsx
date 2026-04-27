'use client'

import React from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'

export const CTASection: React.FC = () => (
  <section className="py-24 px-4 bg-slate-950">
    <div className="max-w-4xl mx-auto text-center">
      <motion.div
        className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-purple-600 via-pink-500 to-orange-400 p-12"
        initial={{ opacity: 0, scale: 0.95 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
      >
        {/* Blobs */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-white rounded-full filter blur-3xl opacity-10" />
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-yellow-300 rounded-full filter blur-3xl opacity-20" />

        <div className="relative z-10">
          <motion.h2
            className="text-3xl md:text-5xl font-extrabold text-white mb-4"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.15 }}
          >
            Ready to start saving?
          </motion.h2>

          <motion.p
            className="text-white/80 text-lg mb-8 max-w-xl mx-auto"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.25 }}
          >
            Join thousands of communities already using Ajo to build financial security together.
          </motion.p>

          <motion.div
            className="flex flex-col sm:flex-row gap-4 justify-center"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.35 }}
          >
            <Link
              href="/dashboard"
              className="bg-white text-purple-600 px-8 py-4 rounded-full font-bold text-lg hover:scale-105 transition-transform shadow-xl"
            >
              Start Saving Today
            </Link>
            <Link
              href="/groups"
              className="bg-white/20 backdrop-blur-sm text-white border border-white/30 px-8 py-4 rounded-full font-bold text-lg hover:bg-white/30 transition-colors"
            >
              Browse Groups
            </Link>
          </motion.div>
        </div>
      </motion.div>
    </div>
  </section>
)
