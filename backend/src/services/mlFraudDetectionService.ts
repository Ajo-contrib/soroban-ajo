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
  contractAddress?: string
  tenantId?: string
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
  modelVersionId?: string
  fraudFlagId?: string
  contractAddress?: string
  tenantId?: string
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

export interface FraudModelParameters {
  anomalyThreshold: number
}

export interface FraudModelRetrainingResult {
  modelId: string
  activated: boolean
  trainingExamples: number
  validationExamples: number
  candidateF1: number
  activeF1: number
}

const DEFAULT_MODEL_ID = 'fraud-statistical-v1'
const DEFAULT_MODEL_PARAMETERS: FraudModelParameters = { anomalyThreshold: 30 }

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
  async detectPatterns(
    tx: TransactionPattern,
    modelParameters?: FraudModelParameters
  ): Promise<AnomalyResult> {
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

    const model = modelParameters ?? (await this.getActiveModel()).parameters
    const severity = this.scoreToSeverity(score)
    return { isAnomaly: score >= model.anomalyThreshold, score, reasons, severity }
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
    options: {
      source?: string
      fraudFlagId?: string
      modelVersionId?: string
      contractAddress?: string
      tenantId?: string
    } = {}
  ): Promise<FraudAlert> {
    const fullDetails = {
      ...details,
      ...(options.contractAddress ? { contractAddress: options.contractAddress } : {}),
      ...(options.tenantId ? { tenantId: options.tenantId } : {}),
    }

    const alert = await this.prisma.fraudAlert.create({
      data: {
        userId,
        alertType,
        severity,
        score,
        details: JSON.stringify(fullDetails),
        status: 'OPEN',
        source: options.source ?? 'ML',
        ...(options.fraudFlagId ? { fraudFlagId: options.fraudFlagId } : {}),
        ...(options.modelVersionId ? { modelVersionId: options.modelVersionId } : {}),
      },
    })

    logger.warn('Fraud alert created', {
      alertId: alert.id,
      userId,
      alertType,
      severity,
      score,
      contractAddress: options.contractAddress,
      tenantId: options.tenantId,
    })

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
    contractAddress?: string
    tenantId?: string
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

    let alerts = (raw ?? []).map(this.mapAlert)
    if (params.contractAddress) {
      alerts = alerts.filter((a) => a.contractAddress === params.contractAddress)
    }
    if (params.tenantId) {
      alerts = alerts.filter((a) => a.tenantId === params.tenantId)
    }

    return { alerts, total: total ?? 0 }
  }

  // ─── Manual Review ───────────────────────────────────────────────────────

  async reviewAlert(
    alertId: string,
    resolution: string,
    reviewerId: string,
    status: 'RESOLVED' | 'DISMISSED' = 'RESOLVED'
  ): Promise<FraudAlert> {
    const updated = await this.prisma.fraudAlert.update({
      where: { id: alertId },
      data: {
        status,
        resolution,
        reviewedAt: new Date(),
        reviewedBy: reviewerId,
      },
    })
    logger.info('Fraud alert reviewed', { alertId, status, reviewerId, resolution })
    return this.mapAlert(updated)
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
    const model = await this.getActiveModel({
      contractAddress: tx.contractAddress,
      tenantId: tx.tenantId,
    })
    const result = await this.detectPatterns(tx, model.parameters)

    if (result.isAnomaly) {
      await this.createAlert(
        tx.userId,
        'TRANSACTION_ANOMALY',
        result.severity,
        result.score,
        {
          reasons: result.reasons,
          amount: tx.amount.toString(),
          groupId: tx.groupId,
          ipAddress: tx.ipAddress,
        },
        {
          modelVersionId: model.id,
          contractAddress: tx.contractAddress,
          tenantId: tx.tenantId,
        }
      )
    }

    return result
  }

  /**
   * Train a candidate threshold from reviewed outcomes and promote it only
   * when it is at least as accurate as the currently active version on the
   * held-out set. Explicit FALSE_POSITIVE/FALSE_NEGATIVE feedback is required.
   * Supports tenant and contractAddress scoped training to prevent cross-tenant data pollution.
   */
  async retrainModel(options?: {
    contractAddress?: string
    tenantId?: string
  }): Promise<FraudModelRetrainingResult | null> {
    const modelStore = (this.prisma as any).fraudModelVersion
    if (!modelStore) return null

    const reviewedAlerts = await this.prisma.fraudAlert.findMany({
      where: { reviewedAt: { not: null }, resolution: { not: null } },
      select: { score: true, resolution: true, details: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    })

    const filteredAlerts = reviewedAlerts.filter((alert: any) => {
      if (!options?.contractAddress && !options?.tenantId) return true
      let parsedDetails: Record<string, unknown> = {}
      try {
        parsedDetails = typeof alert.details === 'string' ? JSON.parse(alert.details) : (alert.details ?? {})
      } catch {
        parsedDetails = {}
      }
      if (options?.contractAddress && parsedDetails.contractAddress !== options.contractAddress) {
        return false
      }
      if (options?.tenantId && parsedDetails.tenantId !== options.tenantId) {
        return false
      }
      return true
    })

    const labeled = filteredAlerts
      .map((alert: any) => ({
        score: Number(alert.score),
        label: this.labelFromResolution(alert.resolution),
      }))
      .filter((alert: { score: number; label: number | null }) => alert.label !== null) as Array<{
      score: number
      label: number
    }>

    if (labeled.length < 10) return null

    const split = Math.max(1, Math.floor(labeled.length * 0.8))
    const training = labeled.slice(0, split)
    const validation = labeled.slice(split)
    if (!this.hasBothLabels(training) || !this.hasBothLabels(validation)) return null
    const thresholds = Array.from({ length: 15 }, (_, index) => 20 + index * 5)
    const candidateThreshold = thresholds.reduce((best, threshold) => {
      const f1 = this.metricsForThreshold(training, threshold).f1
      return f1 > best.f1 ? { threshold, f1 } : best
    }, { threshold: DEFAULT_MODEL_PARAMETERS.anomalyThreshold, f1: -1 }).threshold
    const candidateMetrics = this.metricsForThreshold(validation, candidateThreshold)
    const active = await this.getActiveModel(options)
    const activeMetrics = this.metricsForThreshold(validation, active.parameters.anomalyThreshold)
    const scopeTag = options?.tenantId || options?.contractAddress ? `-${options.tenantId || options.contractAddress}` : ''
    const modelId = `fraud-statistical${scopeTag}-${Date.now()}`

    await modelStore.create({
      data: {
        id: modelId,
        algorithm: 'z-score-threshold',
        parameters: JSON.stringify({ anomalyThreshold: candidateThreshold }),
        trainingExamples: training.length,
        validationExamples: validation.length,
        validationPrecision: candidateMetrics.precision,
        validationRecall: candidateMetrics.recall,
        validationF1: candidateMetrics.f1,
        status: candidateMetrics.f1 >= activeMetrics.f1 ? 'ACTIVE' : 'CANDIDATE',
        ...(candidateMetrics.f1 >= activeMetrics.f1 ? { activatedAt: new Date() } : {}),
      },
    })

    if (candidateMetrics.f1 >= activeMetrics.f1) {
      await modelStore.updateMany({
        where: { status: 'ACTIVE', id: { not: modelId } },
        data: { status: 'RETIRED', retiredAt: new Date() },
      })
    }

    logger.info('Fraud model retraining completed', {
      modelId,
      activated: candidateMetrics.f1 >= activeMetrics.f1,
      candidateF1: candidateMetrics.f1,
      activeF1: activeMetrics.f1,
      scope: options?.tenantId || options?.contractAddress,
    })
    return {
      modelId,
      activated: candidateMetrics.f1 >= activeMetrics.f1,
      trainingExamples: training.length,
      validationExamples: validation.length,
      candidateF1: candidateMetrics.f1,
      activeF1: activeMetrics.f1,
    }
  }

  /** Roll back to a previously retired model version. */
  async rollbackModel(modelId: string): Promise<void> {
    const modelStore = (this.prisma as any).fraudModelVersion
    if (!modelStore) throw new Error('Fraud model versioning is not available')
    const model = await modelStore.findUnique({ where: { id: modelId } })
    if (!model || model.status !== 'RETIRED') throw new Error('Only retired models can be rolled back')
    await modelStore.updateMany({ where: { status: 'ACTIVE' }, data: { status: 'RETIRED', retiredAt: new Date() } })
    await modelStore.update({ where: { id: modelId }, data: { status: 'ACTIVE', activatedAt: new Date(), retiredAt: null } })
  }

  private async getActiveModel(options?: {
    contractAddress?: string
    tenantId?: string
  }): Promise<{ id: string; parameters: FraudModelParameters }> {
    const modelStore = (this.prisma as any).fraudModelVersion
    if (!modelStore) return { id: DEFAULT_MODEL_ID, parameters: DEFAULT_MODEL_PARAMETERS }
    const active = await modelStore.findFirst({ where: { status: 'ACTIVE' }, orderBy: { activatedAt: 'desc' } })
    if (!active) {
      try {
        await modelStore.create({
          data: {
            id: DEFAULT_MODEL_ID,
            algorithm: 'z-score-threshold',
            parameters: JSON.stringify(DEFAULT_MODEL_PARAMETERS),
            trainingExamples: 0,
            validationExamples: 0,
            validationPrecision: 0,
            validationRecall: 0,
            validationF1: 0,
            status: 'ACTIVE',
            activatedAt: new Date(),
          },
        })
      } catch (error: any) {
        if (error?.code !== 'P2002') throw error
      }
      const initialized = await modelStore.findFirst({ where: { status: 'ACTIVE' }, orderBy: { activatedAt: 'desc' } })
      if (initialized) return { id: initialized.id, parameters: JSON.parse(initialized.parameters) as FraudModelParameters }
      return { id: DEFAULT_MODEL_ID, parameters: DEFAULT_MODEL_PARAMETERS }
    }
    return { id: active.id, parameters: JSON.parse(active.parameters) as FraudModelParameters }
  }

  private labelFromResolution(resolution: string | null): number | null {
    if (!resolution) return null
    if (/FALSE_NEGATIVE|confirmed\s+fraud|true\s+positive/i.test(resolution)) return 1
    if (/FALSE_POSITIVE|legitimate|legit|dismissed/i.test(resolution)) return 0
    return null
  }

  private metricsForThreshold(examples: Array<{ score: number; label: number }>, threshold: number) {
    let truePositive = 0
    let falsePositive = 0
    let falseNegative = 0
    for (const example of examples) {
      const predicted = example.score >= threshold ? 1 : 0
      if (predicted === 1 && example.label === 1) truePositive++
      if (predicted === 1 && example.label === 0) falsePositive++
      if (predicted === 0 && example.label === 1) falseNegative++
    }
    const precision = truePositive / Math.max(1, truePositive + falsePositive)
    const recall = truePositive / Math.max(1, truePositive + falseNegative)
    return { precision, recall, f1: (2 * precision * recall) / Math.max(1, precision + recall) }
  }

  private hasBothLabels(examples: Array<{ label: number }>): boolean {
    return examples.some((example) => example.label === 0) && examples.some((example) => example.label === 1)
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
    const details = typeof raw.details === 'string' ? JSON.parse(raw.details) : (raw.details ?? {})
    return {
      id: raw.id,
      userId: raw.userId,
      alertType: raw.alertType,
      severity: raw.severity as FraudSeverity,
      score: raw.score,
      details,
      status: raw.status as AlertStatus,
      source: raw.source ?? 'ML',
      modelVersionId: raw.modelVersionId ?? undefined,
      fraudFlagId: raw.fraudFlagId ?? undefined,
      contractAddress: details.contractAddress ?? undefined,
      tenantId: details.tenantId ?? undefined,
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
