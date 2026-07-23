#![cfg(test)]

use soroban_ajo::{AjoContract, AjoContractClient};
use soroban_sdk::{testutils::{Address as _, Ledger}, Address, Env};

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
fn test_create_group_with_grace_period_and_penalty() {
    let (_env, client, creator, _, _, token) = setup_test_env();

    let contribution = 100_000_000i128; // 10 XLM
    let cycle_duration = 604_800u64; // 1 week
    let max_members = 10u32;
    let grace_period = 86400u64; // 24 hours
    let penalty_rate = 5u32; // 5%

    let group_id = client.create_group(
        &creator,
        &token,
        &contribution,
        &cycle_duration,
        &max_members,
        &grace_period,
        &penalty_rate,
        &0u32,
    );

    assert_eq!(group_id, 1);

    // Verify group was created with penalty settings
    let group = client.get_group(&group_id);
    assert_eq!(group.grace_period, grace_period);
    assert_eq!(group.penalty_rate, penalty_rate);
}

#[test]
fn test_on_time_contribution() {
    let (env, client, creator, member2, _, token) = setup_test_env();

    let contribution = 100_000_000i128;
    let cycle_duration = 604_800u64;
    let max_members = 3u32;
    let grace_period = 86400u64;
    let penalty_rate = 5u32;

    let group_id = client.create_group(
        &creator,
        &token,
        &contribution,
        &cycle_duration,
        &max_members,
        &grace_period,
        &penalty_rate,
        &0u32,
    );

    // Join group
    client.join_group(&member2, &group_id);

    // Contribute on time (within cycle window)
    client.contribute(&creator, &group_id);
    client.contribute(&member2, &group_id);

    // Check penalty record - should be on-time
    let penalty_record = client.get_member_penalty_record(&group_id, &creator);
    assert_eq!(penalty_record.on_time_count, 1);
    assert_eq!(penalty_record.late_count, 0);
    assert_eq!(penalty_record.total_penalties, 0);
    assert_eq!(penalty_record.reliability_score, 100);

    // Check penalty pool - should be empty
    let penalty_pool = client.get_cycle_penalty_pool(&group_id, &1u32);
    assert_eq!(penalty_pool, 0);
}

#[test]
fn test_late_contribution_with_penalty() {
    let (env, client, creator, member2, _, token) = setup_test_env();

    let contribution = 100_000_000i128; // 10 XLM
    let cycle_duration = 604_800u64; // 1 week
    let max_members = 3u32;
    let grace_period = 86400u64; // 24 hours
    let penalty_rate = 5u32; // 5%

    let group_id = client.create_group(
        &creator,
        &token,
        &contribution,
        &cycle_duration,
        &max_members,
        &grace_period,
        &penalty_rate,
        &0u32,
    );

    // Join group
    client.join_group(&member2, &group_id);

    // Creator contributes on time
    client.contribute(&creator, &group_id);

    // Advance time past cycle end but within grace period
    env.ledger().with_mut(|li| {
        li.timestamp = li.timestamp + cycle_duration + 3600; // 1 hour into grace period
    });

    // Member2 contributes late
    client.contribute(&member2, &group_id);

    // Check penalty record for late member
    let penalty_record = client.get_member_penalty_record(&group_id, &member2);
    assert_eq!(penalty_record.on_time_count, 0);
    assert_eq!(penalty_record.late_count, 1);
    assert_eq!(penalty_record.reliability_score, 0);

    // Expected penalty: 10 XLM * 5% = 0.5 XLM = 5_000_000 stroops
    let expected_penalty = 5_000_000i128;
    assert_eq!(penalty_record.total_penalties, expected_penalty);

    // Check penalty pool
    let penalty_pool = client.get_cycle_penalty_pool(&group_id, &1u32);
    assert_eq!(penalty_pool, expected_penalty);

    // Check contribution detail
    let contrib_detail = client.get_contribution_detail(&group_id, &1u32, &member2);
    assert_eq!(contrib_detail.is_late, true);
    assert_eq!(contrib_detail.penalty_amount, expected_penalty);
}

#[test]
fn test_contribution_after_grace_period_fails() {
    let (env, client, creator, member2, _, token) = setup_test_env();

    let contribution = 100_000_000i128;
    let cycle_duration = 604_800u64;
    let max_members = 3u32;
    let grace_period = 86400u64;
    let penalty_rate = 5u32;

    let group_id = client.create_group(
        &creator,
        &token,
        &contribution,
        &cycle_duration,
        &max_members,
        &grace_period,
        &penalty_rate,
        &0u32,
    );

    client.join_group(&member2, &group_id);

    // Creator contributes on time
    client.contribute(&creator, &group_id);

    // Advance time past grace period
    env.ledger().with_mut(|li| {
        li.timestamp = li.timestamp + cycle_duration + grace_period + 1;
    });

    // This should fail with GracePeriodExpired
    let result = client.try_contribute(&member2, &group_id);
    assert!(result.is_err());
    assert_eq!(result, Err(Ok(soroban_ajo::AjoError::GracePeriodExpired)));
}

#[test]
fn test_payout_includes_penalties() {
    let (env, client, creator, member2, _, token) = setup_test_env();

    let contribution = 100_000_000i128; // 10 XLM
    let cycle_duration = 604_800u64;
    let max_members = 2u32;
    let grace_period = 86400u64;
    let penalty_rate = 5u32;

    let group_id = client.create_group(
        &creator,
        &token,
        &contribution,
        &cycle_duration,
        &max_members,
        &grace_period,
        &penalty_rate,
        &0u32,
    );

    client.join_group(&member2, &group_id);

    // Creator contributes on time
    client.contribute(&creator, &group_id);

    // Advance time to grace period
    env.ledger().with_mut(|li| {
        li.timestamp = li.timestamp + cycle_duration + 3600;
    });

    // Member2 contributes late
    client.contribute(&member2, &group_id);

    // Advance time past grace period
    env.ledger().with_mut(|li| {
        li.timestamp = li.timestamp + grace_period;
    });

    // Execute payout
    client.execute_payout(&group_id);

    // Verify payout was executed
    let group = client.get_group(&group_id);
    assert_eq!(group.current_cycle, 2);
    assert_eq!(group.payout_index, 1);
}

#[test]
fn test_payout_delayed_during_grace_period() {
    let (env, client, creator, member2, _, token) = setup_test_env();

    let contribution = 100_000_000i128;
    let cycle_duration = 604_800u64;
    let max_members = 2u32;
    let grace_period = 86400u64;
    let penalty_rate = 5u32;

    let group_id = client.create_group(
        &creator,
        &token,
        &contribution,
        &cycle_duration,
        &max_members,
        &grace_period,
        &penalty_rate,
        &0u32,
    );

    client.join_group(&member2, &group_id);

    // Both contribute on time
    client.contribute(&creator, &group_id);
    client.contribute(&member2, &group_id);

    // Advance time to within grace period
    env.ledger().with_mut(|li| {
        li.timestamp = li.timestamp + cycle_duration + 3600;
    });

    // This should fail - still in grace period
    let result = client.try_execute_payout(&group_id);
    assert!(result.is_err());
    assert_eq!(result, Err(Ok(soroban_ajo::AjoError::OutsideCycleWindow)));
}

#[test]
fn test_reliability_score_calculation() {
    let (env, client, creator, member2, member3, token) = setup_test_env();

    let contribution = 100_000_000i128;
    let cycle_duration = 604_800u64;
    let max_members = 3u32;
    let grace_period = 86400u64;
    let penalty_rate = 5u32;

    let group_id = client.create_group(
        &creator,
        &token,
        &contribution,
        &cycle_duration,
        &max_members,
        &grace_period,
        &penalty_rate,
        &0u32,
    );

    client.join_group(&member2, &group_id);
    client.join_group(&member3, &group_id);

    // Cycle 1: All on time
    client.contribute(&creator, &group_id);
    client.contribute(&member2, &group_id);
    client.contribute(&member3, &group_id);

    env.ledger().with_mut(|li| {
        li.timestamp = li.timestamp + cycle_duration + grace_period + 1;
    });
    client.execute_payout(&group_id);

    // Cycle 2: Member2 late
    client.contribute(&creator, &group_id);
    client.contribute(&member3, &group_id);

    env.ledger().with_mut(|li| {
        li.timestamp = li.timestamp + cycle_duration + 3600;
    });
    client.contribute(&member2, &group_id);

    // Check reliability scores
    let creator_record = client.get_member_penalty_record(&group_id, &creator);
    assert_eq!(creator_record.reliability_score, 100); // 2/2 on time

    let member2_record = client.get_member_penalty_record(&group_id, &member2);
    assert_eq!(member2_record.reliability_score, 50); // 1/2 on time

    let member3_record = client.get_member_penalty_record(&group_id, &member3);
    assert_eq!(member3_record.reliability_score, 100); // 2/2 on time
}

#[test]
fn test_group_status_includes_penalty_info() {
    let (env, client, creator, member2, _, token) = setup_test_env();

    let contribution = 100_000_000i128;
    let cycle_duration = 604_800u64;
    let max_members = 2u32;
    let grace_period = 86400u64;
    let penalty_rate = 5u32;

    let group_id = client.create_group(
        &creator,
        &token,
        &contribution,
        &cycle_duration,
        &max_members,
        &grace_period,
        &penalty_rate,
        &0u32,
    );

    client.join_group(&member2, &group_id);

    // Get status during cycle
    let status = client.get_group_status(&group_id);
    assert_eq!(status.is_cycle_active, true);
    assert_eq!(status.is_in_grace_period, false);
    assert_eq!(status.cycle_penalty_pool, 0);

    // Advance to grace period
    env.ledger().with_mut(|li| {
        li.timestamp = li.timestamp + cycle_duration + 3600;
    });

    let status = client.get_group_status(&group_id);
    assert_eq!(status.is_cycle_active, false);
    assert_eq!(status.is_in_grace_period, true);
}

#[test]
fn test_invalid_penalty_rate() {
    let (_env, client, creator, _, _, token) = setup_test_env();

    let contribution = 100_000_000i128;
    let cycle_duration = 604_800u64;
    let max_members = 3u32;
    let grace_period = 86400u64;
    let penalty_rate = 101u32; // Invalid: > 100

    let result = client.try_create_group(
        &creator,
        &token,
        &contribution,
        &cycle_duration,
        &max_members,
        &grace_period,
        &penalty_rate,
        &0u32,
    );
    
    assert!(result.is_err());
    assert_eq!(result, Err(Ok(soroban_ajo::AjoError::InvalidPenaltyRate)));
}

#[test]
fn test_invalid_grace_period() {
    let (_env, client, creator, _, _, token) = setup_test_env();

    let contribution = 100_000_000i128;
    let cycle_duration = 604_800u64;
    let max_members = 3u32;
    let grace_period = 8 * 24 * 60 * 60; // 8 days - too long
    let penalty_rate = 5u32;

    let result = client.try_create_group(
        &creator,
        &token,
        &contribution,
        &cycle_duration,
        &max_members,
        &grace_period,
        &penalty_rate,
        &0u32,
    );
    
    assert!(result.is_err());
    assert_eq!(result, Err(Ok(soroban_ajo::AjoError::InvalidGracePeriod)));
}
