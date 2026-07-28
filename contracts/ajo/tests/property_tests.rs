#![cfg(test)]

//! Property-based tests for issue #797.
//!
//! Covers the three areas the issue calls out: payout ordering, penalty/
//! grace-period arithmetic, and refund vote tallying. Each property runs
//! against the real contract through `AjoContractClient` (there's no way to
//! reach the private `utils`/`storage` modules from an external test crate),
//! so every case drives a full `Env` + several contract calls - group
//! creation, joins, contributions, payouts, and for two of the four
//! properties a full dispute-vote or refund-vote round - rather than a cheap
//! pure-function check. That makes this a case where the "hundreds to
//! thousands of cases" a property test would ideally run isn't the right
//! target: at measured per-case cost (~1-6s depending on the property, see
//! below), thousands of cases would turn `cargo test` into a multi-hour CI
//! step to explore a state space that's a handful of small integers, not
//! floating-point edge cases or arbitrary byte strings. Case counts are
//! capped explicitly per property instead - see "CI time budget" below.
//!
//! ## Bugs found and fixed while writing this harness
//!
//! `payout_never_repeats_and_everyone_gets_paid_around_a_mid_rotation_removal`
//! (below) found a real bug on the first run: `resolve_dispute`'s `Removal`
//! branch shrank `group.members` but never adjusted `group.payout_index`.
//! `payout_index` does double duty - it's both "how many payouts have
//! happened" (compared against the member count to detect group
//! completion) and, for the `Sequential` strategy, a raw array index into
//! `members`. Removing a member who had *already* been paid shrinks the
//! array without undoing a payout, so the stale index either skipped the
//! next unpaid member outright (Sequential) or made the group report
//! `is_complete` one payout early (every strategy, since the count-vs-length
//! comparison was now off by one). Fixed in `contract.rs`'s `resolve_dispute`
//! by decrementing `payout_index` when the removed member already has
//! `has_received_payout == true`. `test_removing_an_already_paid_member_no_longer_skips_the_next_recipient`
//! below is the permanent regression test for the minimal case the property
//! test found (a 4-member group, remove the first-paid member after 2
//! cycles).
//!
//! ## CI time budget
//!
//! Measured locally, `cargo test --test property_tests` (5 tests: 4
//! properties + the permanent regression test, run concurrently by the
//! default test harness) takes **~3 minutes**. Per-property case counts
//! were picked by measuring the most expensive one first (the mid-rotation
//! removal property: ~6s/case, since each case runs a full dispute-vote
//! round in addition to several payout cycles) and capping it hardest (10
//! cases), then scaling the cheaper properties up somewhat since they cost
//! less per case:
//!
//! | Property | Cases | Approx. cost/case | Why |
//! |---|---|---|---|
//! | payout ordering, no removal | 16 | ~2s | up to 8 payout cycles, no dispute |
//! | payout ordering, with removal | 10 | ~6s | payout cycles + a full dispute-vote round |
//! | penalty/grace-period | 20 | ~1s | 3-6 contribution cycles, no dispute |
//! | refund vote tallying | 16 | ~3s | runs the whole flow twice (forward + reversed vote order) |
//!
//! This is a hard ceiling, not a target to grow opportunistically: if a
//! future change makes any of these properties meaningfully cheaper per
//! case (e.g. by exercising the selection logic more directly instead of
//! driving full contract lifecycles), raise the case count then rather than
//! now, when doing so would just make `cargo test` slower for no added
//! confidence - the state space here is a handful of small integers per
//! property, not the kind of problem that benefits from four-digit case
//! counts. Total added time is well within the existing multi-minute
//! budget the "Build Smart Contracts" CI job already allots for `cargo test`
//! across the whole crate, but it's the most expensive file in the suite by
//! a wide margin, so it's called out here explicitly rather than left to be
//! discovered as "why did CI get slower."

use proptest::prelude::*;
use soroban_ajo::{
    AjoContract, AjoContractClient, DisputeResolution, DisputeType, GroupState,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, BytesN, Env, String as SorobanString,
};

const CONTRIBUTION: i128 = 10_000_000;
const CYCLE_DURATION: u64 = 8 * 86_400; // 8 days
const GRACE_PERIOD: u64 = 7 * 86_400; // 7 days (the max `create_group` allows)
// cycle + grace comfortably outlasts DISPUTE_VOTING_PERIOD (7 days), so a
// dispute vote fully playing out never pushes a case into GracePeriodExpired
// for the cycle that was in flight when the dispute was filed.

fn new_group(env: &Env, member_count: usize) -> (AjoContractClient<'static>, std::vec::Vec<Address>, u64, Address) {
    env.mock_all_auths();
    let contract_id = env.register_contract(None, AjoContract);
    let client = AjoContractClient::new(env, &contract_id);
    let token_admin = Address::generate(env);
    let token = env.register_stellar_asset_contract(token_admin);
    let token_admin_client = token::StellarAssetClient::new(env, &token);

    let members: std::vec::Vec<Address> = (0..member_count).map(|_| Address::generate(env)).collect();
    for m in &members {
        token_admin_client.mint(m, &(CONTRIBUTION * 100));
    }

    let group_id = client.create_group(
        &members[0],
        &token,
        &CONTRIBUTION,
        &CYCLE_DURATION,
        &(member_count as u32),
        &GRACE_PERIOD,
        &5u32,
        &0u32,
    );
    for m in &members[1..] {
        client.join_group(m, &group_id);
    }

    (client, members, group_id, token)
}

fn advance_past_grace(env: &Env) {
    env.ledger().with_mut(|li| li.timestamp += CYCLE_DURATION + GRACE_PERIOD + 1);
}

// ============================================================================
// Property 1: payout ordering never repeats a recipient within one cycle,
// regardless of member count or membership changing mid-rotation.
// ============================================================================

/// Runs a group to completion, optionally removing `members[0]` (via a
/// unanimous, quorum-satisfying Removal dispute among everyone else) right
/// after `remove_after_cycles` payouts have happened. Returns the sequence
/// of payout recipients in the order they were paid.
fn run_to_completion_with_optional_removal(
    env: &Env,
    client: &AjoContractClient,
    members: &[Address],
    group_id: u64,
    remove_after_cycles: Option<u32>,
) -> std::vec::Vec<Address> {
    let mut recipients = std::vec::Vec::new();
    let mut cycles_done: u32 = 0;
    let mut removed = false;

    loop {
        let group = client.get_group(&group_id);
        if group.is_complete {
            break;
        }

        for m in group.members.iter() {
            client.contribute(&m, &group_id);
        }
        advance_past_grace(env);

        let before_cycle = client.get_group(&group_id).current_cycle;
        client.execute_payout(&group_id);
        recipients.push(client.get_payout_order(&group_id, &before_cycle).recipient);
        cycles_done += 1;

        if !removed && Some(cycles_done) == remove_after_cycles {
            let group = client.get_group(&group_id);
            if group.members.len() > 2 && group.members.contains(&members[0]) {
                let dispute_id = client.file_dispute(
                    &members[1],
                    &group_id,
                    &members[0],
                    &DisputeType::RuleViolation,
                    &SorobanString::from_str(env, "removed for the test"),
                    &BytesN::from_array(env, &[0u8; 32]),
                    &DisputeResolution::Removal,
                );
                // Every remaining eligible member votes "for" - this property
                // is about payout ordering surviving a removal, not about
                // quorum math (that's covered in the #801 audit tests), so
                // unanimity sidesteps needing to compute a partial threshold.
                for m in group.members.iter() {
                    if m != members[0] && m != members[1] {
                        client.vote_on_dispute(&m, &dispute_id, &true);
                    }
                }
                env.ledger().with_mut(|li| li.timestamp += 7 * 86_400 + 1);
                client.resolve_dispute(&members[1], &dispute_id);
                removed = true;
            }
        }
    }

    recipients
}

/// `Address` isn't `Hash`, so dedup-checking is a linear scan - fine at the
/// small sizes (<=8 members) these properties use.
fn has_no_duplicates(recipients: &[Address]) -> bool {
    for i in 0..recipients.len() {
        for j in (i + 1)..recipients.len() {
            if recipients[i] == recipients[j] {
                return false;
            }
        }
    }
    true
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(16))]
    #[test]
    fn payout_never_repeats_and_everyone_gets_paid_no_removal(member_count in 2usize..8) {
        let env = Env::default();
        let (client, members, group_id, _token) = new_group(&env, member_count);

        let recipients = run_to_completion_with_optional_removal(&env, &client, &members, group_id, None);

        prop_assert!(has_no_duplicates(&recipients), "a recipient was paid more than once: {:?}", recipients);
        prop_assert_eq!(recipients.len(), member_count, "every member should be paid exactly once");
        for m in &members {
            prop_assert!(recipients.contains(m), "member never received a payout: {:?}", m);
        }
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(10))]
    #[test]
    fn payout_never_repeats_and_everyone_gets_paid_around_a_mid_rotation_removal(
        member_count in 4usize..8,
        remove_after_cycles in 1u32..3,
    ) {
        let env = Env::default();
        let (client, members, group_id, _token) = new_group(&env, member_count);

        // `members[0]` is always the group creator and, under the default
        // Sequential strategy, always the first recipient - so by the time
        // `remove_after_cycles >= 1` fires, they're guaranteed to have
        // already been paid. This is deliberately the "remove an
        // already-paid member" case that found the payout_index bug: unlike
        // removing someone who hasn't been paid yet (which was already
        // correct - the array just closes over their still-open slot),
        // `members[0]`'s historical payout must remain accounted for even
        // though they no longer appear in `group.members`.
        let recipients = run_to_completion_with_optional_removal(
            &env, &client, &members, group_id, Some(remove_after_cycles),
        );

        prop_assert!(has_no_duplicates(&recipients), "a recipient was paid more than once: {:?}", recipients);
        // Every original member appears exactly once: the removed member via
        // their earlier payout, everyone else via their (possibly
        // reindexed) turn after the removal.
        prop_assert_eq!(recipients.len(), member_count, "every original member should be paid exactly once, including the one later removed");
        for m in &members {
            prop_assert!(recipients.contains(m), "member never received a payout: {:?}", m);
        }
        prop_assert!(client.get_group(&group_id).is_complete);
    }
}

/// Permanent regression test for the exact minimal case the property test
/// above found: a 4-member group where the first-paid member is removed
/// after 2 payout cycles (i.e. after they've already been paid). Before the
/// fix, `payout_index` stayed at 2 against a 3-member list, so the 3rd
/// payout landed on the wrong recipient and the group reported complete
/// after only 2 of its 3 remaining members had ever been paid.
#[test]
fn test_removing_an_already_paid_member_no_longer_skips_the_next_recipient() {
    let env = Env::default();
    let (client, members, group_id, _token) = new_group(&env, 4);

    let recipients = run_to_completion_with_optional_removal(&env, &client, &members, group_id, Some(2));

    // members[0] was already paid in cycle 1, then removed after cycle 2;
    // all 4 original members - including the removed one, via their earlier
    // payout - must appear exactly once.
    assert_eq!(recipients.len(), 4);
    assert!(has_no_duplicates(&recipients), "a recipient was paid more than once: {:?}", recipients);
    for m in &members {
        assert!(recipients.contains(m), "member never received a payout: {:?}", m);
    }
    assert!(client.get_group(&group_id).is_complete);
}

// ============================================================================
// Property 2: penalty calculation never produces a negative amount or a
// penalty exceeding the group's configured cap, regardless of how late or
// how often a member misses the contribution window.
// ============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(20))]
    #[test]
    fn penalty_never_negative_or_over_cap(
        contribution in 1_000i128..1_000_000_000i128,
        penalty_rate in 0u32..=100,
        lateness_pattern in prop::collection::vec(any::<bool>(), 3..6),
    ) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, AjoContract);
        let client = AjoContractClient::new(&env, &contract_id);
        let token_admin = Address::generate(&env);
        let token = env.register_stellar_asset_contract(token_admin);
        let token_admin_client = token::StellarAssetClient::new(&env, &token);

        let member_count = lateness_pattern.len();
        let members: std::vec::Vec<Address> = (0..member_count).map(|_| Address::generate(&env)).collect();
        for m in &members {
            token_admin_client.mint(m, &(contribution * 10));
        }

        let group_id = client.create_group(
            &members[0], &token, &contribution, &CYCLE_DURATION,
            &(member_count as u32), &GRACE_PERIOD, &penalty_rate, &0u32,
        );
        for m in &members[1..] {
            client.join_group(m, &group_id);
        }

        // Track members[0] across every cycle; everyone else always
        // contributes on time so the group keeps progressing regardless of
        // what members[0] does.
        let mut expected_late = 0u32;
        let mut expected_on_time = 0u32;
        let mut expected_total_penalty: i128 = 0;

        for &is_late in &lateness_pattern {
            let group = client.get_group(&group_id);
            if group.is_complete {
                break;
            }

            for m in &members[1..] {
                client.contribute(m, &group_id);
            }
            if is_late {
                // Land inside the grace window: past cycle end, before grace end.
                env.ledger().with_mut(|li| li.timestamp += CYCLE_DURATION + 3600);
            }
            client.contribute(&members[0], &group_id);
            if is_late {
                expected_late += 1;
                expected_total_penalty += contribution * (penalty_rate as i128) / 100;
            } else {
                expected_on_time += 1;
            }

            let cycle = client.get_group(&group_id).current_cycle;
            let detail = client.get_contribution_detail(&group_id, &cycle, &members[0]);
            prop_assert!(detail.penalty_amount >= 0, "penalty must never be negative: {}", detail.penalty_amount);
            prop_assert!(
                detail.penalty_amount <= contribution,
                "penalty {} exceeds the contribution it's charged against (100% cap) for rate {}",
                detail.penalty_amount, penalty_rate,
            );
            prop_assert_eq!(detail.is_late, is_late);

            let record = client.get_member_penalty_record(&group_id, &members[0]);
            prop_assert_eq!(record.late_count, expected_late);
            prop_assert_eq!(record.on_time_count, expected_on_time);
            prop_assert_eq!(record.total_penalties, expected_total_penalty);
            prop_assert!(record.total_penalties >= 0);
            prop_assert!(record.reliability_score <= 100, "reliability_score must be a percentage: {}", record.reliability_score);

            if !group.is_complete {
                advance_past_grace(&env);
                let _ = client.try_execute_payout(&group_id);
            }
        }
    }
}

// ============================================================================
// Property 3: refund vote tallying is order-independent and never resolves
// approved without quorum.
// ============================================================================

fn run_refund_vote(
    votes: &[Option<bool>],
    order: &[usize],
) -> (bool, u32, u32, bool) {
    let env = Env::default();
    let (client, members, group_id, _token) = new_group(&env, votes.len());

    for m in &members {
        client.contribute(m, &group_id);
    }
    advance_past_grace(&env);
    client.request_refund(&members[0], &group_id);

    for &i in order {
        if let Some(in_favor) = votes[i] {
            client.vote_refund(&members[i], &group_id, &in_favor);
        }
    }

    env.ledger().with_mut(|li| li.timestamp += 604_800 + 1);
    client.execute_refund(&members[0], &group_id);

    let request = client.get_refund_request(&group_id);
    let cancelled = client.get_group(&group_id).state == GroupState::Cancelled;
    (request.approved, request.votes_for, request.votes_against, cancelled)
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(16))]
    #[test]
    fn refund_tally_is_order_independent_and_respects_quorum(
        votes in prop::collection::vec(prop::option::of(any::<bool>()), 3..8),
    ) {
        let member_count = votes.len();
        let forward_order: std::vec::Vec<usize> = (0..member_count).collect();
        let reversed_order: std::vec::Vec<usize> = (0..member_count).rev().collect();

        let (approved_fwd, for_fwd, against_fwd, cancelled_fwd) = run_refund_vote(&votes, &forward_order);
        let (approved_rev, for_rev, against_rev, cancelled_rev) = run_refund_vote(&votes, &reversed_order);

        prop_assert_eq!(for_fwd, for_rev, "vote-for tally must not depend on submission order");
        prop_assert_eq!(against_fwd, against_rev, "vote-against tally must not depend on submission order");
        prop_assert_eq!(approved_fwd, approved_rev, "approval outcome must not depend on submission order");
        prop_assert_eq!(cancelled_fwd, cancelled_rev);

        // Independently recompute the expected outcome from the generated
        // votes and check the contract agrees - this is the "never resolves
        // without genuine quorum" half of the property, not just internal
        // consistency between the two runs.
        let participating = votes.iter().filter(|v| v.is_some()).count() as u32;
        let for_count = votes.iter().filter(|v| **v == Some(true)).count() as u32;
        let has_quorum = participating.saturating_mul(2) >= member_count as u32;
        let expected_approved = has_quorum
            && participating > 0
            && (for_count * 100 / participating.max(1)) >= 51;

        prop_assert_eq!(approved_fwd, expected_approved);
        prop_assert_eq!(cancelled_fwd, expected_approved);
        if !has_quorum {
            prop_assert!(!approved_fwd, "must never approve without quorum, even with unanimous votes cast");
        }
    }
}
