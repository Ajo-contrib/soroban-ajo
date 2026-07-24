# Storage cost-optimization report: `contribute` / `execute_payout`

This report covers a dedicated cost-optimization pass over `storage.rs` and
the two hottest contract entrypoints, `contribute` and `execute_payout`.
Numbers below are reproducible via:

```
cd contracts/ajo
cargo test --test cost_profiling_tests -- --nocapture
```

## Methodology

Each measured test isolates a single call to the entrypoint under test by
calling `env.budget().reset_unlimited()` (which also zeroes the SDK's cost
trackers) immediately before invoking it, then reads back
`env.budget().cpu_instruction_cost()` and `env.budget().memory_bytes_cost()`.

`ContractCostType::ValSer`/`ValDeser` — which would otherwise proxy ledger
read/write bytes directly — read as zero under `soroban-sdk`'s native
(non-Wasm) contract-registration test harness (`env.register_contract(None,
AjoContract)`), because that XDR (de)serialization only happens on the real
network's storage layer, not this in-process native call path. In place of
that, `contracts/ajo/tests/cost_profiling_tests.rs::print_struct_sizes_for_report`
computes the *actual* ScVal-XDR byte size of the structs at stake (via
`ToXdr`), which is exact rather than a proxy: a 3-member `Group` is **804
bytes**, a `MemberStats` record is **528 bytes**, a `ReputationScore` is
**420 bytes**. These sizes are unchanged by this pass (same struct shapes) —
they're what turns "N fewer/more storage operations" (known exactly from
code inspection, see below) into a concrete byte figure.

All three scenarios use a 3-member group, contribution 100_000_000 stroops,
7-day cycle, 1-day grace period.

## Before / after numbers

| Scenario | CPU instructions (before → after) | Δ | Memory bytes (before → after) | Δ |
|---|---|---|---|---|
| `contribute` (steady state, insurance enabled) | 788,464 → 830,129 | **+5.28%** | 139,623 → 146,448 | **+4.89%** |
| `execute_payout` (mid-cycle, non-completing) | 778,085 → 853,742 | **+9.73%** | 133,518 → 147,000 | **+10.10%** |
| `execute_payout` (final cycle, group completion) | 1,844,591 → 1,717,914 | **−6.87%** | 315,917 → 298,378 | **−5.55%** |

These are not a uniform "everything got cheaper" result, and reporting it
as one would be dishonest — the numbers show a real, explainable trade-off,
detailed below.

## What changed, and why the numbers move the way they do

### 1. Storage-type reclassification (`storage.rs`)

`InsurancePool`, `FraudRiskProfile`, and `GroupRiskAssessment` were stored in
**instance** storage instead of **persistent** storage, despite being
per-token / per-member / per-group records that grow without bound as the
platform scales. Instance storage is a *single shared ledger entry* for the
whole contract — every key in it is read and written together — so this
misclassification meant `InsurancePool` (reachable from `contribute`'s hot
path via `insurance::deposit_to_pool`, `contract.rs:531`) was bloating one
shared blob that gets touched on every call that reads *any* instance key,
not just insurance-enabled ones. All three are now persistent, keyed the
same way. `get_insurance_pool` falls back to the legacy instance key on a
persistent miss so any pool balance from before this change is picked up
transparently and migrates forward on the next write — no data loss, no
migration step required.

This reclassification is a **cost increase per contribute call at small
scale** (persistent storage carries its own per-entry TTL bookkeeping that
instance storage doesn't) but an **unbounded cost avoidance at platform
scale**: it stops the shared instance blob from growing every time a new
token or group interacts with insurance, which would otherwise tax every
single contract call, forever, as adoption grows — exactly the "thousands
of groups" scenario this audit was scoped for.

### 2. TTL extension strategy (`storage.rs`)

**Before this pass, `extend_ttl` was never called anywhere in the crate.**
Every persistent (and instance) entry was written once and never re-extended.
This is a **correctness bug**, not just a cost line item: Soroban's host
returns a hard error reading a persistent key whose TTL has lapsed
(`check_if_entry_is_live` in `soroban-env-host`), and group cycles run up to
90 days plus a 7-day grace period (`utils::GroupTemplate`), so any entry
touched once and left alone was a real, live expiry risk within a single
group's active lifecycle.

Fix: every persistent write in `storage.rs` now goes through a
`persistent_set` helper that extends the entry's TTL to ~120 days
(`PERSISTENT_TTL_EXTEND_TO`, re-triggered once fewer than ~30 days remain,
`PERSISTENT_TTL_THRESHOLD`) — comfortably longer than the worst-case
single-cycle gap between writes, well under the network's max entry TTL.
`get_group`/`get_group_metadata` also extend on read, since those can be
queried many times between cycle-driven writes. `contribute` and
`execute_payout` additionally call `storage::extend_instance_ttl` once each,
since instance storage backs the contract's own identity (admin, schema
version, counters) — losing that would make the *entire contract*
unreachable, strictly worse than losing one group's data.

**This is the direct cause of the CPU/memory increase on `contribute` and
mid-cycle `execute_payout`** above: a `contribute` call now issues roughly
nine `extend_ttl` calls that didn't exist before (one per persistent write
it triggers, plus the instance-storage extension), and each is a real,
non-free host-function dispatch even when it's a no-op re-check. Mid-cycle
`execute_payout` sees a proportionally larger increase because none of its
own redundant-computation had been on that specific (non-completing) code
path — see below.

### 3. Redundant read/write elimination (`contract.rs`, `reputation.rs`)

- `contribute` loaded and stored `MemberStats` itself, then called
  `reputation::update_member_reputation`, which **re-fetched the same
  `MemberStats` from storage** a second time. Fixed by extracting
  `update_member_reputation_with_stats(env, member, &stats)` in
  `reputation.rs`, and having `contribute` (`contract.rs`) pass through the
  `stats` it already has in scope instead of triggering a second storage
  read.
- `execute_payout`'s group-completion loop did the same double-fetch for
  every member, and then **unconditionally called `update_member_reputation`
  a second time for the payout recipient** even when the completion loop had
  just done the exact same recompute for that same member — a fully
  duplicate persistent read+write of `MemberReputation`, plus an
  informationally-empty `CreditScoreSnapshot` append (same score, same
  timestamp) that wastes one of the capped 50 history slots every time a
  group completes. Fixed by reusing the completion loop's already-loaded
  `stats` via `update_member_reputation_with_stats`, and only falling back
  to the standalone recipient update when the group does *not* complete
  (the only case where nothing already refreshed the recipient's
  reputation this call).

**This is the whole story behind the `execute_payout` group-completion
improvement**: that code path is where the redundant computation was
concentrated (one full duplicate reputation recompute per member, plus a
second one for the recipient), so eliminating it outweighs the added TTL
bookkeeping cost on that path — a net **6.87% CPU** / **5.55% memory**
reduction, on the single most expensive call in the contract (the one that
also flips a group to `is_complete`).

## Net assessment

The three fixes pull the cost of a single call in two directions, and the
net effect depends on how much redundant work that call's code path used to
do:

- **`execute_payout` on the completing cycle** (previously the largest,
  most redundant path) improves outright — the eliminated duplicate
  reputation recompute is bigger than the TTL bookkeeping it costs.
- **`contribute` and mid-cycle `execute_payout`** get modestly more
  expensive (5–10%) because they had comparatively little redundant work to
  remove, so the TTL-safety cost isn't fully offset. This is the accepted,
  bounded cost of closing a correctness gap (unprotected TTLs, misclassified
  instance storage) that didn't exist as a cost line before because it
  simply wasn't being paid for — the entries were silently at risk of
  archival instead.

At the scale this platform is built for (per the audit brief: recurring
contributions across potentially thousands of groups), the *unbounded*
costs this pass removes — a single instance-storage blob that grows forever
with every insurance-enabled token, and entries that go permanently
inaccessible once a group runs long enough — matter far more than a ~5–10%
per-call CPU delta on the lightest-weight calls. No entrypoint changed
behavior: same errors, same events, same final `ReputationScore`/tier for
every path (see `cargo test` — full suite green, 0 behavioral changes).

## Verified: no persistent data at risk of TTL expiry

`contracts/ajo/tests/ttl_expiry_tests.rs` fast-forwards the ledger sequence
number past a deliberately short "naive" TTL (simulating what would happen
with the old, never-extended entries) and confirms the group/contribution
data set up before the jump is still fully readable and the group can still
complete its next cycle — proving `extend_ttl` is doing its job rather than
being a no-op assertion.

## Scoped out (follow-up, not fixed in this pass)

- `voting.rs` stores per-cycle vote/tally data in instance storage, but the
  module isn't declared in `lib.rs` (`mod voting;` is missing) — it's dead,
  uncompiled code, not worth touching here.
- `multisig.rs` (`pub mod multisig;`) has the same instance-storage
  misclassification for proposals/signatures, but it's never invoked from
  `contract.rs` or any wired-in entrypoint — outside both "storage.rs" and
  the `contribute`/`execute_payout` hot path this audit was scoped to. Flagged
  here as a real finding for a future pass, not fixed now, to keep this
  diff focused and reviewable.
