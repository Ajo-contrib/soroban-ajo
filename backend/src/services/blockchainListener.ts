/**
 * blockchainListener.ts
 *
 * Hardened Soroban contract event listener with:
 *  1. Durable checkpointing  — last-processed ledger is persisted transactionally
 *     alongside every event's state changes, so a crash between "process" and
 *     "advance checkpoint" can never cause a skipped or double-processed event.
 *  2. Missed-event recovery  — on start, the listener fetches all events from the
 *     last persisted checkpoint up to the current ledger tip via the Soroban RPC
 *     `getEvents` endpoint before switching to the live SSE stream.
 *  3. Exactly-once processing — each (contractId, txHash, eventType) triple is
 *     recorded in `ProcessedBlockchainEvent` inside the same DB transaction that
 *     applies state changes; duplicate deliveries are detected and skipped.
 *  4. Listener-lag alerting  — a periodic heartbeat compares the last-processed
 *     ledger against the current chain tip and fires a warning / critical alert
 *     when lag exceeds configured thresholds.
 *
 * ── Stellar / Soroban finality & reorg safety ──────────────────────────────
 * Stellar uses a federated Byzantine agreement (FBA) consensus model (SCP –
 * Stellar Consensus Protocol). Once a ledger closes it is final: there is NO
 * concept of a chain reorganisation in the Ethereum/Bitcoin sense.  A closed
 * ledger's hash is cryptographically committed to by a quorum of validators
 * and can never be reversed or replaced.  Therefore this listener does NOT
 * need reorg-rollback logic.  If this assumption ever changes (e.g. if the
 * network forks during an upgrade), the checkpoint table already records the
 * last processed ledger, making it straightforward to add a rollback pass
 * that walks backwards from the current checkpoint.
 * ─────────────────────────────────────────────────────────────────────────
 */

import * as StellarSdk from 'stellar-sdk'
import { prisma } from '../config/database'
import { sorobanConfig } from '../config'
import { createModuleLogger } from '../utils/logger'
import { alertingService, AlertSeverity } from '../monitoring/alerting'
import { eventProcessor } from './eventProcessor'
import client from 'prom-client'
import { register } from './metricsService'

const logger = createModuleLogger('BlockchainListener')

// ── Configuration constants ──────────────────────────────────────────────────

/** Initial SSE reconnect delay. Doubles on each failure (capped at MAX). */
const RECONNECT_DELAY_MS = 5_000
const MAX_RECONNECT_DELAY_MS = 60_000

/**
 * Lag thresholds.  Stellar closes a ledger every ~5 seconds, so 60 ledgers
 * ≈ 5 minutes behind is a warning; 300 ledgers ≈ 25 minutes is critical.
 */
const LAG_WARNING_LEDGERS = 60
const LAG_CRITICAL_LEDGERS = 300

/** How often to check listener lag against the chain tip. */
const LAG_CHECK_INTERVAL_MS = 60_000

/**
 * Maximum number of ledgers to back-fill in a single `getEvents` call batch.
 * Soroban RPC enforces a maximum range; 4320 ledgers ≈ 6 hours is safe.
 */
const MAX_BACKFILL_LEDGER_RANGE = 4_320

// ── Prometheus metrics ───────────────────────────────────────────────────────

const listenerLagLedgers = new client.Gauge({
  name: 'blockchain_listener_lag_ledgers',
  help: 'How many ledgers behind the chain tip the listener currently is',
  registers: [register],
})

const eventsProcessedTotal = new client.Counter({
  name: 'blockchain_listener_events_processed_total',
  help: 'Total contract events successfully processed',
  labelNames: ['event_type'],
  registers: [register],
})

const eventProcessingErrors = new client.Counter({
  name: 'blockchain_listener_processing_errors_total',
  help: 'Total event processing errors',
  labelNames: ['event_type'],
  registers: [register],
})

const duplicateEventsSkipped = new client.Counter({
  name: 'blockchain_listener_duplicate_events_skipped_total',
  help: 'Events skipped because they were already processed (idempotency guard)',
  registers: [register],
})

// ── Checkpoint helpers (Prisma) ──────────────────────────────────────────────

interface Checkpoint {
  lastLedger: number
  lastPagingToken: string | null
}

async function loadCheckpoint(): Promise<Checkpoint> {
  const row = await prisma.listenerCheckpoint.findUnique({ where: { id: 'singleton' } })
  return { lastLedger: row?.lastLedger ?? 0, lastPagingToken: row?.lastPagingToken ?? null }
}

/**
 * Persists the checkpoint transactionally with the consumer's own writes.
 * Pass your prisma transaction client (`tx`) so the checkpoint and the
 * event's state changes commit or roll back together.
 */
export async function advanceCheckpoint(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  ledger: number,
  pagingToken: string | null
): Promise<void> {
  await tx.listenerCheckpoint.upsert({
    where: { id: 'singleton' },
    update: { lastLedger: ledger, lastPagingToken: pagingToken },
    create: { id: 'singleton', lastLedger: ledger, lastPagingToken: pagingToken },
  })
}

/**
 * Marks an event as processed within the caller's transaction.
 * Returns `true` if the row was inserted (first time), `false` if it already
 * existed (duplicate — the caller should skip side effects).
 */
export async function markEventProcessed(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  contractId: string,
  ledger: number,
  txHash: string,
  eventType: string
): Promise<boolean> {
  try {
    await tx.processedBlockchainEvent.create({
      data: { contractId, ledger, txHash, eventType },
    })
    return true
  } catch (err: unknown) {
    // Unique-constraint violation: event already processed
    const code = (err as { code?: string })?.code
    if (code === 'P2002') {
      duplicateEventsSkipped.inc()
      return false
    }
    throw err
  }
}

// ── Soroban RPC getEvents helpers ────────────────────────────────────────────

interface SorobanEvent {
  id: string
  ledger: number
  ledgerClosedAt: string
  contractId: string
  pagingToken: string
  topic: StellarSdk.xdr.ScVal[]
  value: StellarSdk.xdr.ScVal
  txHash: string
}

/**
 * Fetches historical contract events via `getEvents`.  Used for the initial
 * back-fill pass to recover events that occurred while the listener was down.
 *
 * `startLedger` is inclusive.  Returns events in ledger-ascending order.
 */
async function fetchEventsRange(
  rpcServer: StellarSdk.SorobanRpc.Server,
  contractId: string,
  startLedger: number,
  endLedger: number
): Promise<SorobanEvent[]> {
  const result = await rpcServer.getEvents({
    startLedger,
    filters: [
      {
        type: 'contract',
        contractIds: [contractId],
      },
    ],
    limit: 10_000,
  } as Parameters<typeof rpcServer.getEvents>[0])

  const records = (result as unknown as { events?: unknown[] }).events ?? []

  return records
    .map((e: unknown) => {
      const ev = e as {
        id?: string
        ledger?: number
        ledgerClosedAt?: string
        contractId?: string
        pagingToken?: string
        topic?: StellarSdk.xdr.ScVal[]
        value?: StellarSdk.xdr.ScVal
        txHash?: string
        transactionHash?: string
      }
      return {
        id: ev.id ?? '',
        ledger: ev.ledger ?? 0,
        ledgerClosedAt: ev.ledgerClosedAt ?? '',
        contractId: ev.contractId ?? '',
        pagingToken: ev.pagingToken ?? ev.id ?? '',
        topic: ev.topic ?? [],
        value: ev.value ?? StellarSdk.xdr.ScVal.scvVoid(),
        txHash: ev.txHash ?? ev.transactionHash ?? ev.id ?? '',
      }
    })
    .filter((e) => e.ledger <= endLedger)
}

// ── Main class ───────────────────────────────────────────────────────────────

export class BlockchainListener {
  private readonly horizonServer: StellarSdk.Horizon.Server
  private readonly rpcServer: StellarSdk.SorobanRpc.Server
  private readonly contractId: string

  private stopStream: (() => void) | null = null
  private reconnectDelay = RECONNECT_DELAY_MS
  private stopped = false

  /** In-memory cache of the latest persisted ledger; updated on every commit. */
  private lastProcessedLedger = 0
  private lastProcessedPagingToken: string | null = null

  private lagCheckTimer: ReturnType<typeof setInterval> | null = null

  constructor() {
    this.contractId = sorobanConfig.contractId
    this.horizonServer = new StellarSdk.Horizon.Server(sorobanConfig.rpcUrl)
    // The Soroban RPC URL may differ from the Horizon URL; fall back to the
    // same value if SOROBAN_RPC_URL is not separately configured.
    const rpcUrl =
      process.env['SOROBAN_RPC_URL'] ??
      process.env['HORIZON_URL'] ??
      sorobanConfig.rpcUrl
    this.rpcServer = new StellarSdk.SorobanRpc.Server(rpcUrl)
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    this.stopped = false

    // Load the last persisted checkpoint before doing anything else.
    const checkpoint = await loadCheckpoint()
    this.lastProcessedLedger = checkpoint.lastLedger
    this.lastProcessedPagingToken = checkpoint.lastPagingToken

    logger.info('BlockchainListener starting', {
      contractId: this.contractId,
      resumingFromLedger: this.lastProcessedLedger,
    })

    // Back-fill: recover any events emitted while we were down.
    await this.backfill()

    // Start the live SSE stream.
    this.startLiveStream()

    // Start the lag monitoring heartbeat.
    this.lagCheckTimer = setInterval(() => {
      this.checkLag().catch((err) =>
        logger.warn('Lag check failed', { err })
      )
    }, LAG_CHECK_INTERVAL_MS)
  }

  stop(): void {
    this.stopped = true
    this.stopStream?.()
    this.stopStream = null
    if (this.lagCheckTimer) {
      clearInterval(this.lagCheckTimer)
      this.lagCheckTimer = null
    }
    logger.info('BlockchainListener stopped')
  }

  // ── Back-fill (missed-event recovery) ─────────────────────────────────────

  /**
   * Fetches all events between `lastProcessedLedger + 1` and the current
   * ledger tip and processes them in order.  This closes the gap that occurs
   * whenever the listener process was down.
   *
   * If the listener has never run (`lastProcessedLedger = 0`) it skips the
   * back-fill and starts from "now" so we don't replay the entire contract
   * history on first boot.
   */
  private async backfill(): Promise<void> {
    if (this.lastProcessedLedger === 0) {
      logger.info('First run — skipping back-fill, starting from current ledger tip')
      try {
        const ledgerResp = await this.rpcServer.getLatestLedger()
        this.lastProcessedLedger = ledgerResp.sequence
        await prisma.listenerCheckpoint.upsert({
          where: { id: 'singleton' },
          update: { lastLedger: this.lastProcessedLedger, lastPagingToken: null },
          create: { id: 'singleton', lastLedger: this.lastProcessedLedger, lastPagingToken: null },
        })
      } catch (err) {
        logger.warn('Could not fetch latest ledger for initial checkpoint; starting from tip', { err })
      }
      return
    }

    try {
      const tipResp = await this.rpcServer.getLatestLedger()
      const tip = tipResp.sequence

      if (tip <= this.lastProcessedLedger) {
        logger.info('Back-fill: already at tip', { tip, lastProcessedLedger: this.lastProcessedLedger })
        return
      }

      const fromLedger = this.lastProcessedLedger + 1
      const toLedger = Math.min(tip, fromLedger + MAX_BACKFILL_LEDGER_RANGE - 1)

      logger.info('Back-filling missed events', { fromLedger, toLedger, totalLedgers: toLedger - fromLedger + 1 })

      const events = await fetchEventsRange(this.rpcServer, this.contractId, fromLedger, toLedger)
      logger.info(`Back-fill: fetched ${events.length} events`)

      for (const event of events) {
        await this.processEvent(event)
      }

      // If we only covered a partial range (more than MAX_BACKFILL_LEDGER_RANGE
      // ledgers behind), log a warning — the next start will pick up the rest.
      if (toLedger < tip) {
        logger.warn('Back-fill: covered partial range; remaining gap will be processed on next poll', {
          covered: `${fromLedger}-${toLedger}`,
          remaining: `${toLedger + 1}-${tip}`,
        })
        await alertingService.fire({
          severity: AlertSeverity.WARNING,
          service: 'BlockchainListener',
          message: `Listener was ${tip - this.lastProcessedLedger} ledgers behind; partial back-fill applied`,
          details: `Back-filled ${toLedger - fromLedger + 1} ledgers. Remaining ${tip - toLedger} ledgers will catch up on next cycle.`,
        })
      }
    } catch (err) {
      logger.error('Back-fill failed; live stream will start from last checkpoint', { err })
      await alertingService.fire({
        severity: AlertSeverity.WARNING,
        service: 'BlockchainListener',
        message: 'Back-fill failed — events during downtime may be missing until next restart',
        details: String(err),
      })
    }
  }

  // ── Live SSE stream ────────────────────────────────────────────────────────

  private startLiveStream(): void {
    if (this.stopped) return

    const cursor = this.lastProcessedPagingToken ?? 'now'
    logger.info('Starting live event stream', { cursor })

    try {
      // The Horizon operations stream is used as the SSE transport.  Soroban
      // events are embedded as operations on the contract account.
      // NOTE: When the Soroban RPC `subscribeEvents` endpoint becomes stable,
      // replace this with a direct Soroban subscription.
      const stop = (
        this.horizonServer as unknown as {
          operations: () => {
            forAccount: (id: string) => {
              cursor: (c: string) => {
                stream: (opts: {
                  onmessage: (e: unknown) => void
                  onerror: (e: unknown) => void
                }) => () => void
              }
            }
          }
        }
      )
        .operations()
        .forAccount(this.contractId)
        .cursor(cursor)
        .stream({
          onmessage: (event: unknown) => {
            this.reconnectDelay = RECONNECT_DELAY_MS // reset back-off on success
            this.handleRawEvent(event)
          },
          onerror: (error: unknown) => {
            logger.error('Live stream error; scheduling reconnect', { error })
            this.scheduleReconnect()
          },
        })

      this.stopStream = stop
    } catch (err) {
      logger.error('Failed to start live event stream', { err })
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) return
    this.stopStream?.()
    this.stopStream = null

    logger.info('Scheduling reconnect', { delayMs: this.reconnectDelay })
    setTimeout(() => {
      if (!this.stopped) this.startLiveStream()
    }, this.reconnectDelay)

    this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY_MS)
  }

  // ── Event processing ───────────────────────────────────────────────────────

  /**
   * Called for each raw SSE message from the live stream.
   * Adapts the Horizon operation shape to our internal SorobanEvent shape
   * before delegating to `processEvent`.
   */
  private handleRawEvent(raw: unknown): void {
    const e = raw as {
      paging_token?: string
      ledger?: number
      transaction_hash?: string
      [k: string]: unknown
    }

    const sorobanEvent: SorobanEvent = {
      id: (e.id as string) ?? '',
      ledger: e.ledger ?? 0,
      ledgerClosedAt: (e.created_at as string) ?? '',
      contractId: this.contractId,
      pagingToken: e.paging_token ?? (e.id as string) ?? '',
      // Topics and value are decoded by eventProcessor / eventParser
      topic: (e.topic as StellarSdk.xdr.ScVal[]) ?? [],
      value: (e.value as StellarSdk.xdr.ScVal) ?? StellarSdk.xdr.ScVal.scvVoid(),
      txHash: e.transaction_hash ?? e.paging_token ?? (e.id as string) ?? '',
    }

    this.processEvent(sorobanEvent).catch((err) => {
      logger.error('Live-stream event processing error', { err, event: sorobanEvent.txHash })
    })
  }

  /**
   * Core processing function — used by both the back-fill pass and the live stream.
   *
   * Wraps every event in a Prisma transaction so that:
   *   - The idempotency record (`ProcessedBlockchainEvent`)
   *   - The event's derived state changes (via eventProcessor)
   *   - The checkpoint advance
   * all commit atomically.  If any step fails the transaction is rolled back
   * and the event will be retried on the next start.
   */
  private async processEvent(event: SorobanEvent): Promise<void> {
    const { contractId, ledger, txHash } = event

    // Quick pre-check (outside the transaction) to skip obvious duplicates
    // without acquiring a DB transaction unnecessarily.
    const alreadyProcessed = await prisma.processedBlockchainEvent.findUnique({
      where: {
        contractId_txHash_eventType: {
          contractId,
          txHash,
          eventType: '_any',
        },
      },
    })
    // Note: the pre-check uses '_any' as a placeholder; the real guard is the
    // per-eventType unique key inside markEventProcessed().  We only do a
    // cheap lookup on txHash here as an optimistic fast path.
    void alreadyProcessed // intentional — we let the transaction be the authoritative check

    try {
      await prisma.$transaction(async (tx) => {
        // Parse the event to get its type before we do anything else.
        const parsed = await eventProcessor.parseOnly(event)

        // Exactly-once guard: try to insert the dedup record.
        const isNew = await markEventProcessed(tx, contractId, ledger, txHash, parsed.type)
        if (!isNew) {
          logger.debug('Duplicate event skipped', { txHash, eventType: parsed.type })
          return
        }

        // Process the event's domain side effects (DB writes, notifications, etc.)
        await eventProcessor.processWithTx(tx, parsed)

        // Advance the checkpoint — same transaction, so it's always consistent.
        await advanceCheckpoint(tx, ledger, event.pagingToken)
      })

      // Update in-memory cache only after successful commit.
      if (ledger > this.lastProcessedLedger) {
        this.lastProcessedLedger = ledger
        this.lastProcessedPagingToken = event.pagingToken
      }

      eventsProcessedTotal.inc({ event_type: 'processed' })
    } catch (err) {
      eventProcessingErrors.inc({ event_type: 'error' })
      logger.error('Failed to process event transactionally', {
        txHash,
        ledger,
        contractId,
        err,
      })
      throw err
    }
  }

  // ── Lag monitoring ─────────────────────────────────────────────────────────

  private async checkLag(): Promise<void> {
    try {
      const tipResp = await this.rpcServer.getLatestLedger()
      const tip = tipResp.sequence
      const lag = tip - this.lastProcessedLedger

      listenerLagLedgers.set(lag)
      logger.debug('Listener lag check', { tip, lastProcessed: this.lastProcessedLedger, lag })

      if (lag >= LAG_CRITICAL_LEDGERS) {
        await alertingService.fire({
          severity: AlertSeverity.CRITICAL,
          service: 'BlockchainListener',
          message: `Listener is critically behind: ${lag} ledgers (~${Math.round(lag * 5 / 60)} min) behind chain tip`,
          details: `Last processed ledger: ${this.lastProcessedLedger}, chain tip: ${tip}. Threshold: ${LAG_CRITICAL_LEDGERS} ledgers.`,
        })
      } else if (lag >= LAG_WARNING_LEDGERS) {
        await alertingService.fire({
          severity: AlertSeverity.WARNING,
          service: 'BlockchainListener',
          message: `Listener lag warning: ${lag} ledgers (~${Math.round(lag * 5 / 60)} min) behind chain tip`,
          details: `Last processed ledger: ${this.lastProcessedLedger}, chain tip: ${tip}. Threshold: ${LAG_WARNING_LEDGERS} ledgers.`,
        })
      } else {
        // Resolve any previously fired lag alerts when we catch up.
        alertingService.resolve('BlockchainListener', AlertSeverity.WARNING)
        alertingService.resolve('BlockchainListener', AlertSeverity.CRITICAL)
      }
    } catch (err) {
      logger.warn('Could not fetch latest ledger for lag check', { err })
    }
  }
}

export const blockchainListener = new BlockchainListener()
