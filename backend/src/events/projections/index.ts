import { StoredEvent, Projection } from '../types'
import { groupProjection, GroupState } from './groupProjection'
import { eventStore } from '../eventStore'
import { snapshotStore } from '../snapshotStore'

/** Events accumulated since the last snapshot before a new one is taken. */
const SNAPSHOT_INTERVAL = 100

/**
 * Rebuilds an aggregate's projected state from its event stream.
 *
 * If a snapshot exists, replay resumes from the snapshot's state and only
 * processes events appended after it — this is what keeps replay cost
 * bounded for long-lived aggregates instead of always reprocessing the
 * full history from genesis. Falls back to a full replay when no snapshot
 * exists yet.
 */
export async function rebuildProjection<T>(
  aggregateId: string,
  aggregateType: string,
  projection: Projection<T>
): Promise<T> {
  const snapshot = await snapshotStore.getLatest<T>(aggregateId)
  const fromVersion = snapshot ? snapshot.version + 1 : 0
  const initialState = snapshot ? snapshot.state : projection.initialState

  const events = await eventStore.getByAggregateId(aggregateId, fromVersion)
  const state = events.reduce(projection.apply.bind(projection), initialState)

  if (events.length >= SNAPSHOT_INTERVAL) {
    const latestVersion = events[events.length - 1].metadata.version
    await snapshotStore.save(aggregateId, aggregateType, latestVersion, state)
  }

  return state
}

export async function rebuildGroupState(groupId: string): Promise<GroupState | null> {
  return rebuildProjection(groupId, 'Group', groupProjection)
}

export { groupProjection }
