/// On-chain reputation system for Ajo members.
///
/// Credit score formula (0–1000 scale):
///   - Payment reliability  40 % → qualifying_on_time / qualifying_contributions × 400
///   - Groups completed     20 % → min(qualifying_groups_completed, 10) × 20
///   - Volume contributed   20 % → tiered by qualifying_amount_contributed (stroops)
///   - Penalty history      20 % → (1 - late_contributions / qualifying_contributions) × 200
///
/// The score is recalculated and stored every time a member's stats change
/// (contribution, payout, group completion).  Callers should invoke
/// `update_member_reputation` after any such event.
///
/// ## Sybil / collusion resistance
///
/// Every component above is keyed off "qualifying" activity rather than raw
/// activity counts. A contribution only qualifies — and only then moves the
/// needle on a member's score — if the group's per-cycle contribution amount
/// is at least [`MIN_REPUTATION_STAKE`]. Groups below that amount still work
/// exactly as before (they can contribute, get paid out, complete), they
/// simply don't generate any reputation.
///
/// This closes the cheapest sybil attack against the old formula: creating
/// many 2-member, dust-amount ROSCA groups where the attacker controls both
/// "members" and rotates a few stroops between them. Under the old formula
/// that reached Platinum (800/1000) for a fraction of a cent in fees. Under
/// this one it scores 0, because none of the activity qualifies. See
/// `docs/reputation-sybil-analysis.md` for the full cost analysis and the
/// tests in `tests/reputation_sybil_tests.rs` for the attack scenario.
use soroban_sdk::{Address, Env};

use crate::errors::AjoError;
use crate::storage;
use crate::types::{
    CreditScoreSnapshot, PaymentHistoryEntry, ReputationScore, ReputationTier,
};
use crate::utils;

/// Minimum per-cycle contribution amount (in stroops) for a group's
/// participation to count toward a member's credit score.
///
/// Set to 10 XLM — the same amount the volume component already treats as
/// the first tier of "real" economic activity (see `volume_score`). Below
/// this, a round of contribute/payout moves too little value to represent
/// genuine stake-at-risk, so it's cheap to fabricate at scale and is
/// excluded from scoring entirely rather than counted at a discount.
pub const MIN_REPUTATION_STAKE: i128 = 10 * 10_000_000;

// ── Score calculation ─────────────────────────────────────────────────────

/// Calculates the volume component (0–200 points) based on total stroops contributed.
///
/// Tiers (in stroops, 1 XLM = 10_000_000):
///   < 10 XLM      →   0
///   10–99 XLM     →  40
///   100–999 XLM   →  80
///   1 000–9 999   → 120
///   10 000–99 999 → 160
///   ≥ 100 000 XLM → 200
fn volume_score(total_amount: i128) -> u32 {
    const XLM: i128 = 10_000_000;
    match total_amount {
        a if a < 10 * XLM => 0,
        a if a < 100 * XLM => 40,
        a if a < 1_000 * XLM => 80,
        a if a < 10_000 * XLM => 120,
        a if a < 100_000 * XLM => 160,
        _ => 200,
    }
}

/// Derives a [`ReputationTier`] from a raw credit score.
fn tier_from_score(score: u32) -> ReputationTier {
    match score {
        0..=199 => ReputationTier::Unrated,
        200..=399 => ReputationTier::Bronze,
        400..=599 => ReputationTier::Silver,
        600..=799 => ReputationTier::Gold,
        800..=899 => ReputationTier::Platinum,
        _ => ReputationTier::Diamond,
    }
}

/// Computes the full credit score (0–1000) from a member's aggregated stats.
///
/// Returns 0 when the member has no contribution history yet, and also when
/// the member's activity exists only in groups below [`MIN_REPUTATION_STAKE`]
/// (i.e. nothing qualifies yet — see module docs).
pub fn compute_credit_score(stats: &crate::types::MemberStats) -> u32 {
    if stats.total_contributions == 0 {
        return 0;
    }

    let qualifying_total = stats.qualifying_contributions;
    if qualifying_total == 0 {
        return 0;
    }

    // 1. Payment reliability component (0–400)
    let reliability = (stats.qualifying_ontime_contribs * 400) / qualifying_total;

    // 2. Groups completed component (0–200): cap at 10 completed groups
    let completed_capped = stats.qualifying_groups_completed.min(10);
    let completion = completed_capped * 20;

    // 3. Volume component (0–200)
    let volume = volume_score(stats.qualifying_amount_contributed);

    // 4. Penalty component (0–200): penalise late contributions
    let penalty_component = if stats.late_contributions == 0 {
        200
    } else {
        let on_time = qualifying_total.saturating_sub(stats.late_contributions);
        (on_time * 200) / qualifying_total
    };

    reliability + completion + volume + penalty_component
}

// ── Public API ────────────────────────────────────────────────────────────

/// Recalculates and persists a member's full reputation record.
///
/// Should be called after every event that changes a member's stats:
/// - successful contribution
/// - payout received
/// - group completed
///
/// # Errors
/// Returns `AjoError::NotMember` if the member has no stats record yet
/// (i.e. they have never interacted with any group).
pub fn update_member_reputation(env: &Env, member: &Address) -> Result<ReputationScore, AjoError> {
    let stats = storage::get_member_stats(env, member)
        .unwrap_or_else(|| utils::default_member_stats(env, member));

    let credit_score = compute_credit_score(&stats);
    let tier = tier_from_score(credit_score);
    let now = env.ledger().timestamp();

    // Retrieve existing record to preserve history metadata
    let existing = storage::get_reputation(env, member);
    let previous_score = existing.as_ref().map(|r| r.credit_score).unwrap_or(0);
    let first_activity = existing
        .as_ref()
        .map(|r| r.first_activity_at)
        .unwrap_or(now);

    let reputation = ReputationScore {
        member: member.clone(),
        credit_score,
        tier,
        total_on_time_payments: stats.on_time_contributions,
        total_late_payments: stats.late_contributions,
        total_missed_payments: 0, // future: track missed separately
        groups_completed: stats.total_groups_completed,
        groups_joined: stats.total_groups_joined,
        total_amount_contributed: stats.total_amount_contributed,
        last_updated: now,
        first_activity_at: first_activity,
    };

    storage::store_reputation(env, member, &reputation);

    // Append a credit score snapshot to the history
    let snapshot = CreditScoreSnapshot {
        score: credit_score,
        recorded_at: now,
        reason: crate::types::ScoreChangeReason::ContributionMade,
    };
    storage::append_credit_snapshot(env, member, &snapshot);

    // Emit events
    crate::events::emit_reputation_updated(env, member, credit_score, tier as u32);
    if previous_score != credit_score {
        crate::events::emit_credit_score_changed(env, member, previous_score, credit_score);
    }

    Ok(reputation)
}

/// Returns the stored reputation for a member, or a default zero-score record
/// if the member has not yet built any history.
pub fn get_reputation(env: &Env, member: &Address) -> ReputationScore {
    storage::get_reputation(env, member).unwrap_or_else(|| {
        let now = env.ledger().timestamp();
        ReputationScore {
            member: member.clone(),
            credit_score: 0,
            tier: ReputationTier::Unrated,
            total_on_time_payments: 0,
            total_late_payments: 0,
            total_missed_payments: 0,
            groups_completed: 0,
            groups_joined: 0,
            total_amount_contributed: 0,
            last_updated: now,
            first_activity_at: now,
        }
    })
}

/// Returns the payment history entries for a member (most recent first).
pub fn get_payment_history(env: &Env, member: &Address) -> soroban_sdk::Vec<PaymentHistoryEntry> {
    storage::get_payment_history(env, member).unwrap_or_else(|| soroban_sdk::Vec::new(env))
}

/// Records a payment history entry for a member.
///
/// Called from `contribute` (on-time or late) and from `execute_payout`
/// when a member receives their payout.
pub fn record_payment_event(
    env: &Env,
    member: &Address,
    group_id: u64,
    cycle: u32,
    amount: i128,
    is_late: bool,
    is_payout: bool,
) {
    let entry = PaymentHistoryEntry {
        group_id,
        cycle,
        amount,
        timestamp: env.ledger().timestamp(),
        is_late,
        is_payout,
    };
    storage::append_payment_history(env, member, &entry);
}

/// Returns the credit score snapshots (history) for a member.
pub fn get_credit_score_history(
    env: &Env,
    member: &Address,
) -> soroban_sdk::Vec<CreditScoreSnapshot> {
    storage::get_credit_snapshots(env, member).unwrap_or_else(|| soroban_sdk::Vec::new(env))
}

/// Checks whether a member meets the minimum credit score required to join a
/// group.  Returns `Ok(())` if the requirement is satisfied or if the group
/// has no minimum set (min_score == 0).
pub fn check_credit_requirement(
    env: &Env,
    member: &Address,
    min_score: u32,
) -> Result<(), AjoError> {
    if min_score == 0 {
        return Ok(());
    }
    let rep = get_reputation(env, member);
    if rep.credit_score < min_score {
        return Err(AjoError::InsufficientCreditScore);
    }
    Ok(())
}
