# Fraud Detection — On-Call Runbook

> **Last updated:** 2026-08-27 (verified line-by-line against `FraudOrchestrator.ts`,
> `FraudDetector.ts`, `mlFraudDetectionService.ts`, `referralService.ts`,
> `RewardEngine.ts`, `routes/fraud.ts`, `cron/scheduler.ts`, and `schema.prisma`
> post-#804/#831 reconciliation)
> **Architecture:** Two-stage ensemble (rule-based fast pass + statistical anomaly detection)
> **Authoritative entry point:** `src/services/FraudOrchestrator.ts`

---

## 1. Architecture Overview

The system has **two fraud subsystems** that run in a defined sequence, coordinated by `FraudOrchestrator`:

| Layer | File | When it runs | What it checks |
|---|---|---|---|
| **Stage 1 — Rules** | `FraudDetector.ts` | At referral-claim time (synchronous) | Self-referral, IP bulk-creation (Redis), device fingerprint\*, IP match\* |
| **Stage 2 — Statistical** | `mlFraudDetectionService.ts` | After contribution submission (async) | Transaction frequency, amount z-score vs. history, group-joining rate |

\* `IP_MATCH` and `DEVICE_MATCH` are stubs that always return `false` — see [§8](#8-known-limitations).

Despite the "ML" naming in the codebase, Stage 2 is a hand-rolled z-score/heuristic
scorer, not a trained model in the traditional sense — see [§1.2](#12-severity--the-anomalythreshold-gate).

### 1.1 What "block" actually means at each stage

These two stages don't block the same thing, which matters when you're investigating:

- **Stage 1 HIGH flag** (`checkReferral.shouldBlock`) does **not** reject the referral
  API call. `referralService.createReferral` still creates the `Referral` row, just
  with `status: 'FLAGGED'` instead of `'PENDING'`. The practical effect is that
  `completeReferral()` later short-circuits and returns early for any referral whose
  status is already `'FLAGGED'` — so the referral can never reach `'COMPLETED'` and
  `distributeReferralReward()` is never invoked for it.
- **The ensemble verdict** (`FraudOrchestrator.ensembleRiskVerdict` /
  `shouldBlockReward`) is a *separate*, per-user gate consulted by `RewardEngine`
  before granting **any** reward (referral, achievement, or milestone) — not just the
  one flagged referral. This is the logic documented in the disagreement table below.

### 1.2 Severity & the `anomalyThreshold` gate

Stage 2's `isAnomaly` decision is **not** simply "z-score > 3". `detectPatterns()`
computes a 0–100 `score` from up to three independent signals, then compares it
against the active model's `anomalyThreshold` (versioned in `FraudModelVersion`,
default **30**):

| Signal | Condition | Score contribution |
|---|---|---|
| Transaction frequency | >10 contributions in 1h | +30 |
| Amount anomaly | z-score > 3 vs. last 50 contributions (needs ≥5 history points) | +min(40, z × 10) |
| Group-joining rate | >5 groups joined in 1h | +20 |

`isAnomaly = score >= anomalyThreshold`. The resulting `score` is then mapped to a
severity band via `scoreToSeverity()`:

| Score | Severity |
|---|---|
| ≥ 80 | `CRITICAL` |
| 60–79 | `HIGH` |
| 30–59 | `MEDIUM` |
| < 30 | `LOW` |

Because the default `anomalyThreshold` (30) equals the bottom of the `MEDIUM` band,
any alert that actually gets created (`isAnomaly: true`) will be `MEDIUM` or higher
under the default model — a `LOW`-severity `FraudAlert` should not normally occur
unless a retrained model lowered the threshold below 30.

### Disagreement Resolution Logic

This table describes `ensembleRiskVerdict()` / `shouldBlockReward()` — the gate
consulted before reward distribution (see [§1.1](#11-what-block-actually-means-at-each-stage)),
**not** whether a referral is accepted at creation time.

| Rule result | ML result | Decision |
|---|---|---|
| Any PENDING/CONFIRMED `FraudFlag` for the user\*\* | Any | **Block** — rule wins, ML not consulted |
| No rule flag | MEDIUM+ rule flag co-occurring with ML MEDIUM+ anomaly | **Ensemble block** |
| No rule flag | CRITICAL | **Block** — auto-escalated for immediate review |
| No rule flag | HIGH | **Alert only** — async admin review, no real-time block |
| No rule flag | LOW/MEDIUM alone | **Alert only** — async admin review |
| No rule flag | No anomaly | **Allow** |

\*\* `FraudDetector.shouldBlockReward()` checks for **any** severity of pending/confirmed
flag, not just HIGH — in practice this is almost always a HIGH flag today because
`IP_MATCH`/`DEVICE_MATCH` (the only checks that produce `MEDIUM`) are stubbed off.
**See the userId caveat in [§8](#8-known-limitations) — this check currently never
matches referral-sourced flags.**

---

## 2. Data Models

Two separate tables track fraud evidence:

- **`FraudFlag`** — rule-based flags, linked to a specific `Referral` (`referralId`)
  and optionally a `userId`. Statuses: `PENDING`, `REVIEWED`, `CONFIRMED`, `DISMISSED`.
- **`FraudAlert`** — statistical/ensemble alerts on transactions, always keyed by
  `userId`. Statuses: `OPEN`, `REVIEWING`, `RESOLVED`, `DISMISSED`. Has a `source`
  field (`ML`, `RULE`, `ENSEMBLE`) — in the current code, every alert is created with
  `source: 'ML'`; `'RULE'` and `'ENSEMBLE'` are supported by the schema but not yet
  produced by any code path.

---

## 3. API Endpoints (all require admin JWT unless noted)

```
POST /api/fraud/analyze               — run statistical analysis on a transaction manually
GET  /api/fraud/anomalies?days=30     — batch contribution anomaly scan
GET  /api/fraud/risk/:userId          — full ensemble verdict for a user
GET  /api/fraud/alerts                — list alerts (filter by status/severity/userId)
GET  /api/fraud/alerts/pending        — queue of OPEN/REVIEWING alerts
POST /api/fraud/alerts/:id/review     — resolve or dismiss an alert
POST /api/fraud/alerts/:id/feedback   — record false positive/negative
POST /api/fraud/models/retrain        — train and validate a candidate model
POST /api/fraud/models/:id/rollback   — restore a retired model version
GET  /api/fraud/my-flags              — user's own alerts (user auth, not admin)
```

> ⚠️ `POST /api/fraud/alerts/:id/review` currently has an argument-order bug — see
> [§8](#8-known-limitations) before relying on it during an incident.

---

## 4. Investigating a Flagged Case

### Step 1: Identify what flagged it

```bash
# Get ensemble verdict for the user
GET /api/fraud/risk/{userId}
```

Check the response:
- `ruleBlocked: true` → a `FraudFlag` record blocked them; go to Step 2a.
- `mlSeverity: "CRITICAL"` or `shouldBlock: true` (ensemble) → a `FraudAlert` drove the decision; go to Step 2b.

### Step 2a: Investigating a Rule-Based Flag (`FraudFlag`)

Query: `SELECT * FROM "FraudFlag" WHERE "userId" = '{userId}' ORDER BY "createdAt" DESC;`

If nothing comes back but you know a referral involving this user was flagged, also check
by referral: `SELECT * FROM "FraudFlag" WHERE "referralId" IN (SELECT id FROM "Referral" WHERE "referrerId" = '{userId}' OR "refereeId" = '{userId}');`
— referral-sourced flags are not guaranteed to have `userId` populated (see [§8](#8-known-limitations)).

| `flagType` | What it means | Evidence to check |
|---|---|---|
| `SELF_REFERRAL` | Referrer ID == Referee ID | Check user accounts for shared identity |
| `BULK_CREATION` | ≥3 referrals from same IP in 24h | Redis key `fraud:ip:{ip}` — check count |
| `IP_MATCH` | Referee IP matches referrer's IP | Currently a stub (always false) — review code before trusting |
| `DEVICE_MATCH` | Referee device matches referrer's device | Currently a stub (always false) — review code before trusting |

There is **no HTTP endpoint to review a `FraudFlag`**. `FraudOrchestrator.reviewFraudFlag()`
(which calls `FraudDetector.reviewFlag()`, setting `status` to `REVIEWED`/`CONFIRMED`/`DISMISSED`)
exists in code but is not called from any route — see [§8](#8-known-limitations). Until it's
wired up, review directly:
```sql
UPDATE "FraudFlag"
SET status = 'CONFIRMED', -- or 'DISMISSED' / 'REVIEWED'
    "reviewedAt" = NOW(),
    "reviewedBy" = '{your admin userId}'
WHERE id = '{flagId}';
```

### Step 2b: Investigating an ML Alert (`FraudAlert`)

```bash
GET /api/fraud/alerts?userId={userId}&status=OPEN
```

Check the `details` JSON field — it contains:
- `reasons[]` — text explanation of why the alert fired (e.g. `"Amount z-score 4.2 — far above historical average"`)
- `amount` — the transaction amount that triggered it
- `groupId` — the group involved
- `ipAddress` — IP at time of transaction

Cross-check against `Contribution` history:
```sql
SELECT amount, "createdAt", "groupId"
FROM "Contribution"
WHERE "userId" = '{userId}'
ORDER BY "createdAt" DESC
LIMIT 20;
```

Look for:
- Sudden large contributions vs. a small, consistent historical baseline
- Many contributions within a 1-hour window
- Joining many groups in quick succession

### Step 3: Make a review decision

**If it's a real fraud case:**
```
POST /api/fraud/alerts/{alertId}/review
{ "status": "RESOLVED", "resolution": "Confirmed fraudster — account suspended. Evidence: ..." }
```
Then suspend the user via `/api/admin/users/{userId}/suspend`.

**If it's a false positive:**
```
POST /api/fraud/alerts/{alertId}/feedback
{ "outcome": "FALSE_POSITIVE", "notes": "User is a registered merchant with high volume — expected behaviour" }
```
This dismisses the alert and tags it for threshold calibration review.

**If it's unclear:**
Escalate by leaving the alert in `REVIEWING` status and tagging the case in the team's fraud-review channel with the `alertId` and your initial assessment.

---

## 5. Feedback Loop & Threshold Calibration

All admin review decisions are persisted in `FraudAlert.resolution`.

To periodically recalibrate detection thresholds, run:
```sql
-- Count false positives and false negatives over the last 90 days
SELECT
  CASE
    WHEN resolution LIKE '[FALSE_POSITIVE]%' THEN 'FALSE_POSITIVE'
    WHEN resolution LIKE '[FALSE_NEGATIVE]%' THEN 'FALSE_NEGATIVE'
    ELSE 'TRUE_POSITIVE'
  END AS outcome,
  COUNT(*) AS count,
  AVG(score) AS avg_score
FROM "FraudAlert"
WHERE "createdAt" > NOW() - INTERVAL '90 days'
  AND "reviewedAt" IS NOT NULL
GROUP BY 1;
```

There are two distinct levers, and they're recalibrated differently:

- **`anomalyThreshold`** (the score cutoff that decides `isAnomaly`, default 30) is
  the primary, *versioned* lever — it's what `POST /api/fraud/models/retrain`
  (see [§6](#6-model-retraining-versioning--rollback)) actually tunes from labeled
  outcomes. Prefer retraining over a manual edit; it validates the candidate against
  held-out data before activating it.
- The three underlying heuristic constants that feed into the `score`
  (transaction-frequency cutoff `>10`/1h, amount z-score cutoff `> 3`, group-join
  cutoff `>5`/1h, all in `MLFraudDetectionService.detectPatterns`) are **hardcoded**,
  not affected by retraining, and require a code change + PR to adjust.

If false-positive rate is high → retrain (adjusts `anomalyThreshold` automatically), or
raise the hardcoded z-score/frequency constants above if a specific signal is noisy.
If false-negative rate is high → retrain, lower a hardcoded constant, or add new rule
checks in `FraudDetector`.

---

## 6. Model Retraining, Versioning & Rollback

Reviewed alert outcomes are the labeled dataset. Use the feedback endpoint with
`FALSE_POSITIVE` or `FALSE_NEGATIVE`; confirmed-fraud resolutions are also
accepted when the resolution contains `confirmed fraud`. At least 10 labeled
alerts are required before retraining starts.

Retraining runs automatically at **04:00 UTC on the first day of every month**
(`cron/scheduler.ts`, `0 4 1 * *`), or can be started manually by an admin with
`POST /api/fraud/models/retrain`. The statistical detector is versioned as a
`FraudModelVersion` record with its threshold, training count, validation count,
precision, recall, and F1 score. Alerts store the model version that produced them.

The data is split chronologically: the first 80% trains the candidate threshold
and the final 20% is held out for validation. A candidate is activated only if
its held-out F1 is at least the active model's F1. A weaker candidate remains
`CANDIDATE` and cannot affect decisions. To restore a prior version, an admin
posts to `POST /api/fraud/models/{modelId}/rollback`; only `RETIRED` versions
can be restored.

## 7. Redis Keys

| Key pattern | Purpose | TTL |
|---|---|---|
| `fraud:ip:{ipAddress}` | Referral count per IP | 24 hours |

To manually check or reset an IP's referral counter:
```bash
redis-cli GET fraud:ip:1.2.3.4
redis-cli DEL fraud:ip:1.2.3.4   # use with caution — logs the action
```

---

## 8. Known Limitations

- `checkIPMatch` and `checkDeviceMatch` in `FraudDetector` are **stubs** (always return `false`). They require a `UserMetadata` table to store historical IPs/fingerprints. Do not rely on these checks until implemented.
- The statistical service uses a versioned z-score/heuristic threshold, not a learned feature model. Accuracy depends on having sufficient contribution history (≥5 data points) and reviewed labels. New users are under-detected.
- The `FraudAlert` model does not yet have a foreign-key relation to `User` — it stores `userId` as a plain string. This is intentional to avoid cascade issues, but means no Prisma relational query is available.

### Verified during this review (2026-08-27) — not yet fixed, no tracking issue filed yet

- **`FraudFlag.userId` is never populated for referral-sourced flags.**
  `referralService.createReferral()` writes `FraudFlag` rows with only `referralId`
  set (`src/services/referralService.ts`, the loop that persists `cachedFraudCheck.flags`).
  `FraudOrchestrator.persistReferralFlags()` has the same gap and, separately, isn't
  actually called from `referralService` at all — `referralService` writes flags
  directly via Prisma instead of going through the orchestrator. Net effect:
  `FraudDetector.shouldBlockReward(userId)` — the gate `RewardEngine` consults before
  granting **achievement/milestone** rewards, and before granting referral rewards for
  a *different, non-flagged* referral by the same user — queries `FraudFlag` by
  `userId` and will never match these rows. The one exception is the specific flagged
  referral itself, which is still blocked via the `status: 'FLAGGED'` path described
  in [§1.1](#11-what-block-actually-means-at-each-stage). **If you're investigating
  why a known-fraudulent user is still receiving unrelated rewards, this is
  the first place to check** — query by `referralId` per Step 2a above rather than
  trusting an empty `userId`-keyed result.
- **No route exposes `FraudOrchestrator.reviewFraudFlag()`.** The method (and the
  `FraudDetector.reviewFlag()` it delegates to) is fully implemented but nothing in
  `routes/fraud.ts` calls it, so `FraudFlag.status` can currently only be moved out of
  `PENDING` via a direct DB write — see Step 2a above.
- **`FraudOrchestrator.reviewAlert()` passes its arguments to
  `MLFraudDetectionService.reviewAlert()` in the wrong order** (`FraudOrchestrator.ts`,
  the `reviewAlert` method): it calls `this.ml.reviewAlert(alertId, reviewerId, status,
  resolution)`, but the callee's signature is `(alertId, resolution, reviewerId,
  status)`. This is the code path behind `POST /api/fraud/alerts/:id/review` used in
  [§4 Step 3](#step-3-make-a-review-decision). Until this is fixed, verify after
  calling that endpoint that `FraudAlert.resolution` actually contains your resolution
  text and not the reviewer's admin ID — if it's swapped, fall back to updating the
  row directly and note it in the incident log.

---

## 9. Ownership

| Component | On-call owner |
|---|---|
| Rule-based flags (`FraudFlag`) | Referral team (moderation:write permission required) |
| ML alerts (`FraudAlert`) | Platform team (moderation:write permission required) |
| Redis IP counters | Infrastructure team |
| Threshold calibration | Data/Analytics team (quarterly review recommended) |

---

## 10. Keeping this runbook accurate

This document went stale once already (the #804/#831 rework left it describing the
pre-reconciliation architecture). To stop that from silently happening again: any PR
that touches `FraudDetector.ts`, `FraudOrchestrator.ts`, `mlFraudDetectionService.ts`,
the fraud-related parts of `referralService.ts` / `RewardEngine.ts`, or the
`FraudFlag`/`FraudAlert`/`FraudModelVersion` Prisma models should confirm this runbook
still matches, and update it in the same PR if not. This is called out explicitly in
the repo's [Pull Request Checklist](../../CONTRIBUTING.md#-pull-request-checklist).
