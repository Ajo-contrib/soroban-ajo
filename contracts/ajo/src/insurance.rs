use soroban_sdk::{Address, Env};
use crate::storage;
use crate::types::{InsuranceClaim, ClaimStatus, InsurancePool, Group};
use crate::errors::AjoError;
use crate::utils;

// ── Security Constants ────────────────────────────────────────────────────

/// Maximum percentage of pool balance claimable per epoch (basis points)
const MAX_CLAIMABLE_BPS: u32 = 500; // 5%

/// Default epoch duration (7 days in seconds) 
const EPOCH_DURATION: u64 = 604_800;

/// High fraud risk threshold
const HIGH_FRAUD_RISK_THRESHOLD: u32 = 80;

// ── Enhanced Security Functions ────────────────────────────────────────────

/// Detects potential self-dealing by checking if claimant and defaulter are the same
fn detect_self_dealing(claim: &InsuranceClaim) -> bool {
    claim.claimant == claim.defaulter
}

/// Detects manufactured defaults by checking if defaulter had sufficient balance
fn detect_manufactured_default(env: &Env, claim: &InsuranceClaim) -> bool {
    let group = match storage::get_group(env, claim.group_id) {
        Some(g) => g,
        None => return false,
    };

    // Check if defaulter had sufficient balance to contribute
    let balance = crate::token::get_balance(env, &group.token_address, &claim.defaulter);
    
    // If they had more than 2x the contribution amount, default is suspicious
    balance >= group.contribution_amount * 2
}

/// Calculates basic fraud risk score for a claim
fn calculate_fraud_risk_score(env: &Env, claim: &InsuranceClaim) -> u32 {
    let mut risk_score = 0u32;

    // Self-dealing check (40 points)
    if detect_self_dealing(claim) {
        risk_score += 40;
    }

    // Manufactured default check (35 points) 
    if detect_manufactured_default(env, claim) {
        risk_score += 35;
    }

    // Basic claim timing analysis (15 points)
    let now = env.ledger().timestamp();
    let claim_age = now - claim.created_at;
    if claim_age < 3600 { // Filed within 1 hour - suspicious timing
        risk_score += 15;
    }

    // Count recent claims by same member (10 points if >2 recent claims)
    let mut recent_claims = 0u32;
    for i in 1..=storage::get_next_claim_id(env) {
        if let Some(other_claim) = storage::get_insurance_claim(env, i) {
            if other_claim.claimant == claim.claimant && 
               other_claim.id != claim.id &&
               now - other_claim.created_at < 86400 { // within 24 hours
                recent_claims += 1;
            }
        }
    }
    if recent_claims > 2 {
        risk_score += 10;
    }

    risk_score.min(100)
}

/// Checks pool solvency limits
fn check_pool_solvency(env: &Env, pool: &mut InsurancePool, claim_amount: i128) -> Result<(), AjoError> {
    let now = env.ledger().timestamp();
    
    // Reset epoch tracking if needed (simplified approach)
    let epoch_start = now - EPOCH_DURATION;
    
    // Calculate total claims in current epoch
    let mut epoch_claims = 0i128;
    for i in 1..=storage::get_next_claim_id(env) {
        if let Some(claim) = storage::get_insurance_claim(env, i) {
            if claim.created_at > epoch_start && 
               claim.status == ClaimStatus::Paid {
                epoch_claims += claim.amount;
            }
        }
    }

    // Check if adding this claim would exceed epoch limit
    let max_claimable = (pool.balance * MAX_CLAIMABLE_BPS as i128) / 10_000;
    if epoch_claims + claim_amount > max_claimable {
        return Err(AjoError::InsufficientPoolBalance); // Reuse existing error
    }

    Ok(())
}

// ── Original Functions with Security Enhancements ─────────────────────────

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
        max_claimable_bps: MAX_CLAIMABLE_BPS,
        last_epoch_reset: env.ledger().timestamp(),
        epoch_claimed_amount: 0,
        epoch_duration: EPOCH_DURATION,
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

    let mut claim = InsuranceClaim {
        id: claim_id,
        group_id,
        cycle,
        defaulter,
        claimant,
        amount,
        status: ClaimStatus::Pending,
        created_at: now,
        fraud_risk_score: 0,
        auto_verified: false,
        verification_flags: 0,
    };

    // Calculate fraud risk score
    let fraud_risk_score = calculate_fraud_risk_score(env, &claim);

    // Reject high-risk claims immediately
    if fraud_risk_score >= HIGH_FRAUD_RISK_THRESHOLD {
        return Err(AjoError::InvalidClaim); // Reuse existing error
    }

    claim.fraud_risk_score = fraud_risk_score;
    storage::store_insurance_claim(env, claim_id, &claim);

    // Update pool stats
    let group = storage::get_group(env, group_id).ok_or(AjoError::GroupNotFound)?;
    let mut pool = storage::get_insurance_pool(env, &group.token_address).unwrap_or(InsurancePool {
        balance: 0,
        total_payouts: 0,
        pending_claims_count: 0,
        max_claimable_bps: MAX_CLAIMABLE_BPS,
        last_epoch_reset: env.ledger().timestamp(),
        epoch_claimed_amount: 0,
        epoch_duration: EPOCH_DURATION,
    });
    pool.pending_claims_count += 1;
    storage::store_insurance_pool(env, &group.token_address, &pool);

    // Note: emit_claim_filed would be called here if the event function existed
    
    Ok(claim_id)
}

/// Processes a claim with enhanced security checks and executes payout if approved.
pub fn process_claim(env: &Env, claim_id: u64, approved: bool) -> Result<(), AjoError> {
    let mut claim = storage::get_insurance_claim(env, claim_id).ok_or(AjoError::InvalidClaim)?;

    if claim.status != ClaimStatus::Pending {
        return Err(AjoError::InvalidClaim);
    }

    let group = storage::get_group(env, claim.group_id).ok_or(AjoError::GroupNotFound)?;
    let mut pool = storage::get_insurance_pool(env, &group.token_address).ok_or(AjoError::PoolNotFound)?;

    if approved {
        // Enhanced: Check pool solvency before payout
        check_pool_solvency(env, &mut pool, claim.amount)?;

        if pool.balance < claim.amount {
            return Err(AjoError::InsufficientPoolBalance);
        }

        // Execute payout
        pool.balance -= claim.amount;
        pool.total_payouts += claim.amount;
        claim.status = ClaimStatus::Paid;

        // Transfer tokens from contract to claimant
        crate::token::transfer_token(
            env,
            &group.token_address,
            &env.current_contract_address(),
            &claim.claimant,
            claim.amount,
        )?;
    } else {
        claim.status = ClaimStatus::Rejected;
    }

    pool.pending_claims_count -= 1;
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
        return Ok(false);
    }

    // Enhanced: Check for fraud patterns before verifying contribution status
    let fraud_risk = calculate_fraud_risk_score(env, &claim);
    if fraud_risk >= HIGH_FRAUD_RISK_THRESHOLD {
        return Ok(false); // Reject high-risk claims
    }

    // Check whether the alleged defaulter actually contributed in the claimed cycle.
    let has_contributed = storage::has_contributed(
        env,
        claim.group_id,
        claim.cycle,
        &claim.defaulter,
    );

    // Claim is valid only when the defaulter did NOT contribute and fraud risk is low.
    Ok(!has_contributed)
}

/// Automatically verifies and processes a pending claim with enhanced security.
pub fn auto_process_claim(env: &Env, claim_id: u64) -> Result<(), AjoError> {
    let claim = storage::get_insurance_claim(env, claim_id)
        .ok_or(AjoError::InvalidClaim)?;

    if claim.status != ClaimStatus::Pending {
        return Err(AjoError::InvalidClaim);
    }

    // Enhanced: Perform additional fraud checks during auto-processing
    let fraud_risk = calculate_fraud_risk_score(env, &claim);
    if fraud_risk >= HIGH_FRAUD_RISK_THRESHOLD {
        // Auto-reject high-risk claims
        let mut rejected_claim = claim;
        rejected_claim.status = ClaimStatus::Rejected;
        storage::store_insurance_claim(env, claim_id, &rejected_claim);
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
    storage::get_insurance_pool(env, token).ok_or(AjoError::PoolNotFound)
}

/// Enhanced member risk scoring based on basic analysis.
pub fn get_member_risk_score(env: &Env, member: &Address) -> u32 {
    // Enhanced: Calculate risk based on actual claim history
    let mut risk_score = 10u32; // Base low risk
    let now = env.ledger().timestamp();
    
    let mut total_claims = 0u32;
    let mut successful_claims = 0u32;
    
    // Analyze member's claim history
    for i in 1..=storage::get_next_claim_id(env) {
        if let Some(claim) = storage::get_insurance_claim(env, i) {
            if claim.claimant == *member {
                total_claims += 1;
                if claim.status == ClaimStatus::Paid {
                    successful_claims += 1;
                }
                
                // Recent claims increase risk
                if now - claim.created_at < 86400 { // within 24 hours
                    risk_score += 10;
                }
            }
        }
    }
    
    // Adjust risk based on success rate
    if total_claims > 0 {
        let success_rate = (successful_claims * 100) / total_claims;
        if success_rate < 50 {
            risk_score += 20; // Poor success rate is suspicious
        }
    }
    
    // Multiple recent claims is high risk
    if total_claims > 3 {
        risk_score += 15;
    }
    
    risk_score.min(100)
}

/// Enhanced group risk rating with behavioral analysis.
pub fn get_group_risk_rating(env: &Env, group: &Group) -> u32 {
    let total_members = group.members.len();
    if total_members == 0 {
        return 0;
    }

    // Enhanced: Calculate aggregate member risk and claim density
    let mut total_risk = 0u32;
    let mut total_claims = 0u32;
    
    // Aggregate member risks
    for member in &group.members {
        total_risk += get_member_risk_score(env, &member);
    }
    
    // Count insurance claims for this group
    for i in 1..=storage::get_next_claim_id(env) {
        if let Some(claim) = storage::get_insurance_claim(env, i) {
            if claim.group_id == group.id {
                total_claims += 1;
            }
        }
    }
    
    let avg_member_risk = total_risk / total_members;
    
    // Adjust for claim density (high claim rate = higher risk)
    let claim_rate = if group.current_cycle > 0 {
        (total_claims * 100) / group.current_cycle
    } else {
        0
    };
    
    let mut group_risk = avg_member_risk;
    group_risk += claim_rate / 2; // Add claim rate impact
    
    group_risk.min(100)
}
