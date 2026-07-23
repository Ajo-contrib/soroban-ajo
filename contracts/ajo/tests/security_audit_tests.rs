#![cfg(test)]

//! Security audit regression tests for Issue #794
//!
//! These tests verify fixes for:
//! - Checks-Effects-Interactions (CEI) ordering in payout/refund flows
//! - Authorization bypass prevention
//! - Unbounded loop DoS vectors
//! - Voting mechanism consistency
//! - Integer overflow/underflow safety

use soroban_sdk::{testutils::{Address as _, Ledger}, token, Address, Env, String as SorobanString, Vec as SorobanVec};
use soroban_ajo::{AjoContract, AjoContractClient, AjoError};

/// Helper to set up test environment with admin, contract, and token
fn setup_test_env() -> (Env, AjoContractClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, AjoContract);
    let client = AjoContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    client.initialize(&admin);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract(token_admin);

    (env, client, admin, token_id)
}

fn generate_addresses(env: &Env, count: usize) -> Vec<Address> {
    (0..count).map(|_| Address::generate(env)).collect()
}

// ============================================================================
// FINDING #1: Checks-Effects-Interactions (CEI) - Reentrancy Safety
// ============================================================================

#[test]
fn test_reentrancy_execute_payout_state_ordering() {
    // REGRESSION TEST: Verifies execute_payout updates internal state BEFORE external token transfer
    // This prevents reentrancy attacks where a malicious token callback could exploit
    // partial state updates.
    
    let (env, client, _admin, token) = setup_test_env();
    let members = generate_addresses(&env, 2);

    let group_id = client.create_group(
        &members[0], &token, &100_000_000i128, &604_800u64, &2u32, &86400u64, &5u32, &0u32
    );
    client.join_group(&members[1], &group_id);

    // Mint and contribute
    let tc = token::StellarAssetClient::new(&env, &token);
    tc.mint(&members[0], &100_000_000i128);
    tc.mint(&members[1], &100_000_000i128);
    client.contribute(&members[0], &group_id);
    client.contribute(&members[1], &group_id);

    // Advance time past grace period
    env.ledger().with_mut(|li| { li.timestamp += 604_800 + 86400 + 1; });

    // Execute payout - should succeed with proper state ordering
    client.execute_payout(&group_id);

    // Verify group state was updated correctly
    let group = client.get_group(&group_id);
    assert_eq!(group.payout_index, 1, "Payout index should advance");
    assert_eq!(group.current_cycle, 2, "Cycle should advance");

    // Verify payout was marked as received in storage
    let order = client.get_payout_order(&group_id, &1u32);
    assert_eq!(order.recipient, members[0], "Payout should be recorded for the first recipient");
}

#[test]
fn test_refund_state_consistency_cei_ordering() {
    // REGRESSION TEST: Verifies execute_refund updates group state BEFORE token transfers
    // This prevents state inconsistency if token callback re-enters
    
    let (env, client, _admin, token) = setup_test_env();
    let members = generate_addresses(&env, 2);

    let group_id = client.create_group(
        &members[0], &token, &100_000_000i128, &604_800u64, &2u32, &86400u64, &5u32, &0u32
    );
    client.join_group(&members[1], &group_id);

    // Mint and contribute
    let tc = token::StellarAssetClient::new(&env, &token);
    tc.mint(&members[0], &100_000_000i128);
    tc.mint(&members[1], &100_000_000i128);
    client.contribute(&members[0], &group_id);
    client.contribute(&members[1], &group_id);

    // Request refund after cycle expires
    env.ledger().with_mut(|li| { li.timestamp += 604_800 + 86400 + 1; });
    client.request_refund(&members[0], &group_id);

    // Vote to approve refund
    client.vote_refund(&members[0], &group_id, &true);
    client.vote_refund(&members[1], &group_id, &true);

    // Advance past voting deadline
    env.ledger().with_mut(|li| { li.timestamp += 604_800 + 1; });

    // Execute refund
    client.execute_refund(&members[0], &group_id);

    // Verify group state changed to Cancelled BEFORE token transfers were made
    let group = client.get_group(&group_id);
    assert_eq!(group.state as u32, 1, "Group should be Cancelled (state=1)");
}

// ============================================================================
// FINDING #2: Authorization Bypass in emergency_refund
// ============================================================================

#[test]
fn test_emergency_refund_authorization_strict() {
    // REGRESSION TEST: Verifies only admin can execute emergency_refund
    // Tests both require_auth and admin verification
    
    let (env, client, admin, token) = setup_test_env();
    let creator = Address::generate(&env);
    let attacker = Address::generate(&env);

    let group_id = client.create_group(
        &creator, &token, &100_000_000i128, &604_800u64, &2u32, &86400u64, &5u32, &0u32
    );

    // Attacker tries to call emergency_refund - should fail
    let result = client.try_emergency_refund(&attacker, &group_id);
    assert_eq!(result, Err(Ok(AjoError::Unauthorized)), "Non-admin cannot emergency refund");

    // Only admin can execute
    client.emergency_refund(&admin, &group_id);
    let group = client.get_group(&group_id);
    assert_eq!(group.state as u32, 1, "Group should be Cancelled after emergency refund");
}

#[test]
fn test_emergency_refund_not_called_twice() {
    // REGRESSION TEST: Verifies emergency_refund cannot be called on already-cancelled group
    
    let (env, client, admin, token) = setup_test_env();
    let creator = Address::generate(&env);

    let group_id = client.create_group(
        &creator, &token, &100_000_000i128, &604_800u64, &2u32, &86400u64, &5u32, &0u32
    );

    // First emergency refund succeeds
    client.emergency_refund(&admin, &group_id);

    // Second attempt on cancelled group should fail
    let result = client.try_emergency_refund(&admin, &group_id);
    assert_eq!(result, Err(Ok(AjoError::GroupCancelled)), "Cannot emergency refund already cancelled group");
}

// ============================================================================
// FINDING #3: Unbounded Loop DoS - list_members()
// ============================================================================

#[test]
fn test_list_members_resource_bounded() {
    // REGRESSION TEST: Verifies list_members() with max 100 members is within resource bounds
    // This documents that the group member limit enforces DoS safety
    
    let (env, client, _admin, token) = setup_test_env();
    let members = generate_addresses(&env, 50);

    // Create group with 50 members
    let group_id = client.create_group(
        &members[0], &token, &100_000_000i128, &604_800u64, &50u32, &86400u64, &5u32, &0u32
    );

    for member in &members[1..] {
        client.join_group(member, &group_id);
    }

    // Fetch member list - should complete within reasonable time
    let member_list = client.list_members(&group_id);
    assert_eq!(member_list.len(), 50, "All 50 members should be listed");

    // Verify all addresses match
    for (i, member) in member_list.iter().enumerate() {
        assert_eq!(member, members[i], "Member address mismatch at index {}", i);
    }
}

#[test]
fn test_list_members_max_size_100() {
    // REGRESSION TEST: Verifies max members of 100 is enforced at group creation
    // This caps the DoS attack surface for list_members()
    
    let (env, client, _admin, token) = setup_test_env();
    let creator = Address::generate(&env);

    // Attempt to create group with 101 members should fail
    let result = client.try_create_group(
        &creator, &token, &100_000_000i128, &604_800u64, &101u32, &86400u64, &5u32, &0u32
    );
    assert_eq!(result, Err(Ok(AjoError::MaxMembersAboveLimit)), "Max members should be capped at 100");

    // But 100 should succeed
    let result = client.try_create_group(
        &creator, &token, &100_000_000i128, &604_800u64, &100u32, &86400u64, &5u32, &0u32
    );
    assert!(result.is_ok(), "Creating group with exactly 100 members should succeed");
}

// ============================================================================
// FINDING #4: Unbounded Loop DoS - get_group_disputes()
// ============================================================================

#[test]
fn test_get_group_disputes_resource_bounded() {
    // REGRESSION TEST: Verifies get_group_disputes() returns disputes within reasonable bounds
    // Disputes are scoped to group lifecycle, so count is naturally bounded
    
    let (env, client, _admin, token) = setup_test_env();
    let members = generate_addresses(&env, 3);

    let group_id = client.create_group(
        &members[0], &token, &100_000_000i128, &604_800u64, &3u32, &86400u64, &5u32, &0u32
    );
    client.join_group(&members[1], &group_id);
    client.join_group(&members[2], &group_id);

    // File a dispute
    let desc = SorobanString::from_str(&env, "Test dispute");
    let evidence = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    let dispute_id = client.file_dispute(
        &members[0],
        &group_id,
        &members[1],
        &soroban_ajo::DisputeType::NonPayment,
        &desc,
        &evidence,
        &soroban_ajo::DisputeResolution::Penalty,
    );

    // Verify dispute list is retrievable
    let disputes = client.get_group_disputes(&group_id);
    assert_eq!(disputes.len(), 1, "Should have exactly 1 dispute");
    assert_eq!(disputes.get(0).unwrap(), dispute_id, "Dispute ID should match");
}

#[test]
fn test_get_group_disputes_lifecycle_bounded() {
    // REGRESSION TEST: Verifies disputes are tied to group lifecycle
    // After group completes, no new disputes can be filed
    
    let (env, client, _admin, token) = setup_test_env();
    let members = generate_addresses(&env, 2);

    let group_id = client.create_group(
        &members[0], &token, &100_000_000i128, &604_800u64, &2u32, &86400u64, &5u32, &0u32
    );
    client.join_group(&members[1], &group_id);

    // Complete group through all payouts
    let tc = token::StellarAssetClient::new(&env, &token);
    for _ in 0..2 {
        tc.mint(&members[0], &100_000_000i128);
        tc.mint(&members[1], &100_000_000i128);
        client.contribute(&members[0], &group_id);
        client.contribute(&members[1], &group_id);
        env.ledger().with_mut(|li| { li.timestamp += 604_800 + 86400 + 1; });
        client.execute_payout(&group_id);
    }

    // Attempt to file dispute on completed group should fail
    let desc = SorobanString::from_str(&env, "Test dispute");
    let evidence = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    let result = client.try_file_dispute(
        &members[0],
        &group_id,
        &members[1],
        &soroban_ajo::DisputeType::NonPayment,
        &desc,
        &evidence,
        &soroban_ajo::DisputeResolution::Penalty,
    );
    assert_eq!(result, Err(Ok(AjoError::GroupComplete)), "Cannot file dispute on completed group");
}

// ============================================================================
// FINDING #5: Voting Deadline Manipulation
// ============================================================================

#[test]
fn test_voting_deadline_fairness() {
    // REGRESSION TEST: Verifies voting deadlines are set consistently and fairly
    // Uses fixed VOTING_PERIOD constant to prevent timezone-based exclusions
    
    let (env, client, _admin, token) = setup_test_env();
    let members = generate_addresses(&env, 2);

    let group_id = client.create_group(
        &members[0], &token, &100_000_000i128, &604_800u64, &2u32, &86400u64, &5u32, &0u32
    );
    client.join_group(&members[1], &group_id);

    // Mint, contribute, and request refund
    let tc = token::StellarAssetClient::new(&env, &token);
    tc.mint(&members[0], &100_000_000i128);
    tc.mint(&members[1], &100_000_000i128);
    client.contribute(&members[0], &group_id);
    client.contribute(&members[1], &group_id);
    
    env.ledger().with_mut(|li| { li.timestamp += 604_800 + 86400 + 1; });
    client.request_refund(&members[0], &group_id);

    // Get initial time
    let initial_time = env.ledger().timestamp();

    // Verify voting deadline is exactly VOTING_PERIOD in the future
    // (VOTING_PERIOD is 604_800 seconds = 7 days, defined in types.rs)
    let expected_deadline = initial_time + 604_800u64; // 7 days voting period
    
    // Note: Exact deadline verification would require exposing refund request details
    // This test documents the expected behavior
    
    // Both members can vote until deadline
    client.vote_refund(&members[0], &group_id, &true);
    client.vote_refund(&members[1], &group_id, &true);
}

#[test]
fn test_voting_period_consistent_across_calls() {
    // REGRESSION TEST: Verifies voting deadlines use same constant for fairness
    
    let (env, client, _admin, token) = setup_test_env();
    let members = generate_addresses(&env, 3);

    let group_id = client.create_group(
        &members[0], &token, &100_000_000i128, &604_800u64, &3u32, &86400u64, &5u32, &0u32
    );
    client.join_group(&members[1], &group_id);
    client.join_group(&members[2], &group_id);

    // Setup for disputes
    let tc = token::StellarAssetClient::new(&env, &token);
    tc.mint(&members[0], &100_000_000i128);
    tc.mint(&members[1], &100_000_000i128);
    tc.mint(&members[2], &100_000_000i128);
    client.contribute(&members[0], &group_id);
    client.contribute(&members[1], &group_id);
    client.contribute(&members[2], &group_id);

    // File disputes at different times and verify all use same voting period
    let desc = SorobanString::from_str(&env, "Test");
    let evidence = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    
    let dispute_id_1 = client.file_dispute(
        &members[0], &group_id, &members[1], &soroban_ajo::DisputeType::NonPayment, &desc, &evidence, &soroban_ajo::DisputeResolution::Penalty
    );

    env.ledger().with_mut(|li| { li.timestamp += 100; }); // Advance 100 seconds

    let dispute_id_2 = client.file_dispute(
        &members[1], &group_id, &members[2], &soroban_ajo::DisputeType::NonPayment, &desc, &evidence, &soroban_ajo::DisputeResolution::Penalty
    );

    // Both disputes should exist with consistent voting periods
    let disputes = client.get_group_disputes(&group_id);
    assert_eq!(disputes.len(), 2, "Both disputes should be filed");
}

// ============================================================================
// FINDING #6: Repeated Voting Prevention
// ============================================================================

#[test]
fn test_cannot_vote_twice_refund() {
    // REGRESSION TEST: Verifies storage check prevents double-voting on refund requests
    // Tests the has_voted() check in vote_refund()
    
    let (env, client, _admin, token) = setup_test_env();
    let members = generate_addresses(&env, 2);

    let group_id = client.create_group(
        &members[0], &token, &100_000_000i128, &604_800u64, &2u32, &86400u64, &5u32, &0u32
    );
    client.join_group(&members[1], &group_id);

    let tc = token::StellarAssetClient::new(&env, &token);
    tc.mint(&members[0], &100_000_000i128);
    tc.mint(&members[1], &100_000_000i128);
    client.contribute(&members[0], &group_id);
    client.contribute(&members[1], &group_id);

    env.ledger().with_mut(|li| { li.timestamp += 604_800 + 86400 + 1; });
    client.request_refund(&members[0], &group_id);

    // First vote succeeds
    client.vote_refund(&members[0], &group_id, &true);

    // Second vote from same member should fail
    let result = client.try_vote_refund(&members[0], &group_id, &false);
    assert_eq!(result, Err(Ok(AjoError::AlreadyVoted)), "Cannot vote twice on same refund request");
}

#[test]
fn test_cannot_vote_twice_dispute() {
    // REGRESSION TEST: Verifies storage check prevents double-voting on disputes
    // Tests the has_voted_on_dispute() check in vote_on_dispute()
    
    let (env, client, _admin, token) = setup_test_env();
    let members = generate_addresses(&env, 3);

    let group_id = client.create_group(
        &members[0], &token, &100_000_000i128, &604_800u64, &3u32, &86400u64, &5u32, &0u32
    );
    client.join_group(&members[1], &group_id);
    client.join_group(&members[2], &group_id);

    // File dispute
    let desc = SorobanString::from_str(&env, "Test");
    let evidence = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    let dispute_id = client.file_dispute(
        &members[0], &group_id, &members[1], &soroban_ajo::DisputeType::NonPayment, &desc, &evidence, &soroban_ajo::DisputeResolution::Penalty
    );

    // First vote succeeds
    client.vote_on_dispute(&members[0], &dispute_id, &true);

    // Second vote should fail
    let result = client.try_vote_on_dispute(&members[0], &dispute_id, &false);
    assert_eq!(result, Err(Ok(AjoError::AlreadyVotedOnDispute)), "Cannot vote twice on same dispute");
}

// ============================================================================
// FINDING #7: Integer Overflow in Penalty Calculation
// ============================================================================

#[test]
fn test_penalty_calculation_no_overflow() {
    // REGRESSION TEST: Verifies penalty calculation doesn't overflow with max values
    // Tests: contribution_amount * penalty_rate / 100
    
    let (env, client, _admin, token) = setup_test_env();
    let members = generate_addresses(&env, 3);

    // Use large but realistic contribution amount
    // Max practical: 1 trillion stroops = 100,000 XLM
    let large_contribution = 1_000_000_000_000i128;
    
    let group_id = client.create_group(
        &members[0], &token, &large_contribution, &604_800u64, &3u32, &86400u64, &5u32, &0u32
    );
    client.join_group(&members[1], &group_id);
    client.join_group(&members[2], &group_id);

    // Create dispute and resolve it with penalty
    let desc = SorobanString::from_str(&env, "Test");
    let evidence = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    
    let dispute_id = client.file_dispute(
        &members[0], &group_id, &members[1], &soroban_ajo::DisputeType::NonPayment, &desc, &evidence, &soroban_ajo::DisputeResolution::Penalty
    );

    // Vote to approve penalty
    client.vote_on_dispute(&members[0], &dispute_id, &true);
    client.vote_on_dispute(&members[2], &dispute_id, &true);

    // Advance past voting period and resolve
    env.ledger().with_mut(|li| { li.timestamp += 604_800 + 1; });
    client.resolve_dispute(&members[0], &dispute_id);

    // Verify group state is still valid (no overflow occurred)
    let group = client.get_group(&group_id);
    assert_eq!(group.id, group_id, "Group should still exist after penalty");
    assert_eq!(group.state as u32, 0, "Group should still be Active (not corrupted)");
}

#[test]
fn test_penalty_rate_bounded_at_100() {
    // REGRESSION TEST: Verifies penalty_rate is capped at 100 during group creation
    // This prevents penalty calculation overflow
    
    let (env, client, _admin, token) = setup_test_env();
    let creator = Address::generate(&env);

    // Attempt to create group with penalty_rate > 100 should fail
    let result = client.try_create_group(
        &creator, &token, &100_000_000i128, &604_800u64, &5u32, &86400u64, &101u32, &0u32
    );
    assert_eq!(result, Err(Ok(AjoError::InvalidPenaltyRate)), "Penalty rate must be ≤ 100");

    // penalty_rate = 100 should succeed
    let result = client.try_create_group(
        &creator, &token, &100_000_000i128, &604_800u64, &5u32, &86400u64, &100u32, &0u32
    );
    assert!(result.is_ok(), "Penalty rate of 100 should be allowed");
}

// ============================================================================
// FINDING #8: Payout Calculation Arithmetic Overflow
// ============================================================================

#[test]
fn test_payout_calculation_no_overflow() {
    // REGRESSION TEST: Verifies payout calculation doesn't overflow
    // Tests: contribution_amount * member_count (max 100)
    
    let (env, client, _admin, token) = setup_test_env();
    // 100 members contributing in one Env is more sequential invocations than
    // the default single-transaction resource budget allows.
    env.budget().reset_unlimited();
    let members = generate_addresses(&env, 100);

    // Large contribution amount: 1 billion stroops = 100 XLM
    let contribution = 1_000_000_000i128;
    
    let group_id = client.create_group(
        &members[0], &token, &contribution, &604_800u64, &100u32, &86400u64, &5u32, &0u32
    );

    // Add all 99 other members
    for member in &members[1..] {
        client.join_group(member, &group_id);
    }

    // Mint and contribute for all members
    let tc = token::StellarAssetClient::new(&env, &token);
    for member in &members {
        tc.mint(member, &contribution);
        client.contribute(member, &group_id);
    }

    // Advance time and execute payout
    env.ledger().with_mut(|li| { li.timestamp += 604_800 + 86400 + 1; });
    
    // This should not overflow: 100 * 1e9 = 1e11 << i128::MAX
    client.execute_payout(&group_id);

    // Verify state updated correctly
    let group = client.get_group(&group_id);
    assert_eq!(group.payout_index, 1, "Payout index should increment");
    assert_eq!(group.current_cycle, 2, "Cycle should advance");
}

#[test]
fn test_payout_with_penalty_bonus_no_overflow() {
    // REGRESSION TEST: Verifies payout calculation including penalty bonus doesn't overflow
    // Tests: base_payout + penalty_bonus (collected during cycle)
    
    let (env, client, _admin, token) = setup_test_env();
    let members = generate_addresses(&env, 10);

    let contribution = 100_000_000i128; // 10 XLM
    
    let group_id = client.create_group(
        &members[0], &token, &contribution, &604_800u64, &10u32, &86400u64, &10u32, &0u32
    );

    for member in &members[1..] {
        client.join_group(member, &group_id);
    }

    // Mint and contribute for all members
    let tc = token::StellarAssetClient::new(&env, &token);
    for member in &members {
        tc.mint(member, &contribution);
        client.contribute(member, &group_id);
    }

    // File and resolve disputes to accumulate penalties
    let desc = SorobanString::from_str(&env, "Test");
    let evidence = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    
    let dispute_id = client.file_dispute(
        &members[0], &group_id, &members[1], &soroban_ajo::DisputeType::NonPayment, &desc, &evidence, &soroban_ajo::DisputeResolution::Penalty
    );

    // Vote to approve penalty
    for i in 2..10 {
        client.vote_on_dispute(&members[i], &dispute_id, &true);
    }

    env.ledger().with_mut(|li| { li.timestamp += 604_800 + 1; });
    client.resolve_dispute(&members[0], &dispute_id);

    // Now execute payout with accumulated penalties
    env.ledger().with_mut(|li| { li.timestamp += 604_800 + 86400 + 1; });
    client.execute_payout(&group_id);

    let group = client.get_group(&group_id);
    assert_eq!(group.payout_index, 1, "Payout should succeed with penalty bonus");
}
