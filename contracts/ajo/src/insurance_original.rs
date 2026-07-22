use soroban_sdk::{Address, Env};
use crate::storage;
use crate::types::{
    InsuranceClaim, ClaimStatus, InsurancePool, Group, FraudRiskProfile, GroupRiskAssessment,
    DEFAULT_MAX_CLAIMABLE_BPS, DEFAULT_EPOCH_DURATION, HIGH_FRAUD_RISK_THRESHOLD,
    MAX_CLAIMS_PER_MEMBER_PER_EPOCH, FRAUD_FLAG_SELF_DEALING, FRAUD_FLAG_SYBIL_ATTACK,
    FRAUD_FLAG_RATE_LIMIT, FRAUD_FLAG_MANUFACTURED_DEFAULT, FRAUD_FLAG_SUSPICIOUS_PATTERN,
};
use crate::errors::AjoError;
use crate::utils;
use crate::events;

// ── Risk Assessment and Fraud Detection ──────────────────────────────────

/// Analyzes claim for potential self-dealing (member claiming against their own default)
fn detect_self_dealing(env: &Env, claim: &InsuranceClaim) -> bool {
    // Check if claimant and defaulter are the same (direct self-dealing)
    if claim.claimant == claim.defaulter {
        return true;
    }

    // Check for indirect self-dealing through group history analysis
    let group = match storage::get_group(env, claim.group_id) {
        Some(g) => g,
        None => return false,
    };

    // Advanced pattern: check if the claimant has a history of defaulting right before their own payout cycle
    // This would indicate manufactured defaults for insurance gains
    let current_cycle = claim.cycle;
    let total_cycles = group.max_members;

    // Check if defaulter was supposed to receive payout in the next few cycles after the default
    // This could indicate timing manipulation
    if current_cycle + 1 <= total_cycles {
        // Check contribution patterns of the defaulter in recent cycles
        for check_cycle in (current_cycle.saturating_sub(3))..current_cycle {
            if storage::has_contributed(env, claim.group_id, check_cycle, &claim.defaulter) {
                // If they contributed in recent cycles but suddenly defaulted, it's suspicious
                continue;
            } else {
                // Pattern of selective defaults might indicate fraud
                return true;
            }
        }
    }

    false
}

/// Detects manufactured defaults by analyzing member's financial capacity
fn detect_manufactured_default(env: &Env, claim: &InsuranceClaim) -> bool {
    let group = match storage::get_group(env, claim.group_id) {
        Some(g) => g,
        None => return false,
    };

    // Check if the defaulter had sufficient balance to contribute
    let defaulter_balance = crate::token::get_balance(env, &group.token_address, &claim.defaulter);
    
    // If they had more than enough balance to cover the contribution, the default is suspicious
    if defaulter_balance >= group.contribution_amount * 2 {
        return true;
    }

    // Check contribution patterns - if they contribute immediately after filing claim, it's suspicious
    let now = env.ledger().timestamp();
    let claim_age = now - claim.created_at;
    
    // If claim was filed recently and member now has balance, it's suspicious
    if claim_age < 86400 && defaulter_balance >= group.contribution_amount { // within 24 hours
        return true;
    }

    false
}

/// Detects sybil attacks by analyzing account relationships and behavior patterns
fn detect_sybil_attack(env: &Env, claim: &InsuranceClaim) -> bool {
    let group = match storage::get_group(env, claim.group_id) {
        Some(g) => g,
        None => return false,
    };

    // Check for coordinated claim timing from multiple members
    let mut recent_claims = 0u32;
    let now = env.ledger().timestamp();
    let time_window = 86400; // 24 hours
    
    // Count recent claims in the same group
    for i in 1..=storage::get_next_claim_id(env) {
        if let Some(other_claim) = storage::get_insurance_claim(env, i) {
            if other_claim.group_id == claim.group_id &&
               other_claim.id != claim.id &&
               now - other_claim.created_at < time_window {
                recent_claims += 1;
            }
        }
    }

    // If more than 2 claims filed within 24 hours in the same group, it's suspicious
    if recent_claims > 2 {
        return true;
    }

    // Check for pattern where multiple members default in sequential cycles
    // This could indicate collusion
    let current_cycle = claim.cycle;
    if current_cycle >= 3 {
        let mut sequential_defaults = 0u32;
        for check_cycle in (current_cycle - 2)..current_cycle {
            // Count how many members didn't contribute in recent cycles
            let mut non_contributors = 0u32;
            for member in &group.members {
                if !storage::has_contributed(env, claim.group_id, check_cycle, &member) {
                    non_contributors += 1;
                }
            }
            if non_contributors > 0 {
                sequential_defaults += 1;
            }
        }
        
        // If there have been defaults in multiple recent cycles, it's suspicious
        if sequential_defaults >= 2 {
            return true;
        }
    }

    false
}

/// Calculates comprehensive fraud risk score for a claim
fn calculate_fraud_risk_score(env: &Env, claim: &InsuranceClaim) -> u32 {
    let mut risk_score = 0u32;
    let mut flags = 0u32;

    // Self-dealing detection (high risk: +40 points)
    if detect_self_dealing(env, claim) {
        risk_score += 40;
        flags |= FRAUD_FLAG_SELF_DEALING;
    }

    // Manufactured default detection (high risk: +35 points)
    if detect_manufactured_default(env, claim) {
        risk_score += 35;
        flags |= FRAUD_FLAG_MANUFACTURED_DEFAULT;
    }

    // Sybil attack detection (medium risk: +25 points)
    if detect_sybil_attack(env, claim) {
        risk_score += 25;
        flags |= FRAUD_FLAG_SYBIL_ATTACK;
    }

    // Rate limiting check
    let claimant_profile = get_or_create_fraud_profile(env, &claim.claimant);
    let now = env.ledger().timestamp();
    let epoch_start = now - DEFAULT_EPOCH_DURATION;
    
    // Count recent claims by this member
    let mut recent_claims_count = 0u32;
    for i in 1..=storage::get_next_claim_id(env) {
        if let Some(other_claim) = storage::get_insurance_claim(env, i) {
            if other_claim.claimant == claim.claimant &&
               other_claim.created_at > epoch_start {
                recent_claims_count += 1;
            }
        }
    }

    if recent_claims_count > MAX_CLAIMS_PER_MEMBER_PER_EPOCH {
        risk_score += 20;
        flags |= FRAUD_FLAG_RATE_LIMIT;
    }

    // Member's historical fraud score contribution
    risk_score += claimant_profile.base_risk_score / 5; // contribute up to 20 points

    // Pattern analysis based on claim timing and amounts
    if claim.amount > 0 {
        let group = storage::get_group(env, claim.group_id).unwrap_or_else(|| {
            // Return a minimal group struct if not found  
            Group {
                id: claim.group_id,
                creator: claim.claimant.clone(),
                token_address: env.current_contract_address(),
                contribution_amount: 1,
                max_members: 1,
                current_cycle: 1,
                cycle_duration: 604800,
                cycle_start_time: 0,
                members: soroban_sdk::Vec::new(env),
                state: crate::types::GroupState::Active,
                grace_period: 0,
                penalty_rate: 0,
            }
        });
        // Large claims relative to contribution amount are more suspicious
        let amount_ratio = (claim.amount * 100) / group.contribution_amount.max(1);
        if amount_ratio > 150 { // claiming more than 150% of contribution
            risk_score += 15;
            flags |= FRAUD_FLAG_SUSPICIOUS_PATTERN;
        }
    }

    // Cap risk score at 100
    risk_score.min(100)
}

/// Gets or creates a fraud risk profile for a member
fn get_or_create_fraud_profile(env: &Env, member: &Address) -> FraudRiskProfile {
    storage::get_fraud_risk_profile(env, member).unwrap_or_else(|| {
        let now = env.ledger().timestamp();
        FraudRiskProfile {
            member: member.clone(),
            base_risk_score: 10, // start with low risk
            total_claims_filed: 0,
            successful_claims: 0,
            claim_frequency_score: 0,
            pattern_analysis_score: 0,
            last_claim_timestamp: 0,
            suspicious_flags: 0,
            last_assessed: now,
        }
    })
}

/// Updates fraud risk profile after claim processing
fn update_fraud_profile(env: &Env, member: &Address, claim_approved: bool, fraud_flags: u32) {
    let mut profile = get_or_create_fraud_profile(env, member);
    let now = env.ledger().timestamp();

    profile.total_claims_filed += 1;
    if claim_approved {
        profile.successful_claims += 1;
    }

    // Calculate claim frequency score
    let time_since_last = if profile.last_claim_timestamp > 0 {
        now - profile.last_claim_timestamp
    } else {
        DEFAULT_EPOCH_DURATION
    };

    if time_since_last < 86400 { // less than 24 hours
        profile.claim_frequency_score += 10;
    } else if time_since_last < 604_800 { // less than 1 week
        profile.claim_frequency_score += 5;
    } else {
        // Decay frequency score over time
        profile.claim_frequency_score = profile.claim_frequency_score.saturating_sub(1);
    }

    // Update suspicious flags
    profile.suspicious_flags |= fraud_flags;

    // Adjust base risk score
    if fraud_flags > 0 {
        profile.base_risk_score += 10;
    } else if claim_approved {
        // Slightly reduce risk for legitimate claims
        profile.base_risk_score = profile.base_risk_score.saturating_sub(1);
    }

    profile.base_risk_score = profile.base_risk_score.min(100);
    profile.last_claim_timestamp = now;
    profile.last_assessed = now;

    storage::store_fraud_risk_profile(env, member, &profile);
}

// ── Pool Solvency Protection ──────────────────────────────────────────────

/// Checks if a claim would exceed pool solvency limits
fn check_pool_solvency(env: &Env, pool: &mut InsurancePool, claim_amount: i128) -> Result<(), AjoError> {
    let now = env.ledger().timestamp();
    
    // Reset epoch if needed
    if now - pool.last_epoch_reset >= pool.epoch_duration {
        pool.epoch_claimed_amount = 0;
        pool.last_epoch_reset = now;
    }

    // Calculate maximum claimable amount for this epoch
    let max_claimable = (pool.balance * pool.max_claimable_bps as i128) / 10000;
    
    // Check if claim would exceed epoch limit
    if pool.epoch_claimed_amount + claim_amount > max_claimable {
        events::emit_pool_solvency_limit_triggered(
            env,
            &env.current_contract_address(), // placeholder for token address
            pool.balance,
            claim_amount,
            max_claimable,
        );
        return Err(AjoError::PoolSolvencyLimitReached);
    }

    Ok(())
}

/// Updates pool after successful claim payout
fn update_pool_after_payout(pool: &mut InsurancePool, claim_amount: i128) {
    pool.balance -= claim_amount;
    pool.total_payouts += claim_amount;
    pool.epoch_claimed_amount += claim_amount;
    pool.pending_claims_count -= 1;
}

// ── Enhanced Public API ───────────────────────────────────────────────────

/// Calculates the insurance premium for a contribution.
pub fn calculate_premium(amount: i128, rate_bps: u32) -> i128 {
    (amount * (rate_bps as i128)) / 10000
}

/// Adds funds to the insurance pool for a token.
pub fn deposit_to_pool(env: &Env, token: &Address, amount: i128) {
    let mut pool = storage::get_insurance_pool(env, token).unwrap_or(InsurancePool {
        balance: 0,
        total_payouts: 0,
        pending_claims_count: 0,
        max_claimable_bps: DEFAULT_MAX_CLAIMABLE_BPS,
        last_epoch_reset: env.ledger().timestamp(),
        epoch_claimed_amount: 0,
        epoch_duration: DEFAULT_EPOCH_DURATION,
    });
    pool.balance += amount;
    storage::store_insurance_pool(env, token, &pool);
}

/// Records a claim against the insurance pool with enhanced fraud detection.
pub fn file_claim(
    env: &Env,
    group_id: u64,
    cycle: u32,
    claimant: Address,
    defaulter: Address,
    amount: i128,
) -> Result<u64, AjoError> {
    let claim_id = storage::get_next_claim_id(env);
    let now = env.ledger().timestamp();

    // Create preliminary claim for fraud analysis
    let preliminary_claim = InsuranceClaim {
        id: claim_id,
        group_id,
        cycle,
        defaulter: defaulter.clone(),
        claimant: claimant.clone(),
        amount,
        status: ClaimStatus::Pending,
        created_at: now,
        fraud_risk_score: 0,
        auto_verified: false,
        verification_flags: 0,
    };

    // Calculate fraud risk score
    let fraud_risk_score = calculate_fraud_risk_score(env, &preliminary_claim);
    
    // Check for high fraud risk
    if fraud_risk_score >= HIGH_FRAUD_RISK_THRESHOLD {
        events::emit_fraud_detection_alert(
            env,
            claim_id,
            &claimant,
            "HIGH_FRAUD_RISK",
            fraud_risk_score,
        );
        return Err(AjoError::HighFraudRisk);
    }

    // Create final claim with fraud score
    let claim = InsuranceClaim {
        fraud_risk_score,
        ..preliminary_claim
    };

    storage::store_insurance_claim(env, claim_id, &claim);

    // Update pool stats
    let group = storage::get_group(env, group_id).ok_or(AjoError::GroupNotFound)?;
    let mut pool = storage::get_insurance_pool(env, &group.token_address).unwrap_or(InsurancePool {
        balance: 0,
        total_payouts: 0,
        pending_claims_count: 0,
        max_claimable_bps: DEFAULT_MAX_CLAIMABLE_BPS,
        last_epoch_reset: now,
        epoch_claimed_amount: 0,
        epoch_duration: DEFAULT_EPOCH_DURATION,
    });
    pool.pending_claims_count += 1;
    storage::store_insurance_pool(env, &group.token_address, &pool);

    // Emit event: claim filed
    events::emit_claim_filed(env, claim_id, group_id, cycle);

    Ok(claim_id)
}

/// Processes a claim with enhanced security checks and executes payout if approved.
pub fn process_claim(env: &Env, claim_id: u64, approved: bool) -> Result<(), AjoError> {
    let mut claim = storage::get_insurance_claim(env, claim_id).ok_or(AjoError::InvalidClaim)?;

    if claim.status != ClaimStatus::Pending {
        return Err(AjoError::ClaimAlreadyProcessed);
    }

    let group = storage::get_group(env, claim.group_id).ok_or(AjoError::GroupNotFound)?;
    let mut pool = storage::get_insurance_pool(env, &group.token_address).ok_or(AjoError::PoolNotFound)?;

    if approved {
        // Check pool solvency before payout
        check_pool_solvency(env, &mut pool, claim.amount)?;

        if pool.balance < claim.amount {
            return Err(AjoError::InsufficientPoolBalance);
        }

        // Execute payout
        update_pool_after_payout(&mut pool, claim.amount);
        claim.status = ClaimStatus::Paid;

        // Transfer tokens from contract to claimant
        crate::token::transfer_token(
            env,
            &group.token_address,
            &env.current_contract_address(),
            &claim.claimant,
            claim.amount,
        )?;

        // Emit approval event
        events::emit_claim_approved(env, claim_id, claim.group_id, &claim.claimant, claim.amount);
    } else {
        claim.status = ClaimStatus::Rejected;
        pool.pending_claims_count -= 1;

        // Emit rejection event
        events::emit_claim_rejected(env, claim_id, claim.group_id);
    }

    // Update fraud profile for both claimant and defaulter
    update_fraud_profile(env, &claim.claimant, approved, claim.fraud_risk_score);

    storage::store_insurance_pool(env, &group.token_address, &pool);
    storage::store_insurance_claim(env, claim_id, &claim);

    Ok(())
}

/// Enhanced claim verification with anti-fraud measures.
pub fn verify_claim(env: &Env, claim_id: u64) -> Result<bool, AjoError> {
    let claim = storage::get_insurance_claim(env, claim_id)
        .ok_or(AjoError::InvalidClaim)?;

    let group = storage::get_group(env, claim.group_id)
        .ok_or(AjoError::GroupNotFound)?;

    // Only verify after the full grace period for that cycle has elapsed.
    let cycle_end = group.cycle_start_time + group.cycle_duration;
    let grace_end = cycle_end + group.grace_period;
    let now = utils::get_current_timestamp(env);

    if now < grace_end {
        events::emit_claim_verification_result(env, claim_id, claim.group_id, false, false);
        return Ok(false);
    }

    // Enhanced verification: check for manufactured default
    if detect_manufactured_default(env, &claim) {
        events::emit_fraud_detection_alert(
            env,
            claim_id,
            &claim.defaulter,
            "MANUFACTURED_DEFAULT",
            claim.fraud_risk_score,
        );
        events::emit_claim_verification_result(env, claim_id, claim.group_id, true, false);
        return Ok(false);
    }

    // Check whether the alleged defaulter actually contributed in the claimed cycle.
    let has_contributed = storage::has_contributed(
        env,
        claim.group_id,
        claim.cycle,
        &claim.defaulter,
    );

    // Claim is valid only when the defaulter did NOT contribute.
    let is_valid = !has_contributed;

    events::emit_claim_verification_result(env, claim_id, claim.group_id, true, is_valid);

    Ok(is_valid)
}

/// Automatically verifies and processes a pending claim with enhanced security.
pub fn auto_process_claim(env: &Env, claim_id: u64) -> Result<(), AjoError> {
    let claim = storage::get_insurance_claim(env, claim_id)
        .ok_or(AjoError::InvalidClaim)?;

    if claim.status != ClaimStatus::Pending {
        return Err(AjoError::ClaimAlreadyProcessed);
    }

    // Additional fraud checks before processing
    let current_fraud_score = calculate_fraud_risk_score(env, &claim);
    
    if current_fraud_score >= HIGH_FRAUD_RISK_THRESHOLD {
        // Auto-reject high-risk claims
        let mut updated_claim = claim.clone();
        updated_claim.status = ClaimStatus::Rejected;
        updated_claim.fraud_risk_score = current_fraud_score;
        
        storage::store_insurance_claim(env, claim_id, &updated_claim);
        
        events::emit_fraud_detection_alert(
            env,
            claim_id,
            &claim.claimant,
            "AUTO_REJECTED_HIGH_RISK",
            current_fraud_score,
        );
        events::emit_claim_rejected(env, claim_id, claim.group_id);
        
        return Ok(());
    }

    let is_valid = verify_claim(env, claim_id)?;

    let group = storage::get_group(env, claim.group_id)
        .ok_or(AjoError::GroupNotFound)?;

    let grace_end = group.cycle_start_time + group.cycle_duration + group.grace_period;
    let now = utils::get_current_timestamp(env);

    if now < grace_end {
        return Err(AjoError::OutsideCycleWindow);
    }

    // Auto-process based on verification result
    process_claim(env, claim_id, is_valid)
}

/// Returns enhanced pool information with solvency metrics.
pub fn get_pool_info(env: &Env, token: &Address) -> Result<InsurancePool, AjoError> {
    let mut pool = storage::get_insurance_pool(env, token).ok_or(AjoError::PoolNotFound)?;
    
    // Update epoch if needed
    let now = env.ledger().timestamp();
    if now - pool.last_epoch_reset >= pool.epoch_duration {
        pool.epoch_claimed_amount = 0;
        pool.last_epoch_reset = now;
        storage::store_insurance_pool(env, token, &pool);
    }
    
    Ok(pool)
}

/// Enhanced member risk scoring based on comprehensive analysis.
pub fn get_member_risk_score(env: &Env, member: &Address) -> u32 {
    let profile = get_or_create_fraud_profile(env, member);
    
    // Base risk score from fraud profile
    let mut risk_score = profile.base_risk_score;
    
    // Adjust based on claim success rate
    if profile.total_claims_filed > 0 {
        let success_rate = (profile.successful_claims * 100) / profile.total_claims_filed;
        if success_rate < 50 {
            risk_score += 20; // High claim failure rate is suspicious
        } else if success_rate > 90 {
            risk_score = risk_score.saturating_sub(10); // Good track record
        }
    }
    
    // Factor in claim frequency
    risk_score += profile.claim_frequency_score;
    
    // Factor in suspicious flags
    if profile.suspicious_flags & FRAUD_FLAG_SELF_DEALING != 0 {
        risk_score += 25;
    }
    if profile.suspicious_flags & FRAUD_FLAG_SYBIL_ATTACK != 0 {
        risk_score += 20;
    }
    if profile.suspicious_flags & FRAUD_FLAG_MANUFACTURED_DEFAULT != 0 {
        risk_score += 30;
    }
    
    // Cap at 100
    risk_score.min(100)
}

/// Enhanced group risk rating with behavioral analysis.
pub fn get_group_risk_rating(env: &Env, group: &Group) -> u32 {
    let mut assessment = storage::get_group_risk_assessment(env, group.id)
        .unwrap_or_else(|| {
            GroupRiskAssessment {
                group_id: group.id,
                aggregate_risk_score: 50, // default medium risk
                default_rate: 0,
                claim_rate: 0,
                sybil_risk_score: 0,
                behavior_flags: 0,
                last_assessed: env.ledger().timestamp(),
            }
        });

    let now = env.ledger().timestamp();
    
    // Only recalculate if assessment is older than 24 hours
    if now - assessment.last_assessed < 86400 {
        return assessment.aggregate_risk_score;
    }

    let total_members = group.members.len();
    if total_members == 0 {
        return 0;
    }

    // Calculate aggregate member risk
    let mut total_member_risk = 0u32;
    let mut suspicious_members = 0u32;
    
    for member in &group.members {
        let member_risk = get_member_risk_score(env, &member);
        total_member_risk += member_risk;
        
        if member_risk > 70 {
            suspicious_members += 1;
        }
    }
    
    let avg_member_risk = total_member_risk / total_members;
    
    // Calculate default rate for recent cycles
    let mut total_expected_contributions = 0u32;
    let mut actual_contributions = 0u32;
    
    let current_cycle = group.current_cycle;
    let cycles_to_check = 5u32.min(current_cycle);
    
    for cycle in (current_cycle.saturating_sub(cycles_to_check))..current_cycle {
        for member in &group.members {
            total_expected_contributions += 1;
            if storage::has_contributed(env, group.id, cycle, &member) {
                actual_contributions += 1;
            }
        }
    }
    
    let default_rate = if total_expected_contributions > 0 {
        ((total_expected_contributions - actual_contributions) * 100) / total_expected_contributions
    } else {
        0
    };

    // Count insurance claims for this group
    let mut claim_count = 0u32;
    for i in 1..=storage::get_next_claim_id(env) {
        if let Some(claim) = storage::get_insurance_claim(env, i) {
            if claim.group_id == group.id {
                claim_count += 1;
            }
        }
    }
    
    let claim_rate = if current_cycle > 0 {
        (claim_count * 100) / current_cycle
    } else {
        0
    };

    // Calculate sybil risk based on member behavior patterns
    let sybil_risk = if suspicious_members * 3 > total_members {
        70 // High sybil risk if >33% members are suspicious
    } else if suspicious_members * 2 > total_members {
        40 // Medium sybil risk if >50% members are suspicious  
    } else {
        10 // Low sybil risk
    };

    // Calculate final group risk score
    let mut group_risk = avg_member_risk;
    
    // Adjust based on default rate
    group_risk += default_rate / 2;
    
    // Adjust based on claim rate
    group_risk += claim_rate;
    
    // Adjust based on sybil risk
    group_risk += sybil_risk / 3;
    
    // Cap at 100
    group_risk = group_risk.min(100);

    // Update assessment
    assessment.aggregate_risk_score = group_risk;
    assessment.default_rate = default_rate;
    assessment.claim_rate = claim_rate;
    assessment.sybil_risk_score = sybil_risk;
    assessment.last_assessed = now;
    
    storage::store_group_risk_assessment(env, group.id, &assessment);
    
    group_risk
}

/// Gets fraud risk profile for a member (public interface)
pub fn get_member_fraud_profile(env: &Env, member: &Address) -> FraudRiskProfile {
    get_or_create_fraud_profile(env, member)
}

/// Gets group risk assessment (public interface)  
pub fn get_group_assessment(env: &Env, group_id: u64) -> Result<GroupRiskAssessment, AjoError> {
    storage::get_group_risk_assessment(env, group_id).ok_or(AjoError::GroupNotFound)
}
