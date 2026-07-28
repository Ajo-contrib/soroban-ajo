#![cfg(test)]

//! Integration tests covering full group lifecycle scenarios
//!
//! These tests verify the complete flow from group creation through completion,
//! including multiple groups and failure scenarios.

use soroban_ajo::{AjoContract, AjoContractClient, AjoError};
use soroban_sdk::{testutils::{Address as _, Ledger}, Address, Env};

/// Helper function to create a test environment and contract
fn setup_test_env() -> (Env, AjoContractClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, AjoContract);
    let client = AjoContractClient::new(&env, &contract_id);
    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract(token_admin);

    (env, client, token)
}

/// Helper function to generate multiple test addresses, funded so they can `contribute()`.
fn generate_addresses(env: &Env, token: &Address, count: usize) -> Vec<Address> {
    let token_admin_client = soroban_sdk::token::StellarAssetClient::new(env, token);
    (0..count)
        .map(|_| {
            let member = Address::generate(env);
            token_admin_client.mint(&member, &1_000_000_000i128);
            member
        })
        .collect()
}

/// Helper function to run a complete cycle (all members contribute + payout)
fn complete_cycle(env: &Env, client: &AjoContractClient, group_id: &u64, members: &[Address]) {
    for member in members {
        client.contribute(member, group_id);
    }
    
    // Advance time past grace period to allow payout
    env.ledger().with_mut(|li| {
        li.timestamp = li.timestamp + 604_800 + 86400 + 1;
    });
    
    client.execute_payout(group_id);
}

#[test]
fn test_full_lifecycle_create_join_contribute_payout_complete() {
    let (env, client, token) = setup_test_env();
    let members = generate_addresses(&env, &token, 5);

    // Step 1: Create group
    let creator = &members[0];
    let contribution = 100_000_000i128; // 10 XLM
    let cycle_duration = 604_800u64; // 1 week
    let max_members = 5u32;

    let group_id = client.create_group(creator, &token, &contribution, &cycle_duration, &max_members, &86400u64, &5u32, &0u32);
    assert_eq!(group_id, 1);

    // Verify initial state
    let group = client.get_group(&group_id);
    assert_eq!(group.members.len(), 1);
    assert_eq!(group.current_cycle, 1);
    assert_eq!(group.payout_index, 0);
    assert_eq!(group.is_complete, false);

    // Step 2: Join - remaining members join the group
    for member in &members[1..] {
        client.join_group(member, &group_id);
    }

    // Verify all members joined
    let member_list = client.list_members(&group_id);
    assert_eq!(member_list.len(), 5);

    for member in &members {
        assert_eq!(client.is_member(&group_id, member), true);
    }

    // Step 3: Contribute & Payout - Complete all cycles
    for cycle in 1..=5 {
        // All members contribute
        for member in &members {
            client.contribute(member, &group_id);
        }

        // Verify contribution status
        let status = client.get_contribution_status(&group_id, &(cycle as u32));
        assert_eq!(status.len(), 5);
        for (_, has_paid) in status.iter() {
            assert_eq!(has_paid, true);
        }

        // Execute payout
        env.ledger().with_mut(|li| {
            li.timestamp = li.timestamp + 604_800 + 86400 + 1;
        });
        client.execute_payout(&group_id);

        // Verify cycle progression
        let group = client.get_group(&group_id);
        if cycle < 5 {
            assert_eq!(group.current_cycle, (cycle + 1) as u32);
            assert_eq!(group.payout_index, cycle as u32);
            assert_eq!(group.is_complete, false);
        } else {
            // Step 4: Complete - After final cycle
            assert_eq!(group.is_complete, true);
            assert_eq!(group.payout_index, 5);
        }
    }

    // Verify final completion state
    assert_eq!(client.is_complete(&group_id), true);
}

#[test]
fn test_multiple_groups_independent_lifecycle() {
    let (env, client, token) = setup_test_env();

    // Create addresses for different groups
    let group1_members = generate_addresses(&env, &token, 3);
    let group2_members = generate_addresses(&env, &token, 4);

    // Create Group 1 (3 members, 10 XLM contribution)
    let group_id1 = client.create_group(&group1_members[0], &token, &100_000_000i128, &604_800u64, &3u32, &86400u64, &5u32, &0u32);

    // Create Group 2 (4 members, 20 XLM contribution)
    let group_id2 = client.create_group(&group2_members[0], &token, &200_000_000i128, &1_209_600u64, &4u32, &86400u64, &5u32, &0u32);

    assert_eq!(group_id1, 1);
    assert_eq!(group_id2, 2);

    // Join members to respective groups
    for member in &group1_members[1..] {
        client.join_group(member, &group_id1);
    }

    for member in &group2_members[1..] {
        client.join_group(member, &group_id2);
    }

    // Verify groups are independent
    let g1 = client.get_group(&group_id1);
    let g2 = client.get_group(&group_id2);

    assert_eq!(g1.members.len(), 3);
    assert_eq!(g2.members.len(), 4);
    assert_eq!(g1.contribution_amount, 100_000_000i128);
    assert_eq!(g2.contribution_amount, 200_000_000i128);

    // Progress Group 1 through one cycle
    complete_cycle(&env, &client, &group_id1, &group1_members);

    // Verify Group 1 progressed but Group 2 didn't
    let g1_after = client.get_group(&group_id1);
    let g2_after = client.get_group(&group_id2);

    assert_eq!(g1_after.current_cycle, 2);
    assert_eq!(g2_after.current_cycle, 1);

    // Complete Group 1 entirely
    for _ in 0..2 {
        complete_cycle(&env, &client, &group_id1, &group1_members);
    }

    assert_eq!(client.is_complete(&group_id1), true);
    assert_eq!(client.is_complete(&group_id2), false);

    // Verify group 2 is still at cycle 1 and independent
    let g2_final = client.get_group(&group_id2);
    assert_eq!(g2_final.current_cycle, 1);
    assert_eq!(g2_final.is_complete, false);
}

#[test]
fn test_multiple_groups_with_overlapping_members() {
    let (env, client, token) = setup_test_env();
    let members = generate_addresses(&env, &token, 5);

    // Create Group 1 with members 0, 1, 2
    let group_id1 = client.create_group(&members[0], &token, &100_000_000i128, &604_800u64, &3u32, &86400u64, &5u32, &0u32);
    client.join_group(&members[1], &group_id1);
    client.join_group(&members[2], &group_id1);

    // Create Group 2 with members 1, 3, 4 (member 1 is in both groups)
    let group_id2 = client.create_group(&members[1], &token, &150_000_000i128, &604_800u64, &3u32, &86400u64, &5u32, &0u32);
    client.join_group(&members[3], &group_id2);
    client.join_group(&members[4], &group_id2);

    // Verify member 1 is in both groups
    assert_eq!(client.is_member(&group_id1, &members[1]), true);
    assert_eq!(client.is_member(&group_id2, &members[1]), true);

    // Member 1 can contribute to both groups independently
    client.contribute(&members[0], &group_id1);
    client.contribute(&members[1], &group_id1);
    client.contribute(&members[2], &group_id1);

    client.contribute(&members[1], &group_id2);
    client.contribute(&members[3], &group_id2);
    client.contribute(&members[4], &group_id2);

    // Both groups can execute payouts independently
    env.ledger().with_mut(|li| {
        li.timestamp = li.timestamp + 604_800 + 86400 + 1;
    });
    client.execute_payout(&group_id1);
    
    env.ledger().with_mut(|li| {
        li.timestamp = li.timestamp + 604_800 + 86400 + 1;
    });
    client.execute_payout(&group_id2);

    let g1 = client.get_group(&group_id1);
    let g2 = client.get_group(&group_id2);

    assert_eq!(g1.current_cycle, 2);
    assert_eq!(g2.current_cycle, 2);
}

#[test]
fn test_failure_scenario_incomplete_contributions() {
    let (env, client, token) = setup_test_env();
    let members = generate_addresses(&env, &token, 4);

    // Create group with 4 members
    let group_id = client.create_group(&members[0], &token, &100_000_000i128, &604_800u64, &4u32, &86400u64, &5u32, &0u32);
    for member in &members[1..] {
        client.join_group(member, &group_id);
    }

    // Only 3 out of 4 members contribute
    client.contribute(&members[0], &group_id);
    client.contribute(&members[1], &group_id);
    client.contribute(&members[2], &group_id);
    // members[3] doesn't contribute

    // Attempt to execute payout should fail
    let result = client.try_execute_payout(&group_id);
    assert_eq!(result, Err(Ok(AjoError::IncompleteContributions)));

    // Verify group state hasn't changed
    let group = client.get_group(&group_id);
    assert_eq!(group.current_cycle, 1);
    assert_eq!(group.payout_index, 0);
}

#[test]
fn test_failure_scenario_double_contribution() {
    let (env, client, token) = setup_test_env();
    let members = generate_addresses(&env, &token, 3);

    let group_id = client.create_group(&members[0], &token, &100_000_000i128, &604_800u64, &3u32, &86400u64, &5u32, &0u32);
    for member in &members[1..] {
        client.join_group(member, &group_id);
    }

    // First contribution succeeds
    client.contribute(&members[0], &group_id);

    // Second contribution from same member should fail
    let result = client.try_contribute(&members[0], &group_id);
    assert_eq!(result, Err(Ok(AjoError::AlreadyContributed)));
}

#[test]
fn test_failure_scenario_join_after_max_members() {
    let (env, client, token) = setup_test_env();
    let members = generate_addresses(&env, &token, 4);

    // Create group with max 3 members
    let group_id = client.create_group(&members[0], &token, &100_000_000i128, &604_800u64, &3u32, &86400u64, &5u32, &0u32);
    client.join_group(&members[1], &group_id);
    client.join_group(&members[2], &group_id);

    // Fourth member tries to join
    let result = client.try_join_group(&members[3], &group_id);
    assert_eq!(result, Err(Ok(AjoError::MaxMembersExceeded)));

    // Verify member count is still 3
    let member_list = client.list_members(&group_id);
    assert_eq!(member_list.len(), 3);
}

#[test]
fn test_failure_scenario_contribute_after_completion() {
    let (env, client, token) = setup_test_env();
    let members = generate_addresses(&env, &token, 2);

    let group_id = client.create_group(&members[0], &token, &100_000_000i128, &604_800u64, &2u32, &86400u64, &5u32, &0u32);
    client.join_group(&members[1], &group_id);

    // Complete all cycles
    for _ in 0..2 {
        complete_cycle(&env, &client, &group_id, &members);
    }

    assert_eq!(client.is_complete(&group_id), true);

    // Try to contribute to completed group
    let result = client.try_contribute(&members[0], &group_id);
    assert_eq!(result, Err(Ok(AjoError::GroupComplete)));
}

#[test]
fn test_failure_scenario_non_member_contribution() {
    let (env, client, token) = setup_test_env();
    let members = generate_addresses(&env, &token, 3);
    let non_member = Address::generate(&env);

    let group_id = client.create_group(&members[0], &token, &100_000_000i128, &604_800u64, &3u32, &86400u64, &5u32, &0u32);

    // Non-member tries to contribute
    let result = client.try_contribute(&non_member, &group_id);
    assert_eq!(result, Err(Ok(AjoError::NotMember)));
}

#[test]
fn test_failure_scenario_join_already_member() {
    let (env, client, token) = setup_test_env();
    let members = generate_addresses(&env, &token, 2);

    let group_id = client.create_group(&members[0], &token, &100_000_000i128, &604_800u64, &5u32, &86400u64, &5u32, &0u32);
    client.join_group(&members[1], &group_id);

    // Try to join again
    let result = client.try_join_group(&members[1], &group_id);
    assert_eq!(result, Err(Ok(AjoError::AlreadyMember)));
}

#[test]
fn test_failure_scenario_invalid_group_creation() {
    let (env, client, token) = setup_test_env();
    let creator = Address::generate(&env);

    // Zero contribution amount
    let result = client.try_create_group(&creator, &token, &0i128, &604_800u64, &5u32, &86400u64, &5u32, &0u32);
    assert_eq!(result, Err(Ok(AjoError::ContributionAmountZero)));

    // Negative contribution amount
    let result = client.try_create_group(&creator, &token, &-100i128, &604_800u64, &5u32, &86400u64, &5u32, &0u32);
    assert_eq!(result, Err(Ok(AjoError::ContributionAmountNegative)));

    // Zero cycle duration
    let result = client.try_create_group(&creator, &token, &100_000_000i128, &0u64, &5u32, &86400u64, &5u32, &0u32);
    assert_eq!(result, Err(Ok(AjoError::CycleDurationZero)));

    // Max members below minimum (less than 2)
    let result = client.try_create_group(&creator, &token, &100_000_000i128, &604_800u64, &1u32, &86400u64, &5u32, &0u32);
    assert_eq!(result, Err(Ok(AjoError::MaxMembersBelowMinimum)));
}

#[test]
fn test_complex_scenario_partial_completion_with_recovery() {
    let (env, client, token) = setup_test_env();
    let members = generate_addresses(&env, &token, 3);

    let group_id = client.create_group(&members[0], &token, &100_000_000i128, &604_800u64, &3u32, &86400u64, &5u32, &0u32);
    for member in &members[1..] {
        client.join_group(member, &group_id);
    }

    // Complete first cycle successfully
    complete_cycle(&env, &client, &group_id, &members);
    assert_eq!(client.get_group(&group_id).current_cycle, 2);

    // Second cycle: incomplete contributions
    client.contribute(&members[0], &group_id);
    client.contribute(&members[1], &group_id);

    // Try payout - should fail
    let result = client.try_execute_payout(&group_id);
    assert_eq!(result, Err(Ok(AjoError::IncompleteContributions)));

    // Recovery: last member contributes
    client.contribute(&members[2], &group_id);

    // Now payout should succeed
    env.ledger().with_mut(|li| {
        li.timestamp = li.timestamp + 604_800 + 86400 + 1;
    });
    client.execute_payout(&group_id);
    assert_eq!(client.get_group(&group_id).current_cycle, 3);

    // Complete final cycle
    complete_cycle(&env, &client, &group_id, &members);
    assert_eq!(client.is_complete(&group_id), true);
}

#[test]
fn test_large_group_full_lifecycle() {
    let (env, client, token) = setup_test_env();
    // 10 members x 10 cycles is many sequential invocations against one `Env` -
    // more than the default single-transaction resource budget allows, even
    // though each individual call is cheap. Uncap it for this lifecycle test.
    env.budget().reset_unlimited();
    let members = generate_addresses(&env, &token, 10);

    // Create group with 10 members
    let group_id = client.create_group(&members[0], &token, &50_000_000i128, &604_800u64, &10u32, &86400u64, &5u32, &0u32);

    // All members join
    for member in &members[1..] {
        client.join_group(member, &group_id);
    }

    // Verify all joined
    assert_eq!(client.list_members(&group_id).len(), 10);

    // Complete all 10 cycles
    for cycle in 1..=10 {
        complete_cycle(&env, &client, &group_id, &members);

        let group = client.get_group(&group_id);
        if cycle < 10 {
            assert_eq!(group.current_cycle, (cycle + 1) as u32);
            assert_eq!(group.is_complete, false);
        } else {
            assert_eq!(group.is_complete, true);
        }
    }

    assert_eq!(client.is_complete(&group_id), true);
}

#[test]
fn test_sequential_group_creation_and_completion() {
    let (env, client, token) = setup_test_env();
    let members = generate_addresses(&env, &token, 3);

    // Create and complete first group
    let group_id1 = client.create_group(&members[0], &token, &100_000_000i128, &604_800u64, &3u32, &86400u64, &5u32, &0u32);
    for member in &members[1..] {
        client.join_group(member, &group_id1);
    }

    for _ in 0..3 {
        complete_cycle(&env, &client, &group_id1, &members);
    }

    assert_eq!(client.is_complete(&group_id1), true);

    // Create second group with same members
    let group_id2 = client.create_group(&members[0], &token, &150_000_000i128, &604_800u64, &3u32, &86400u64, &5u32, &0u32);
    for member in &members[1..] {
        client.join_group(member, &group_id2);
    }

    // Second group should be independent and functional
    complete_cycle(&env, &client, &group_id2, &members);

    let g2 = client.get_group(&group_id2);
    assert_eq!(g2.current_cycle, 2);
    assert_eq!(g2.is_complete, false);

    // First group should still be complete
    assert_eq!(client.is_complete(&group_id1), true);
}
