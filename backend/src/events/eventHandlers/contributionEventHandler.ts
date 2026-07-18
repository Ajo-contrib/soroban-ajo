import { DomainEvent, EventHandler } from '../types'
import { logger } from '../../utils/logger'

export const contributionEventHandler: EventHandler = async (event: DomainEvent) => {
  switch (event.type) {
    case 'CONTRIBUTION_MADE':
      logger.info('Contribution made event', { groupId: event.aggregateId, payload: event.payload })
      break
    case 'PAYOUT_PROCESSED':
      logger.info('Payout processed event', { groupId: event.aggregateId, payload: event.payload })
      break
    default:
      break
  }
}
