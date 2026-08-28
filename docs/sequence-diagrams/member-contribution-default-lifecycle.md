# End-to-End Sequence Diagram: Member Misses a Contribution

**Closes / addresses:** #972  
**Related issues:** #794 (grace period bounds), #800 (manufactured-default fraud detection), #801 (dispute fairness)

---

## Overview

This document traces the complete, connected lifecycle from the moment a member
fails to contribute through every downstream subsystem: grace period detection,
fraud analysis, dispute and insurance claim processing, on-chain payout
execution, notification delivery, and reputation impact.

The goal is exactly what #972 asked for — a **single cross-cutting artifact**
that makes end-to-end behaviour visible, so individually-correct subsystems
can be evaluated for surprising or exploitable combinations that no
per-subsystem test would surface.

---

## Participants

| Participant | Implementation |
|---|---|
| **Member** | Wallet / frontend user |
| **OtherMembers** | All other group members (for votes/notifications) |
| **Recipient** | The member scheduled to receive payout this cycle |
| **AjoContract** | `contracts/ajo/src/contract.rs` (Soroban) |
| **Insurance** | `contracts/ajo/src/insurance.rs` |
| **Reputation** | `contracts/ajo/src/reputation.rs` |
| **CronScheduler** | `backend/src/cron/scheduler.ts` |
| **ScheduleService** | `backend/src/services/scheduleService.ts` |
| **BlockchainListener** | `backend/src/services/blockchainListener.ts` |
| **EventProcessor** | `backend/src/services/eventProcessor.ts` |
| **DisputeService** | `backend/src/services/disputeService.ts` |
| **InsuranceService** | `backend/src/services/insuranceService.ts` |
| **NotificationService** | `backend/src/services/notificationService.ts` |
| **NotificationQueue** | BullMQ `notification` queue + `notificationWorker.ts` |
| **ReminderService** | `backend/src/services/reminderService.ts` |
| **PayoutSaga** | `backend/src/sagas/payoutSaga.ts` |
| **DB** | PostgreSQL via Prisma |
| **Redis** | Dispute cache + BullMQ broker |
| **Horizon** | Stellar Horizon API (event stream) |

---

## Phase Overview

```
Phase 1 │ Cycle opens & pre-miss reminders
Phase 2 │ Due date passes — grace period begins
Phase 3 │ Late-contribution window (still recoverable)
Phase 4 │ Grace period expires — default is confirmed
Phase 5 │ Payout unlocked; on-chain execution
Phase 6 │ Post-default branching:
         │  A. Dispute (governance sanction)
         │  B. Insurance claim (economic compensation)
         │  Both can be raised for the same default — see §6
Phase 7 │ Reputation impact
Phase 8 │ Cross-cutting observations & known gaps
```

---

## Full Sequence Diagram

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                    PHASE 1 — CYCLE OPENS & PRE-MISS REMINDERS                                      │
└────────────────────────────────────────────────────────────────────────────────────────────────────┘

CronScheduler ──────────────────────────────────────────────────────────────────────────────────────
  │  (event: previous cycle's PayoutExecuted received by EventProcessor)
  │
  │  every 1h ──► addScheduleJob({ type: 'send_due_reminders' })
  │
ReminderService.sendContributionReminders()
  │  ├─ Query DB: active groups + members + cycleDeadline
  │  ├─ For each member who has NOT yet contributed this round:
  │  │    └─ if (hoursUntil ≤ prefs.contributionReminderHours)
  │  │         ├─ push  ──► NotificationService.sendToUser(member, { type: 'contribution_due' })
  │  │         ├─ email ──► EmailService.sendContributionReminder(email, groupName, amount, dueDate, cycle, groupId)
  │  │         └─ sms   ──► SmsService.send(phoneNumber, message)
  │  └─ NOTE: reminder cadence is user-preference-driven
  │           (prefs.contributionReminderHours, default: 24h)
  │
  │  On-chain: AjoContract can also emit ReminderType::ContributionDue
  │            when member calls trigger_contribution_reminders()
  │            → backend BlockchainListener sees it but EventProcessor has
  │              ⚠ NO HANDLER for this event type (see §8 Gap #1)


┌────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                    PHASE 2 — DUE DATE PASSES (T = dueAt)                                           │
└────────────────────────────────────────────────────────────────────────────────────────────────────┘

T = dueAt
  │  Member has NOT called AjoContract.contribute()
  │

CronScheduler ──► every 15min ──► addScheduleJob({ type: 'enforce_grace_periods' })
                                          │
ScheduleService.enforceGracePeriods()     │
  │  ├─ Query DB: PaymentWindow rows WHERE status IN ('OPEN','GRACE')
  │  │
  │  ├─ For window where (now > win.dueAt) AND (now < graceCutoff):
  │  │    │  graceCutoff = addHours(win.dueAt, schedule.gracePeriodHours)
  │  │    │  Default gracePeriodHours = 24  (range: 1–168 per #794)
  │  │    │
  │  │    ├─ DB UPDATE PaymentWindow SET status='GRACE'
  │  │    └─ LOG: "Window entered grace period"
  │  │
  │  │  NOTE: No notification is sent here for grace period start.
  │  │        ⚠ See §8 Gap #2
  │  │
  │  └─ returns { graced: N, missed: 0 }   ← missed handled in Phase 4

  AjoContract (on-chain, same moment):
  │  ├─ GroupStatus.is_in_grace_period = true
  │  │  (cycle_end < now <= grace_period_end_time)
  │  │  grace_period_end_time = cycle_start_time + cycle_duration + grace_period
  │  │  Default on-chain grace_period = 86_400s (24h); max = 604_800s (7 days per #794)
  │  │
  │  └─ emit ReminderType::GracePeriod event (if member has grace_period_reminders = true)
  │       → BlockchainListener receives it
  │       → ⚠ EventProcessor has NO handler (see §8 Gap #1)

  ReminderService.sendOverdueReminders()    ← runs every 6h via separate cron
  │  ├─ For each member past deadline who has NOT contributed:
  │  │    ├─ push  ──► "Overdue Contribution — [Group]"
  │  │    ├─ email ──► sendContributionReminder(...) with overdue framing
  │  │    └─ sms   ──► "Overdue Contribution: ... Contribute now to avoid penalties."
  │  └─ This fires repeatedly until contribution is made or window is MISSED


┌────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                    PHASE 3 — LATE-CONTRIBUTION WINDOW (STILL RECOVERABLE)                          │
│                    T ∈ (dueAt, gracePeriodEnd]                                                     │
└────────────────────────────────────────────────────────────────────────────────────────────────────┘

Member ──► AjoContract.contribute(member, group_id)
  │
  AjoContract:
  │  ├─ require_auth(member)
  │  ├─ Check: group not complete, not cancelled
  │  ├─ Check: member is group member
  │  ├─ Check: not already contributed this cycle
  │  ├─ Check balance: member has ≥ contribution_amount tokens
  │  ├─ is_within_grace_period(group, now)?
  │  │    → cycle_end < now <= grace_period_end_time  ✓
  │  │
  │  │  ┌─ LATE CONTRIBUTION PATH ─────────────────────────────────────────────┐
  │  │  │                                                                        │
  │  │  │  token.transfer_from(member → contract, contribution_amount)          │
  │  │  │  + penalty = contribution_amount × penalty_rate / 100                 │
  │  │  │    ├─ penalty tokens added to cycle_penalty_pool in storage           │
  │  │  │    └─ penalty_pool will be paid out to this cycle's recipient         │
  │  │  │                                                                        │
  │  │  │  storage.store_contribution(group_id, cycle, member, true)            │
  │  │  │  stats.late_contributions += 1       ← feeds reputation Phase 7       │
  │  │  │  stats.on_time_contributions  ← NOT incremented                       │
  │  │  │                                                                        │
  │  │  │  If insurance enabled:                                                 │
  │  │  │    premium = contribution_amount × insurance_config.rate_bps / 10_000 │
  │  │  │    insurance.deposit_to_pool(token, premium)                          │
  │  │  │                                                                        │
  │  │  │  reputation.record_payment_event(member, group_id, cycle,             │
  │  │  │    amount, is_late=true, is_payout=false)                             │
  │  │  │  reputation.update_member_reputation(member)  → score drops           │
  │  │  │    emit_reputation_updated, emit_credit_score_changed                 │
  │  │  │                                                                        │
  │  │  │  emit ContributionMade(group_id, member, cycle, amount)               │
  │  │  │                                                                        │
  │  │  └────────────────────────────────────────────────────────────────────────┘
  │  │
  BlockchainListener ──► EventProcessor ──► handleContributionMade(event)
  │  ├─ Deduplicate by txHash (DB lookup)
  │  ├─ DB: addContribution({ groupId, walletAddress, amount, round, txHash })
  │  ├─ NotificationService.sendToUser(member, { type: 'contribution_received',
  │  │    title: 'Contribution Confirmed', message: '...' })   [real-time Socket.IO]
  │  └─ webhookService.triggerEvent(CONTRIBUTION_MADE, { groupId, contributor, amount, txHash, cycle })

  ─── IF MEMBER CONTRIBUTES IN GRACE PERIOD: lifecycle ends here ─────────────────────────────────
      The default is avoided. Late penalty is collected. Payout proceeds in Phase 5.
  ────────────────────────────────────────────────────────────────────────────────────────────────


┌────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                    PHASE 4 — GRACE PERIOD EXPIRES — DEFAULT CONFIRMED                              │
│                    T ≥ graceCutoff = dueAt + gracePeriodHours                                      │
│                    (On-chain: now ≥ cycle_start_time + cycle_duration + grace_period)              │
└────────────────────────────────────────────────────────────────────────────────────────────────────┘

CronScheduler ──► every 15min ──► addScheduleJob({ type: 'enforce_grace_periods' })
                                          │
ScheduleService.enforceGracePeriods()     │
  │  ├─ For window where (now >= graceCutoff) OR (now >= win.closesAt):
  │  │
  │  │    DB UPDATE PaymentWindow SET status='MISSED'
  │  │    LOG WARN: "Payment window missed" { windowId, groupId, cycleNumber }
  │  │
  │  │    ScheduleService.advanceCycle(groupId):
  │  │      ├─ DB UPDATE PaymentWindow (OPEN/GRACE → CLOSED)
  │  │      ├─ newNextDueDate = advanceDate(nextDueDate, frequency, intervalDays)
  │  │      ├─ DB UPDATE ContributionSchedule SET nextDueDate=newNextDueDate
  │  │      └─ openNextWindow(schedule) → new PaymentWindow{ status:'OPEN' }
  │  │
  │  │    ⚠ No notification is sent for MISSED status (see §8 Gap #3)
  │  │    ⚠ No backend event to on-chain to record the missed contribution (see §8 Gap #4)
  │  │
  │  └─ returns { graced: 0, missed: N }

  Any subsequent attempt: Member ──► AjoContract.contribute(member, group_id)
  │  └─ now > grace_period_end_time
  │       → return Err(AjoError::GracePeriodExpired)   ← contribution REJECTED


┌────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                    PHASE 5 — PAYOUT UNLOCKED & ON-CHAIN EXECUTION                                  │
│                    Triggered by: off-chain PayoutSaga or keeper/keeper bot                         │
└────────────────────────────────────────────────────────────────────────────────────────────────────┘

  IMPORTANT: execute_payout() requires ALL members to have contributed.
  If the defaulting member NEVER contributed (not even late), the payout
  will fail with AjoError::IncompleteContributions.

  Resolution path when a member truly defaults:
  ┌──────────────────────────────────────────────────────────────────────────────┐
  │  Option A — Penalty path (member contributed late, incurred penalty):        │
  │    Payout proceeds normally. Recipient receives:                             │
  │      base_payout = contribution_amount × member_count                       │
  │    + penalty_bonus = cycle_penalty_pool (accumulated late fees)              │
  │    = payout_amount                                                           │
  │                                                                              │
  │  Option B — True default (member never contributed at all):                  │
  │    execute_payout() → Err(IncompleteContributions)                          │
  │    → Governance / insurance paths below (Phase 6) must resolve this first   │
  └──────────────────────────────────────────────────────────────────────────────┘

  Assuming Option A (late-paid) or dispute/insurance resolved the shortfall:

PayoutSaga.executePayoutSaga({ groupId, recipientId, recipientAddress, amount, currency, cycleNumber })
  │
  │  Saga ID: "payout-{groupId}-{cycleNumber}"  ← idempotent; crash-safe via SagaInstance
  │
  ├─ Step 1: validate-payout [retryable]
  │    ├─ Confirm group exists and isActive
  │    └─ Confirm no existing payout for (groupId, cycleNumber) in processing/completed
  │
  ├─ Step 2: create-pending-payout-record [retryable, compensatable]
  │    └─ DB UPSERT Payout{ groupId, cycleNumber, status:'processing', ... }
  │         compensation: UPDATE Payout SET status='failed'
  │
  ├─ Step 3: submit-onchain-payout [NOT retryable, irreversible]
  │    └─ sorobanService.executePayout(groupId)
  │         → AjoContract.execute_payout(group_id):
  │              ├─ require: all members contributed (IncompleteContributions guard)
  │              ├─ require: now >= grace_period_end  (OutsideCycleWindow guard)
  │              │
  │              │  ─── EFFECTS (all state changes BEFORE external call) ─────────
  │              │  storage.mark_payout_received(group_id, payout_recipient)
  │              │  group.payout_index += 1
  │              │  if payout_index >= member_count:
  │              │    group.is_complete = true
  │              │  else:
  │              │    group.current_cycle += 1
  │              │    group.cycle_start_time = now
  │              │  storage.store_group(group_id, group)
  │              │  reputation.record_payment_event(recipient, ..., is_payout=true)
  │              │  reputation.update_member_reputation(recipient)
  │              │
  │              │  ─── INTERACTIONS (external calls LAST — CEI pattern per #794) ─
  │              │  token.check_contract_balance(contract, payout_amount) ✓
  │              │  token.transfer_token(contract → recipient, payout_amount)
  │              │
  │              │  ─── EVENTS ──────────────────────────────────────────────────
  │              │  if penalty_bonus > 0:
  │              │    emit PenaltyDistributed(group_id, recipient, cycle, base, bonus)
  │              │  emit PayoutExecuted(group_id, recipient, cycle, amount)
  │              │  emit PayoutOrderDetermined(group_id, cycle, recipient, strategy)
  │              │  if group.is_complete: emit GroupCompleted(group_id)
  │              └─
  │
  ├─ Step 4: finalize-payout-record [retryable]
  │    └─ DB UPDATE Payout SET status='completed', transactionHash=txHash, processedAt=now
  │
  └─ Step 5: notify-recipient [retryable]
       └─ notificationService.send({
            userId: recipientAddress,
            type: 'payout_received',
            title: 'Payout received',
            message: 'You received a payout of {amount} {currency}.',
            channels: ['push', 'websocket']
          })
            → NotificationQueue (BullMQ) ──► notificationWorker
                ├─ push:      sendToUser() via Socket.IO
                ├─ email:     emailService.sendEmail(recipientEmail)
                └─ sms:       smsService.send(recipientPhone)

  BlockchainListener ──► EventProcessor ──► handlePayoutExecuted(event)
  │  ├─ NotificationService.sendToUser(recipient, { type: 'payout_received' })  [real-time]
  │  └─ webhookService.triggerEvent(PAYOUT_EXECUTED, ...)
  │       + webhookService.triggerEvent(PAYOUT_COMPLETED, ...)  ← legacy compat

  BlockchainListener ──► EventProcessor ──► handleCycleAdvanced(event)
  │  └─ DB UPDATE Group SET currentRound=newCycle
  │     webhookService.triggerEvent(CYCLE_STARTED, ...)


┌────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                    PHASE 6A — DISPUTE PATH (GOVERNANCE SANCTION)                                   │
│                    Triggered by: any member, at any point after the default                        │
│                    Can run CONCURRENTLY with Phase 6B (insurance claim)                            │
└────────────────────────────────────────────────────────────────────────────────────────────────────┘

  ── 6A-i: ON-CHAIN DISPUTE ───────────────────────────────────────────────────────────────────────

  Complainant ──► AjoContract.file_dispute(
    complainant, group_id, defendant=defaultingMember,
    dispute_type=DisputeType::NonPayment,
    description, evidence_hash (BytesN<32> — hash of off-chain evidence),
    proposed_resolution=DisputeResolution::Penalty | ::Removal | ...
  )
  │
  AjoContract:
  │  ├─ require_auth(complainant)
  │  ├─ Check: both complainant and defendant are group members
  │  ├─ dispute_id = storage.get_next_dispute_id()
  │  ├─ Dispute{
  │  │    status: DisputeStatus::Open,
  │  │    voting_deadline: now + DISPUTE_VOTING_PERIOD (604_800s = 7 days),
  │  │    proposed_resolution,
  │  │    votes_for_action: 0, votes_against_action: 0
  │  │  }
  │  ├─ storage.store_dispute(dispute_id, dispute)
  │  ├─ storage.store_group_dispute_ids(group_id, [..., dispute_id])
  │  └─ emit DisputeFiled(dispute_id, group_id, complainant, defendant)
  │       → BlockchainListener receives it
  │       → ⚠ EventProcessor has NO handler (see §8 Gap #5)
  │           No DB record, no notification sent to group members

  OtherMembers ──► AjoContract.vote_on_dispute(voter, dispute_id, supports_action: bool)
  │  ├─ Check: dispute is not Resolved/Rejected
  │  ├─ Check: voter is group member
  │  ├─ Check: voter has not already voted
  │  ├─ Check: now <= voting_deadline
  │  ├─ storage.store_dispute_vote(dispute_id, voter, vote)
  │  ├─ dispute.votes_for_action += 1  OR  dispute.votes_against_action += 1
  │  └─ if votes_for_action / total_members >= DISPUTE_APPROVAL_THRESHOLD (66%):
  │         dispute.status = DisputeStatus::Resolved
  │         dispute.final_resolution = proposed_resolution
  │         emit DisputeResolved(dispute_id, group_id, final_resolution)
  │         → ⚠ EventProcessor has NO handler (see §8 Gap #5)
  │             Proposed resolution (Penalty/Removal) is recorded on-chain
  │             but no backend automation executes it

  ── 6A-ii: OFF-CHAIN DISPUTE (parallel Redis-backed system) ──────────────────────────────────────

  Complainant ──► POST /api/disputes  ──► disputeService.fileDispute(
    groupId, filedBy, type='non_payment', summary, evidence[]
  )
  │  ├─ Check: filedBy is group member (via dbService.getGroupMembers)
  │  ├─ Dispute{
  │  │    status: 'voting',
  │  │    votingDeadline: now + DEFAULT_VOTING_WINDOW (172_800s = 48h,
  │  │                    configurable via DISPUTE_VOTING_WINDOW_SECONDS env)
  │  │  }
  │  └─ Redis SET dispute:{id} / SADD group_disputes:{groupId}

  OtherMembers ──► disputeService.voteOnDispute(disputeId, voter, 'yes'|'no')
  │  ├─ Check: dispute exists, status = 'voting', deadline not passed
  │  ├─ Check: voter is group member
  │  ├─ Redis UPDATE dispute votes
  │  └─ tryAutoResolve():
  │       ├─ if yes_votes / totalMembers > 50% → status='resolved', decision='yes'
  │       ├─ if no_votes  / totalMembers > 50% → status='resolved', decision='no'
  │       └─ if now > votingDeadline (no majority) → status='escalated'

  Admin path (escalated disputes):
  disputeService.escalateToAdmin(disputeId) → status='escalated'
  disputeService.adminResolve(disputeId, adminId, decision) → status='resolved'

  ── 6A NOTE: On-chain and off-chain dispute systems are INDEPENDENT ──────────────────────────────
  ⚠  They do not share state, cross-reference each other, or enforce mutual exclusivity.
     A single default can have both an on-chain dispute (7-day, 66% threshold) AND
     an off-chain dispute (48-hour, 50% threshold) open simultaneously, with potentially
     contradictory outcomes. See §8 Gap #6.


┌────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                    PHASE 6B — INSURANCE CLAIM PATH (ECONOMIC COMPENSATION)                        │
│                    Triggered by: Recipient (cycle's scheduled payout recipient)                   │
│                    Requires: group.insurance_config.is_enabled = true                             │
│                    Can run CONCURRENTLY with Phase 6A (dispute)                                   │
└────────────────────────────────────────────────────────────────────────────────────────────────────┘

  ── 6B-i: CLAIM FILING ───────────────────────────────────────────────────────────────────────────

  Recipient ──► POST /api/insurance/claims  ──► insuranceService.fileClaim({
    claimant: recipientAddress,
    groupId, cycle,
    defaulter: defaultingMemberAddress,
    amount: contributionAmount   ← or portion thereof
  })
  │
  insuranceService:
  │  └─ sorobanService.buildUnsignedTransaction(claimant, 'file_insurance_claim', args)
  │       → return { unsignedXdr }  ← user must sign and submit
  │         OR if signedXdr provided: submit directly

  AjoContract.file_insurance_claim(claimant, group_id, cycle, defaulter, amount)
  │
  insurance.file_claim(env, group_id, cycle, claimant, defaulter, amount):
  │  │
  │  ├─ ── FRAUD RISK SCORING ─────────────────────────────────────────────────
  │  │  │
  │  │  ├─ detect_self_dealing(claim):                       +40 pts if claimant == defaulter
  │  │  ├─ detect_manufactured_default(env, claim):          +35 pts if #800 triggered:
  │  │  │    └─ token.get_balance(defaulter) >= contribution_amount × 2
  │  │  │         meaning: defaulter HAD enough funds but chose not to contribute
  │  │  ├─ Suspicious timing:                                +15 pts if claim filed < 1h after default
  │  │  └─ Recent claim frequency:                          +10 pts if >2 claims from claimant in 24h
  │  │
  │  │  Total fraud_risk_score ∈ [0, 100]
  │  │
  │  │  if fraud_risk_score >= HIGH_FRAUD_RISK_THRESHOLD (80):
  │  │    → return Err(AjoError::InvalidClaim)   ← claim REJECTED immediately
  │  │    → emit FraudDetectionAlert(claim_id, member, fraud_type, risk_score)
  │  │         → ⚠ EventProcessor has NO handler (see §8 Gap #7)
  │  │
  │  ├─ InsuranceClaim{
  │  │    status: ClaimStatus::Pending,
  │  │    fraud_risk_score,
  │  │    auto_verified: false,
  │  │  }
  │  ├─ storage.store_insurance_claim(claim_id, claim)
  │  ├─ pool.pending_claims_count += 1
  │  └─ storage.store_insurance_pool(token, pool)

  ── 6B-ii: CLAIM VERIFICATION (AUTOMATED) ────────────────────────────────────────────────────────

  Keeper/bot (or admin) ──► AjoContract.auto_verify_insurance_claim(claim_id)
  │
  insurance.auto_process_claim(env, claim_id):
  │  ├─ Check: claim.status == Pending
  │  ├─ Re-run calculate_fraud_risk_score():
  │  │    if risk >= 80 → auto-reject (update status=Rejected, return Ok)
  │  │
  │  ├─ insurance.verify_claim(env, claim_id):
  │  │    ├─ Check: now >= grace_period_end  (cycle_start_time + cycle_duration + grace_period)
  │  │    │    → if not: return Ok(false)  ← too early to verify
  │  │    ├─ Re-run fraud risk check (≥ 80 → reject)
  │  │    └─ has_contributed = storage.has_contributed(env, group_id, cycle, defaulter)
  │  │         → claim is valid only if !has_contributed  ← defaulter truly missed
  │  │
  │  └─ process_claim(env, claim_id, is_valid):
  │       ├─ if approved:
  │       │    check_pool_solvency(pool, claim.amount):
  │       │      ├─ epoch_limit = pool.balance × MAX_CLAIMABLE_BPS / 10_000 (5% of pool)
  │       │      └─ epoch_claimed + claim.amount <= epoch_limit  else → InsufficientPoolBalance
  │       │    pool.balance -= claim.amount
  │       │    pool.total_payouts += claim.amount
  │       │    claim.status = ClaimStatus::Paid
  │       │    token.transfer_token(contract → claimant, claim.amount)
  │       └─ if rejected:
  │            claim.status = ClaimStatus::Rejected
  │       pool.pending_claims_count -= 1
  │       storage.store_insurance_pool / store_insurance_claim

  ── 6B-iii: MANUAL ADMIN REVIEW ──────────────────────────────────────────────────────────────────

  Admin ──► PUT /api/insurance/claims/:claimId  ──► insuranceService.processClaim({
    admin, claimId, approved: true|false
  })
  │  └─ sorobanService.buildUnsignedTransaction(admin, 'process_insurance_claim', args)
  │       → same on-chain process_claim() path as auto-verification

  ── 6B NOTE: Dispute + Insurance CAN COEXIST ─────────────────────────────────────────────────────
  The code does not enforce mutual exclusivity between a Phase 6A dispute and a Phase 6B
  insurance claim for the same (group_id, cycle, defaulter) triple.

  Scenario that works today:
    1. Recipient files DisputeType::NonPayment on-chain  (seeking removal of defaulter)
    2. Recipient simultaneously files an insurance claim  (seeking monetary compensation)
    3. Dispute resolves: DisputeResolution::Removal — defaulter removed from group
    4. Insurance claim auto-verifies: ClaimStatus::Paid — claimant receives payment

  This is intentional separation of concerns (governance vs. compensation), but it
  opens a question: should a dispute outcome of DisputeResolution::Refund override or
  satisfy the insurance claim, or are they cumulative? The contract does not enforce
  deduplication. See §8 Gap #8.


┌────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                    PHASE 7 — REPUTATION IMPACT                                                     │
└────────────────────────────────────────────────────────────────────────────────────────────────────┘

  Reputation is updated on-chain at specific trigger points (reputation.rs).
  The credit score (0–1000) uses four components:

  Component                │ Weight │ How a true miss affects it
  ─────────────────────────┼────────┼──────────────────────────────────────────────────────────
  Payment reliability      │  40%   │ qualifying_ontime_contribs stays flat; qualifying_total
                           │        │ does NOT increment (no contribution recorded at all).
                           │        │ Next on-time contribution makes the ratio worse
                           │        │ because total has implicitly grown without a matched hit.
  Groups completed         │  20%   │ If the group cannot pay out and is abandoned → 0 credit
                           │        │ for qualifying_groups_completed.
  Volume contributed       │  20%   │ qualifying_amount_contributed stays flat → no tier gain.
  Penalty component        │  20%   │ For a LATE contribution: late_contributions++ → this
                           │        │ component (on_time/total × 200) degrades.
                           │        │ For a TRUE miss (never contributed): no on-time or late
                           │        │ increment — the member is simply absent from the cycle.
  ─────────────────────────┴────────┴──────────────────────────────────────────────────────────

  NOTE: Only groups with contribution_amount >= MIN_REPUTATION_STAKE (10 XLM = 100_000_000 stroops)
  affect the credit score (anti-Sybil gate introduced in PR #823 / issue fix #802).

  Tier thresholds:
    Unrated (0–199) | Bronze (200–399) | Silver (400–599) |
    Gold (600–799) | Platinum (800–899) | Diamond (900–1000)

  Trigger points in the miss lifecycle:

  T1: Member makes LATE contribution (Phase 3)
  │   AjoContract.contribute() → reputation.record_payment_event(is_late=true)
  │                            → reputation.update_member_reputation(member)
  │                            → emit ReputationUpdated, CreditScoreChanged
  │   Impact: penalty component degrades (late_contributions++)

  T2: Payout is executed (Phase 5)
  │   AjoContract.execute_payout() → reputation.record_payment_event(recipient, is_payout=true)
  │                                → reputation.update_member_reputation(recipient)
  │   Impact: recipient score updated (group completion progress)

  T3: Group completes all cycles
  │   AjoContract.execute_payout() final cycle → all members:
  │     stats.total_groups_completed++ / qualifying_groups_completed++
  │     reputation.update_member_reputation(member) for each
  │   Impact: groups_completed component gains for members who contributed
  │   The defaulter who never contributed earns NO qualifying_groups_completed credit.

  ⚠  total_missed_payments on ReputationScore is declared but hardcoded to 0:
     "future: track missed separately" (reputation.rs line ~220).
     A true miss is invisible to the score formula as a distinct signal today.
     See §8 Gap #9.

  After any reputation update:
  NotificationService ─► BlockchainListener ─► (no backend handler for ReputationUpdated)
  ⚠ No backend notification is sent when a member's credit score drops. See §8 Gap #10.


┌────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                    PHASE 8 — CROSS-CUTTING OBSERVATIONS & KNOWN GAPS                              │
└────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## §8 — Cross-Cutting Observations & Known Gaps

These are the findings that emerge from tracing the **combined** flow — issues
that per-subsystem tests would miss because each subsystem's tests hold the
others constant.

### Gap #1 — On-chain reminder events are unhandled by the backend

**Where:** `contracts/ajo/src/events.rs` emits `emit_reminder_triggered` with
`ReminderType::GracePeriod` and `ReminderType::Overdue`. The `BlockchainListener`
receives these but `EventProcessor`'s `switch` has no `case` for them.

**Risk:** Off-chain notification delivery for the grace period window depends
entirely on the backend's polling cron (`sendOverdueReminders` every 6h). If the
cron is delayed or missed, members in the grace window receive no notification.
The on-chain trigger exists and fires — it just silently disappears at the
backend boundary.

**Affected files:** `backend/src/services/eventProcessor.ts`,
`backend/src/handlers/contractEventHandlers.ts`

---

### Gap #2 — No notification is sent when a PaymentWindow transitions to GRACE

**Where:** `scheduleService.enforceGracePeriods()` updates
`PaymentWindow.status = 'GRACE'` but emits no notification.

**Risk:** Members learn their window is in grace only via the periodic overdue
reminder (up to 6h later) or by querying the API. A member who checks their
wallet balance right after `dueAt` and sees no urgent notification may not
realise the penalty clock has started.

**Affected files:** `backend/src/services/scheduleService.ts`

---

### Gap #3 — No notification is sent when a PaymentWindow is marked MISSED

**Where:** Same `enforceGracePeriods()` loop — the `MISSED` state change happens
silently. There is no `notificationService.send(...)` call after the
`status='MISSED'` DB write.

**Risk:** The defaulting member, the group, and the scheduled Recipient are
all unaware that the window has closed via backend observation. Downstream
actions (filing a dispute or insurance claim) may be delayed simply because no
one was alerted.

**Affected files:** `backend/src/services/scheduleService.ts`

---

### Gap #4 — Off-chain MISSED state is not propagated back on-chain

**Where:** When `scheduleService` marks a `PaymentWindow` as `MISSED`, there is
no corresponding on-chain call to record the miss. The Soroban contract learns
about the miss only indirectly — when `execute_payout()` is called and the
`all_members_contributed` check fails.

**Risk:** The on-chain `MemberStats` record never gains a `late_contributions`
or missed-payment entry for a true miss, because no `contribute(is_late=true)`
call is ever made. The reputation system therefore cannot distinguish "never
contributed" from "joined but cycle not yet due" — both appear as
`total_contributions = 0` for that cycle.

**Affected files:** `backend/src/services/scheduleService.ts`,
`contracts/ajo/src/reputation.rs`

---

### Gap #5 — On-chain dispute events have no backend handlers

**Where:** `contracts/ajo/src/events.rs` emits `emit_dispute_filed` and
`emit_dispute_resolved`. The `EventProcessor` switch does not handle them.

**Risk:**
- No DB record of on-chain disputes is created (only off-chain Redis disputes are persisted).
- No notification is sent to group members when a dispute is filed or resolved on-chain.
- Dispute `final_resolution` outcomes (e.g. `DisputeResolution::Removal`) are
  recorded on-chain but **no backend automation executes them** — removal of the
  member from the group DB, suspension of notifications, etc., must be done manually.

**Affected files:** `backend/src/services/eventProcessor.ts`,
`backend/src/handlers/contractEventHandlers.ts`

---

### Gap #6 — On-chain and off-chain dispute systems are siloed

**Where:** `disputeService.ts` (off-chain, Redis) and `AjoContract.file_dispute`
(on-chain, Soroban storage) are completely independent. They share no state,
cross-reference, or deduplication key.

**Risk:**
- The same default can have one on-chain dispute (7-day, 66% threshold) and
  one off-chain dispute (48-hour, 50% threshold) open at the same time.
- The two systems can reach **contradictory resolutions**: off-chain resolves
  "yes, sanction the member" while on-chain resolves "no action" (or vice versa).
- Neither system prevents this.
- The threshold asymmetry (50% off-chain vs 66% on-chain) means a smaller
  coalition can close the off-chain dispute with a "yes" while the on-chain vote
  is still open, potentially poisoning the voting atmosphere.

**Affected files:** `backend/src/services/disputeService.ts`,
`contracts/ajo/src/contract.rs`

---

### Gap #7 — FraudDetectionAlert events have no backend handler

**Where:** `insurance.rs` calls `emit_fraud_detection_alert` when a claim is
rejected for high fraud risk. `EventProcessor` has no case for this event.

**Risk:** Fraudulent-claim attempts are silently rejected on-chain. No admin
alert, no DB record, no user notification. A persistent attacker making
repeated manufactured-default claims (all scoring < 80, so they slip through)
would not accumulate any visible flag in the backend.

**Affected files:** `backend/src/services/eventProcessor.ts`,
`backend/src/handlers/contractEventHandlers.ts`

---

### Gap #8 — Dispute resolution and insurance payout are not deduplicated

**Where:** `AjoContract.file_dispute` and `insurance.file_claim` are
independent entry points with no cross-check on (group_id, cycle, defaulter).

**Risk:** A recipient can receive economic compensation twice:
1. Insurance claim pays out `claim.amount` from the pool.
2. Dispute resolves with `DisputeResolution::Refund`, which triggers a separate
   refund path.

This is the most financially exploitable gap in the combined flow. The
`RefundRequest` voting mechanism (also on-chain) is a third independent
compensation path, making the total count three separate ways to claim for the
same default event.

**Affected files:** `contracts/ajo/src/insurance.rs`,
`contracts/ajo/src/contract.rs` (`file_dispute`, `vote_on_refund_request`)

---

### Gap #9 — True missed contributions are invisible to the reputation formula

**Where:** `reputation.rs` — `total_missed_payments` is declared on
`ReputationScore` but hardcoded to `0` with the comment
`// future: track missed separately`.

**Risk:** A member who never contributes in a cycle scores identically to a
member who is a first-time participant with no history. The penalty component
(0–200 pts) is based on `late_contributions` (which requires an actual late
`contribute()` call) — but a true miss generates no `contribute()` call at all,
so the formula never sees it.

**Affected files:** `contracts/ajo/src/reputation.rs`

---

### Gap #10 — No notification is sent when a member's credit score drops

**Where:** `reputation.rs` emits `emit_credit_score_changed` on-chain, but
`EventProcessor` has no handler, and no backend notification is queued.

**Risk:** Members receive no out-of-band alert when their tier drops (e.g.,
Gold → Silver after a late payment). The score change is visible only via a
direct API query. Combined with Gap #9, a member who truly defaults may never
learn their credit standing was affected.

**Affected files:** `backend/src/services/eventProcessor.ts`

---

## §9 — Compact Textual Sequence (TL;DR)

```
1. Cycle opens
   ScheduleService.openNextWindow() → PaymentWindow{OPEN}
   AjoContract: cycle_start_time set

2. Pre-miss reminders (hourly cron, per-member preference)
   ReminderService → push / email / SMS

3. dueAt passes — grace period clock starts (15-min cron)
   ScheduleService.enforceGracePeriods():
     PaymentWindow{OPEN} → {GRACE}
   AjoContract: is_in_grace_period = true
   ⚠ No notification fired here

4. Grace window: late contributions still accepted on-chain
   AjoContract.contribute() → penalty levied
   stats.late_contributions++
   reputation.update_member_reputation() → score drops (penalty component)
   emit ContributionMade → handleContributionMade → push notification

5. graceCutoff passes — default confirmed (15-min cron)
   ScheduleService.enforceGracePeriods():
     PaymentWindow{GRACE} → {MISSED}
     advanceCycle() → next window opened
   AjoContract: GracePeriodExpired returned to any contribute() attempt
   ⚠ No notification fired here

6. Payout (after grace_period_end)
   PayoutSaga steps 1–5 → AjoContract.execute_payout()
   CEI pattern: state changes BEFORE token.transfer_token()
   emit PayoutExecuted → handlePayoutExecuted → push notification

7. Dispute (governance, optional, any time after default)
   On-chain:  file_dispute() → vote_on_dispute() → auto-resolve at 66%  [7-day window]
   Off-chain: POST /disputes  → voteOnDispute()  → auto-resolve at 50%  [48-hour window]
   ⚠ Both paths independent; no cross-state; no shared deduplication
   ⚠ No backend event handlers for either on-chain dispute event

8. Insurance claim (compensation, optional, if enabled)
   POST /insurance/claims → file_claim() → fraud scoring (<80 passes)
   → ClaimStatus::Pending
   → auto_verify_insurance_claim():
       verify_claim() (now >= grace_end && !has_contributed)
       process_claim():  pool.balance -= amount; token.transfer → claimant
   ⚠ No deduplication against dispute refund path

9. Reputation
   True miss:  reliability & volume components stagnate (no contribution recorded)
   Late miss:  late_contributions++ → penalty component (0-200) degrades
   ⚠ total_missed_payments hardcoded 0 — no distinct miss signal in formula
```

---

## §10 — Data Flow Summary: Which System Owns What

| Concern | Source of truth | Persistence |
|---|---|---|
| Grace period duration | `ContributionSchedule.gracePeriodHours` (backend DB) | PostgreSQL |
| Grace period enforcement | `ScheduleService.enforceGracePeriods()` | PaymentWindow row |
| On-chain grace boundary | `Group.grace_period` (Soroban storage) | Ledger |
| Contribution record | `Contribution` row + on-chain storage | Both |
| Dispute (off-chain) | `disputeService` | Redis |
| Dispute (on-chain) | `AjoContract.file_dispute` | Ledger |
| Insurance pool | `InsurancePool` (on-chain) | Ledger |
| Insurance claim | `InsuranceClaim` (on-chain) | Ledger |
| Fraud risk score | `calculate_fraud_risk_score()` (on-chain, at claim time) | Ephemeral / claim record |
| Credit score | `reputation.rs` `compute_credit_score()` | Ledger (`ReputationScore`) |
| Notifications | `notificationService` + `reminderService` | BullMQ / Socket.IO |
| Payout saga state | `SagaInstance` | PostgreSQL |

---

## References

- Issue #794 — Grace period bounds and CEI security audit
- Issue #800 — Manufactured-default fraud detection
- Issue #801 — Dispute fairness
- Issue #972 — This document (end-to-end lifecycle cross-cut)
- `contracts/ajo/src/contract.rs` — `contribute()`, `execute_payout()`, `file_dispute()`
- `contracts/ajo/src/insurance.rs` — `file_claim()`, `auto_process_claim()`, `verify_claim()`
- `contracts/ajo/src/reputation.rs` — `compute_credit_score()`, `update_member_reputation()`
- `backend/src/services/scheduleService.ts` — `enforceGracePeriods()`, `advanceCycle()`
- `backend/src/services/disputeService.ts` — off-chain dispute system
- `backend/src/services/insuranceService.ts` — insurance claim API
- `backend/src/sagas/payoutSaga.ts` — crash-safe payout orchestration
- `backend/src/services/notificationService.ts` — multi-channel notification delivery
- `backend/src/services/reminderService.ts` — scheduled reminder dispatch
- `backend/src/handlers/contractEventHandlers.ts` — on-chain event handlers
- `backend/prisma/schema.prisma` — `ContributionSchedule`, `PaymentWindow`, `Payout`, `SagaInstance`

---

## §11 — Mermaid Sequence Diagram (GitHub-renderable)

The diagram below covers the core happy-path-to-default flow. Sub-flows for
dispute voting and saga compensation steps are collapsed for readability; the
detailed prose in §§1–9 above covers every edge.

```mermaid
sequenceDiagram
    autonumber

    participant M  as Member
    participant AC as AjoContract
    participant SS as ScheduleService<br/>(cron/15min)
    participant RS as ReminderService<br/>(cron/1h & 6h)
    participant BL as BlockchainListener
    participant EP as EventProcessor
    participant IS as InsuranceService
    participant DS as DisputeService
    participant PS as PayoutSaga
    participant NS as NotificationService
    participant DB as DB (Postgres)
    participant RD as Redis

    rect rgb(230,245,255)
        Note over SS,DB: PHASE 1 — Cycle opens
        SS->>DB: openNextWindow() → PaymentWindow{OPEN}
        SS->>AC: (cycle_start_time already set on CycleAdvanced event)
    end

    rect rgb(230,255,230)
        Note over RS,NS: PHASE 1 — Pre-miss reminders (hourly)
        RS->>DB: Query members without contribution & hoursUntil ≤ pref
        RS->>NS: sendContributionReminders() → push / email / SMS
        Note right of NS: ReminderType::ContributionDue
    end

    rect rgb(255,255,220)
        Note over SS,AC: PHASE 2 — dueAt passes; grace period starts
        SS->>DB: enforceGracePeriods()
        DB-->>SS: windows WHERE status=OPEN AND now > dueAt AND now < graceCutoff
        SS->>DB: UPDATE PaymentWindow SET status='GRACE'
        Note right of SS: ⚠ No notification emitted (Gap #2)
        AC->>AC: is_in_grace_period = true<br/>(cycle_end < now ≤ grace_period_end)
        RS->>NS: sendOverdueReminders() → push/email/SMS every 6h
    end

    rect rgb(255,240,220)
        Note over M,AC: PHASE 3 — Late contribution (still recoverable)
        M->>AC: contribute(member, group_id)
        AC->>AC: is_within_grace_period? ✓
        AC->>AC: transfer_token(member→contract, amount + penalty)
        AC->>AC: stats.late_contributions++
        AC->>AC: reputation.update_member_reputation() — score drops
        AC-->>BL: emit ContributionMade
        BL->>EP: process(ContributionMade)
        EP->>DB: addContribution(txHash, round, amount)
        EP->>NS: sendToUser(member, 'contribution_received') [Socket.IO]
        Note over M,AC: ─── Default avoided if member pays here ───
    end

    rect rgb(255,220,220)
        Note over SS,DB: PHASE 4 — Grace expires; default confirmed
        SS->>DB: enforceGracePeriods()
        DB-->>SS: windows WHERE now ≥ graceCutoff
        SS->>DB: UPDATE PaymentWindow SET status='MISSED'
        SS->>SS: advanceCycle(groupId) → next window opened
        Note right of SS: ⚠ No notification emitted (Gap #3)
        Note right of SS: ⚠ No on-chain record of miss (Gap #4)
        M->>AC: contribute() [any attempt now]
        AC-->>M: Err(GracePeriodExpired)
    end

    rect rgb(220,255,220)
        Note over PS,AC: PHASE 5 — Payout execution
        PS->>DB: validate-payout (group active, no dup)
        PS->>DB: UPSERT Payout{status:processing}
        PS->>AC: execute_payout(group_id)
        AC->>AC: EFFECTS: mark_payout_received, payout_index++,<br/>cycle++ or is_complete=true
        AC->>AC: reputation.update_member_reputation(recipient)
        AC->>AC: INTERACTIONS: token.transfer(contract→recipient)
        AC-->>BL: emit PayoutExecuted, CycleAdvanced
        BL->>EP: process(PayoutExecuted)
        EP->>NS: sendToUser(recipient, 'payout_received') [Socket.IO]
        PS->>DB: UPDATE Payout{status:completed, txHash}
        PS->>NS: send('payout_received') → BullMQ → email/SMS/push
    end

    rect rgb(245,220,255)
        Note over DS,RD: PHASE 6A — Dispute (governance, optional)
        M->>AC: file_dispute(complainant, group_id, defaulter,<br/>NonPayment, evidence_hash, Penalty)
        AC->>AC: store_dispute{status:Open, deadline:now+7days}
        AC-->>BL: emit DisputeFiled
        Note right of BL: ⚠ No EventProcessor handler (Gap #5)
        Note over DS,RD: Off-chain path (parallel)
        M->>DS: POST /disputes {groupId, type:'non_payment'}
        DS->>RD: SET dispute:{id}, SADD group_disputes:{groupId}
        DS->>DS: voteOnDispute() × members → tryAutoResolve @50%
        Note right of DS: ⚠ Independent of on-chain dispute (Gap #6)
    end

    rect rgb(255,235,210)
        Note over IS,AC: PHASE 6B — Insurance claim (compensation, optional)
        Note over IS,AC: Requires insurance_config.is_enabled = true
        M->>IS: POST /insurance/claims {groupId, cycle, defaulter, amount}
        IS->>AC: file_insurance_claim(claimant, groupId, cycle, defaulter, amount)
        AC->>AC: fraud_risk_score = calculate_fraud_risk_score()<br/>• self-dealing +40<br/>• manufactured default (#800) +35<br/>• suspicious timing +15<br/>• claim frequency +10
        alt fraud_risk_score ≥ 80
            AC-->>M: Err(InvalidClaim) — auto-rejected
            AC-->>BL: emit FraudDetectionAlert
            Note right of BL: ⚠ No EventProcessor handler (Gap #7)
        else fraud_risk_score < 80
            AC->>AC: store InsuranceClaim{Pending}
            Note over AC: After grace_period_end:
            AC->>AC: auto_verify_insurance_claim(claim_id)
            AC->>AC: verify_claim(): !has_contributed(defaulter, cycle)?
            alt defaulter truly missed
                AC->>AC: process_claim(): pool.balance -= amount
                AC->>AC: token.transfer(contract→claimant)
                AC->>AC: claim.status = Paid
            else defaulter contributed (claim invalid)
                AC->>AC: claim.status = Rejected
            end
        end
        Note right of AC: ⚠ Both 6A dispute AND 6B claim can coexist<br/>for same default — no deduplication (Gap #8)
    end

    rect rgb(220,240,255)
        Note over AC,NS: PHASE 7 — Reputation impact
        Note over AC: True miss: reliability & volume components stagnate<br/>Late miss: late_contributions++ → penalty component drops
        AC-->>BL: emit ReputationUpdated, CreditScoreChanged
        Note right of BL: ⚠ No EventProcessor handler (Gap #10)<br/>⚠ total_missed_payments hardcoded 0 (Gap #9)
    end
```

---

## §12 — Gap Summary Table

| # | Gap | Phase | Files | Severity |
|---|---|---|---|---|
| 1 | On-chain reminder events unhandled by EventProcessor | 1–2 | `eventProcessor.ts` | Medium |
| 2 | No notification when `PaymentWindow → GRACE` | 2 | `scheduleService.ts` | Low |
| 3 | No notification when `PaymentWindow → MISSED` | 4 | `scheduleService.ts` | High |
| 4 | Off-chain MISSED not written back on-chain | 4 | `scheduleService.ts`, `reputation.rs` | High |
| 5 | On-chain dispute events unhandled; no automation of resolution outcomes | 6A | `eventProcessor.ts`, `contractEventHandlers.ts` | High |
| 6 | On-chain and off-chain dispute systems are independent silos | 6A | `disputeService.ts`, `contract.rs` | High |
| 7 | `FraudDetectionAlert` events unhandled; no admin alerting | 6B | `eventProcessor.ts` | Medium |
| 8 | Dispute refund and insurance payout not deduplicated | 6A+6B | `insurance.rs`, `contract.rs` | Critical |
| 9 | `total_missed_payments` hardcoded to 0 in reputation formula | 7 | `reputation.rs` | Medium |
| 10 | No notification when credit score drops | 7 | `eventProcessor.ts` | Low |
