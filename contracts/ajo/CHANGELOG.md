# Changelog

All notable changes to the Ajo Soroban contract are documented here.

This changelog is written for **contract integrators** (backend developers, SDK/client
developers, and third-party consumers). It describes contract-facing changes
independently from the repository's general development history.

## Schema Versioning

The contract uses an on-chain schema version (`CURRENT_SCHEMA_VERSION` in
`storage.rs`) to gate Wasm upgrades. When the serialized shape of persisted
types changes, the version must be incremented and a migration provided.

- **Schema v1** is the initial and current version. All historical entries below
  fall under schema v1 unless noted otherwise.
- If an entry does not affect the on-chain type layout (e.g. internal logic
  fixes, access control hardening, storage classification), the schema version
  is **not** incremented and existing integrations remain compatible.

---

## [Unreleased]

### Schema Version Compatibility

All changes in this section remain at **schema v1**. No migration is required
for on-chain state. Integrators should review behavioral changes below to
determine if client-side updates are needed.

---

## [v1] - Security & Audit Hardening (2026-07-16 to 2026-07-24)

Schema v1 · `CURRENT_SCHEMA_VERSION = 1`

This period covers the contract's first formal audit cycle and associated
remediations. All changes are backward-compatible at the type level; the schema
version was not incremented.

---

### Schema Upgrade Guard (2026-07-16)

**Source:** "Add safe contract upgrade schema guard"

Introduces the on-chain schema versioning mechanism that gates Wasm upgrades.

- **`CURRENT_SCHEMA_VERSION`** constant added to `storage.rs` (initialized to `1`).
- **`SchemaUnsupported`** (error 59): read-side guard — returns `None` from
  `get_group()` when the on-chain schema does not match this Wasm's expected
  version. Fails closed.
- **`SchemaMismatch`** (error 60): write-side guard — `upgrade()` rejects the
  call if the declared `schema_version` does not match `CURRENT_SCHEMA_VERSION`.
- Auto-stamp mechanism: `set_schema_version_if_unset()` stamps `v1` on first
  write to instance storage.
- Upgrade migration regression test added.

**Integrator impact:** None for existing integrations. New error codes 59 and 60
are returned only during contract upgrade attempts. Client SDKs that decode error
codes should be aware of these values.

---

### Security Audit Remediation — Reentrancy, Auth Bypass, Access Control (#794 → PR #819)

**Issue:** [#794](https://github.com/anomalyco/soroban-ajo/issues/794)
**Merged:** PR #819

Audit and remediation of every state-mutating entrypoint in `contract.rs`.

**Findings addressed:**
- **3 HIGH** — reentrancy in payout/refund flows, authorization bypass on
  emergency refunds, unrestricted access to sensitive endpoints.
- **3 MEDIUM** — unbounded-loop DoS on `list_members`/`get_group_disputes`,
  integer overflow risk in financial calculations, event ordering.
- **2 LOW** — missing error context, insufficient input validation.

**Contract-facing changes:**
- `execute_payout`, `execute_refund`, `emergency_refund` refactored to
  checks-effects-interactions (CEI) ordering.
- Dual authorization pattern added for emergency refunds.
- Access control verification added across sensitive endpoints.
- Pagination added for previously unbounded loops.
- Checked arithmetic applied to financial calculations.

**Integrator impact:** Non-breaking. Error responses and return types are
unchanged. Callers that previously relied on the ability to invoke sensitive
endpoints without authorization will now receive `Unauthorized`.

---

### Insurance Subsystem Security Audit (#800 → PR #822)

**Issue:** [#800](https://github.com/anomalyco/soroban-ajo/issues/800)
**Merged:** PR #822

Audit of `auto_verify_insurance_claim`, pool solvency, risk scoring, and
sybil consistency with `reputation.rs`.

**Findings addressed:**
- Self-dealing exploits (members claiming against own defaults).
- Pool solvency under adversarial burst claims.
- Score gaming via `get_member_risk_score`/`get_group_risk_rating`.

**Contract-facing changes:**
- Self-dealing prevention: detects members claiming against their own defaults.
- Pool solvency protection: 5% per-epoch claim limit, 140-day minimum pool life.
- Manufactured default detection added.
- Sybil attack pattern analysis added to risk scoring.
- Rate limiting: 3 claims max per member per epoch.
- `InsurancePool` struct expanded with epoch tracking fields
  (`max_claimable_bps`, `last_epoch_reset`, `epoch_claimed_amount`,
  `epoch_duration`).
- `FraudRiskProfile` and `GroupRiskAssessment` structs added.

**Integrator impact:** Non-breaking for existing integrations. New struct fields
are additive. Callers that construct `InsurancePool` from scratch (e.g. in tests)
must include the new fields. Callers that only read existing fields are
unaffected.

---

### Dispute Resolution & Voting Fairness Audit (#801 → PR #827)

**Issue:** [#801](https://github.com/anomalyco/soroban-ajo/issues/801)
**Merged:** PR #827

Audit of quorum calculation, deadline manipulation, vote-weight fairness, and
tied/non-quorate-at-deadline behavior in dispute and refund-voting entrypoints.

**Findings addressed:**
- **Quorum-of-one:** `resolve_dispute` and `execute_refund` computed approval as
  % of votes cast with no minimum participation floor. One voter could force
  resolution.
- **Defendant self-vote:** `vote_on_dispute` did not prevent defendants from
  voting on their own disputes.
- **Self-filed dispute:** `file_dispute` did not check that `complainant != defendant`.
- **Stuck refund:** `execute_refund` wrote `executed=true, approved=false` then
  returned `Err`, causing Soroban to roll back the write. `request_refund`
  subsequently saw stale state and permanently blocked future requests.

**Contract-facing changes:**
- Quorum now requires ≥50% eligible membership participation, recomputed
  dynamically at resolution time.
- `vote_on_dispute` rejects defendant self-votes with `Unauthorized`.
- `file_dispute` rejects self-filed disputes with `Unauthorized`.
- Non-approval in `execute_refund` now returns `Ok(())` so storage persists
  (prevents the stuck-refund loop).

**Integrator impact:** Non-breaking at the type level. Behavioral changes:
- Disputes and refund requests now require genuine quorum to resolve.
- Defendants can no longer self-vote on disputes.
- Self-filed disputes are rejected.
- Refund execution with non-approval no longer reverts storage writes.

Integrators monitoring dispute outcomes should account for the quorum floor.

---

### Sybil-Resistant Reputation Scoring (#802 → PR #823)

**Issue:** [#802](https://github.com/anomalyco/soroban-ajo/issues/802)
**Merged:** PR #823

Audit of the on-chain credit scoring algorithm for sybil cost analysis,
collusion resistance, and score inflation via minimal self-dealing.

**Findings addressed:**
- Pre-fix sybil cost: Gold tier (620/1000) achievable after 1 completed
  2-member group with 1 stroop/cycle contribution (~$0 in fees).
- Post-fix: sub-threshold groups contribute 0 to the qualifying score.

**Contract-facing changes:**
- `MemberStats` struct: 4 new fields added — `qualifying_contributions`,
  `qualifying_ontime_contribs`, `qualifying_groups_completed`,
  `qualifying_amount_contributed`.
- `compute_credit_score` now derives reliability/completion/volume components
  from qualifying figures instead of raw counters.
- `MIN_REPUTATION_STAKE` constant (10 XLM/cycle) gates which contributions
  count toward the qualifying fields.
- Qualifying increments gated on the group's contribution amount meeting the
  stake threshold in `contribute`, `contribute_with_token`, `execute_payout`,
  and `execute_multi_token_payout`.

**Integrator impact:** Non-breaking for consumers that read `credit_score` and
`tier` from `ReputationScore`. Callers that construct `MemberStats` from scratch
must include the new `qualifying_*` fields. The credit score formula now
requires a minimum contribution threshold, so scores for groups with very low
contribution amounts will be lower than before.

---

### Storage Cost Optimization — TTL Extension & Reclassification (#830 → PR #830)

**Issue:** [#830](https://github.com/anomalyco/soroban-ajo/pull/830)
**Merged:** PR #830 (closes #795)

Storage classification audit and cost optimization pass.

**Findings addressed:**
- `InsurancePool`, `FraudRiskProfile`, and `GroupRiskAssessment` were
  misclassified as instance storage instead of persistent storage.
- No TTL extension existed — a correctness bug since Soroban hard-errors after
  TTL lapses and group cycles can run 90+ days.
- Redundant storage reads and reputation recomputation in `contribute`/`execute_payout`.

**Contract-facing changes:**
- `InsurancePool`, `FraudRiskProfile`, `GroupRiskAssessment` reclassified from
  instance → persistent storage.
- TTL extension (~120 days) added on every persistent write, on-read for
  `get_group`/`get_group_metadata`, and once per call for `contribute`/`execute_payout`
  instance-storage entries.
- Eliminated duplicate `MemberStats` re-fetches in `update_member_reputation`.
- Eliminated duplicate reputation recomputation in `execute_payout`.

**Integrator impact:** Non-breaking. No type or API changes. Existing groups
with long-running cycles will no longer risk data loss from TTL expiry.
Integrators do not need to take any action.

---

## Prior History

Before the schema versioning system was introduced (2026-07-16), the contract
underwent significant feature development. Key milestones that established the
current v1 type layout include:

| Date (approx.) | Change | Schema Impact |
|-----------------|--------|---------------|
| 2026-03 | Multi-token support (`TokenConfig`, `MultiTokenConfig`, `TokenContribution`) | Part of v1 |
| 2026-03 | Dynamic payout ordering strategies (`PayoutOrderingStrategy`) | Part of v1 |
| 2026-03 | Group templates (`GroupTemplate`, `TemplateConfig`) | Part of v1 |
| 2026-03 | Dispute resolution system (`Dispute`, `DisputeVote`, `DisputeType`, etc.) | Part of v1 |
| 2026-03 | Contribution reminders & notifications (`MemberNotificationPreferences`, `ReminderRecord`) | Part of v1 |
| 2026-03 | Milestone & achievement system (`MilestoneRecord`, `AchievementRecord`) | Part of v1 |
| 2026-03 | Insurance pool & risk assessment (`InsurancePool`, `FraudRiskProfile`, `GroupRiskAssessment`) | Part of v1 |
| 2026-04 | Reputation & credit scoring system (`ReputationScore`, `CreditScoreSnapshot`, `PaymentHistoryEntry`) | Part of v1 |

All of these features are part of schema v1. The schema versioning mechanism
was introduced after this initial feature set was established.
