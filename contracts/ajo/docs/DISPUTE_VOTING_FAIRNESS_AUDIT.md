# Dispute Resolution and Voting Fairness Audit (Issue #801)

**Scope:** `file_dispute`, `vote_on_dispute`, `resolve_dispute` (`contract.rs`,
backed by `Dispute`/`DisputeVote` in `types.rs`), and `request_refund`,
`vote_refund`, `execute_refund` (the member-refund-vote path, which shares the
same quorum-of-one problem and is fixed alongside the dispute path).

## 1. Quorum: fixed percentage of votes cast, not of the group

Before this fix, both `execute_refund` and `resolve_dispute` computed
approval as a percentage of **votes cast**, with no floor on how many members
had to cast one:

```rust
// resolve_dispute, pre-fix
let total_votes = dispute.votes_for_action + dispute.votes_against_action;
let approved = total_votes > 0
    && (dispute.votes_for_action * 100 / total_votes) >= DISPUTE_APPROVAL_THRESHOLD;
```

If `total_votes == 1` and that one vote is "for," approval is 100% —
comfortably clearing both the refund's 51% and the dispute's 66% threshold.
Concretely, in a 10-member group:

- **Refund:** the requester calls `request_refund`, then `vote_refund(true)`
  for themselves. If no one else votes before the 7-day deadline,
  `execute_refund` sees 1-for/0-against = 100% approval and cancels the
  *entire group* — refunding everyone and ending the ROSCA — over the
  objection (or indifference) of the other 9 members, who never got a say.
- **Dispute:** the complainant votes for their own proposed resolution once,
  and if no one else weighs in, `resolve_dispute` applies it — including
  `Removal` (kicking the defendant from the group) or `Penalty` (a
  reliability-score hit) — decided by a single voter.

Neither path required the disputed/refunded party, or anyone else, to
participate at all. "Quorum of one" is not a contrived edge case here — it's
the *default* outcome whenever a vote is filed and the rest of the group
doesn't happen to notice before the deadline, which real wallet/notification
latency makes routine, not exceptional (see §3).

**Fix:** both paths now also require quorum — at least half of the eligible
membership must have cast a vote — computed and re-checked at
resolution time, on top of the existing approval-percentage threshold:

```rust
let has_quorum = total_votes.saturating_mul(2) >= eligible_voters;
let approved = has_quorum && total_votes > 0 && (votes_for * 100 / total_votes) >= THRESHOLD;
```

- **Refund quorum** is measured against `group.members.len()` — every
  current member is an eligible voter (see §4 on why the requester voting
  for themselves is fine).
- **Dispute quorum** is measured against `group.members.len() - 1`, i.e.
  every member *except the defendant*, who cannot vote on their own case
  (§2). Both counts are read live from `storage::get_group` at resolution
  time rather than snapshotted when the vote/dispute was filed, so a member
  who joins mid-vote is already counted as eligible for that vote by the
  time it resolves — see §1a for why this direction was chosen over
  snapshotting.

50% is a judgment call, not a derived constant. It's the smallest quorum bar
that rules out "one voter decides for everyone" while not requiring
unanimous participation (which would let a single non-voting member veto by
silence — its own fairness problem, and unrealistic for e.g. an inactive
member of a large group). Groups that want stricter guarantees can be built
on top of this primitive (e.g. an off-chain UI could refuse to submit
`resolve_dispute`/`execute_refund` before some higher bar is hit, since
both remain callable by any member at any time after the deadline); the
contract's floor is what stands between "any single member" and "requires
a real fraction of the group."

### 1a. Dynamic vs. snapshotted membership

Quorum is recalculated from the group's *current* member list every time
`resolve_dispute`/`execute_refund` runs, not fixed at vote-creation time.
The alternative — snapshot the eligible-voter count when the vote opens —
has a worse failure mode for this contract: `join_group` has no cooldown or
approval delay for `Open`-access groups (the common case), so a proposer
could file a dispute or refund request the instant before inviting/accepting
a wave of new members, and a snapshotted quorum would then be trivially wrong
in either direction (too low if members join after, artificially hard to
reach if the count doesn't track members who leave via `Removal`). Recomputing
live means quorum always reflects who could plausibly still be reached to
vote, and it costs nothing extra since `resolve_dispute`/`execute_refund`
already fetch the group record.

## 2. The defendant could vote on their own dispute

`vote_on_dispute`'s doc comment claimed "any group member (except the
defendant) may vote," but the code never checked it — a defendant could vote
`supports_action: false` on their own case, and did count toward `total_votes`
and thus toward reaching quorum under the fix in §1. Combined with the
quorum-of-one bug, a defendant facing a `Removal` dispute could vote against
it once, and if no one else voted, `votes_against_action` would exceed the
66% "for" bar trivially (0% for), rejecting the dispute unilaterally — the
mirror image of the complainant's quorum-of-one problem, with the accused
party deciding their own case instead.

**Fix:** `vote_on_dispute` now rejects the defendant with `Unauthorized`, and
they're excluded from the eligible-voter count for quorum (§1) — they can
still contest the dispute off-chain / by whatever the group's real dispute
process is, but can't cast an on-chain vote in it.

## 3. Timing: fixed period, not proposer-configurable — but still exploitable via the *filing* moment

`VOTING_PERIOD` and `DISPUTE_VOTING_PERIOD` are both a flat 604,800 seconds
(7 days), hard-coded constants — neither `request_refund` nor `file_dispute`
takes a caller-supplied duration. This means a proposer cannot shorten the
window to rush a vote past honest participants; 7 days is generous relative
to realistic wallet-signing latency, so the window itself isn't the
manipulable variable.

What *is* still true, and is a structural property of "any member can vote
whenever, resolution requires no minimum participation" designs generally:
a proposer can pick *when* to file (e.g. right before a holiday, or
immediately after a contentious payout when other members are least likely
to be watching) to depress turnout during the fixed window. Quorum (§1)
directly mitigates this — a low-turnout window now fails to resolve in the
proposer's favor rather than defaulting to whoever happened to vote — but it
doesn't eliminate the incentive to file at a quiet moment. This is a
game-theoretic residual, not a bug: closing it further would mean either a
proposer-independent minimum notice period before voting can start (adding
latency to every legitimate dispute/refund, including urgent ones) or an
off-chain notification requirement the contract can't enforce. Given the
7-day window and the quorum fix, we judged the residual acceptable rather
than adding contract-level delay machinery with no clear stopping point.

## 4. Vote weight: one member, one vote, regardless of stake

Every member gets exactly one vote in both `vote_refund` and
`vote_on_dispute`, independent of `contribution_amount` or, in multi-token
groups, which token/weight they're contributing. This is the intended
design, not an oversight: `Group.contribution_amount` is a single value for
the *whole* group (every member owes the same amount per cycle; multi-token
support lets members pay in different tokens but the group defines
equal-value weights via `MultiTokenConfig`, not per-member stake tiers), so
one-member-one-vote already tracks one-stake-one-vote for the refund case —
every member has identical amount at risk. For disputes, the relevant stake
is membership standing (a `Removal`/`Penalty` outcome), not contribution
size, so equal voting power per member is the correct model there too.
Stake-weighted voting would only make sense if the protocol later
introduces per-member variable stake within one group, which it doesn't.

The requester/complainant voting for their own refund/dispute is
deliberately still allowed (unlike the defendant, per §2): a refund vote
benefits every member equally (everyone gets their contribution back), so
there's no self-dealing angle to exclude, and excluding the complainant
from disputes would be an odd asymmetry — they're not being adjudicated,
the defendant is.

## 5. Self-filed disputes

`file_dispute` never checked `complainant != defendant`. Combined with §1
and §2 (pre-fix), a member could file a dispute naming themselves as the
defendant, vote on it themselves (the defendant-exclusion in §2 didn't exist
yet either), and pass it solo. The main risk isn't the `Removal`/`Penalty`
resolutions (self-removing or self-penalizing is merely pointless), it's
`Refund`: that branch unconditionally records a `RefundRecord` for the
complainant, without checking that they'd actually contributed anything
that cycle. A self-dispute with `DisputeResolution::Refund`, passed solo,
would produce a `RefundRecord` the member never earned. (This contract
version doesn't wire `RefundRecord` from dispute resolutions to an actual
token transfer — `execute_refund`'s own loop is what moves funds, and that
path already checks `has_contributed` — so this specific gap isn't a live
fund-drain today, but the record is still bogus bookkeeping that any future
code trusting it would inherit.)

**Fix:** `file_dispute` now rejects `complainant == defendant` with
`Unauthorized`.

## 6. Tied and non-quorate votes at the deadline: explicit, tested, never stuck

Both functions are callable by any member after the deadline passes, and
in every branch (quorum met/not met, approved/rejected, tied) they resolve
to a final, terminal state in the *same call* — never leaving anything in
"Voting"/pending indefinitely:

- **Disputes:** `resolve_dispute` always sets `status` to either `Resolved`
  (quorum + approval met) or `Rejected` (either one missing, including a
  tie: 50% "for" among votes cast is < 66%, so a tie is a Rejected outcome,
  same as failing quorum outright) and returns `Ok(())` either way. There is
  no error return for "not approved" — non-approval is a normal, final
  outcome, distinguishable via `get_dispute(id).status`/`final_resolution`.
- **Refunds:** this was *not* true before this audit. `execute_refund` used
  to write `executed = true, approved = false` and then `return
  Err(RefundNotApproved)` — but a Soroban contract invocation that returns
  an `Err` rolls back every storage write made during it, so that "recorded
  rejection" never actually persisted. The refund request was left with
  `executed: false` forever, and since `request_refund` only checked
  *existence* of a prior request (not whether it had run), the group could
  never file another refund request again after one failed vote — a
  permanently stuck state, not a "genuine quorum" edge case, but real
  incidental breakage this audit found while fixing quorum in the same
  function. Fixed: a non-approved outcome now writes the rejection and
  returns `Ok(())` (matching the dispute path), and `request_refund` treats
  any `executed` request — approved or not — as resolved, so a new one can
  always be filed. `execute_refund`'s doc comment and the `RefundNotApproved`
  error variant's meaning changed accordingly: check
  `get_refund_request(id).approved` rather than matching on an `Err`.

## Summary of fixes

| Vector | Function(s) | Fix |
|---|---|---|
| Quorum-of-one approval | `execute_refund`, `resolve_dispute` | Require ≥50% of eligible members to have voted, recomputed live at resolution |
| Defendant votes on own dispute | `vote_on_dispute` | Reject with `Unauthorized`; excluded from quorum denominator |
| Self-filed dispute | `file_dispute` | Reject `complainant == defendant` with `Unauthorized` |
| Rejected refund vote permanently blocks future requests | `execute_refund`, `request_refund` | Rejection persists via `Ok`, not a rolled-back `Err`; a resolved (executed) request no longer blocks a new one |

Every row has a regression test in
`contracts/ajo/tests/dispute_voting_fairness_tests.rs` demonstrating the
vector no longer works, plus a matching "quorum is met" test proving the
fix doesn't just require unanimity.

Note on error codes: `Unauthorized` is reused for the two new checks (§2,
§5) rather than adding new `AjoError` variants, because the enum is already
at Soroban's hard 50-case limit for a `#[contracterror]` spec export (see
the doc comment on `AjoError` in `errors.rs`, and the build-fix PR that
trimmed it back to 50). Both are genuinely access-control-shaped rejections
("you are not allowed to take this action"), so the reuse is semantically
reasonable, not just a workaround.
