#![cfg(test)]

//! Tests for the sybil/collusion mitigation in `reputation.rs` (Issue #802).
//!
//! The attack modeled here: an attacker creates a two-member ROSCA (the
//! protocol's minimum group size) contributing a dust amount per cycle,
//! with the attacker effectively controlling both "members" (or, for the
//! collusion variant, two distinct but colluding real accounts). Before the
//! fix, completing even one such group pushed a member's credit score to
//! 620/1000 (Gold) purely from the reliability/completion/penalty
//! components, none of which required any real amount at risk. See
//! `docs/reputation-sybil-analysis.md` for the full cost breakdown.

use soroban_ajo::{AjoContract, AjoContractClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env,
};

/// 10 XLM in stroops — the reputation system's minimum qualifying stake per
/// cycle (`reputation::MIN_REPUTATION_STAKE`). Duplicated here as a literal
/// since the constant is crate-private; keep in sync if it ever changes.
const MIN_REPUTATION_STAKE: i128 = 100_000_000;

fn setup_test_env() -> (Env, AjoContractClient<'static>, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, AjoContract);
    let client = AjoContractClient::new(&env, &contract_id);

    let creator = Address::generate(&env);
    let member2 = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract(token_admin);

    (env, client, creator, member2, token)
}

fn mint_tokens(env: &Env, token_id: &Address, members: &[Address], amount: i128) {
    let token_client = token::StellarAssetClient::new(env, token_id);
    for member in members {
        token_client.mint(member, &amount);
    }
}

/// Runs a minimal two-member ROSCA (the smallest group the protocol allows)
/// from creation through both payout cycles, i.e. full completion. Uses a
/// 1-second cycle with no grace period so the whole thing clears in a single
/// ledger-timestamp bump, mirroring the cheapest possible attack loop.
fn complete_two_member_rosca(
    env: &Env,
    client: &AjoContractClient,
    creator: &Address,
    member2: &Address,
    token: &Address,
    contribution_amount: i128,
) {
    let group_id = client.create_group(
        creator,
        token,
        &contribution_amount,
        &1u64, // cycle_duration: 1 second
        &2u32, // max_members: protocol minimum
        &0u64, // grace_period: none
        &0u32, // penalty_rate
        &0u32, // insurance_rate_bps
    );

    client.join_group(member2, &group_id);

    // Cycle 1
    client.contribute(creator, &group_id);
    client.contribute(member2, &group_id);
    env.ledger().with_mut(|li| li.timestamp += 2);
    client.execute_payout(&group_id);

    // Cycle 2 (group completes: payout_index reaches member_count)
    client.contribute(creator, &group_id);
    client.contribute(member2, &group_id);
    env.ledger().with_mut(|li| li.timestamp += 2);
    client.execute_payout(&group_id);
}

#[test]
fn test_dust_self_dealing_group_does_not_inflate_score() {
    let (env, client, creator, member2, token) = setup_test_env();
    mint_tokens(&env, &token, &[creator.clone(), member2.clone()], 10_000i128);

    // Attacker's cheapest loop: a 2-member group contributing 1 stroop per
    // cycle, self-dealt between two addresses the attacker controls.
    complete_two_member_rosca(&env, &client, &creator, &member2, &token, 1i128);

    let stats = client.get_member_stats(&creator);
    assert_eq!(stats.total_contributions, 2);
    assert_eq!(stats.total_groups_completed, 1);
    assert_eq!(stats.qualifying_contributions, 0);
    assert_eq!(stats.qualifying_groups_completed, 0);

    // Pre-fix this scored 620/1000 (Gold) from a single completed group.
    // Post-fix, none of it qualifies, so the score stays at 0.
    assert_eq!(client.get_credit_score(&creator), 0);
}

#[test]
fn test_ten_dust_groups_still_yield_zero_score() {
    let (env, client, creator, member2, token) = setup_test_env();
    // 10 full group lifecycles in one Env is more sequential invocations than
    // the default single-transaction resource budget allows.
    env.budget().reset_unlimited();
    mint_tokens(&env, &token, &[creator.clone(), member2.clone()], 10_000i128);

    // Pre-fix, 10 completed groups maxed out the "groups completed"
    // component (200/200) regardless of amount, pushing a dust-farmed
    // identity to Platinum (800/1000). Confirm the cap no longer helps.
    for _ in 0..10 {
        complete_two_member_rosca(&env, &client, &creator, &member2, &token, 1i128);
    }

    let stats = client.get_member_stats(&creator);
    assert_eq!(stats.total_groups_completed, 10);
    assert_eq!(stats.qualifying_groups_completed, 0);
    assert_eq!(client.get_credit_score(&creator), 0);
}

#[test]
fn test_just_below_stake_threshold_does_not_qualify() {
    let (env, client, creator, member2, token) = setup_test_env();
    mint_tokens(
        &env,
        &token,
        &[creator.clone(), member2.clone()],
        1_000_000_000i128,
    );

    complete_two_member_rosca(
        &env,
        &client,
        &creator,
        &member2,
        &token,
        MIN_REPUTATION_STAKE - 1,
    );

    assert_eq!(client.get_credit_score(&creator), 0);
}

#[test]
fn test_legitimate_high_stake_group_earns_credit_score() {
    let (env, client, creator, member2, token) = setup_test_env();
    mint_tokens(
        &env,
        &token,
        &[creator.clone(), member2.clone()],
        1_000_000_000i128,
    );

    // A group that actually puts the minimum qualifying stake at risk each
    // cycle should still earn reputation normally — the fix targets dust
    // amounts, not legitimate participation.
    complete_two_member_rosca(
        &env,
        &client,
        &creator,
        &member2,
        &token,
        MIN_REPUTATION_STAKE,
    );

    let stats = client.get_member_stats(&creator);
    assert_eq!(stats.qualifying_contributions, 2);
    assert_eq!(stats.qualifying_groups_completed, 1);

    // reliability 400 (2/2 on-time) + completion 20 (1 group) +
    // volume 40 (20 XLM total, in the 10-99 XLM tier) + penalty 200 = 660
    assert_eq!(client.get_credit_score(&creator), 660);
}
