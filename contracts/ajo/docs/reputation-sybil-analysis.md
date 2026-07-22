# Reputation/Credit Scoring: Sybil & Collusion Analysis (Issue #802)

**Scope:** `contracts/ajo/src/reputation.rs` and its call sites in `contract.rs`.

## 1. The scoring formula, as implemented

`compute_credit_score` (`reputation.rs`) produces a 0–1000 score from a
member's aggregated `MemberStats`, recalculated on every contribution,
payout, and group completion:

| Component            | Weight | Formula (pre-fix)                                          |
|-----------------------|--------|-------------------------------------------------------------|
| Payment reliability   | 40 %   | `on_time_contributions / total_contributions × 400`         |
| Groups completed      | 20 %   | `min(total_groups_completed, 10) × 20`                       |
| Volume contributed    | 20 %   | tiered on `total_amount_contributed` (0 below 10 XLM, up to 200 at ≥100,000 XLM) |
| Penalty history       | 20 %   | `(1 - late_contributions / total_contributions) × 200`       |

`credit_score` maps to a tier: Unrated (0–199), Bronze (200–399), Silver
(400–599), Gold (600–799), Platinum (800–899), Diamond (900–1000).
`check_credit_requirement` / `get_credit_score` expose this for callers to
gate group access or (per the issue's premise) loan terms and collateral.

Three of the four components — reliability, completion, penalty — are pure
**counts and ratios**. None of them are weighted by how much value actually
moved. The only component sensitive to amount is volume, and it's gated on
an absolute cumulative total, not on how much was at risk in any single
group.

The protocol's own minimum group size is 2 (`utils::validate_group_params`
rejects `max_members < 2`), contribution amount only has to be `> 0`
(`ContributionAmountZero`/`ContributionAmountNegative`), and cycle duration
only has to be `> 0`.

## 2. Sybil cost (pre-fix)

**Cheapest attack:** a 2-member ROSCA (the protocol minimum) with a
1-stroop contribution and a 1-second cycle / 0-second grace period, where
the attacker controls both member addresses.

A 2-member group needs exactly 2 payout cycles to reach `is_complete`. Per
group that's:

- 1× `create_group`, 1× `join_group`
- 2× `contribute` per cycle × 2 cycles = 4× `contribute`
- 2× `execute_payout`

= **8 transactions**, and since `cycle_duration=1s`/`grace_period=0s`, each
cycle clears as soon as the ledger timestamp advances past it — i.e. on the
next ledger close (~5–6s on mainnet), not something an attacker can shortcut
by submitting more transactions. Wall-clock cost for one completed group:
**~2 ledger closes (~10–15 s)**.

Scoring that one group under the pre-fix formula, for either member:

```
reliability = 2/2 × 400 = 400
completion  = min(1, 10) × 20 = 20
volume      = 0            (well under the 10 XLM volume floor)
penalty     = 200           (no late contributions ever recorded)
──────────────────────────────────────────
score       = 620  → Gold tier, from ONE 8-tx, sub-cent group.
```

Repeating the loop across 10 such groups (they can run concurrently, so
wall-clock stays ~10–15 s, not 10×) maxes out the completion component:

```
reliability = 400, completion = min(10,10)×20 = 200, volume = 0, penalty = 200
──────────────────────────────────────────
score       = 800  → Platinum tier.
```

**Transaction fees:** Soroban invocations on Stellar mainnet run a base fee
of 100 stroops plus a modest resource fee; even generously assuming 0.01 XLM
per invocation, 10 groups × 8 tx = 80 tx ≈ **0.8 XLM** in fees (a few US
cents to well under a dollar at any XLM price the asset has historically
traded at).

**Account cost:** the attacker needs their own identity plus exactly **one**
disposable helper address (the same helper can be reused as the second
member across all 10 groups — nothing prevents one address from belonging to
many groups at once). Stellar's minimum account reserve (~1 XLM per account)
is refundable via `merge_account` once the helper is discarded, so it's
locked capital during the attack, not a sunk cost.

**Bottom line: for well under $1 and about 10–15 seconds, one actor mints a
Platinum-tier (800/1000) identity, and this scales linearly and in parallel
— N identities cost N× the fees and N helper accounts, with no increase in
per-identity cost.** Any product decision that gates better loan terms or
reduced collateral behind this score was gating them behind a cost lower
than the gas to read this document.

## 3. Collusion resistance (pre-fix)

The same loop works for two *real, distinct* accounts that agree offline to
farm each other's score, with no sybil-detection heuristic (distinct
addresses, distinct funding sources, whatever) able to tell it apart from
genuine participation: the pre-fix formula doesn't distinguish "two people
who don't trust each other contributing real capital for 10 cycles" from
"two people rotating the same handful of stroops back and forth." Because
reliability/completion/penalty are amount-blind, colluders don't even need
real capital — the dust-amount version above works identically for two real
people as it does for two sybils. No default risk is ever taken by either
party: each payout simply returns capital the recipient contributed moments
earlier in the same cycle.

## 4. Mitigation chosen: minimum stake-at-risk per qualifying cycle

Of the options the issue lists, the other two aren't viable right now:

- **Cross-referencing the insurance subsystem's risk data** — `insurance.rs`
  `get_member_risk_score`/`get_group_risk_rating` are unimplemented stubs
  that return a constant (see issue #800); there's no real risk signal yet
  to cross-reference.
- **Graph-based collusion detection** (flagging reciprocal group clusters)
  is real anti-sybil tooling, but it's an off-chain analytics job, not
  something `reputation.rs`'s pure, cheap, per-call score computation can
  do on-chain without unbounded storage/compute — a much larger initiative
  than this issue's scope.

That leaves **score decay/recency weighting** and **minimum stake-at-risk
thresholds**. We implemented the latter: it directly targets the mechanism
that makes the attack cheap (amount-blind scoring), is a small, local,
fully-testable change, and doesn't preclude adding decay weighting later as
a second, complementary layer.

### Implementation

`reputation::MIN_REPUTATION_STAKE` (`= 10 XLM`, matching the volume
component's own existing "first tier of real activity" threshold) is the
minimum per-cycle contribution amount for a group's participation to count
toward score. `MemberStats` now tracks `qualifying_contributions`,
`qualifying_ontime_contribs`, `qualifying_groups_completed`, and
`qualifying_amount_contributed` alongside the existing raw counters — only
incremented when `contribution_amount >= MIN_REPUTATION_STAKE`
(`contract.rs`: `contribute`, `contribute_with_token`, and the
group-completion blocks in `execute_payout` / `execute_multi_token_payout`).
`compute_credit_score` now derives all four components from the qualifying
figures instead of the raw ones. Groups below the threshold are otherwise
unaffected — they still work exactly as before, they simply generate no
reputation.

Re-scoring the attack in §2 against the new formula: `qualifying_contributions`
stays 0 throughout (1 stroop `<` 10 XLM), so the score is 0 for 1 group and
still 0 for 10. See `tests/reputation_sybil_tests.rs` for the executable
version of this, alongside a positive-path test confirming a group that
actually stakes ≥10 XLM per cycle scores normally (660/1000 for one
completed 2-member group at exactly the threshold).

### What this does and doesn't fix

- **Fixes:** the practically-free, unlimited-scale version of the attack.
  Before, cost was independent of the score achieved. After, reaching any
  non-zero score requires locking real capital (≥10 XLM) per qualifying
  cycle — a five-to-six order of magnitude cost increase over the 1-stroop
  version, and it removes the free ride on the completion-count cap.
- **Doesn't fully fix:** an attacker who already has ~10 XLM of liquid
  capital can still recycle the *same* capital through a chain of sybil
  identities *serially* (one identity's group completes, the capital frees
  up, feed it into the next identity's group), so this raises the cost of
  running the attack **in parallel** (capital-multiplied) but only rate-
  limits — via wall-clock cycle time — an attacker willing to run it
  **serially** with a fixed amount of capital. It also doesn't (yet) address
  multi-token groups where a token's raw integer amount could nominally
  clear the stroop-denominated threshold while representing negligible real
  value (an existing limitation of `volume_score` too, not introduced here).

### Recommended follow-up

- **Recency/decay weighting**, so a score built once and never
  refreshed decays — directly limits the serial-recycling residual above by
  forcing sustained capital commitment rather than a one-time build-up.
  Complementary to a distinct-counterparty-diversity requirement (e.g.
  discounting qualifying activity concentrated in a small, repeatedly-reused
  set of counterparties), which would address collusion between a small,
  fixed cartel more directly than a stake floor alone.
- Once #800 lands real risk scoring in `insurance.rs`, cross-referencing it
  here becomes viable and would catch cases a pure stake floor can't (a
  well-capitalized cartel that meets the stake floor but has an
  anomalous claims/default pattern).
