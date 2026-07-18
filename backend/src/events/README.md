# Event Sourcing Module

See [ADR-011](../../../docs/ARCHITECTURE_DECISION_RECORDS.md#adr-011-event-sourcing-scope-and-its-relationship-to-prisma-and-the-blockchain)
for the full architectural decision. This file is the practical "how it
works and how to use it" companion.

## Current status: unused

Nothing in the application calls into this module. `git grep` for
`eventStore`, `dispatchEvent`, or `rebuildGroupState` outside this
directory returns no results. It is not the source of truth for any
domain. For the Group/Contribution domain specifically, the Soroban smart
contract is the source of truth and Prisma is kept in sync with it via
`backend/src/handlers/contractEventHandlers.ts` — do not wire this module
into that flow, it would create a second, competing projection of the same
state. See the decision table in ADR-011 for when this module is (and
isn't) the right tool for a new feature.

## How it works

- **`eventStore.ts`** — `EventStore.append()` writes a `DomainEvent` to the
  `EventStore` Prisma table. `event.metadata.version` must be exactly one
  greater than the aggregate's current latest version; the table has a
  unique constraint on `(aggregateId, version)`, so a concurrent writer
  appending a conflicting version gets a `ConflictError` (409) instead of
  silently corrupting the aggregate's history. `getByAggregateId`,
  `getByType`, and `getAll` read events back in `sequenceNumber` order.
- **`types.ts`** — `DomainEvent`/`StoredEvent` shapes, the closed
  `EventType` union, and the `Projection<TState>` interface
  (`initialState` + a pure `apply(state, event): state` reducer).
- **`projections/groupProjection.ts`** — an example `Projection<GroupState>`
  reducer for illustration/testing. Not wired to real group data (see
  above).
- **`projections/index.ts`** — `rebuildProjection(aggregateId,
  aggregateType, projection)` reconstructs an aggregate's state. If a
  snapshot exists, it resumes from the snapshot's state and only replays
  events appended after it; otherwise it replays from genesis. Once it
  processes ≥100 events in one rebuild, it saves a new snapshot.
- **`snapshotStore.ts`** — one row per aggregate (upserted, not versioned
  history) recording the projected state as of a given version.
- **`eventHandlers/`** — example fire-and-forget handlers
  (`dispatchEvent`) that just log; a template for reacting to events
  asynchronously, not a requirement for using the store or projections.

## Correctness guarantees, and where they're tested

- **Full replay ≡ incremental processing**: reducing over an aggregate's
  entire event history at once (what `rebuildProjection` does after a
  cache miss) produces exactly the same state as applying events one at a
  time as they arrive live. Verified in
  `src/__tests__/unit/events/replayCorrectness.test.ts` against a
  synthetic but realistic group lifecycle (created → members join →
  contributions → a member leaves → more contributions), including
  pinned-value assertions so a reducer bug can't hide behind a tautology.
- **Snapshot-based replay ≡ full replay**: resuming from a snapshot and
  replaying only the events after it produces the same state as replaying
  from event #1, verified in
  `src/__tests__/unit/events/snapshotReplay.test.ts` over a 132-event
  history (well past the 100-event snapshot threshold). That test also
  asserts the snapshot path actually requests events starting after the
  snapshot's version — i.e. that it's not secretly doing a full replay
  anyway.
- **Concurrent writes are rejected, not silently applied**:
  `src/__tests__/unit/events/eventStore.test.ts` covers `ConflictError` on
  a duplicate `(aggregateId, version)`, and this was also exercised live
  against a real Postgres instance (not just a mock) during development —
  the DB constraint genuinely rejects the second writer.

## Using it for a new domain

```ts
import { eventStore } from '../events/eventStore'
import { rebuildProjection } from '../events/projections'
import type { Projection } from '../events/types'

// 1. Append events as they happen, with the aggregate's next version.
await eventStore.append({
  type: 'DISPUTE_FILED',
  aggregateId: disputeId,
  aggregateType: 'Dispute',
  payload: { reason },
  metadata: { timestamp: new Date().toISOString(), version: nextVersion },
})

// 2. Define a reducer and rebuild state from the log (snapshot-aware).
const disputeProjection: Projection<DisputeState | null> = {
  name: 'DisputeProjection',
  initialState: null,
  apply(state, event) { /* ... */ },
}

const state = await rebuildProjection(disputeId, 'Dispute', disputeProjection)
```

If you add a new `EventType`, extend the union in `types.ts`. If your
domain's version can be contended (concurrent writers), read
`eventStore.getLatestVersion(aggregateId)` before computing the next
version, and be prepared to retry on `ConflictError`.
