import { StoredEvent, EventType } from '../../src/events/types'

/**
 * Builds the event history for a real group lifecycle scenario: a group is
 * created, three members join, five contributions come in, one member
 * leaves, and two more contributions arrive after that. Optionally
 * appended with `extraContributions` more CONTRIBUTION_MADE events, to
 * simulate a long-lived group whose history keeps growing.
 */
export function buildGroupLifecycleEvents(extraContributions = 0): StoredEvent[] {
  const aggregateId = 'group-1'
  const aggregateType = 'Group'

  const events: Array<{ type: EventType; payload: Record<string, unknown> }> = [
    { type: 'GROUP_CREATED', payload: { name: 'Lagos Traders Circle' } },
    { type: 'MEMBER_JOINED', payload: { userId: 'user-1' } },
    { type: 'MEMBER_JOINED', payload: { userId: 'user-2' } },
    { type: 'MEMBER_JOINED', payload: { userId: 'user-3' } },
    { type: 'CONTRIBUTION_MADE', payload: { userId: 'user-1', amount: 100 } },
    { type: 'CONTRIBUTION_MADE', payload: { userId: 'user-2', amount: 100 } },
    { type: 'CONTRIBUTION_MADE', payload: { userId: 'user-3', amount: 100 } },
    { type: 'CONTRIBUTION_MADE', payload: { userId: 'user-1', amount: 150 } },
    { type: 'CONTRIBUTION_MADE', payload: { userId: 'user-2', amount: 150 } },
    { type: 'MEMBER_LEFT', payload: { userId: 'user-3' } },
    { type: 'CONTRIBUTION_MADE', payload: { userId: 'user-1', amount: 100 } },
    { type: 'CONTRIBUTION_MADE', payload: { userId: 'user-2', amount: 100 } },
  ]

  for (let i = 0; i < extraContributions; i++) {
    events.push({
      type: 'CONTRIBUTION_MADE',
      payload: { userId: i % 2 === 0 ? 'user-1' : 'user-2', amount: 50 },
    })
  }

  let sequenceNumber = 0
  let version = 0

  return events.map(({ type, payload }): StoredEvent => {
    version += 1
    sequenceNumber += 1
    return {
      id: `evt-${sequenceNumber}`,
      type,
      aggregateId,
      aggregateType,
      payload,
      metadata: { timestamp: new Date(2026, 0, 1, 0, 0, sequenceNumber).toISOString(), version },
      sequenceNumber,
      createdAt: new Date(2026, 0, 1, 0, 0, sequenceNumber),
    }
  })
}
