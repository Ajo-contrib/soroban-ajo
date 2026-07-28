/**
 * mlFraudDetectionService.ts
 *
 * ML/statistical layer of the unified fraud-detection architecture.
 *
 * Responsibility: detect behavioural anomalies on transactions and contributions
 * using z-score analysis (no external ML library required).  It does NOT make
 * block/pass decisions on its own; that is delegated to FraudOrchestrator, which
 * combines this service with the rule-based FraudDetector.
 *
 * All reads/writes go through an injected PrismaClient so the service can be
 * tested in isolation without touching a real database.
 */

import { PrismaClient } from '@prisma/client'
import { createModuleLogger } from '../utils/logger'

const logger = createModuleLogger('MLFraudDetection')

export type FraudSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
export type AlertStatus = 'OPEN' | 'REVIEWING' | 'RESOLVED' | 'DISMISSED'

export interface TransactionPattern {
  userId: string
  amount: bigint
  groupId: string
  timestamp: Date
  ipAddress?: string
}

export interface FraudAlert {
  id: string
  userId: string
  alertType: string
  severity: FraudSeverity
  score: number
  details: Record<string, unknown>
  status: AlertStatus
  source: string
  fraudFlagId?: string
  resolution?: string
  createdAt: Date
  reviewedAt?: Date
  reviewedBy?: string
}

export interface AnomalyResult {
  isAnomaly: boolean
  score: number
  reasons: string[]
  severity: FraudSeverity
}

// ─── Simple statistical helpers (no external ML lib needed) ──────────────────

function mean(values: number[]): number {
  if (!values.length) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

function stdDev(values: number[], avg: number): number {
  if (values.length < 2) return 0
  const variance = values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / values.length
  return Math.sqrt(variance)
}

function zScore(value: number, avg: number, std: number): number {
  if (std === 0) return 0
  return Math.abs((value - avg) / std)
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class MLFraudDetectionService {
  constructor(private readonly prisma: PrismaClient = new PrismaClient()) {}

  // ─── Pattern Detection ──────────────────────────────────────────────────

  /**
   * Detects suspicious transaction patterns for a user:
   * - Rapid successive transactions (>10 in 1 h)
   * - Unusually large amounts vs. user history (z-score > 3)
   * - Multiple groups joined in a short window (>5 in 1 h)
   */
  async detectPatterns(tx: TransactionPattern): Promise<AnomalyResult> {
    const reasons: string[] = []
    let score = 0

    const windowStart = new Date(tx.timestamp.getTime() - 60 * 60 * 1000) // 1-hour window

    // 1. Rapid transactions
    const recentTxCount = await this.prisma.contribution.count({
      where: { userId: tx.userId, createdAt: { gte: windowStart } },
    })

    if (recentTxCount > 10) {
      reasons.push(`High transaction frequency: ${recentTxCount} in 1h`)
      score += 30
    }

    // 2. Amount anomaly vs. user history
    const history = await this.prisma.contribution.findMany({
      where: { userId: tx.userId },
      select: { amount: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })

    if (history.length >= 5) {
      const amounts = history.map((h) => Number(h.amount))
      const avg = mean(amounts)
      const std = stdDev(amounts, avg)
      const z = zScore(Number(tx.amount), avg, std)

      if (z > 3) {
        reasons.push(`Amount z-score ${z.toFixed(2)} — far above historical average`)
        score += Math.min(40, z * 10)
      }
    }

    // 3. Multiple groups joined recently
    const recentGroups = await this.prisma.groupMember.count({
      where: { userId: tx.userId, joinedAt: { gte: windowStart } },
    })

    if (recentGroups > 5) {
      reasons.push(`Joined ${recentGroups} groups in 1h`)
      score += 20
    }

    const severity = this.scoreToSeverity(score)
    return { isAnomaly: score >= 30, score, reasons, severity }
  }

  // ─── Anomaly Detection ───────────────────────────────────────────────────

  /**
   * Statistical anomaly detection on contribution amounts across all users.
   * Returns users whose most recent contribution deviates significantly from
   * their historical baseline (z-score > 2.5).
   */
  async detectContributionAnomalies(lookbackDays = 30): Promise<
    Array<{ userId: string; score: number; severity: FraudSeverity; reason: string }>
  > {
    const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000)

    const contributions = await this.prisma.contribution.findMany({
      where: { createdAt: { gte: since } },
      select: { userId: true, amount: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    })

    // Group by user
    const byUser = new Map<string, number[]>()
    for (const c of contributions) {
      const arr = byUser.get(c.userId) ?? []
      arr.push(Number(c.amount))
      byUser.set(c.userId, arr)
    }

    const results: Array<{ userId: string; score: number; severity: FraudSeverity; reason: string }> = []

    for (const [userId, amounts] of byUser) {
      if (amounts.length < 3) continue
      const baseline = amounts.slice(0, -1)
      const latest = amounts[amounts.length - 1]
      const avg = mean(baseline)
      const std = stdDev(baseline, avg)
      const z = zScore(latest, avg, std)

      if (z > 2.5) {
        const score = Math.min(100, z * 15)
        results.push({
          userId,
          score,
          severity: this.scoreToSeverity(score),
          reason: `Latest contribution z-score ${z.toFixed(2)} vs. baseline`,
        })
      }
    }

    return results.sort((a, b) => b.score - a.score)
  }

  // ─── Alert System ────────────────────────────────────────────────────────

  /**
   * Persists a new fraud alert and auto-escalates CRITICAL ones.
   * Called by analyzeTransaction() and by FraudOrchestrator for ensemble alerts.
   */
  async createAlert(
    userId: string,
    alertType: string,
    severity: FraudSeverity,
    score: number,
    details: Record<string, unknown>,
    options: { source?: string; fraudFlagId?: string } = {}
  ): Promise<FraudAlert> {
    const alert = await this.prisma.fraudAlert.create({
      data: {
        userId,
        alertType,
        severity,
        score,
        details: JSON.stringify(details),
        status: 'OPEN',
        source: options.source ?? 'ML',
        ...(options.fraudFlagId ? { fraudFlagId: options.fraudFlagId } : {}),
      },
    })

    logger.warn('Fraud alert created', { alertId: alert.id, userId, alertType, severity, score })

    // Auto-escalate critical alerts for immediate human review
    if (severity === 'CRITICAL') {
      await this.escalateAlert(alert.id)
    }

    return this.mapAlert(alert)
  }

  async escalateAlert(alertId: string): Promise<void> {
    await this.prisma.fraudAlert.update({
      where: { id: alertId },
      data: { status: 'REVIEWING' },
    })
    logger.error('CRITICAL fraud alert escalated for immediate review', { alertId })
  }

  async listAlerts(params: {
    status?: AlertStatus
    severity?: FraudSeverity
    userId?: string
    page?: number
    limit?: number
  }): Promise<{ alerts: FraudAlert[]; total: number }> {
    const { page = 1, limit = 20 } = params
    const where: Record<string, unknown> = {}
    if (params.status) where.status = params.status
    if (params.severity) where.severity = params.severity
    if (params.userId) where.userId = params.userId

    const [raw, total] = await Promise.all([
      this.prisma.fraudAlert.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.fraudAlert.count({ where }),
    ])

    return { alerts: (raw ?? []).map(this.mapAlert), total: total ?? 0 }
  }

  // ─── Manual Review ───────────────────────────────────────────────────────

  async reviewAlert(
    alertId: string,
    reviewerId: string,
    status: 'RESOLVED' | 'DISMISSED',
    resolution: string
  ): Promise<FraudAlert> {
    const alert = await this.prisma.fraudAlert.update({
      where: { id: alertId },
      data: { status, reviewedAt: new Date(), reviewedBy: reviewerId, resolution },
    })

    logger.info('Fraud alert reviewed', { alertId, reviewerId, status })
    return this.mapAlert(alert)
  }

  async getPendingReviews(limit = 50): Promise<FraudAlert[]> {
    const raw = await this.prisma.fraudAlert.findMany({
      where: { status: { in: ['OPEN', 'REVIEWING'] } },
      orderBy: [{ severity: 'desc' }, { createdAt: 'asc' }],
      take: limit,
    })
    return (raw ?? []).map(this.mapAlert)
  }

  /**
   * Run full ML fraud analysis on a transaction and auto-create an alert if anomalous.
   * This is the primary entry point for transaction-time checks.
   */
  async analyzeTransaction(tx: TransactionPattern): Promise<AnomalyResult> {
    const result = await this.detectPatterns(tx)

    if (result.isAnomaly) {
      await this.createAlert(tx.userId, 'TRANSACTION_ANOMALY', result.severity, result.score, {
        reasons: result.reasons,
        amount: tx.amount.toString(),
        groupId: tx.groupId,
        ipAddress: tx.ipAddress,
      })
    }

    return result
  }

  // ─── Feedback Loop ───────────────────────────────────────────────────────

  /**
   * Record a confirmed false positive or false negative from admin review.
   * This creates an audit trail that can be used to periodically recalibrate
   * detection thresholds (z-score cutoffs, frequency limits, etc.).
   *
   * @param alertId    - The alert being corrected
   * @param outcome    - 'FALSE_POSITIVE' | 'FALSE_NEGATIVE'
   * @param reviewerId - Admin performing the correction
   * @param notes      - Free-text explanation of why it was wrong
   */
  async recordFeedback(
    alertId: string,
    outcome: 'FALSE_POSITIVE' | 'FALSE_NEGATIVE',
    reviewerId: string,
    notes: string
  ): Promise<void> {
    const resolution = `[${outcome}] ${notes}`
    const status = outcome === 'FALSE_POSITIVE' ? 'DISMISSED' : 'RESOLVED'
    await this.prisma.fraudAlert.update({
      where: { id: alertId },
      data: {
        status,
        reviewedAt: new Date(),
        reviewedBy: reviewerId,
        resolution,
      },
    })
    logger.info('Fraud feedback recorded', { alertId, outcome, reviewerId })
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  scoreToSeverity(score: number): FraudSeverity {
    if (score >= 80) return 'CRITICAL'
    if (score >= 60) return 'HIGH'
    if (score >= 30) return 'MEDIUM'
    return 'LOW'
  }

  private mapAlert(raw: any): FraudAlert {
    return {
      id: raw.id,
      userId: raw.userId,
      alertType: raw.alertType,
      severity: raw.severity as FraudSeverity,
      score: raw.score,
      details: typeof raw.details === 'string' ? JSON.parse(raw.details) : (raw.details ?? {}),
      status: raw.status as AlertStatus,
      source: raw.source ?? 'ML',
      fraudFlagId: raw.fraudFlagId ?? undefined,
      resolution: raw.resolution ?? undefined,
      createdAt: raw.createdAt,
      reviewedAt: raw.reviewedAt ?? undefined,
      reviewedBy: raw.reviewedBy ?? undefined,
    }
  }
}

/** Singleton for use in non-injected contexts (routes, cron jobs).
 *  Prefer constructor injection in tests and new service code. */
export const mlFraudDetectionService = new MLFraudDetectionService()
