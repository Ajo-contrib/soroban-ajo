/**
 * fraud.ts — Fraud detection API routes
 *
 * All write-operations (review, feedback) require admin auth.
 * Read-only admin views require admin auth.
 * Users may view their own alerts via /my-flags (user auth).
 *
 * These routes delegate exclusively to FraudOrchestrator, which is the single
 * authoritative entry point for both the rule-based and ML fraud systems.
 *
 * For investigation procedures see: docs/FRAUD_RUNBOOK.md
 */

import { Router, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { adminAuth } from '../middleware/adminAuth'
import { fraudOrchestrator } from '../services/FraudOrchestrator'
import { AlertStatus, FraudSeverity } from '../services/mlFraudDetectionService'

export const fraudRouter = Router()

/**
 * @swagger
 * tags:
 *   name: Fraud Detection
 *   description: Unified fraud detection — rule-based + ML ensemble
 */

/**
 * POST /api/fraud/analyze
 * Analyze a transaction for fraud patterns (admin / internal use).
 * Runs the ML anomaly detector against the given transaction.
 */
fraudRouter.post('/analyze', adminAuth(), async (req, res: Response) => {
  try {
    const { userId, amount, groupId, ipAddress } = req.body
    if (!userId || !amount || !groupId) {
      return res.status(400).json({ error: 'userId, amount, groupId required' })
    }
    const txResult = await fraudOrchestrator.analyzeTransaction({
      userId,
      amount: BigInt(amount),
      groupId,
      timestamp: new Date(),
      ipAddress,
    })
    res.json({ success: true, result: txResult.anomaly, alert: txResult.alert ?? null })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * GET /api/fraud/anomalies
 * Run contribution anomaly scan across all users (admin).
 */
fraudRouter.get('/anomalies', adminAuth(), async (req, res: Response) => {
  try {
    const lookbackDays = Number(req.query.days) || 30
    const anomalies = await fraudOrchestrator.detectContributionAnomalies(lookbackDays)
    res.json({ success: true, anomalies })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * GET /api/fraud/risk/:userId
 * Get ensemble risk verdict for a user (admin).
 * Returns both the rule-based block status and ML severity, plus the final
 * ensemble decision and the disagreement-resolution reason string.
 */
fraudRouter.get('/risk/:userId', adminAuth(), async (req, res: Response) => {
  try {
    const verdict = await fraudOrchestrator.ensembleRiskVerdict(req.params.userId)
    res.json({ success: true, verdict })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * GET /api/fraud/alerts
 * List ML/ensemble fraud alerts (admin).
 */
fraudRouter.get('/alerts', adminAuth(), async (req, res: Response) => {
  try {
    const { status, severity, userId, page, limit } = req.query
    const result = await fraudOrchestrator.listAlerts({
      status: status as AlertStatus | undefined,
      severity: severity as FraudSeverity | undefined,
      userId: userId as string | undefined,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
    })
    res.json({ success: true, ...result })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * GET /api/fraud/alerts/pending
 * Get ML alerts pending manual review (admin).
 */
fraudRouter.get('/alerts/pending', adminAuth(), async (req, res: Response) => {
  try {
    const alerts = await fraudOrchestrator.getPendingReviews(Number(req.query.limit) || 50)
    res.json({ success: true, alerts })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * POST /api/fraud/alerts/:id/review
 * Submit a manual review decision on a fraud alert (admin).
 * status: RESOLVED | DISMISSED
 */
fraudRouter.post('/alerts/:id/review', adminAuth(), async (req, res: Response) => {
  try {
    const { status, resolution } = req.body
    if (!['RESOLVED', 'DISMISSED'].includes(status)) {
      return res.status(400).json({ error: 'status must be RESOLVED or DISMISSED' })
    }
    if (!resolution) return res.status(400).json({ error: 'resolution required' })

    const adminId = (req as any).admin?.id || 'admin'
    const alert = await fraudOrchestrator.reviewAlert(req.params.id, adminId, status, resolution)
    res.json({ success: true, alert })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * POST /api/fraud/alerts/:id/feedback
 * Record a confirmed false positive or false negative on an alert (admin).
 * This feeds back into threshold calibration.
 *
 * Body: { outcome: 'FALSE_POSITIVE' | 'FALSE_NEGATIVE', notes: string }
 */
fraudRouter.post('/alerts/:id/feedback', adminAuth(), async (req, res: Response) => {
  try {
    const { outcome, notes } = req.body
    if (!['FALSE_POSITIVE', 'FALSE_NEGATIVE'].includes(outcome)) {
      return res.status(400).json({ error: 'outcome must be FALSE_POSITIVE or FALSE_NEGATIVE' })
    }
    if (!notes) return res.status(400).json({ error: 'notes required' })

    const adminId = (req as any).admin?.id || 'admin'
    await fraudOrchestrator.recordAlertFeedback(req.params.id, outcome, adminId, notes)
    res.json({ success: true, message: 'Feedback recorded' })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * GET /api/fraud/my-flags
 * Authenticated user can see their own fraud alerts.
 */
fraudRouter.get('/my-flags', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.walletAddress
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })
    const result = await fraudOrchestrator.listAlerts({ userId, limit: 10 })
    res.json({ success: true, flags: result.alerts })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})
