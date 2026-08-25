export type EventType =
  | 'GROUP_CREATED'
  | 'GROUP_UPDATED'
  | 'MEMBER_JOINED'
  | 'MEMBER_LEFT'
  | 'CONTRIBUTION_MADE'
  | 'PAYOUT_PROCESSED'
  | 'DISPUTE_FILED'
  | 'DISPUTE_RESOLVED'
  | 'USER_REGISTERED'

export interface DomainEvent<T = Record<string, unknown>> {
  id: string
  type: EventType
  aggregateId: string
  aggregateType: string
  payload: T
  metadata: {
    userId?: string
    timestamp: string
    version: number
    correlationId?: string
    contractAddress?: string
    tenantId?: string
    network?: string
  }
}

export interface StoredEvent extends DomainEvent {
  sequenceNumber: number
  createdAt: Date
}

export type EventHandler<T = Record<string, unknown>> = (event: DomainEvent<T>) => Promise<void>

export interface Projection<TState> {
  name: string
  initialState: TState
  apply(state: TState, event: StoredEvent): TState
}
