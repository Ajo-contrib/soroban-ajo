import { Projection, StoredEvent, assertUnhandledEventType } from '../types'

export interface GroupState {
  id: string
  name: string
  memberCount: number
  totalContributions: number
  status: 'active' | 'inactive'
  version: number
}

export const groupProjection: Projection<GroupState | null> = {
  name: 'GroupProjection',
  initialState: null,

  apply(state: GroupState | null, event: StoredEvent): GroupState | null {
    const base = state ?? {
      id: event.aggregateId,
      name: '',
      memberCount: 0,
      totalContributions: 0,
      status: 'active' as const,
      version: 0,
    }

    switch (event.type) {
      case 'GROUP_CREATED':
        return {
          ...base,
          id: event.aggregateId,
          name: (event.payload as { name: string }).name ?? '',
          status: 'active',
          version: event.metadata.version,
        }
      case 'MEMBER_JOINED':
        return { ...base, memberCount: base.memberCount + 1, version: event.metadata.version }
      case 'MEMBER_LEFT':
        return { ...base, memberCount: Math.max(0, base.memberCount - 1), version: event.metadata.version }
      case 'CONTRIBUTION_MADE':
        return {
          ...base,
          totalContributions: base.totalContributions + ((event.payload as { amount: number }).amount ?? 0),
          version: event.metadata.version,
        }
      // These event types don't currently affect GroupState. They're listed
      // explicitly (rather than falling through a `default`) so that adding
      // a new EventType without updating this switch is a compile error via
      // assertUnhandledEventType, instead of a silently under-applied
      // projection.
      case 'GROUP_UPDATED':
      case 'PAYOUT_PROCESSED':
      case 'DISPUTE_FILED':
      case 'DISPUTE_RESOLVED':
      case 'USER_REGISTERED':
        return base
      default:
        return assertUnhandledEventType(event.type)
    }
  },
}
