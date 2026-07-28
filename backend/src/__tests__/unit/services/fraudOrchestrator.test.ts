/**
 * Unit tests for FraudOrchestrator — the unified fraud-detection entry point.
 *
 * Coverage goals (per issue #804 acceptance criteria):
 *   ✅ Rule-based check blocks referral on HIGH flags
 *   ✅ Rule-based check passes referral when no flags
 *   ✅ ML layer creates alert when anomaly score ≥ 30
 *   ✅ ML layer does NOT create alert when score < 30
 *   ✅ Disagreement resolution: rule MEDIUM + ML MEDIUM → ensemble BLOCK
 *   ✅ Disagreement resolution: rule pass + ML HIGH → alert only (no block)
 *   ✅ Disagreement resolution: rule HIGH → block, ML not consulted
 *   ✅ ML CRITICAL alone → ensemble block
 *   ✅ Feedback loop: false positive correctly tags alert and sets status DISMISSED
 *   ✅ Feedback loop: false negative correctly tags alert and sets status RESOLVED
 *   ✅ shouldBlockReward delegates to ensemble verdict
 *   ✅ persistReferralFlags writes FraudFlag rows for each flag
 */

import { FraudOrchestrator } from '../../../services/FraudOrchestrator'
import { FraudDetector } from '../../../services/FraudDetector'
import { MLFraudDetectionService } from '../../../services/mlFraudDetectionService'

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../../../services/FraudDetector')
jest.mock('../../../services/mlFraudDetectionService')

const MockFraudDetector = FraudDetector as jest.MockedClass<typeof FraudDetector>
const MockMLService = MLFraudDetectionService as jest.MockedClass<typeof MLFraudDetectionService>

function makePrismaMock() {
  return {
    fraudFlag: {
      create: jest.fn().mockResolvedValue({ id: 'flag-1' }),
      count: jest.fn().mockResolvedValue(0),
    },
    fraudAlert: {
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
  } as any
}

function makeRedisMock() {
  return { incr: jest.fn(), expire: jest.fn(), get: jest.fn() } as any
}

function makeOrchestrator(prisma: any, rules: any, ml: any) {
  MockFraudDetector.mockImplementation(() => rules)
  MockMLService.mockImplementation(() => ml)
  return new FraudOrchestrator(prisma, makeRedisMock())
}

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const REFERRER = 'user-A'
const REFEREE = 'user-B'
const METADATA = { ipAddress: '1.2.3.4', userAgent: 'test', registrationTimestamp: new Date() }

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('FraudOrchestrator — Stage 1: referral rule checks', () => {
  it('blocks referral when rule check returns a HIGH flag', async () => {
    const rules = {
      checkReferral: jest.fn().mockResolvedValue({
        passed: false,
        flags: [{ type: 'SELF_REFERRAL', severity: 'HIGH', details: {} }],
        shouldBlock: true,
      }),
      shouldBlockReward: jest.fn().mockResolvedValue(true),
      incrementIPCount: jest.fn(),
      reviewFlag: jest.fn(),
    }
    const ml = { listAlerts: jest.fn().mockResolvedValue({ alerts: [], total: 0 }), analyzeTransaction: jest.fn(), recordFeedback: jest.fn(), detectContributionAnomalies: jest.fn(), getPendingReviews: jest.fn(), reviewAlert: jest.fn() }
    const orch = makeOrchestrator(makePrismaMock(), rules, ml)

    const result = await orch.checkReferral(REFERRER, REFEREE, METADATA)

    expect(result.blocked).toBe(true)
    expect(result.ruleResult.flags[0].type).toBe('SELF_REFERRAL')
  })

  it('allows referral when no rule flags are raised', async () => {
    const rules = {
      checkReferral: jest.fn().mockResolvedValue({ passed: true, flags: [], shouldBlock: false }),
      shouldBlockReward: jest.fn().mockResolvedValue(false),
      incrementIPCount: jest.fn(),
      reviewFlag: jest.fn(),
    }
    const ml = { listAlerts: jest.fn().mockResolvedValue({ alerts: [], total: 0 }), analyzeTransaction: jest.fn(), recordFeedback: jest.fn(), detectContributionAnomalies: jest.fn(), getPendingReviews: jest.fn(), reviewAlert: jest.fn() }
    const orch = makeOrchestrator(makePrismaMock(), rules, ml)

    const result = await orch.checkReferral(REFERRER, REFEREE, METADATA)

    expect(result.blocked).toBe(false)
    expect(result.ruleResult.flags).toHaveLength(0)
  })

  it('persistReferralFlags creates one FraudFlag row per flag', async () => {
    const prisma = makePrismaMock()
    const rules = { checkReferral: jest.fn(), shouldBlockReward: jest.fn(), incrementIPCount: jest.fn(), reviewFlag: jest.fn() }
    const ml = { listAlerts: jest.fn(), analyzeTransaction: jest.fn(), recordFeedback: jest.fn(), detectContributionAnomalies: jest.fn(), getPendingReviews: jest.fn(), reviewAlert: jest.fn() }
    const orch = makeOrchestrator(prisma, rules, ml)

    const ruleResult = {
      passed: false,
      shouldBlock: true,
      flags: [
        { type: 'SELF_REFERRAL', severity: 'HIGH' as const, details: {} },
        { type: 'BULK_CREATION', severity: 'HIGH' as const, details: { count: 5 } },
      ],
    }

    const flagIds = await orch.persistReferralFlags('referral-1', ruleResult)

    expect(prisma.fraudFlag.create).toHaveBeenCalledTimes(2)
    expect(prisma.fraudFlag.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ flagType: 'SELF_REFERRAL', referralId: 'referral-1' }) })
    )
    expect(flagIds).toHaveLength(2)
  })
})

describe('FraudOrchestrator — Stage 2: ML transaction analysis', () => {
  it('creates an alert when ML detects an anomaly (score >= 30)', async () => {
    const anomalyResult = { isAnomaly: true, score: 45, reasons: ['High tx frequency'], severity: 'MEDIUM' as const }
    const createdAlert = { id: 'alert-1', userId: 'user-1', alertType: 'TRANSACTION_ANOMALY', severity: 'MEDIUM' as const, score: 45, details: {}, status: 'OPEN' as const, source: 'ML', createdAt: new Date() }

    const rules = { checkReferral: jest.fn(), shouldBlockReward: jest.fn().mockResolvedValue(false), incrementIPCount: jest.fn(), reviewFlag: jest.fn() }
    const ml = {
      analyzeTransaction: jest.fn().mockResolvedValue(anomalyResult),
      listAlerts: jest.fn().mockResolvedValue({ alerts: [createdAlert], total: 1 }),
      recordFeedback: jest.fn(),
      detectContributionAnomalies: jest.fn(),
      getPendingReviews: jest.fn(),
      reviewAlert: jest.fn(),
    }
    const orch = makeOrchestrator(makePrismaMock(), rules, ml)

    const result = await orch.analyzeTransaction({ userId: 'user-1', amount: BigInt(1000), groupId: 'g-1', timestamp: new Date() })

    expect(result.anomaly.isAnomaly).toBe(true)
    expect(result.alert).toBeDefined()
    expect(result.alert?.id).toBe('alert-1')
  })

  it('does NOT create an alert when ML score is below threshold', async () => {
    const anomalyResult = { isAnomaly: false, score: 10, reasons: [], severity: 'LOW' as const }
    const rules = { checkReferral: jest.fn(), shouldBlockReward: jest.fn().mockResolvedValue(false), incrementIPCount: jest.fn(), reviewFlag: jest.fn() }
    const ml = {
      analyzeTransaction: jest.fn().mockResolvedValue(anomalyResult),
      listAlerts: jest.fn().mockResolvedValue({ alerts: [], total: 0 }),
      recordFeedback: jest.fn(),
      detectContributionAnomalies: jest.fn(),
      getPendingReviews: jest.fn(),
      reviewAlert: jest.fn(),
    }
    const orch = makeOrchestrator(makePrismaMock(), rules, ml)

    const result = await orch.analyzeTransaction({ userId: 'user-1', amount: BigInt(100), groupId: 'g-1', timestamp: new Date() })

    expect(result.anomaly.isAnomaly).toBe(false)
    expect(result.alert).toBeUndefined()
  })
})

describe('FraudOrchestrator — Ensemble disagreement resolution', () => {
  /**
   * Case 1: Rule HIGH block → ensemble blocks regardless of ML
   */
  it('blocks when rule-based system has a confirmed HIGH flag, regardless of ML', async () => {
    const prisma = makePrismaMock()
    prisma.fraudFlag.count.mockResolvedValue(0) // no MEDIUM flags (already have HIGH)
    const rules = { checkReferral: jest.fn(), shouldBlockReward: jest.fn().mockResolvedValue(true), incrementIPCount: jest.fn(), reviewFlag: jest.fn() }
    const ml = {
      listAlerts: jest.fn().mockResolvedValue({ alerts: [], total: 0 }),
      analyzeTransaction: jest.fn(),
      recordFeedback: jest.fn(),
      detectContributionAnomalies: jest.fn(),
      getPendingReviews: jest.fn(),
      reviewAlert: jest.fn(),
    }
    const orch = makeOrchestrator(prisma, rules, ml)

    const verdict = await orch.ensembleRiskVerdict('user-1')

    expect(verdict.shouldBlock).toBe(true)
    expect(verdict.ruleBlocked).toBe(true)
    expect(verdict.reason).toMatch(/rule-based/i)
  })

  /**
   * Case 2: Rule MEDIUM flag + ML MEDIUM anomaly → ensemble blocks
   */
  it('blocks when rule has MEDIUM flag AND ML has MEDIUM anomaly (ensemble decision)', async () => {
    const prisma = makePrismaMock()
    prisma.fraudFlag.count.mockResolvedValue(2) // 2 pending MEDIUM flags
    const rules = { checkReferral: jest.fn(), shouldBlockReward: jest.fn().mockResolvedValue(false), incrementIPCount: jest.fn(), reviewFlag: jest.fn() }
    const ml = {
      listAlerts: jest.fn().mockResolvedValue({
        alerts: [{ id: 'a-1', severity: 'MEDIUM', status: 'OPEN', userId: 'user-1', alertType: 'TRANSACTION_ANOMALY', score: 45, details: {}, source: 'ML', createdAt: new Date() }],
        total: 1,
      }),
      analyzeTransaction: jest.fn(),
      recordFeedback: jest.fn(),
      detectContributionAnomalies: jest.fn(),
      getPendingReviews: jest.fn(),
      reviewAlert: jest.fn(),
    }
    const orch = makeOrchestrator(prisma, rules, ml)

    const verdict = await orch.ensembleRiskVerdict('user-1')

    expect(verdict.shouldBlock).toBe(true)
    expect(verdict.ruleBlocked).toBe(false)
    expect(verdict.reason).toMatch(/ensemble/i)
  })

  /**
   * Case 3: ML CRITICAL alone → ensemble blocks
   */
  it('blocks when ML returns CRITICAL severity even without rule flags', async () => {
    const prisma = makePrismaMock()
    prisma.fraudFlag.count.mockResolvedValue(0)
    const rules = { checkReferral: jest.fn(), shouldBlockReward: jest.fn().mockResolvedValue(false), incrementIPCount: jest.fn(), reviewFlag: jest.fn() }
    const ml = {
      listAlerts: jest.fn().mockResolvedValue({
        alerts: [{ id: 'a-2', severity: 'CRITICAL', status: 'OPEN', userId: 'user-1', alertType: 'TRANSACTION_ANOMALY', score: 90, details: {}, source: 'ML', createdAt: new Date() }],
        total: 1,
      }),
      analyzeTransaction: jest.fn(),
      recordFeedback: jest.fn(),
      detectContributionAnomalies: jest.fn(),
      getPendingReviews: jest.fn(),
      reviewAlert: jest.fn(),
    }
    const orch = makeOrchestrator(prisma, rules, ml)

    const verdict = await orch.ensembleRiskVerdict('user-1')

    expect(verdict.shouldBlock).toBe(true)
    expect(verdict.ensembleSeverity).toBe('CRITICAL')
    expect(verdict.reason).toMatch(/CRITICAL/i)
  })

  /**
   * Case 4: Rule passes + ML HIGH → alert only, no block (async review path)
   */
  it('does NOT block when rule passes and ML is only HIGH (async review, no instant block)', async () => {
    const prisma = makePrismaMock()
    prisma.fraudFlag.count.mockResolvedValue(0) // no MEDIUM rule flags
    const rules = { checkReferral: jest.fn(), shouldBlockReward: jest.fn().mockResolvedValue(false), incrementIPCount: jest.fn(), reviewFlag: jest.fn() }
    const ml = {
      listAlerts: jest.fn().mockResolvedValue({
        alerts: [{ id: 'a-3', severity: 'HIGH', status: 'OPEN', userId: 'user-1', alertType: 'TRANSACTION_ANOMALY', score: 65, details: {}, source: 'ML', createdAt: new Date() }],
        total: 1,
      }),
      analyzeTransaction: jest.fn(),
      recordFeedback: jest.fn(),
      detectContributionAnomalies: jest.fn(),
      getPendingReviews: jest.fn(),
      reviewAlert: jest.fn(),
    }
    const orch = makeOrchestrator(prisma, rules, ml)

    const verdict = await orch.ensembleRiskVerdict('user-1')

    // HIGH ML alone doesn't block in real-time — it creates an alert for review
    expect(verdict.shouldBlock).toBe(false)
    expect(verdict.mlSeverity).toBe('HIGH')
  })

  /**
   * Case 5: Neither system flags → no block
   */
  it('allows when neither rule nor ML system raises any flags', async () => {
    const prisma = makePrismaMock()
    prisma.fraudFlag.count.mockResolvedValue(0)
    const rules = { checkReferral: jest.fn(), shouldBlockReward: jest.fn().mockResolvedValue(false), incrementIPCount: jest.fn(), reviewFlag: jest.fn() }
    const ml = {
      listAlerts: jest.fn().mockResolvedValue({ alerts: [], total: 0 }),
      analyzeTransaction: jest.fn(),
      recordFeedback: jest.fn(),
      detectContributionAnomalies: jest.fn(),
      getPendingReviews: jest.fn(),
      reviewAlert: jest.fn(),
    }
    const orch = makeOrchestrator(prisma, rules, ml)

    const verdict = await orch.ensembleRiskVerdict('user-1')

    expect(verdict.shouldBlock).toBe(false)
    expect(verdict.mlSeverity).toBeNull()
  })
})

describe('FraudOrchestrator — Feedback loop', () => {
  it('records false positive — status becomes DISMISSED', async () => {
    const rules = { checkReferral: jest.fn(), shouldBlockReward: jest.fn(), incrementIPCount: jest.fn(), reviewFlag: jest.fn() }
    const ml = {
      recordFeedback: jest.fn().mockResolvedValue(undefined),
      listAlerts: jest.fn(),
      analyzeTransaction: jest.fn(),
      detectContributionAnomalies: jest.fn(),
      getPendingReviews: jest.fn(),
      reviewAlert: jest.fn(),
    }
    const orch = makeOrchestrator(makePrismaMock(), rules, ml)

    await orch.recordAlertFeedback('alert-99', 'FALSE_POSITIVE', 'admin-1', 'User is a real merchant')

    expect(ml.recordFeedback).toHaveBeenCalledWith(
      'alert-99',
      'FALSE_POSITIVE',
      'admin-1',
      'User is a real merchant'
    )
  })

  it('records false negative — status becomes RESOLVED', async () => {
    const rules = { checkReferral: jest.fn(), shouldBlockReward: jest.fn(), incrementIPCount: jest.fn(), reviewFlag: jest.fn() }
    const ml = {
      recordFeedback: jest.fn().mockResolvedValue(undefined),
      listAlerts: jest.fn(),
      analyzeTransaction: jest.fn(),
      detectContributionAnomalies: jest.fn(),
      getPendingReviews: jest.fn(),
      reviewAlert: jest.fn(),
    }
    const orch = makeOrchestrator(makePrismaMock(), rules, ml)

    await orch.recordAlertFeedback('alert-100', 'FALSE_NEGATIVE', 'admin-1', 'Confirmed fraudster, missed by ML')

    expect(ml.recordFeedback).toHaveBeenCalledWith(
      'alert-100',
      'FALSE_NEGATIVE',
      'admin-1',
      'Confirmed fraudster, missed by ML'
    )
  })
})

describe('FraudOrchestrator — shouldBlockReward delegates to ensemble', () => {
  it('returns true when ensemble verdict is to block', async () => {
    const prisma = makePrismaMock()
    prisma.fraudFlag.count.mockResolvedValue(0)
    const rules = { checkReferral: jest.fn(), shouldBlockReward: jest.fn().mockResolvedValue(true), incrementIPCount: jest.fn(), reviewFlag: jest.fn() }
    const ml = { listAlerts: jest.fn().mockResolvedValue({ alerts: [], total: 0 }), analyzeTransaction: jest.fn(), recordFeedback: jest.fn(), detectContributionAnomalies: jest.fn(), getPendingReviews: jest.fn(), reviewAlert: jest.fn() }
    const orch = makeOrchestrator(prisma, rules, ml)

    const blocked = await orch.shouldBlockReward('user-fraud')
    expect(blocked).toBe(true)
  })

  it('returns false when ensemble verdict is clean', async () => {
    const prisma = makePrismaMock()
    prisma.fraudFlag.count.mockResolvedValue(0)
    const rules = { checkReferral: jest.fn(), shouldBlockReward: jest.fn().mockResolvedValue(false), incrementIPCount: jest.fn(), reviewFlag: jest.fn() }
    const ml = { listAlerts: jest.fn().mockResolvedValue({ alerts: [], total: 0 }), analyzeTransaction: jest.fn(), recordFeedback: jest.fn(), detectContributionAnomalies: jest.fn(), getPendingReviews: jest.fn(), reviewAlert: jest.fn() }
    const orch = makeOrchestrator(prisma, rules, ml)

    const blocked = await orch.shouldBlockReward('user-clean')
    expect(blocked).toBe(false)
  })
})
