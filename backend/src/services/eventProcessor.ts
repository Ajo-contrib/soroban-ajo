/**
 * eventProcessor.ts
 *
 * Two-mode event processor:
 *  - `process(rawEvent)` — original fire-and-forget path for backwards compatibility
 *    (used by legacy callers; idempotency is delegated to the individual handlers).
 *  - `parseOnly(rawEvent)` — parse without side effects, used by BlockchainListener
 *    before starting the outer DB transaction.
 *  - `processWithTx(tx, parsedEvent)` — execute all domain side effects inside the
 *    caller's Prisma transaction so they commit atomically with the dedup record
 *    and the checkpoint advance.
 */
import { prisma } from '../config/database'
import { createModuleLogger } from '../utils/logger'
import { parseContractEvent, ParsedContractEvent } from '../utils/eventParser'
import {
  handleGroupCreated,
  handleMemberJoined,
  handleContributionMade,
  handlePayoutExecuted,
  handleGroupCompleted,
  handleCycleAdvanced,
} from '../handlers/contractEventHandlers'

const logger = createModuleLogger('EventProcessor')

type PrismaTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

export class EventProcessor {
  // ── Parse only (no side effects) ──────────────────────────────────────────

  /**
   * Parses a raw on-chain event into a typed `ParsedContractEvent` without
   * executing any side effects.  Used by `BlockchainListener` to determine
   * the event type before opening a DB transaction.
   */
  parseOnly(rawEvent: unknown): ParsedContractEvent {
    return parseContractEvent(rawEvent)
  }

  // ── Transactional processing (used by BlockchainListener) ─────────────────

  /**
   * Executes all domain side effects for a pre-parsed event inside the
   * supplied Prisma transaction.  The caller (BlockchainListener) is
   * responsible for:
   *   1. Inserting the `ProcessedBlockchainEvent` dedup record (before this call).
   *   2. Advancing the `ListenerCheckpoint` (after this call).
   * All three writes share the same transaction and commit atomically.
   *
   * Note: handlers that dispatch notifications or webhook calls outside the
   * DB (e.g. `notificationService.sendToUser`) are intentionally kept
   * outside the Prisma transaction to avoid holding open a DB connection
   * for the duration of external network calls.  The DB-side writes (upserts,
   * inserts) must be passed the `tx` client; notifications are best-effort
   * and fire after the transaction commits.
   */
  async processWithTx(tx: PrismaTx, event: ParsedContractEvent): Promise<void> {
    logger.debug('Processing event (transactional)', { type: event.type, groupId: event.groupId })

    try {
      switch (event.type) {
        case 'GroupCreated':
          await handleGroupCreated(event, tx)
          break
        case 'MemberJoined':
          await handleMemberJoined(event, tx)
          break
        case 'ContributionMade':
          await handleContributionMade(event, tx)
          break
        case 'PayoutExecuted':
          await handlePayoutExecuted(event, tx)
          break
        case 'GroupCompleted':
          await handleGroupCompleted(event, tx)
          break
        case 'CycleAdvanced':
          await handleCycleAdvanced(event, tx)
          break
        default:
          logger.debug('Unhandled event type', { type: event.type })
      }
    } catch (err) {
      logger.error('Failed to process event in transaction', {
        type: event.type,
        groupId: event.groupId,
        err,
      })
      throw err
    }
  }

  // ── Legacy fire-and-forget path (backwards compatibility) ──────────────────

  /**
   * Original process method — parses and dispatches an event without a
   * wrapping transaction.  Kept for any callers outside BlockchainListener
   * (e.g. manual admin replay routes, tests).  Each handler retains its own
   * idempotency guards.
   */
  async process(rawEvent: unknown): Promise<void> {
    const event = this.parseOnly(rawEvent)

    logger.debug('Processing event', { type: event.type, groupId: event.groupId })

    try {
      switch (event.type) {
        case 'GroupCreated':
          await handleGroupCreated(event)
          break
        case 'MemberJoined':
          await handleMemberJoined(event)
          break
        case 'ContributionMade':
          await handleContributionMade(event)
          break
        case 'PayoutExecuted':
          await handlePayoutExecuted(event)
          break
        case 'GroupCompleted':
          await handleGroupCompleted(event)
          break
        case 'CycleAdvanced':
          await handleCycleAdvanced(event)
          break
        default:
          logger.debug('Unhandled event type', { type: event.type })
      }
    } catch (err) {
      logger.error('Failed to process event', { type: event.type, groupId: event.groupId, err })
      throw err
    }
  }
}

export const eventProcessor = new EventProcessor()
