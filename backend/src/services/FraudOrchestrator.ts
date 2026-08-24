/**
 * FraudOrchestrator.ts
 *
 * THE authoritative fraud-detection entry point.
 *
 * Architecture: two-stage ensemble
 * ─────────────────────────────────
 *   Stage 1 — Rule-based fast pass (FraudDetector):
 *     Synchronous checks executed at referral-claim time.
 *     Checks: self-referral, IP bulk-creation (Redis), device fingerprint, IP match.
 *     Outcome: block (HIGH flags) or allow with flags.
 *
 *   Stage 2 — Statistical anomaly detection (MLFraudDetectionService):
 *     Applied to contribution transactions after they are submitted.
 *     Uses z-score analysis over historical contribution data.
 *     Outcome: OPEN alert for admin review; auto-escalates CRITICAL cases.
 *
 * Disagreement resolution:
 *   • If Stage 1 blocks  → reject immediately, Stage 2 is NOT run (no need).
 *   • If Stage 1 passes with MEDIUM flags AND Stage 2 flags → ENSEMBLE alert
 *     at the higher of the two severities.
 *   • If only Stage 2 flags → create alert, do NOT block in real-time (async review).
 *   • If neither flags → allow.
 *
 * Feedback loop:
 *   Admin reviews feed back via recordFeedback() on the alert; confirmed
 *   false positives/negatives are preserved in FraudAlert.resolution and can
 *   be aggregated to recalibrate thresholds.
 *
 * On-call runbook: see docs/FRAUD_RUNBOOK.md
 */

import { PrismaClient } from '@prisma/client'
import Redis from 'ioredis'
import { FraudDetector, ReferralMetadata, FraudCheckResult } from './FraudDetector'
import {
  MLFraudDetectionService,
  TransactionPattern,
  AnomalyResult,
  FraudAlert,
  FraudSeverity,
  AlertStatus,
} from './mlFraudDetectionService'
import { createModuleLogger } from '../utils/logger'

const logger = createModuleLogger('FraudOrchestrator')

export interface ReferralFraudResult {
  /** Whether this referral should be blocked outright */
  blocked: boolean
  /** Rule-based verdict */
  ruleResult: FraudCheckResult
  /** All persisted flag IDs created for this referral */
  flagIds: string[]
}

export interface TransactionFraudResult {
  /** The anomaly result from ML analysis */
  anomaly: AnomalyResult
  /** The alert created, if any */
  alert?: FraudAlert
}

export class FraudOrchestrator {
  private readonly rules: FraudDetector
  private readonly ml: MLFraudDetectionService

  constructor(
    private readonly prisma: PrismaClient,
    redis: Redis
  ) {
    this.rules = new FraudDetector(prisma, redis)
    this.ml = new MLFraudDetectionService(prisma)
  }

  // ─── Stage 1: Referral-time rule checks ──────────────────────────────────

  /**
   * Run all rule-based fraud checks at referral claim time.
   * This is a synchronous, fast gate — it must complete before the referral
   * record is written.
   *
   * @returns ReferralFraudResult — includes `blocked` which callers MUST respect
   */
  async checkReferral(
    referrerId: string,
    refereeId: string,
    metadata: ReferralMetadata
  ): Promise<ReferralFraudResult> {
    const ruleResult = await this.rules.checkReferral(referrerId, refereeId, metadata)
    logger.info('Rule-based referral check complete', {
      referrerId,
      refereeId,
      blocked: ruleResult.shouldBlock,
      flagCount: ruleResult.flags.length,
    })
    return {
      blocked: ruleResult.shouldBlock,
      ruleResult,
      flagIds: [], // populated after the caller persists FraudFlag rows
    }
  }

  /**
   * Persist FraudFlag rows for a referral that has already been created.
   * Call this AFTER prisma.referral.create() so you have the referralId.
   */
  async persistReferralFlags(
    referralId: string,
    ruleResult: FraudCheckResult
  ): Promise<string[]> {
    const flagIds: string[] = []
    for (const flag of ruleResult.flags) {
      const record = await this.prisma.fraudFlag.create({
        data: {
          referralId,
          flagType: flag.type,
          severity: flag.severity,
          details: JSON.stringify(flag.details ?? {}),
          status: 'PENDING',
        },
      })
      flagIds.push(record.id)
    }
    return flagIds
  }

  /**
   * Track that an IP address was used for a referral (rate-limiting).
   * Must be called after a referral is successfully created.
   */
  async trackReferralIP(ipAddress: string): Promise<void> {
    await this.rules.incrementIPCount(ipAddress)
  }

  // ─── Stage 2: Transaction-time ML analysis ───────────────────────────────

  /**
   * Analyse a contribution transaction for behavioural anomalies.
   * This is asynchronous and non-blocking — it DOES NOT reject the transaction.
   * If an anomaly is found an alert is raised for admin review.
   *
   * Call this after a contribution has been successfully written to the DB.
   */
  async analyzeTransaction(tx: TransactionPattern): Promise<TransactionFraudResult> {
    const anomaly = await this.ml.analyzeTransaction(tx)
    let alert: FraudAlert | undefined

    if (anomaly.isAnomaly) {
      // Alert was already created inside ml.analyzeTransaction(); fetch it back
      const { alerts } = await this.ml.listAlerts({
        userId: tx.userId,
        status: 'OPEN' as AlertStatus,
        limit: 1,
      })
      alert = alerts[0]
      logger.warn('Transaction anomaly detected', {
        userId: tx.userId,
        groupId: tx.groupId,
        score: anomaly.score,
        severity: anomaly.severity,
      })
    }

    return { anomaly, alert }
  }

  // ─── Ensemble: combined referral + behavioural check ─────────────────────

  /**
   * Evaluate both rule-based flags and any existing ML alerts for a user and
   * produce a single ensemble verdict.  Use this when you need a holistic view
   * (e.g., admin dashboard risk score, reward-block decision).
   *
   * Disagreement resolution logic:
   *   HIGH rule flag  → BLOCK regardless of ML
   *   MEDIUM rule flag + ML anomaly ≥ MEDIUM → ensemble BLOCK
   *   ML CRITICAL alone → BLOCK (auto-escalated for immediate review)
   *   All other combinations → ALLOW (alert may exist for async review)
   */
  async ensembleRiskVerdict(userId: string): Promise<{
    shouldBlock: boolean
    ruleBlocked: boolean
    mlSeverity: FraudSeverity | null
    ensembleSeverity: FraudSeverity | null
    reason: string
  }> {
    const [ruleBlocked, mlAlerts] = await Promise.all([
      this.rules.shouldBlockReward(userId),
      this.ml.listAlerts({ userId, status: 'OPEN' as AlertStatus }),
    ])

    const topMlAlert = mlAlerts.alerts[0]
    const mlSeverity: FraudSeverity | null = topMlAlert?.severity ?? null

    // Determine ensemble severity
    const severityRank: Record<FraudSeverity, number> = {
      LOW: 1,
      MEDIUM: 2,
      HIGH: 3,
      CRITICAL: 4,
    }
    let ensembleSeverity: FraudSeverity | null = mlSeverity

    let shouldBlock = ruleBlocked
    let reason = ruleBlocked ? 'Rule-based block (HIGH flag or CONFIRMED fraud)' : 'No rule block'

    if (!ruleBlocked && mlSeverity) {
      if (severityRank[mlSeverity] >= severityRank['CRITICAL']) {
        shouldBlock = true
        ensembleSeverity = 'CRITICAL'
        reason = 'ML CRITICAL anomaly — auto-block pending immediate review'
      }
    }

    if (!shouldBlock && mlSeverity && severityRank[mlSeverity] >= severityRank['MEDIUM']) {
      // Check for co-occurring rule MEDIUM flags (not HIGH, which would already block)
      const pendingFlags = await this.prisma.fraudFlag.count({
        where: { userId, status: { in: ['PENDING', 'CONFIRMED'] }, severity: 'MEDIUM' },
      })
      if (pendingFlags > 0) {
        shouldBlock = true
        ensembleSeverity = mlSeverity
        reason = `Ensemble block: rule MEDIUM flags (${pendingFlags}) + ML ${mlSeverity} anomaly`
      }
    }

    return { shouldBlock, ruleBlocked, mlSeverity, ensembleSeverity, reason }
  }

  // ─── Feedback loop ───────────────────────────────────────────────────────

  /**
   * Record admin feedback on an ML alert.  Confirmed false positives and
   * false negatives are tagged in the resolution field for threshold calibration.
   */
  async recordAlertFeedback(
    alertId: string,
    outcome: 'FALSE_POSITIVE' | 'FALSE_NEGATIVE',
    reviewerId: string,
    notes: string
  ): Promise<void> {
    await this.ml.recordFeedback(alertId, outcome, reviewerId, notes)
    logger.info('Alert feedback recorded via orchestrator', { alertId, outcome })
  }

  async retrainModel() {
    return this.ml.retrainModel()
  }

  async rollbackModel(modelId: string): Promise<void> {
    return this.ml.rollbackModel(modelId)
  }

  /**
   * Record admin review of a rule-based FraudFlag.
   */
  async reviewFraudFlag(
    flagId: string,
    status: 'REVIEWED' | 'CONFIRMED' | 'DISMISSED',
    reviewerId: string
  ): Promise<void> {
    await this.rules.reviewFlag(flagId, status, reviewerId)
    logger.info('FraudFlag reviewed via orchestrator', { flagId, status })
  }

  // ─── Accessors (delegate to inner services) ──────────────────────────────

  /** Checks if a user has pending/confirmed rule-based fraud flags blocking rewards. */
  async shouldBlockReward(userId: string): Promise<boolean> {
    const { shouldBlock } = await this.ensembleRiskVerdict(userId)
    return shouldBlock
  }

  /** Expose ML alert listing for the fraud router. */
  async listAlerts(params: Parameters<MLFraudDetectionService['listAlerts']>[0]) {
    return this.ml.listAlerts(params)
  }

  /** Expose ML alert review for the fraud router. */
  async reviewAlert(
    alertId: string,
    reviewerId: string,
    status: 'RESOLVED' | 'DISMISSED',
    resolution: string
  ) {
    return this.ml.reviewAlert(alertId, reviewerId, status, resolution)
  }

  /** Expose pending review queue for the fraud router. */
  async getPendingReviews(limit?: number) {
    return this.ml.getPendingReviews(limit)
  }

  /** Expose contribution anomaly scan for the fraud router. */
  async detectContributionAnomalies(lookbackDays?: number) {
    return this.ml.detectContributionAnomalies(lookbackDays)
  }
}

/** Singleton for non-injected contexts. Prefer constructor injection in tests. */
import { PrismaClient as PC } from '@prisma/client'
import RedisClient from 'ioredis'
export const fraudOrchestrator = new FraudOrchestrator(
  new PC(),
  new RedisClient(process.env.REDIS_URL ?? 'redis://localhost:6379')
)
