import { DomainEvent, EventHandler } from '../types'
import { logger } from '../../utils/logger'

export const groupEventHandler: EventHandler = async (event: DomainEvent) => {
  switch (event.type) {
    case 'GROUP_CREATED':
      logger.info('Group created event', { groupId: event.aggregateId, payload: event.payload })
      break
    case 'GROUP_UPDATED':
      logger.info('Group updated event', { groupId: event.aggregateId, payload: event.payload })
      break
    case 'MEMBER_JOINED':
      logger.info('Member joined event', { groupId: event.aggregateId, payload: event.payload })
      break
    case 'MEMBER_LEFT':
      logger.info('Member left event', { groupId: event.aggregateId, payload: event.payload })
      break
    default:
      break
  }
}
