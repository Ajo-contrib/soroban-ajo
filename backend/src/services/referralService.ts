import { PrismaClient } from '@prisma/client'
import { ReferralCodeGenerator } from '../utils/ReferralCodeGenerator'
import type { ReferralMetadata } from './FraudDetector'

// Local type alias since Referral model may not be in the generated Prisma client
type Referral = Record<string, any>

export interface ReferralRewardDistributor {
  distributeReferralReward(referrerId: string, refereeId: string): Promise<void>
}

export interface ReferralFraudDetector {
  checkReferral(
    referrerId: string,
    refereeId: string,
    metadata: ReferralMetadata
  ): Promise<{
    flags: Array<{
      type: string
      details: unknown
    }>
    shouldBlock: boolean
  }>
}

export interface ReferralAnalyticsTracker {
  saveEvent(type: string, data: Record<string, unknown>): Promise<void>
}

export interface ReferralStats {
  referralCode: string | null;
  totalReferrals: number;
  activeReferrals: number;
  pendingReferrals: number;
  completedReferrals: number;
  flaggedReferrals: number;
  conversionRate: number;
  totalRewardsEarned: number;
  referrals: Array<{
    id: string;
    refereeId: string;
    referralCode: string;
    status: string;
    createdAt: Date;
    completedAt?: Date | null;
  }>;
}

export interface ReferralAnalytics {
  summary: {
    totalReferrals: number
    completedReferrals: number
    pendingReferrals: number
    flaggedReferrals: number
    conversionRate: number
  }
  statusBreakdown: Array<{
    status: string
    count: number
  }>
  timeline: Array<{
    date: string
    referrals: number
    completions: number
  }>
}

export interface CreateReferralInput {
  referrerId: string
  refereeId: string
  code: string
  metadata?: ReferralMetadata
}

/**
 * Service for managing referral codes and relationships
 */
export class ReferralService {
  constructor(
    private prisma: PrismaClient,
    private rewardDistributor?: ReferralRewardDistributor,
    private fraudDetector?: ReferralFraudDetector,
    private analyticsTracker?: ReferralAnalyticsTracker
  ) {}

  /**
   * Generates a new unique referral code for a user, or retrieves their existing one.
   * 
   * @param userId - The user's wallet address
   * @returns Promise resolving to the user's referral code
   */
  async generateReferralCode(userId: string): Promise<string> {
    // Check if user already has a referral code
    const existing = await this.prisma.referralCode.findUnique({
      where: { userId },
    })

    if (existing) {
      return existing.code
    }

    // Generate new unique code
    const code = await ReferralCodeGenerator.generateUnique(this.prisma)

    // Store the code
    await this.prisma.referralCode.create({
      data: {
        userId,
        code,
      },
    })

    return code
  }

  /**
   * Retrieves an existing referral code for a user if one has been generated.
   * 
   * @param userId - The user's wallet address
   * @returns Promise resolving to the referral code or null if not found
   */
  async getReferralCode(userId: string): Promise<string | null> {
    const referralCode = await this.prisma.referralCode.findUnique({
      where: { userId },
    })

    return referralCode?.code || null
  }

  /**
   * Validate if a referral code exists
   * @param code - Referral code to validate
   * @returns true if code exists and is valid
   */
  async validateReferralCode(code: string): Promise<boolean> {
    // First check format
    if (!ReferralCodeGenerator.isValidFormat(code)) {
      return false
    }

    // Check if code exists in database
    const referralCode = await this.prisma.referralCode.findUnique({
      where: { code },
    })

    return referralCode !== null
  }

  /**
   * Get referrer user ID by referral code
   * @param code - Referral code
   * @returns Referrer's user ID or null if not found
   */
  async getReferrerByCode(code: string): Promise<string | null> {
    const referralCode = await this.prisma.referralCode.findUnique({
      where: { code },
      select: { userId: true },
    })

    return referralCode?.userId || null
  }

  /**
   * Establishes a new referral relationship between two users.
   * Includes fraud detection checks and updates gamification stats.
   * 
   * @param input - The referral creation data (referrer, referee, code)
   * @returns Promise resolving to the created referral record
   * @throws {Error} If self-referral, duplicate referral, or invalid code
   */
  async createReferral(input: CreateReferralInput): Promise<Referral> {
    const { referrerId, refereeId, code, metadata } = input
    // Validate: Cannot refer yourself
    if (referrerId === refereeId) {
      throw new Error('Cannot refer yourself')
    }

    // Validate: Referee can only be referred once
    const existingReferral = await this.prisma.referral.findUnique({
      where: { refereeId },
    })

    if (existingReferral) {
      throw new Error('User has already been referred')
    }

    // Validate: Referral code must exist and belong to referrer
    const referralCode = await this.prisma.referralCode.findUnique({
      where: { code },
    })

    if (!referralCode) {
      throw new Error('Invalid referral code')
    }

    if (referralCode.userId !== referrerId) {
      throw new Error('Referral code does not belong to referrer')
    }

    let initialStatus = 'PENDING'
    let cachedFraudCheck: { flags: Array<{ type: string; details: unknown }>; shouldBlock: boolean } | null = null

    if (metadata && this.fraudDetector) {
      cachedFraudCheck = await this.fraudDetector.checkReferral(referrerId, refereeId, metadata)
      if (cachedFraudCheck.shouldBlock) {
        initialStatus = 'FLAGGED'
      }
    }

    // Create referral relationship
    const referral = await this.prisma.referral.create({
      data: {
        referrerId,
        refereeId,
        referralCode: code,
        status: initialStatus,
      },
    })

    // Persist flags using the already-computed fraud check (no second call)
    if (cachedFraudCheck) {
      for (const flag of cachedFraudCheck.flags) {
        await this.prisma.fraudFlag.create({
          data: {
            referralId: referral.id,
            flagType: flag.type,
            severity: cachedFraudCheck.shouldBlock ? 'HIGH' : 'MEDIUM',
            details: JSON.stringify(flag.details ?? {}),
            status: 'PENDING',
          },
        })
      }
    }

    // Increment referrer's total invites in gamification
    await this.prisma.userGamification.upsert({
      where: { userId: referrerId },
      update: {
        totalInvites: { increment: 1 },
      },
      create: {
        userId: referrerId,
        totalInvites: 1,
      },
    })

    await this.trackEvent('referral_created', {
      referrerId,
      refereeId,
      referralId: referral.id,
      status: referral.status,
    })

    return referral
  }

  /**
   * Marks a referral as completed and triggers reward distribution.
   * Typically called when a referee makes their first contribution.
   * 
   * @param refereeId - The wallet address of the referred user
   * @returns Promise resolving to the updated referral record or null
   */
  async completeReferral(refereeId: string): Promise<Referral | null> {
    const referral = await this.prisma.referral.findUnique({
      where: { refereeId },
    })

    if (!referral) {
      return null
    }

    if (referral.status === 'COMPLETED') {
      return referral
    }

    if (referral.status === 'FLAGGED') {
      return referral
    }

    // Update referral status
    const completedReferral = await this.prisma.referral.update({
      where: { id: referral.id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    })

    if (this.rewardDistributor) {
      try {
        await this.rewardDistributor.distributeReferralReward(
          completedReferral.referrerId,
          completedReferral.refereeId
        )
      } catch {
        // Reward configuration can be absent in local/test environments.
      }
    }

    await this.trackEvent('referral_completed', {
      referralId: completedReferral.id,
      referrerId: completedReferral.referrerId,
      refereeId: completedReferral.refereeId,
    })

    return completedReferral
  }

  /**
   * Get referral statistics for a user
   * @param userId - User's wallet address
   * @returns Referral statistics
   */
  async getReferralStats(userId: string): Promise<ReferralStats> {
    const referrals = await this.prisma.referral.findMany({
      where: { referrerId: userId },
      select: {
        id: true,
        refereeId: true,
        referralCode: true,
        status: true,
        createdAt: true,
        completedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    })

    const referralCode = await this.getReferralCode(userId)
    const rewardCount = await this.prisma.reward.count({
      where: {
        userId,
        source: 'REFERRAL',
      },
    })

    const totalReferrals = referrals.length
    const activeReferrals = referrals.filter((r: any) => r.status === 'ACTIVE').length
    const pendingReferrals = referrals.filter((r: any) => r.status === 'PENDING').length
    const completedReferrals = referrals.filter((r: any) => r.status === 'COMPLETED').length
    const flaggedReferrals = referrals.filter((r: any) => r.status === 'FLAGGED').length
    const conversionRate = totalReferrals === 0 ? 0 : completedReferrals / totalReferrals

    return {
      referralCode,
      totalReferrals,
      activeReferrals,
      pendingReferrals,
      completedReferrals,
      flaggedReferrals,
      conversionRate,
      totalRewardsEarned: rewardCount,
      referrals,
    }
  }

  /**
   * Get referral count for a user (optionally filtered by status)
   * @param userId - User's wallet address
   * @param status - Optional status filter
   * @returns Count of referrals
   */
  async getReferralCount(userId: string, status?: string): Promise<number> {
    return this.prisma.referral.count({
      where: {
        referrerId: userId,
        ...(status && { status }),
      },
    })
  }

  async getReferralAnalytics(userId: string): Promise<ReferralAnalytics> {
    const referrals = await this.prisma.referral.findMany({
      where: { referrerId: userId },
      select: {
        status: true,
        createdAt: true,
        completedAt: true,
      },
      orderBy: { createdAt: 'asc' },
    })

    const dailyMap = new Map<string, { referrals: number; completions: number }>()
    for (const referral of referrals) {
      const createdKey = referral.createdAt.toISOString().slice(0, 10)
      const createdEntry = dailyMap.get(createdKey) ?? { referrals: 0, completions: 0 }
      createdEntry.referrals += 1
      dailyMap.set(createdKey, createdEntry)

      if (referral.completedAt) {
        const completedKey = referral.completedAt.toISOString().slice(0, 10)
        const completedEntry = dailyMap.get(completedKey) ?? { referrals: 0, completions: 0 }
        completedEntry.completions += 1
        dailyMap.set(completedKey, completedEntry)
      }
    }

    const statusBreakdown = ['PENDING', 'ACTIVE', 'COMPLETED', 'FLAGGED'].map((status) => ({
      status,
      count: referrals.filter((referral: any) => referral.status === status).length,
    }))

    const totalReferrals = referrals.length
    const completedReferrals = statusBreakdown.find((entry) => entry.status === 'COMPLETED')?.count ?? 0
    const pendingReferrals = statusBreakdown.find((entry) => entry.status === 'PENDING')?.count ?? 0
    const flaggedReferrals = statusBreakdown.find((entry) => entry.status === 'FLAGGED')?.count ?? 0

    return {
      summary: {
        totalReferrals,
        completedReferrals,
        pendingReferrals,
        flaggedReferrals,
        conversionRate: totalReferrals === 0 ? 0 : completedReferrals / totalReferrals,
      },
      statusBreakdown,
      timeline: Array.from(dailyMap.entries()).map(([date, values]) => ({
        date,
        referrals: values.referrals,
        completions: values.completions,
      })),
    }
  }

  async getReferralLeaderboard(limit = 10) {
    const grouped = await this.prisma.referral.groupBy({
      by: ['referrerId'],
      _count: {
        referrerId: true,
      },
      where: {
        status: {
          in: ['PENDING', 'ACTIVE', 'COMPLETED'],
        },
      },
      orderBy: {
        _count: {
          referrerId: 'desc',
        },
      },
      take: limit,
    })

    return Promise.all(
      grouped.map(async (entry: any, index: number) => {
        const completedReferrals = await this.prisma.referral.count({
          where: {
            referrerId: entry.referrerId,
            status: 'COMPLETED',
          },
        })

        return {
          rank: index + 1,
          userId: entry.referrerId,
          totalReferrals: entry._count.referrerId,
          completedReferrals,
        }
      })
    )
  }

  private async trackEvent(type: string, data: Record<string, unknown>): Promise<void> {
    if (!this.analyticsTracker) {
      return
    }

    await this.analyticsTracker.saveEvent(type, {
      category: 'referral',
      ...data,
    })
  }
}
