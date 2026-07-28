#![cfg(test)]

//! Regression test for the TTL-extension strategy added to `storage.rs`.
//!
//! Before this optimization pass, no code anywhere in the crate ever called
//! `extend_ttl`. Soroban's host hard-errors when a persistent entry is read
//! after its TTL has lapsed (see `check_if_entry_is_live` in
//! `soroban-env-host`), so a group whose cycle outlives its data's TTL would
//! have its `Group`/`Contribution`/... entries silently become
//! inaccessible — a correctness bug, not just a cost concern.
//!
//! This test sets a deliberately tiny "naive" minimum persistent-entry TTL
//! (simulating the floor every entry in this contract used to be stuck at),
//! writes group/contribution data through the real entrypoints, then jumps
//! the ledger sequence number far past that naive floor — comfortably
//! inside the contract's own `extend_ttl` policy (~120 days worth of
//! ledgers, see `storage::PERSISTENT_TTL_EXTEND_TO`) — and confirms the data
//! is still fully readable and the group can still complete its next cycle.
//!
//! If a future change accidentally dropped the `extend_ttl` calls in
//! `storage::persistent_set`/`get_group`, this test would fail: `get_group`
//! (and therefore `execute_payout`) would hit an archived-entry error once
//! the sequence jump passes the naive 100-ledger floor.

use soroban_ajo::{AjoContract, AjoContractClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env,
};

fn setup_test_env() -> (Env, AjoContractClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, AjoContract);
    let client = AjoContractClient::new(&env, &contract_id);
    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract(token_admin);

    (env, client, token)
}

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

#[test]
fn group_and_contribution_data_survive_sequence_jump_past_naive_ttl() {
    let (env, client, token) = setup_test_env();

    // Force a tiny "naive" default TTL for freshly written persistent
    // entries — the floor every entry in this contract was stuck at before
    // `extend_ttl` was introduced anywhere in the crate.
    env.ledger().set_min_persistent_entry_ttl(100);

    let members = generate_addresses(&env, &token, 3);
    let contribution = 100_000_000i128;
    let cycle_duration = 604_800u64;
    let grace_period = 86_400u64;

    let group_id = client.create_group(
        &members[0],
        &token,
        &contribution,
        &cycle_duration,
        &3u32,
        &grace_period,
        &5u32,
        &0u32,
    );
    for m in &members[1..] {
        client.join_group(m, &group_id);
    }
    for m in &members {
        client.contribute(m, &group_id);
    }

    // Sanity check: the naive floor really is that small, and we're about
    // to jump far past it.
    let naive_floor = 100u32;
    let jump = 50_000u32;
    assert!(jump > naive_floor * 100, "test jump should dwarf the naive floor");

    env.ledger().with_mut(|li| {
        li.sequence_number += jump;
    });

    // Group and per-cycle contribution data must still be fully readable.
    let group = client.get_group(&group_id);
    assert_eq!(group.members.len(), 3);
    assert_eq!(group.current_cycle, 1);
    assert_eq!(group.is_complete, false);

    let status = client.get_contribution_status(&group_id, &1u32);
    assert_eq!(status.len(), 3);
    for (_, has_paid) in status.iter() {
        assert_eq!(has_paid, true);
    }

    // The contract must still be fully usable: advance past the grace
    // period and confirm the payout for this cycle still succeeds. This
    // touches every persistent entry the hot paths write (Group, per-member
    // Contribution/ContributionDetail/MemberPenalty, CyclePenaltyPool,
    // MemberStats, MemberReputation, CreditScoreSnapshot, PaymentHistory) —
    // if any of them had lapsed, this call would panic on an archived-entry
    // error instead of completing normally.
    env.ledger().with_mut(|li| {
        li.timestamp += cycle_duration + grace_period + 1;
    });
    client.execute_payout(&group_id);

    let group = client.get_group(&group_id);
    assert_eq!(group.current_cycle, 2);
    assert_eq!(group.payout_index, 1);
    assert_eq!(group.is_complete, false);

    // Reputation/stats data (also persistent, also previously unprotected)
    // must be intact too.
    let stats = client.get_member_stats(&members[0]);
    assert_eq!(stats.total_contributions, 1);
}
