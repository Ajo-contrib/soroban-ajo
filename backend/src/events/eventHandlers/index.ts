import { EventType, EventHandler, DomainEvent } from '../types'
import { groupEventHandler } from './groupEventHandler'
import { contributionEventHandler } from './contributionEventHandler'
import { logger } from '../../utils/logger'

const handlerMap: Partial<Record<EventType, EventHandler[]>> = {
  GROUP_CREATED: [groupEventHandler],
  GROUP_UPDATED: [groupEventHandler],
  MEMBER_JOINED: [groupEventHandler],
  MEMBER_LEFT: [groupEventHandler],
  CONTRIBUTION_MADE: [contributionEventHandler],
  PAYOUT_PROCESSED: [contributionEventHandler],
}

export async function dispatchEvent(event: DomainEvent): Promise<void> {
  const handlers = handlerMap[event.type] ?? []
  await Promise.all(
    handlers.map((h) =>
      h(event).catch((err) => logger.error('Event handler error', { type: event.type, err }))
    )
  )
}

export { groupEventHandler, contributionEventHandler }
