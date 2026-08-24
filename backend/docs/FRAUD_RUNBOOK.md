# Fraud Detection — On-Call Runbook

> **Last updated:** 2026-07-28  
> **Architecture:** Two-stage ensemble (rule-based fast pass + ML anomaly detection)  
> **Authoritative entry point:** `src/services/FraudOrchestrator.ts`

---

## 1. Architecture Overview

The system has **two fraud subsystems** that run in a defined sequence, coordinated by `FraudOrchestrator`:

| Layer | File | When it runs | What it checks |
|---|---|---|---|
| **Stage 1 — Rules** | `FraudDetector.ts` | At referral-claim time (synchronous) | Self-referral, IP bulk-creation (Redis), device fingerprint, IP match |
| **Stage 2 — ML** | `MLFraudDetectionService.ts` | After contribution submission (async) | Transaction frequency, amount z-score vs. history, group-joining rate |

### Disagreement Resolution Logic

| Rule result | ML result | Decision |
|---|---|---|
| HIGH block | Any | **Block** — rule wins, ML not consulted |
| MEDIUM flags | MEDIUM+ anomaly | **Ensemble block** — both systems agree on elevated risk |
| Pass | CRITICAL | **Block** — auto-escalated for immediate review |
| Pass | HIGH | **Alert only** — async admin review, no real-time block |
| Pass | LOW/MEDIUM alone | **Alert only** — async admin review |
| Pass | No anomaly | **Allow** |

---

## 2. Data Models

Two separate tables track fraud evidence:

- **`FraudFlag`** — rule-based flags, linked to a specific `Referral`. Statuses: `PENDING`, `REVIEWED`, `CONFIRMED`, `DISMISSED`.
- **`FraudAlert`** — ML/ensemble alerts on transactions. Statuses: `OPEN`, `REVIEWING`, `RESOLVED`, `DISMISSED`. Has a `source` field (`ML`, `RULE`, `ENSEMBLE`).

---

## 3. API Endpoints (all require admin JWT)

```
POST /api/fraud/analyze               — run ML on a transaction manually
GET  /api/fraud/anomalies?days=30     — batch contribution anomaly scan
GET  /api/fraud/risk/:userId          — full ensemble verdict for a user
GET  /api/fraud/alerts                — list alerts (filter by status/severity/userId)
GET  /api/fraud/alerts/pending        — queue of OPEN/REVIEWING alerts
POST /api/fraud/alerts/:id/review     — resolve or dismiss an alert
POST /api/fraud/alerts/:id/feedback   — record false positive/negative
POST /api/fraud/models/retrain        — train and validate a candidate model
POST /api/fraud/models/:id/rollback   — restore a retired model version
GET  /api/fraud/my-flags              — user's own alerts (user auth)
```

---

## 4. Investigating a Flagged Case

### Step 1: Identify what flagged it

```bash
# Get ensemble verdict for the user
GET /api/fraud/risk/{userId}
```

Check the response:
- `ruleBlocked: true` → a `FraudFlag` record blocked them; go to Step 2a.
- `mlSeverity: "CRITICAL"` or `shouldBlock: true` (ensemble) → an `FraudAlert` drove the decision; go to Step 2b.

### Step 2a: Investigating a Rule-Based Flag (`FraudFlag`)

Query: `SELECT * FROM "FraudFlag" WHERE "userId" = '{userId}' ORDER BY "createdAt" DESC;`

| `flagType` | What it means | Evidence to check |
|---|---|---|
| `SELF_REFERRAL` | Referrer ID == Referee ID | Check user accounts for shared identity |
| `BULK_CREATION` | >3 referrals from same IP in 24h | Redis key `fraud:ip:{ip}` — check count |
| `IP_MATCH` | Referee IP matches referrer's IP | Currently a stub (always false) — review code before trusting |
| `DEVICE_MATCH` | Referee device matches referrer's device | Currently a stub (always false) — review code before trusting |

Review the flag via API or directly:
```
POST /api/fraud/alerts/:flagId/review
{ "status": "CONFIRMED" | "DISMISSED", "resolution": "..." }
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

If false-positive rate is high → increase z-score threshold in `MLFraudDetectionService.detectPatterns` (currently z > 3).  
If false-negative rate is high → decrease the threshold or add new rule checks in `FraudDetector`.

---

## 6. Model Retraining, Versioning & Rollback

Reviewed alert outcomes are the labeled dataset. Use the feedback endpoint with
`FALSE_POSITIVE` or `FALSE_NEGATIVE`; confirmed-fraud resolutions are also
accepted when the resolution contains `confirmed fraud`. At least 10 labeled
alerts are required before retraining starts.

Retraining runs automatically at 04:00 UTC on the first day of every month,
or can be started manually by an admin with `POST /api/fraud/models/retrain`.
The statistical detector is versioned as a `FraudModelVersion` record with its
threshold, training count, validation count, precision, recall, and F1 score.
Alerts store the model version that produced them.

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
- The ML service uses a versioned statistical z-score threshold, not a learned feature model. Accuracy depends on having sufficient contribution history (≥5 data points) and reviewed labels. New users are under-detected.
- The `FraudAlert` model does not yet have a foreign-key relation to `User` — it stores `userId` as a plain string. This is intentional to avoid cascade issues, but means no Prisma relational query is available.

---

## 9. Ownership

| Component | On-call owner |
|---|---|
| Rule-based flags (`FraudFlag`) | Referral team (moderation:write permission required) |
| ML alerts (`FraudAlert`) | Platform team (moderation:write permission required) |
| Redis IP counters | Infrastructure team |
| Threshold calibration | Data/Analytics team (quarterly review recommended) |
