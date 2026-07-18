import { groupProjection, GroupState } from '../../../events/projections/groupProjection'
import { buildGroupLifecycleEvents } from '../../../../tests/fixtures/eventLifecycle'

jest.mock('../../../events/eventStore', () => ({
  eventStore: {
    getByAggregateId: jest.fn(),
  },
}))

jest.mock('../../../events/snapshotStore', () => ({
  snapshotStore: {
    getLatest: jest.fn(),
    save: jest.fn(),
  },
}))

import { eventStore } from '../../../events/eventStore'
import { snapshotStore } from '../../../events/snapshotStore'
import { rebuildProjection } from '../../../events/projections'

const mockEventStore = eventStore as unknown as { getByAggregateId: jest.Mock }
const mockSnapshotStore = snapshotStore as unknown as { getLatest: jest.Mock; save: jest.Mock }

describe('Snapshot-based replay', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('produces the exact same state as a full replay from genesis, for a long-lived aggregate that has accumulated a snapshot', async () => {
    // 12 base events + 120 extra contributions = 132 events total, well past
    // the snapshot threshold — the scenario this exists for: a group with
    // years of history where replaying from event #1 every time would be
    // wasteful.
    const allEvents = buildGroupLifecycleEvents(120)
    const snapshotCutoff = 100 // simulate a snapshot taken after the 100th event

    // --- Baseline: full replay from genesis, no snapshot involved ---
    mockSnapshotStore.getLatest.mockResolvedValueOnce(null)
    mockEventStore.getByAggregateId.mockResolvedValueOnce(allEvents)
    const fullReplayState = await rebuildProjection('group-1', 'Group', groupProjection)

    // --- Snapshot-based replay: resume from a snapshot taken mid-history ---
    const stateAtCutoff = allEvents
      .slice(0, snapshotCutoff)
      .reduce<GroupState | null>((state, event) => groupProjection.apply(state, event), groupProjection.initialState)

    mockSnapshotStore.getLatest.mockResolvedValueOnce({ version: snapshotCutoff, state: stateAtCutoff })
    const eventsAfterSnapshot = allEvents.slice(snapshotCutoff)
    mockEventStore.getByAggregateId.mockResolvedValueOnce(eventsAfterSnapshot)

    const snapshotBasedState = await rebuildProjection('group-1', 'Group', groupProjection)

    expect(snapshotBasedState).toEqual(fullReplayState)
    expect(snapshotBasedState).not.toBeNull()

    // Prove the snapshot path actually avoided reprocessing the full
    // history — it must have asked the event store for events starting
    // right after the snapshot's version, not from 0.
    expect(mockEventStore.getByAggregateId).toHaveBeenLastCalledWith('group-1', snapshotCutoff + 1)
    expect(eventsAfterSnapshot.length).toBeLessThan(allEvents.length)
  })

  it('takes a new snapshot once enough events have been replayed since the last one', async () => {
    const events = buildGroupLifecycleEvents(120) // 132 events, over the 100-event threshold

    mockSnapshotStore.getLatest.mockResolvedValueOnce(null)
    mockEventStore.getByAggregateId.mockResolvedValueOnce(events)

    await rebuildProjection('group-1', 'Group', groupProjection)

    expect(mockSnapshotStore.save).toHaveBeenCalledTimes(1)
    const [aggregateId, aggregateType, version] = mockSnapshotStore.save.mock.calls[0]
    expect(aggregateId).toBe('group-1')
    expect(aggregateType).toBe('Group')
    expect(version).toBe(events[events.length - 1].metadata.version)
  })

  it('does not snapshot when the number of events since the last snapshot stays under the threshold', async () => {
    const events = buildGroupLifecycleEvents() // 12 events, well under the threshold

    mockSnapshotStore.getLatest.mockResolvedValueOnce(null)
    mockEventStore.getByAggregateId.mockResolvedValueOnce(events)

    await rebuildProjection('group-1', 'Group', groupProjection)

    expect(mockSnapshotStore.save).not.toHaveBeenCalled()
  })
})
