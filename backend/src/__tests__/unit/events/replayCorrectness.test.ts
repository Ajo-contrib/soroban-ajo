import { groupProjection, GroupState } from '../../../events/projections/groupProjection'
import { buildGroupLifecycleEvents } from '../../../../tests/fixtures/eventLifecycle'

describe('Event replay correctness', () => {
  it('produces identical aggregate state whether the history is replayed in bulk or applied incrementally as events arrive', () => {
    const events = buildGroupLifecycleEvents()

    // Full replay: what rebuildProjection does — reduce over the entire
    // history at once, as if reconstructing state from scratch after a
    // crash or on a fresh read model.
    const fullReplayState = events.reduce<GroupState | null>(
      (state, event) => groupProjection.apply(state, event),
      groupProjection.initialState
    )

    // Incremental processing: apply one event at a time as it "arrives
    // live", carrying the running state forward — what the system
    // actually does in production as events are appended one by one.
    let incrementalState: GroupState | null = groupProjection.initialState
    for (const event of events) {
      incrementalState = groupProjection.apply(incrementalState, event)
    }

    expect(incrementalState).toEqual(fullReplayState)

    // Pin the actual expected business result so a bug in the reducer
    // (wrong math, wrong member counting) fails this test even though
    // "incremental === full replay" would still trivially hold.
    expect(fullReplayState).toEqual<GroupState>({
      id: 'group-1',
      name: 'Lagos Traders Circle',
      memberCount: 2, // 3 joined, 1 left
      totalContributions: 800, // 100+100+100+150+150+100+100
      status: 'active',
      version: 12,
    })
  })

  it('replaying only a prefix of the history and continuing from that point matches replaying the full history in one pass', () => {
    // This is the property snapshot-based replay depends on: apply(state, events[0..n])
    // followed by apply(result, events[n..end]) must equal apply(initialState, events[0..end]).
    const events = buildGroupLifecycleEvents()
    const splitPoint = 6

    const fullReplayState = events.reduce<GroupState | null>(
      (state, event) => groupProjection.apply(state, event),
      groupProjection.initialState
    )

    const partialState = events
      .slice(0, splitPoint)
      .reduce<GroupState | null>((state, event) => groupProjection.apply(state, event), groupProjection.initialState)

    const resumedState = events
      .slice(splitPoint)
      .reduce<GroupState | null>((state, event) => groupProjection.apply(state, event), partialState)

    expect(resumedState).toEqual(fullReplayState)
  })
})
