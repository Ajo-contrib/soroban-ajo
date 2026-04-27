import React from 'react'
import { HeroSection } from '@/components/landing/HeroSection'
import { FeatureGrid } from '@/components/landing/FeatureGrid'
import { StatsSection } from '@/components/landing/StatsSection'
import { CTASection } from '@/components/landing/CTASection'
import { SocialProofSection } from '@/components/landing/SocialProofSection'

export default function HomePage() {
  return (
    <main className="bg-slate-950">
      <HeroSection />
      <StatsSection />
      <FeatureGrid />
      <SocialProofSection />
      <CTASection />
    </main>
  )
}
