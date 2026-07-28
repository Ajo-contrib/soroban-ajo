#![cfg(test)]

//! Budget-based cost profiling for the two hottest entrypoints in the
//! contract, `contribute` and `execute_payout`.
//!
//! Each test isolates a single call to the entrypoint under measurement by
//! calling `env.budget().reset_unlimited()` (which also zeroes the cost
//! trackers, see `soroban-env-host`'s `Budget::reset_unlimited`) immediately
//! before invoking it, then prints CPU instructions and the memory-bytes
//! cost from `env.budget()`.
//!
//! Note: `ContractCostType::ValSer`/`ValDeser` trackers (which would
//! otherwise proxy storage read/write bytes) read zero under this SDK's
//! native (non-Wasm) contract-registration test harness — the XDR ledger
//! (de)serialization those cost types measure only happens on the real
//! network's storage layer, not the in-process native call path used here.
//! Instead, `xdr_len_of` below computes the *actual* ScVal-XDR byte size of
//! the specific structs each entrypoint reads/writes (via `ToXdr`), which is
//! an exact, reproducible number rather than a proxy.
//!
//! Run with `cargo test --test cost_profiling_tests -- --nocapture` to see
//! the printed numbers. These are the numbers recorded in
//! `COST_OPTIMIZATION_REPORT.md` (captured once before the optimization pass
//! and again after).

use soroban_ajo::{AjoContract, AjoContractClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    xdr::ToXdr,
    Address, Env, IntoVal, Val,
};

fn xdr_len_of<T: IntoVal<Env, Val>>(env: &Env, value: T) -> u32 {
    value.to_xdr(env).len()
}

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

fn advance_past_grace(env: &Env, seconds: u64) {
    env.ledger().with_mut(|li| {
        li.timestamp += seconds + 1;
    });
}

fn print_costs(label: &str, env: &Env) {
    let budget = env.budget();
    let cpu = budget.cpu_instruction_cost();
    let mem = budget.memory_bytes_cost();
    println!("[cost-profile] {label}: cpu_insns={cpu} mem_bytes={mem}");
}

/// Steady-state `contribute`: the member already has `MemberStats` /
/// `MemberPenalty` / `MemberReputation` history from cycle 1, and the group
/// has insurance enabled so the call also exercises the insurance-pool
/// deposit path (`insurance::deposit_to_pool`).
#[test]
fn profile_contribute_steady_state() {
    let (env, client, token) = setup_test_env();
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
        &200u32, // 2% insurance premium — exercises the InsurancePool path
    );
    for m in &members[1..] {
        client.join_group(m, &group_id);
    }

    // Cycle 1: establishes MemberStats/MemberPenalty/MemberReputation so the
    // measured call below reflects a realistic "update", not "create".
    for m in &members {
        client.contribute(m, &group_id);
    }
    advance_past_grace(&env, cycle_duration + grace_period);
    client.execute_payout(&group_id);

    env.budget().reset_unlimited();
    client.contribute(&members[1], &group_id);
    print_costs("contribute (steady state, insurance enabled)", &env);
}

/// `execute_payout` on a cycle that does NOT complete the group (2 of 3
/// cycles done) — the common case for most of a group's life.
#[test]
fn profile_execute_payout_mid_cycle() {
    let (env, client, token) = setup_test_env();
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
    advance_past_grace(&env, cycle_duration + grace_period);

    env.budget().reset_unlimited();
    client.execute_payout(&group_id); // cycle 1 of 3: group does not complete
    print_costs("execute_payout (mid-cycle, non-completing)", &env);
}

/// `execute_payout` on the FINAL cycle, which flips `is_complete = true` and
/// runs the per-member stats/reputation completion loop — the path with the
/// most redundant work before this optimization pass.
#[test]
fn profile_execute_payout_group_completion() {
    let (env, client, token) = setup_test_env();
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

    for _ in 0..2 {
        for m in &members {
            client.contribute(m, &group_id);
        }
        advance_past_grace(&env, cycle_duration + grace_period);
        client.execute_payout(&group_id);
    }

    for m in &members {
        client.contribute(m, &group_id);
    }
    advance_past_grace(&env, cycle_duration + grace_period);

    env.budget().reset_unlimited();
    client.execute_payout(&group_id);
    print_costs("execute_payout (final cycle, group completion)", &env);
}

/// Prints the exact ScVal-XDR byte size of the structs whose redundant
/// reads/writes this optimization pass eliminates. These sizes don't change
/// before/after (same struct shape) — they're what turns "N fewer
/// reads/writes" (known exactly from code inspection) into a concrete byte
/// figure for the report.
#[test]
fn print_struct_sizes_for_report() {
    let (env, client, token) = setup_test_env();
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
        &200u32,
    );
    for m in &members[1..] {
        client.join_group(m, &group_id);
    }
    for m in &members {
        client.contribute(m, &group_id);
    }

    let group = client.get_group(&group_id);
    let stats = client.get_member_stats(&members[0]);
    let reputation = client.get_reputation(&members[0]);

    println!(
        "[cost-profile] struct sizes (xdr bytes): Group(3 members)={} MemberStats={} ReputationScore={}",
        xdr_len_of(&env, group),
        xdr_len_of(&env, stats),
        xdr_len_of(&env, reputation),
    );
}
