#![cfg(test)]

use soroban_ajo::{AjoContract, AjoContractClient};
use soroban_sdk::testutils::Ledger;
use soroban_sdk::{testutils::Address as _, Address, Env};

/// Helper function to create a test environment and contract
fn setup_test_env() -> (Env, AjoContractClient<'static>, Address, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, AjoContract);
    let client = AjoContractClient::new(&env, &contract_id);

    // Generate test addresses
    let creator = Address::generate(&env);
    let member2 = Address::generate(&env);
    let member3 = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract(token_admin);

    // Fund every generated member so `contribute()` calls in tests have balance to transfer.
    let token_admin_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    for member in [&creator, &member2, &member3] {
        token_admin_client.mint(member, &1_000_000_000i128);
    }

    (env, client, creator, member2, member3, token)
}

#[test]
fn test_group_status_initial_state() {
    let (_env, client, creator, member2, member3, token) = setup_test_env();

    // Create group with 3 members
    let group_id = client.create_group(&creator, &token, &100_000_000i128, &604_800u64, &3u32, &86400u64, &5u32, &0u32);
    client.join_group(&member2, &group_id);
    client.join_group(&member3, &group_id);

    // Get status
    let status = client.get_group_status(&group_id);

    // Verify initial state
    assert_eq!(status.group_id, group_id);
    assert_eq!(status.current_cycle, 1);
    assert_eq!(status.has_next_recipient, true);
    assert_eq!(status.next_recipient, creator.clone());
    assert_eq!(status.contributions_received, 0);
    assert_eq!(status.total_members, 3);
    assert_eq!(status.pending_contributors.len(), 3);
    assert_eq!(status.is_complete, false);
    assert_eq!(status.is_cycle_active, true);
}

#[test]
fn test_group_status_partial_contributions() {
    let (_env, client, creator, member2, member3, token) = setup_test_env();

    // Create group with 3 members
    let group_id = client.create_group(&creator, &token, &100_000_000i128, &604_800u64, &3u32, &86400u64, &5u32, &0u32);
    client.join_group(&member2, &group_id);
    client.join_group(&member3, &group_id);

    // Two members contribute
    client.contribute(&creator, &group_id);
    client.contribute(&member2, &group_id);

    // Get status
    let status = client.get_group_status(&group_id);

    // Verify partial contribution state
    assert_eq!(status.contributions_received, 2);
    assert_eq!(status.total_members, 3);
    assert_eq!(status.pending_contributors.len(), 1);
    assert_eq!(status.pending_contributors.get(0).unwrap(), member3);
    assert_eq!(status.is_complete, false);
}

#[test]
fn test_group_status_all_contributed() {
    let (_env, client, creator, member2, member3, token) = setup_test_env();

    // Create group with 3 members
    let group_id = client.create_group(&creator, &token, &100_000_000i128, &604_800u64, &3u32, &86400u64, &5u32, &0u32);
    client.join_group(&member2, &group_id);
    client.join_group(&member3, &group_id);

    // All members contribute
    client.contribute(&creator, &group_id);
    client.contribute(&member2, &group_id);
    client.contribute(&member3, &group_id);

    // Get status
    let status = client.get_group_status(&group_id);

    // Verify all contributed
    assert_eq!(status.contributions_received, 3);
    assert_eq!(status.total_members, 3);
    assert_eq!(status.pending_contributors.len(), 0);
    assert_eq!(status.is_complete, false);
}

#[test]
fn test_group_status_after_payout() {
    let (env, client, creator, member2, member3, token) = setup_test_env();

    // Create group with 3 members
    let group_id = client.create_group(&creator, &token, &100_000_000i128, &604_800u64, &3u32, &86400u64, &5u32, &0u32);
    client.join_group(&member2, &group_id);
    client.join_group(&member3, &group_id);

    // Complete first cycle
    client.contribute(&creator, &group_id);
    client.contribute(&member2, &group_id);
    client.contribute(&member3, &group_id);
    
    // Advance time past grace period to allow payout
    env.ledger().with_mut(|li| {
        li.timestamp = li.timestamp + 604_800 + 86400 + 1;
    });
    
    client.execute_payout(&group_id);

    // Get status after payout
    let status = client.get_group_status(&group_id);

    // Verify state after payout
    assert_eq!(status.current_cycle, 2);
    assert_eq!(status.has_next_recipient, true);
    assert_eq!(status.next_recipient, member2.clone());
    assert_eq!(status.contributions_received, 0); // Reset for new cycle
    assert_eq!(status.pending_contributors.len(), 3); // All pending again
    assert_eq!(status.is_complete, false);
}

#[test]
fn test_group_status_mid_lifecycle() {
    let (env, client, creator, member2, member3, token) = setup_test_env();

    // Create group with 3 members
    let group_id = client.create_group(&creator, &token, &100_000_000i128, &604_800u64, &3u32, &86400u64, &5u32, &0u32);
    client.join_group(&member2, &group_id);
    client.join_group(&member3, &group_id);

    // Complete first cycle
    client.contribute(&creator, &group_id);
    client.contribute(&member2, &group_id);
    client.contribute(&member3, &group_id);
    
    // Advance time past grace period
    env.ledger().with_mut(|li| {
        li.timestamp = li.timestamp + 604_800 + 86400 + 1;
    });
    
    client.execute_payout(&group_id);

    // Complete second cycle
    client.contribute(&creator, &group_id);
    client.contribute(&member2, &group_id);
    client.contribute(&member3, &group_id);
    
    // Advance time past grace period again
    env.ledger().with_mut(|li| {
        li.timestamp = li.timestamp + 604_800 + 86400 + 1;
    });
    
    client.execute_payout(&group_id);

    // Start third cycle with partial contributions
    client.contribute(&creator, &group_id);

    // Get status
    let status = client.get_group_status(&group_id);

    // Verify mid-lifecycle state
    assert_eq!(status.current_cycle, 3);
    assert_eq!(status.has_next_recipient, true);
    assert_eq!(status.next_recipient, member3.clone());
    assert_eq!(status.contributions_received, 1);
    assert_eq!(status.pending_contributors.len(), 2);
    assert_eq!(status.is_complete, false);
}

#[test]
fn test_group_status_completed() {
    let (env, client, creator, member2, member3, token) = setup_test_env();

    // Create group with 3 members
    let group_id = client.create_group(&creator, &token, &100_000_000i128, &604_800u64, &3u32, &86400u64, &5u32, &0u32);
    client.join_group(&member2, &group_id);
    client.join_group(&member3, &group_id);

    // Complete all three cycles
    for _ in 0..3 {
        client.contribute(&creator, &group_id);
        client.contribute(&member2, &group_id);
        client.contribute(&member3, &group_id);
        
        // Advance time past grace period
        env.ledger().with_mut(|li| {
            li.timestamp = li.timestamp + 604_800 + 86400 + 1;
        });
        
        client.execute_payout(&group_id);
    }

    // Get status
    let status = client.get_group_status(&group_id);

    // Verify completed state
    assert_eq!(status.is_complete, true);
    assert_eq!(status.has_next_recipient, false); // No next recipient when complete
    assert_eq!(status.current_cycle, 3); // Stays at last cycle
}

#[test]
fn test_group_status_cycle_timing() {
    let (_env, client, creator, _, _, token) = setup_test_env();

    let cycle_duration = 604_800u64; // 1 week
    let group_id = client.create_group(&creator, &token, &100_000_000i128, &cycle_duration, &3u32, &86400u64, &5u32, &0u32);

    // Get initial status
    let status = client.get_group_status(&group_id);

    // Verify timing information
    assert_eq!(
        status.cycle_end_time - status.cycle_start_time,
        cycle_duration
    );
    assert_eq!(status.is_cycle_active, true);
    assert!(status.current_time >= status.cycle_start_time);
    assert!(status.current_time < status.cycle_end_time);
}

#[test]
fn test_group_status_cycle_expired() {
    let (env, client, creator, _, _, token) = setup_test_env();

    let cycle_duration = 604_800u64; // 1 week
    let group_id = client.create_group(&creator, &token, &100_000_000i128, &cycle_duration, &3u32, &86400u64, &5u32, &0u32);

    // Advance time past cycle end
    env.ledger()
        .with_mut(|li| li.timestamp += cycle_duration + 1);

    // Get status
    let status = client.get_group_status(&group_id);

    // Verify cycle is no longer active
    assert_eq!(status.is_cycle_active, false);
    assert!(status.current_time >= status.cycle_end_time);
}

#[test]
fn test_group_status_single_member_group() {
    let (_env, client, creator, _, _, token) = setup_test_env();

    // Create group with just creator (edge case, though normally min is 2)
    let group_id = client.create_group(&creator, &token, &100_000_000i128, &604_800u64, &2u32, &86400u64, &5u32, &0u32);

    // Get status
    let status = client.get_group_status(&group_id);

    // Verify single member state
    assert_eq!(status.total_members, 1);
    assert_eq!(status.contributions_received, 0);
    assert_eq!(status.pending_contributors.len(), 1);
    assert_eq!(status.has_next_recipient, true);
    assert_eq!(status.next_recipient, creator.clone());
}

#[test]
fn test_group_status_large_group() {
    let (env, client, creator, _, _, token) = setup_test_env();

    // Create group with many members
    let max_members = 10u32;
    let group_id = client.create_group(&creator, &token, &100_000_000i128, &604_800u64, &max_members, &86400u64, &5u32, &0u32);

    // Add more members
    let token_admin_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    let mut members = vec![creator.clone()];
    for _ in 1..5 {
        let member = Address::generate(&env);
        client.join_group(&member, &group_id);
        token_admin_client.mint(&member, &1_000_000_000i128);
        members.push(member);
    }

    // Some contribute
    client.contribute(&members[0], &group_id);
    client.contribute(&members[1], &group_id);
    client.contribute(&members[2], &group_id);

    // Get status
    let status = client.get_group_status(&group_id);

    // Verify large group state
    assert_eq!(status.total_members, 5);
    assert_eq!(status.contributions_received, 3);
    assert_eq!(status.pending_contributors.len(), 2);
}

#[test]
fn test_group_status_multiple_cycles_tracking() {
    let (env, client, creator, member2, member3, token) = setup_test_env();

    // Create group
    let group_id = client.create_group(&creator, &token, &100_000_000i128, &604_800u64, &3u32, &86400u64, &5u32, &0u32);
    client.join_group(&member2, &group_id);
    client.join_group(&member3, &group_id);

    // Track status through multiple cycles
    for cycle in 1..=3 {
        let status_before = client.get_group_status(&group_id);
        assert_eq!(status_before.current_cycle, cycle);
        assert_eq!(status_before.contributions_received, 0);

        // All contribute
        client.contribute(&creator, &group_id);
        client.contribute(&member2, &group_id);
        client.contribute(&member3, &group_id);

        let status_after = client.get_group_status(&group_id);
        assert_eq!(status_after.contributions_received, 3);
        assert_eq!(status_after.pending_contributors.len(), 0);

        // Advance time past grace period
        env.ledger().with_mut(|li| {
            li.timestamp = li.timestamp + 604_800 + 86400 + 1;
        });

        // Execute payout (except on last cycle to check completion)
        client.execute_payout(&group_id);
    }

    // Final status should show completion
    let final_status = client.get_group_status(&group_id);
    assert_eq!(final_status.is_complete, true);
}

#[test]
fn test_group_status_consistency_with_get_group() {
    let (_env, client, creator, member2, member3, token) = setup_test_env();

    // Create and setup group
    let group_id = client.create_group(&creator, &token, &100_000_000i128, &604_800u64, &3u32, &86400u64, &5u32, &0u32);
    client.join_group(&member2, &group_id);
    client.join_group(&member3, &group_id);
    client.contribute(&creator, &group_id);

    // Get both status and group
    let status = client.get_group_status(&group_id);
    let group = client.get_group(&group_id);

    // Verify consistency
    assert_eq!(status.group_id, group.id);
    assert_eq!(status.current_cycle, group.current_cycle);
    assert_eq!(status.total_members, group.members.len());
    assert_eq!(status.is_complete, group.is_complete);
    assert_eq!(status.cycle_start_time, group.cycle_start_time);
}

#[test]
fn test_group_status_invalid_group_id() {
    let (_env, client, _creator, _, _, token) = setup_test_env();

    // Try to get status for non-existent group
    let result = client.try_get_group_status(&999u64);

    // Should return GroupNotFound error
    assert!(result.is_err());
    match result {
        Err(Ok(err)) => {
            // Verify it's the correct error type by checking error code
            // GroupNotFound is error code 1
            assert_eq!(format!("{:?}", err).contains("GroupNotFound"), true);
        }
        _ => panic!("Expected GroupNotFound error"),
    }
}

#[test]
fn test_group_status_zero_group_id() {
    let (_env, client, _creator, _, _, token) = setup_test_env();

    // Try to get status for group ID 0 (invalid)
    let result = client.try_get_group_status(&0u64);

    // Should return GroupNotFound error
    assert!(result.is_err());
}

#[test]
fn test_group_status_max_group_id() {
    let (_env, client, _creator, _, _, token) = setup_test_env();

    // Try to get status for maximum u64 value
    let result = client.try_get_group_status(&u64::MAX);

    // Should return GroupNotFound error, not panic
    assert!(result.is_err());
}

#[test]
fn test_group_status_no_overflow_with_many_contributions() {
    let (env, client, creator, _, _, token) = setup_test_env();

    // Create group with multiple members
    let group_id = client.create_group(&creator, &token, &100_000_000i128, &604_800u64, &10u32, &86400u64, &5u32, &0u32);

    // Add several members
    let token_admin_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    let mut members = vec![creator.clone()];
    for _ in 1..8 {
        let member = Address::generate(&env);
        client.join_group(&member, &group_id);
        token_admin_client.mint(&member, &1_000_000_000i128);
        members.push(member);
    }

    // All contribute
    for member in &members {
        client.contribute(member, &group_id);
    }

    // Get status - should not overflow
    let status = client.get_group_status(&group_id);

    // Verify counts are correct
    assert_eq!(status.contributions_received, 8);
    assert_eq!(status.total_members, 8);
    assert_eq!(status.pending_contributors.len(), 0);
}

#[test]
fn test_group_status_placeholder_address_when_complete() {
    let (env, client, creator, member2, member3, token) = setup_test_env();

    // Create and complete a group
    let group_id = client.create_group(&creator, &token, &100_000_000i128, &604_800u64, &3u32, &86400u64, &5u32, &0u32);
    client.join_group(&member2, &group_id);
    client.join_group(&member3, &group_id);

    // Complete all cycles
    for _ in 0..3 {
        client.contribute(&creator, &group_id);
        client.contribute(&member2, &group_id);
        client.contribute(&member3, &group_id);
        
        // Advance time past grace period
        env.ledger().with_mut(|li| {
            li.timestamp = li.timestamp + 604_800 + 86400 + 1;
        });
        
        client.execute_payout(&group_id);
    }

    // Get status
    let status = client.get_group_status(&group_id);

    // Verify placeholder handling
    assert_eq!(status.is_complete, true);
    assert_eq!(status.has_next_recipient, false);
    // next_recipient contains placeholder (creator), but has_next_recipient is false
    assert_eq!(status.next_recipient, creator);
}

#[test]
fn test_group_status_atomic_consistency() {
    let (_env, client, creator, member2, member3, token) = setup_test_env();

    // Create group
    let group_id = client.create_group(&creator, &token, &100_000_000i128, &604_800u64, &3u32, &86400u64, &5u32, &0u32);
    client.join_group(&member2, &group_id);
    client.join_group(&member3, &group_id);

    // Contribute
    client.contribute(&creator, &group_id);
    client.contribute(&member2, &group_id);

    // Get status
    let status = client.get_group_status(&group_id);

    // Verify atomic consistency
    // contributions_received + pending_contributors.len() should equal total_members
    assert_eq!(
        status.contributions_received + status.pending_contributors.len(),
        status.total_members
    );

    // Verify pending list is accurate
    assert_eq!(status.pending_contributors.len(), 1);
    assert_eq!(status.pending_contributors.get(0).unwrap(), member3);
}
