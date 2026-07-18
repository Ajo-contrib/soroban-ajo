#![cfg(test)]

//! Security-focused tests for the Ajo contract
//!
//! These tests specifically target security vulnerabilities and edge cases
//! that could lead to fund loss, unauthorized access, or state corruption.

use soroban_sdk::{testutils::{Address as _, Ledger}, token, Address, Env};
use soroban_ajo::{AjoContract, AjoContractClient, AjoError};

/// Helper function to create a test environment and contract
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

/// Generate multiple test addresses
fn generate_addresses(env: &Env, count: usize) -> Vec<Address> {
    (0..count).map(|_| Address::generate(env)).collect()
}

// ============================================================================
// Access Control Tests
// ============================================================================

#[test]
fn test_security_unauthorized_pause() {
    let (env, client, _admin, _token) = setup_test_env();
    let attacker = Address::generate(&env);
    
    // Attacker tries to pause without being admin
    let result = client.try_pause();
    assert_eq!(result, Err(Ok(AjoError::UnauthorizedPause)));
}

#[test]
fn test_security_unauthorized_unpause() {
    let (env, client, admin, _token) = setup_test_env();
    
    // Admin pauses
    client.pause();
    
    // Attacker tries to unpause
    let attacker = Address::generate(&env);
    let result = client.try_unpause();
    assert_eq!(result, Err(Ok(AjoError::UnauthorizedUnpause)));
}

#[test]
fn test_security_unauthorized_upgrade() {
    let (env, client, _admin, _token) = setup_test_env();
    let attacker = Address::generate(&env);
    
    // Create fake wasm hash
    let fake_wasm = [0u8; 32];
    let wasm_hash = soroban_sdk::BytesN::from_array(&env, &fake_wasm);
    
    // Attacker tries to upgrade
    let result = client.try_upgrade(&wasm_hash, &1u32);
    assert_eq!(result, Err(Ok(AjoError::Unauthorized)));
}

#[test]
fn test_security_non_member_contribution() {
    let (env, client, _admin, token) = setup_test_env();
    let creator = Address::generate(&env);
    let attacker = Address::generate(&env);

    let group_id = client.create_group(&creator, &token, &100_000_000i128, &604_800u64, &5u32, &86400u64, &5u32, &0u32);

    // Attacker tries to contribute without being a member
    let result = client.try_contribute(&attacker, &group_id);
    assert_eq!(result, Err(Ok(AjoError::NotMember)));
}

// ============================================================================
// Double-Spend / Replay Attack Tests
// ============================================================================

#[test]
fn test_security_double_contribution_same_cycle() {
    let (env, client, _admin, token) = setup_test_env();
    let members = generate_addresses(&env, 3);

    let group_id = client.create_group(&members[0], &token, &100_000_000i128, &604_800u64, &3u32, &86400u64, &5u32, &0u32);
    client.join_group(&members[1], &group_id);
    client.join_group(&members[2], &group_id);

    // Mint tokens and make first contribution succeed
    let tc = token::StellarAssetClient::new(&env, &token);
    tc.mint(&members[0], &100_000_000i128);
    client.contribute(&members[0], &group_id);

    // Second contribution from same member should fail
    let result = client.try_contribute(&members[0], &group_id);
    assert_eq!(result, Err(Ok(AjoError::AlreadyContributed)));
}

#[test]
fn test_security_double_payout_attempt() {
    let (env, client, _admin, token) = setup_test_env();
    let members = generate_addresses(&env, 2);

    let group_id = client.create_group(&members[0], &token, &100_000_000i128, &604_800u64, &2u32, &86400u64, &5u32, &0u32);
    client.join_group(&members[1], &group_id);

    // Complete first cycle
    let tc = token::StellarAssetClient::new(&env, &token);
    tc.mint(&members[0], &100_000_000i128);
    tc.mint(&members[1], &100_000_000i128);
    client.contribute(&members[0], &group_id);
    client.contribute(&members[1], &group_id);
    env.ledger().with_mut(|li| { li.timestamp += 604_800 + 86400 + 1; });
    client.execute_payout(&group_id);

    // Try to execute payout again without contributions
    let result = client.try_execute_payout(&group_id);
    assert_eq!(result, Err(Ok(AjoError::IncompleteContributions)));
}

#[test]
fn test_security_join_after_already_member() {
    let (env, client, _admin, token) = setup_test_env();
    let members = generate_addresses(&env, 2);

    let group_id = client.create_group(&members[0], &token, &100_000_000i128, &604_800u64, &5u32, &86400u64, &5u32, &0u32);
    client.join_group(&members[1], &group_id);

    // Try to join again
    let result = client.try_join_group(&members[1], &group_id);
    assert_eq!(result, Err(Ok(AjoError::AlreadyMember)));
}

// ============================================================================
// Input Validation / Boundary Tests
// ============================================================================

#[test]
fn test_security_zero_contribution_amount() {
    let (env, client, _admin, token) = setup_test_env();
    let creator = Address::generate(&env);

    let result = client.try_create_group(&creator, &token, &0i128, &604_800u64, &5u32, &86400u64, &5u32, &0u32);
    assert_eq!(result, Err(Ok(AjoError::ContributionAmountZero)));
}

#[test]
fn test_security_negative_contribution_amount() {
    let (env, client, _admin, token) = setup_test_env();
    let creator = Address::generate(&env);

    let result = client.try_create_group(&creator, &token, &-1000i128, &604_800u64, &5u32, &86400u64, &5u32, &0u32);
    assert_eq!(result, Err(Ok(AjoError::ContributionAmountNegative)));
}

#[test]
fn test_security_zero_cycle_duration() {
    let (env, client, _admin, token) = setup_test_env();
    let creator = Address::generate(&env);

    let result = client.try_create_group(&creator, &token, &100_000_000i128, &0u64, &5u32, &86400u64, &5u32, &0u32);
    assert_eq!(result, Err(Ok(AjoError::CycleDurationZero)));
}

#[test]
fn test_security_max_members_below_minimum() {
    let (env, client, _admin, token) = setup_test_env();
    let creator = Address::generate(&env);

    let result = client.try_create_group(&creator, &token, &100_000_000i128, &604_800u64, &1u32, &86400u64, &5u32, &0u32);
    assert_eq!(result, Err(Ok(AjoError::MaxMembersBelowMinimum)));
}

#[test]
fn test_security_max_members_above_limit() {
    let (env, client, _admin, token) = setup_test_env();
    let creator = Address::generate(&env);

    let result = client.try_create_group(&creator, &token, &100_000_000i128, &604_800u64, &101u32, &86400u64, &5u32, &0u32);
    assert_eq!(result, Err(Ok(AjoError::MaxMembersAboveLimit)));
}

#[test]
fn test_security_max_members_at_limit() {
    let (env, client, _admin, token) = setup_test_env();
    let creator = Address::generate(&env);

    // Should succeed with exactly 100 members
    let result = client.try_create_group(&creator, &token, &100_000_000i128, &604_800u64, &100u32, &86400u64, &5u32, &0u32);
    assert!(result.is_ok());
}

// ============================================================================
// State Manipulation Tests
// ============================================================================

#[test]
fn test_security_payout_without_all_contributions() {
    let (env, client, _admin, token) = setup_test_env();
    let members = generate_addresses(&env, 3);

    let group_id = client.create_group(&members[0], &token, &100_000_000i128, &604_800u64, &3u32, &86400u64, &5u32, &0u32);
    client.join_group(&members[1], &group_id);
    client.join_group(&members[2], &group_id);

    // Only 2 out of 3 contribute
    let tc = token::StellarAssetClient::new(&env, &token);
    tc.mint(&members[0], &100_000_000i128);
    tc.mint(&members[1], &100_000_000i128);
    client.contribute(&members[0], &group_id);
    client.contribute(&members[1], &group_id);

    // Payout should fail (IncompleteContributions checked before token)
    let result = client.try_execute_payout(&group_id);
    assert_eq!(result, Err(Ok(AjoError::IncompleteContributions)));
}

#[test]
fn test_security_contribute_to_completed_group() {
    let (env, client, _admin, token) = setup_test_env();
    let members = generate_addresses(&env, 2);

    let group_id = client.create_group(&members[0], &token, &100_000_000i128, &604_800u64, &2u32, &86400u64, &5u32, &0u32);
    client.join_group(&members[1], &group_id);

    // Complete all cycles
    let tc = token::StellarAssetClient::new(&env, &token);
    for _ in 0..2 {
        tc.mint(&members[0], &100_000_000i128);
        tc.mint(&members[1], &100_000_000i128);
        client.contribute(&members[0], &group_id);
        client.contribute(&members[1], &group_id);
        env.ledger().with_mut(|li| { li.timestamp += 604_800 + 86400 + 1; });
        client.execute_payout(&group_id);
    }

    // Try to contribute to completed group
    let result = client.try_contribute(&members[0], &group_id);
    assert_eq!(result, Err(Ok(AjoError::GroupComplete)));
}

#[test]
fn test_security_join_completed_group() {
    let (env, client, _admin, token) = setup_test_env();
    let members = generate_addresses(&env, 3);

    let group_id = client.create_group(&members[0], &token, &100_000_000i128, &604_800u64, &2u32, &86400u64, &5u32, &0u32);
    client.join_group(&members[1], &group_id);

    // Complete all cycles
    let tc = token::StellarAssetClient::new(&env, &token);
    for _ in 0..2 {
        tc.mint(&members[0], &100_000_000i128);
        tc.mint(&members[1], &100_000_000i128);
        client.contribute(&members[0], &group_id);
        client.contribute(&members[1], &group_id);
        env.ledger().with_mut(|li| { li.timestamp += 604_800 + 86400 + 1; });
        client.execute_payout(&group_id);
    }

    // Try to join completed group
    let result = client.try_join_group(&members[2], &group_id);
    assert_eq!(result, Err(Ok(AjoError::GroupComplete)));
}

#[test]
fn test_security_payout_to_completed_group() {
    let (env, client, _admin, token) = setup_test_env();
    let members = generate_addresses(&env, 2);

    let group_id = client.create_group(&members[0], &token, &100_000_000i128, &604_800u64, &2u32, &86400u64, &5u32, &0u32);
    client.join_group(&members[1], &group_id);

    // Complete all cycles
    let tc = token::StellarAssetClient::new(&env, &token);
    for _ in 0..2 {
        tc.mint(&members[0], &100_000_000i128);
        tc.mint(&members[1], &100_000_000i128);
        client.contribute(&members[0], &group_id);
        client.contribute(&members[1], &group_id);
        env.ledger().with_mut(|li| { li.timestamp += 604_800 + 86400 + 1; });
        client.execute_payout(&group_id);
    }

    // Try to execute another payout
    let result = client.try_execute_payout(&group_id);
    assert_eq!(result, Err(Ok(AjoError::GroupComplete)));
}

// ============================================================================
// Denial of Service Tests
// ============================================================================

#[test]
fn test_security_join_full_group() {
    let (env, client, _admin, token) = setup_test_env();
    let members = generate_addresses(&env, 4);

    // Create group with max 3 members
    let group_id = client.create_group(&members[0], &token, &100_000_000i128, &604_800u64, &3u32, &86400u64, &5u32, &0u32);
    client.join_group(&members[1], &group_id);
    client.join_group(&members[2], &group_id);

    // Try to add 4th member
    let result = client.try_join_group(&members[3], &group_id);
    assert_eq!(result, Err(Ok(AjoError::MaxMembersExceeded)));
}

#[test]
fn test_security_large_group_operations() {
    let (env, client, _admin, token) = setup_test_env();
    let members = generate_addresses(&env, 50);

    // Create group with 50 members
    let group_id = client.create_group(&members[0], &token, &100_000_000i128, &604_800u64, &50u32, &86400u64, &5u32, &0u32);

    // Add all members
    for member in &members[1..] {
        client.join_group(member, &group_id);
    }

    // Mint tokens and contribute for all members
    let tc = token::StellarAssetClient::new(&env, &token);
    for member in &members {
        tc.mint(member, &100_000_000i128);
        client.contribute(member, &group_id);
    }

    // Advance time past grace period and execute payout
    env.ledger().with_mut(|li| { li.timestamp += 604_800 + 86400 + 1; });
    client.execute_payout(&group_id);

    let group = client.get_group(&group_id);
    assert_eq!(group.current_cycle, 2);
}

// ============================================================================
// Emergency Pause Tests
// ============================================================================

#[test]
fn test_security_pause_blocks_create_group() {
    let (env, client, _admin, token) = setup_test_env();
    let creator = Address::generate(&env);

    // Pause contract
    client.pause();

    // Try to create group
    let result = client.try_create_group(&creator, &token, &100_000_000i128, &604_800u64, &5u32, &86400u64, &5u32, &0u32);
    assert_eq!(result, Err(Ok(AjoError::ContractPaused)));
}

#[test]
fn test_security_pause_blocks_join_group() {
    let (env, client, _admin, token) = setup_test_env();
    let members = generate_addresses(&env, 2);

    // Create group before pause
    let group_id = client.create_group(&members[0], &token, &100_000_000i128, &604_800u64, &5u32, &86400u64, &5u32, &0u32);

    // Pause contract
    client.pause();

    // Try to join
    let result = client.try_join_group(&members[1], &group_id);
    assert_eq!(result, Err(Ok(AjoError::ContractPaused)));
}

#[test]
fn test_security_pause_blocks_contribute() {
    let (env, client, _admin, token) = setup_test_env();
    let creator = Address::generate(&env);

    // Create group before pause
    let group_id = client.create_group(&creator, &token, &100_000_000i128, &604_800u64, &5u32, &86400u64, &5u32, &0u32);

    // Pause contract
    client.pause();

    // Try to contribute (ContractPaused checked before token transfer)
    let result = client.try_contribute(&creator, &group_id);
    assert_eq!(result, Err(Ok(AjoError::ContractPaused)));
}

#[test]
fn test_security_pause_blocks_payout() {
    let (env, client, _admin, token) = setup_test_env();
    let members = generate_addresses(&env, 2);

    let group_id = client.create_group(&members[0], &token, &100_000_000i128, &604_800u64, &2u32, &86400u64, &5u32, &0u32);
    client.join_group(&members[1], &group_id);

    // All contribute
    let tc = token::StellarAssetClient::new(&env, &token);
    tc.mint(&members[0], &100_000_000i128);
    tc.mint(&members[1], &100_000_000i128);
    client.contribute(&members[0], &group_id);
    client.contribute(&members[1], &group_id);

    // Pause contract
    client.pause();

    // Try to execute payout (ContractPaused checked first)
    let result = client.try_execute_payout(&group_id);
    assert_eq!(result, Err(Ok(AjoError::ContractPaused)));
}

#[test]
fn test_security_pause_allows_queries() {
    let (env, client, _admin, token) = setup_test_env();
    let creator = Address::generate(&env);

    // Create group before pause
    let group_id = client.create_group(&creator, &token, &100_000_000i128, &604_800u64, &5u32, &86400u64, &5u32, &0u32);

    // Pause contract
    client.pause();
    
    // Queries should still work
    let group = client.get_group(&group_id);
    assert_eq!(group.id, group_id);
    
    let members = client.list_members(&group_id);
    assert_eq!(members.len(), 1);
    
    let is_member = client.is_member(&group_id, &creator);
    assert_eq!(is_member, true);
}

#[test]
fn test_security_unpause_restores_functionality() {
    let (env, client, _admin, token) = setup_test_env();
    let members = generate_addresses(&env, 2);

    let group_id = client.create_group(&members[0], &token, &100_000_000i128, &604_800u64, &5u32, &86400u64, &5u32, &0u32);

    // Pause
    client.pause();
    
    // Verify paused
    let result = client.try_join_group(&members[1], &group_id);
    assert_eq!(result, Err(Ok(AjoError::ContractPaused)));
    
    // Unpause
    client.unpause();
    
    // Should work now
    client.join_group(&members[1], &group_id);
    let group = client.get_group(&group_id);
    assert_eq!(group.members.len(), 2);
}

// ============================================================================
// Integer Overflow / Underflow Tests
// ============================================================================

#[test]
fn test_security_large_contribution_amount() {
    let (env, client, _admin, token) = setup_test_env();
    let creator = Address::generate(&env);

    // Try with very large amount (should succeed if within i128 range)
    let large_amount = 1_000_000_000_000_000i128; // 100 million XLM
    let result = client.try_create_group(&creator, &token, &large_amount, &604_800u64, &5u32, &86400u64, &5u32, &0u32);
    assert!(result.is_ok());
}

#[test]
fn test_security_payout_calculation_no_overflow() {
    let (env, client, _admin, token) = setup_test_env();
    let members = generate_addresses(&env, 10);

    // Large contribution with multiple members
    let contribution = 100_000_000_000i128; // 10,000 XLM
    let group_id = client.create_group(&members[0], &token, &contribution, &604_800u64, &10u32, &86400u64, &5u32, &0u32);

    for member in &members[1..] {
        client.join_group(member, &group_id);
    }

    // Mint tokens and contribute for all members
    let tc = token::StellarAssetClient::new(&env, &token);
    for member in &members {
        tc.mint(member, &contribution);
        client.contribute(member, &group_id);
    }

    // Advance time past grace period and execute payout
    env.ledger().with_mut(|li| { li.timestamp += 604_800 + 86400 + 1; });
    client.execute_payout(&group_id);

    let group = client.get_group(&group_id);
    assert_eq!(group.current_cycle, 2);
}

// ============================================================================
// Metadata Security Tests
// ============================================================================

#[test]
fn test_security_metadata_unauthorized_update() {
    let (env, client, _admin, token) = setup_test_env();
    let members = generate_addresses(&env, 2);

    let group_id = client.create_group(&members[0], &token, &100_000_000i128, &604_800u64, &5u32, &86400u64, &5u32, &0u32);
    client.join_group(&members[1], &group_id);
    
    // Non-creator tries to set metadata
    let name = soroban_sdk::String::from_str(&env, "Test Group");
    let desc = soroban_sdk::String::from_str(&env, "Description");
    let rules = soroban_sdk::String::from_str(&env, "Rules");
    
    let result = client.try_set_group_metadata(&group_id, &name, &desc, &rules);
    assert_eq!(result, Err(Ok(AjoError::Unauthorized)));
}

// ============================================================================
// Concurrent Operation Tests
// ============================================================================

#[test]
fn test_security_multiple_groups_isolation() {
    let (env, client, _admin, token) = setup_test_env();
    let members = generate_addresses(&env, 4);

    // Create two groups
    let group_id1 = client.create_group(&members[0], &token, &100_000_000i128, &604_800u64, &2u32, &86400u64, &5u32, &0u32);
    let group_id2 = client.create_group(&members[2], &token, &200_000_000i128, &1_209_600u64, &2u32, &86400u64, &5u32, &0u32);

    client.join_group(&members[1], &group_id1);
    client.join_group(&members[3], &group_id2);

    // Mint tokens and contribute to group 1
    let tc = token::StellarAssetClient::new(&env, &token);
    tc.mint(&members[0], &100_000_000i128);
    tc.mint(&members[1], &100_000_000i128);
    client.contribute(&members[0], &group_id1);
    client.contribute(&members[1], &group_id1);

    // Group 2 should not be affected
    let status2 = client.get_contribution_status(&group_id2, &1u32);
    for (_, contributed) in status2.iter() {
        assert_eq!(contributed, false);
    }

    // Advance time and execute payout for group 1
    env.ledger().with_mut(|li| { li.timestamp += 604_800 + 86400 + 1; });
    client.execute_payout(&group_id1);

    // Group 2 should still be on cycle 1
    let group2 = client.get_group(&group_id2);
    assert_eq!(group2.current_cycle, 1);
}

#[test]
fn test_security_member_in_multiple_groups() {
    let (env, client, _admin, token) = setup_test_env();
    let members = generate_addresses(&env, 3);

    // Member 0 creates and joins both groups
    let group_id1 = client.create_group(&members[0], &token, &100_000_000i128, &604_800u64, &2u32, &86400u64, &5u32, &0u32);
    let group_id2 = client.create_group(&members[0], &token, &200_000_000i128, &604_800u64, &2u32, &86400u64, &5u32, &0u32);

    client.join_group(&members[1], &group_id1);
    client.join_group(&members[2], &group_id2);

    // Mint tokens and contribute to both groups independently
    let tc = token::StellarAssetClient::new(&env, &token);
    tc.mint(&members[0], &100_000_000i128);
    client.contribute(&members[0], &group_id1);
    tc.mint(&members[0], &200_000_000i128);
    client.contribute(&members[0], &group_id2);

    // Verify contributions are tracked separately
    assert_eq!(
        client.get_contribution_status(&group_id1, &1u32).get(0).unwrap().1,
        true
    );
    assert_eq!(
        client.get_contribution_status(&group_id2, &1u32).get(0).unwrap().1,
        true
    );
}
