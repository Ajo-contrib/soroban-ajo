use soroban_sdk::{symbol_short, Address, Env};

/// Emit an event when a group is created
pub fn emit_group_created(
    env: &Env,
    group_id: u64,
    creator: &Address,
    contribution_amount: i128,
    max_members: u32,
) {
    let topics = (symbol_short!("created"), group_id);
    env.events()
        .publish(topics, (creator, contribution_amount, max_members));
}

/// Emit an event when a member joins a group
pub fn emit_member_joined(env: &Env, group_id: u64, member: &Address) {
    let topics = (symbol_short!("joined"), group_id);
    env.events().publish(topics, member);
}

/// Emit an event when a member contributes
pub fn emit_contribution_made(
    env: &Env,
    group_id: u64,
    member: &Address,
    cycle: u32,
    amount: i128,
) {
    let topics = (symbol_short!("contrib"), group_id, cycle);
    env.events().publish(topics, (member, amount));
}

/// Emit an event when a payout is executed
pub fn emit_payout_executed(
    env: &Env,
    group_id: u64,
    recipient: &Address,
    cycle: u32,
    amount: i128,
) {
    let topics = (symbol_short!("payout"), group_id, cycle);
    env.events().publish(topics, (recipient, amount));
}

/// Emit an event when a group completes all cycles
pub fn emit_group_completed(env: &Env, group_id: u64) {
    let topics = (symbol_short!("complete"), group_id);
    env.events().publish(topics, ());
}

/// Emit an event when a cycle advances
pub fn emit_cycle_advanced(env: &Env, group_id: u64, new_cycle: u32, cycle_start_time: u64) {
    let topics = (symbol_short!("cycle"), group_id);
    env.events().publish(topics, (new_cycle, cycle_start_time));
}

/// Emit an event when a group is cancelled by its creator
pub fn emit_group_cancelled(
    env: &Env,
    group_id: u64,
    creator: &Address,
    member_count: u32,
    refund_per_member: i128,
) {
    let topics = (symbol_short!("cancel"), group_id);
    env.events()
        .publish(topics, (creator, member_count, refund_per_member));
}

/// Emit an event when a late contribution is made with penalty
pub fn emit_late_contribution(
    env: &Env,
    group_id: u64,
    member: &Address,
    cycle: u32,
    amount: i128,
    penalty: i128,
) {
    let topics = (symbol_short!("late"), group_id, cycle);
    env.events().publish(topics, (member, amount, penalty));
}

/// Emit an event when penalties are distributed with payout
pub fn emit_penalty_distributed(
    env: &Env,
    group_id: u64,
    recipient: &Address,
    cycle: u32,
    base_amount: i128,
    penalty_bonus: i128,
) {
    let topics = (symbol_short!("pendistr"), group_id, cycle);
    env.events()
        .publish(topics, (recipient, base_amount, penalty_bonus));
}

/// Emit an event when a refund request is created
pub fn emit_refund_requested(
    env: &Env,
    group_id: u64,
    requester: &Address,
    voting_deadline: u64,
) {
    let topics = (symbol_short!("refreq"), group_id);
    env.events().publish(topics, (requester, voting_deadline));
}

/// Emit an event when a member votes on a refund request
pub fn emit_refund_vote(
    env: &Env,
    group_id: u64,
    voter: &Address,
    in_favor: bool,
) {
    let topics = (symbol_short!("refvote"), group_id);
    env.events().publish(topics, (voter, in_favor));
}

/// Emit an event when a refund is processed
pub fn emit_refund_processed(
    env: &Env,
    group_id: u64,
    member: &Address,
    amount: i128,
    reason: u32,
) {
    let topics = (symbol_short!("refund"), group_id);
    env.events().publish(topics, (member, amount, reason));
}

/// Emit an event when an emergency refund is executed
pub fn emit_emergency_refund(
    env: &Env,
    group_id: u64,
    admin: &Address,
    total_refunded: i128,
) {
    let topics = (symbol_short!("emrefund"), group_id);
    env.events().publish(topics, (admin, total_refunded));
}

/// Emit an event when a member votes for the next payout recipient
pub fn emit_payout_vote(env: &Env, group_id: u64, voter: &Address, nominee: &Address, cycle: u32) {
    let topics = (symbol_short!("pvote"), group_id, cycle);
    env.events().publish(topics, (voter, nominee));
}

/// Emit an event when the payout recipient for a cycle is determined
pub fn emit_payout_order_determined(
    env: &Env,
    group_id: u64,
    cycle: u32,
    recipient: &Address,
    strategy: u32,
) {
    let topics = (symbol_short!("porder"), group_id, cycle);
    env.events().publish(topics, (recipient, strategy));
}

/// Emit an event when a member updates their notification preferences
pub fn emit_preferences_updated(env: &Env, member: &Address) {
    let topics = (symbol_short!("notpref"),);
    env.events().publish(topics, member);
}

/// Emit an event when a contribution reminder is triggered for a member.
///
/// Off-chain notification services should listen for this event and
/// deliver the appropriate message based on `reminder_type`.
pub fn emit_reminder_triggered(
    env: &Env,
    group_id: u64,
    member: &Address,
    reminder_type: u32,
    deadline: u64,
) {
    let topics = (symbol_short!("remind"), group_id);
    env.events()
        .publish(topics, (member, reminder_type, deadline));
}
/// Emit an event when a group milestone is achieved
pub fn emit_milestone_achieved(
    env: &Env,
    group_id: u64,
    milestone: u32,
    cycle: u32,
) {
    let topics = (symbol_short!("mileston"), group_id);
    env.events().publish(topics, (milestone, cycle));
}

/// Emit an event when a member earns an achievement
pub fn emit_achievement_earned(
    env: &Env,
    member: &Address,
    achievement: u32,
    group_id: u64,
) {
    let topics = (symbol_short!("achieve"), group_id);
    env.events().publish(topics, (member, achievement));
}

// ── Multi-token events ────────────────────────────────────────────────────

/// Emit an event when a multi-token group is created
pub fn emit_multi_token_group_created(
    env: &Env,
    group_id: u64,
    creator: &Address,
    contribution_amount: i128,
    token_count: u32,
) {
    let topics = (symbol_short!("mtcreat"), group_id);
    env.events()
        .publish(topics, (creator, contribution_amount, token_count));
}

/// Emit an event when a member contributes with a specific token
pub fn emit_token_contribution(
    env: &Env,
    group_id: u64,
    member: &Address,
    token: &Address,
    amount: i128,
    cycle: u32,
) {
    let topics = (symbol_short!("tkcontr"), group_id, cycle);
    env.events().publish(topics, (member, token, amount));
}

/// Emit an event when a multi-token payout is executed for one token
pub fn emit_multi_token_payout(
    env: &Env,
    group_id: u64,
    recipient: &Address,
    token: &Address,
    amount: i128,
    cycle: u32,
) {
    let topics = (symbol_short!("mtpay"), group_id, cycle);
    env.events().publish(topics, (recipient, token, amount));
}

/// Emit an event when a dispute is filed
pub fn emit_dispute_filed(env: &Env, dispute_id: u64, group_id: u64, complainant: &Address, defendant: &Address) {
    let topics = (symbol_short!("disfiled"), dispute_id);
    env.events().publish(topics, (group_id, complainant, defendant));
}

/// Emit an event when a vote is cast on a dispute
pub fn emit_dispute_vote(env: &Env, dispute_id: u64, voter: &Address, supports_action: bool) {
    let topics = (symbol_short!("disvote"), dispute_id);
    env.events().publish(topics, (voter, supports_action));
}

/// Emit an event when a dispute is resolved
pub fn emit_dispute_resolved(
    env: &Env,
    dispute_id: u64,
    group_id: u64,
    resolution: crate::types::DisputeResolution,
) {
    let topics = (symbol_short!("disres"), dispute_id);
    env.events().publish(topics, (group_id, resolution));
}

// ── Reputation events ─────────────────────────────────────────────────────

/// Emit an event when a member's reputation record is updated.
///
/// `tier` is the numeric value of the new [`ReputationTier`](crate::types::ReputationTier).
pub fn emit_reputation_updated(env: &Env, member: &Address, credit_score: u32, tier: u32) {
    let topics = (symbol_short!("repupd"),);
    env.events().publish(topics, (member, credit_score, tier));
}

/// Emit an event when a member's credit score changes.
pub fn emit_credit_score_changed(
    env: &Env,
    member: &Address,
    old_score: u32,
    new_score: u32,
) {
    let topics = (symbol_short!("scoreChg"),);
    env.events().publish(topics, (member, old_score, new_score));
}

/// Emit an event when a member advances to a higher reputation tier.
pub fn emit_tier_upgraded(env: &Env, member: &Address, old_tier: u32, new_tier: u32) {
    let topics = (symbol_short!("tierUp"),);
    env.events().publish(topics, (member, old_tier, new_tier));
}

// ── Insurance Events ──────────────────────────────────────────────────────

/// Emit an event when an insurance claim is filed.
pub fn emit_claim_filed(env: &Env, claim_id: u64, group_id: u64, cycle: u32) {
    let topics = (symbol_short!("clmfile"), claim_id);
    env.events().publish(topics, (group_id, cycle));
}

/// Emit an event when an insurance claim is approved and paid.
pub fn emit_claim_approved(env: &Env, claim_id: u64, group_id: u64, claimant: &Address, amount: i128) {
    let topics = (symbol_short!("clmappv"), claim_id);
    env.events().publish(topics, (group_id, claimant, amount));
}

/// Emit an event when an insurance claim is rejected.
pub fn emit_claim_rejected(env: &Env, claim_id: u64, group_id: u64) {
    let topics = (symbol_short!("clmrej"), claim_id);
    env.events().publish(topics, group_id);
}

/// Emit an event with claim verification results.
pub fn emit_claim_verification_result(env: &Env, claim_id: u64, group_id: u64, verification_complete: bool, is_valid: bool) {
    let topics = (symbol_short!("clmverif"), claim_id);
    env.events().publish(topics, (group_id, verification_complete, is_valid));
}

/// Emit an event when pool solvency limits are triggered.
pub fn emit_pool_solvency_limit_triggered(env: &Env, token: &Address, pool_balance: i128, claim_amount: i128, max_claimable: i128) {
    let topics = (symbol_short!("poolsol"),);
    env.events().publish(topics, (token, pool_balance, claim_amount, max_claimable));
}

/// Emit an event when suspicious activity is detected.
pub fn emit_fraud_detection_alert(env: &Env, claim_id: u64, member: &Address, fraud_type: &str, risk_score: u32) {
    let topics = (symbol_short!("fraudalt"), claim_id);
    env.events().publish(topics, (member, fraud_type, risk_score));
}
