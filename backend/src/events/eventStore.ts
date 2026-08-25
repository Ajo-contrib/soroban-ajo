import { randomUUID } from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../config/database'
import { DomainEvent, StoredEvent, EventType } from './types'
import { logger } from '../utils/logger'
import { ConflictError } from '../errors/AppError'

export interface EventQueryOptions {
  contractAddress?: string
  tenantId?: string
  network?: string
}

export class EventStore {
  /**
   * Appends an event for an aggregate.
   *
   * `event.metadata.version` must be exactly one greater than the
   * aggregate's current latest version (0 for a brand-new aggregate). This
   * is the optimistic-concurrency check that keeps the event log gapless
   * and ordered per aggregate: without it, two concurrent writers reading
   * the same "current state" could both append using the same version
   * number, and replay would silently apply only one of them (or apply them
   * in an order that never actually happened), corrupting the projection.
   * The DB-level unique constraint on (aggregateId, version) is what
   * actually enforces this under a race; the check here just produces a
   * caller-friendly error instead of a raw Prisma error.
   */
  async append(event: Omit<DomainEvent, 'id'>): Promise<StoredEvent> {
    const id = randomUUID()

    try {
      const stored = await prisma.eventStore.create({
        data: {
          id,
          type: event.type,
          aggregateId: event.aggregateId,
          aggregateType: event.aggregateType,
          payload: event.payload as object,
          metadata: event.metadata as object,
          version: event.metadata.version,
        },
      })

      logger.info('Event appended', {
        id,
        type: event.type,
        aggregateId: event.aggregateId,
        contractAddress: event.metadata.contractAddress,
        tenantId: event.metadata.tenantId,
      })

      return {
        ...event,
        id,
        sequenceNumber: stored.sequenceNumber,
        createdAt: stored.createdAt,
      }
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictError(
          `Concurrent modification detected for aggregate ${event.aggregateId}: version ${event.metadata.version} was already written by another writer. Reload the aggregate and retry.`,
          { aggregateId: event.aggregateId, aggregateType: event.aggregateType, version: event.metadata.version }
        )
      }
      throw err
    }
  }

  /** Returns the version of the most recent event for an aggregate, or 0 if none exists. */
  async getLatestVersion(aggregateId: string, options?: EventQueryOptions): Promise<number> {
    if (!options?.contractAddress && !options?.tenantId && !options?.network) {
      const latest = await prisma.eventStore.findFirst({
        where: { aggregateId },
        orderBy: { version: 'desc' },
        select: { version: true },
      })
      return latest?.version ?? 0
    }

    const events = await this.getByAggregateId(aggregateId, 0, options)
    if (!events.length) return 0
    return Math.max(...events.map((e) => e.metadata.version))
  }

  async getByAggregateId(
    aggregateId: string,
    fromVersion = 0,
    options?: EventQueryOptions
  ): Promise<StoredEvent[]> {
    const events = await prisma.eventStore.findMany({
      where: { aggregateId, version: { gte: fromVersion } },
      orderBy: { sequenceNumber: 'asc' },
    })

    const stored = events.map(this.toStoredEvent)
    return this.filterByTenant(stored, options)
  }

  async getByType(
    type: EventType,
    limit = 100,
    options?: EventQueryOptions
  ): Promise<StoredEvent[]> {
    const events = await prisma.eventStore.findMany({
      where: { type },
      orderBy: { sequenceNumber: 'asc' },
      take: limit,
    })

    const stored = events.map(this.toStoredEvent)
    return this.filterByTenant(stored, options)
  }

  async getAll(
    fromSequence = 0,
    limit = 100,
    options?: EventQueryOptions
  ): Promise<StoredEvent[]> {
    const events = await prisma.eventStore.findMany({
      where: { sequenceNumber: { gt: fromSequence } },
      orderBy: { sequenceNumber: 'asc' },
      take: limit,
    })

    const stored = events.map(this.toStoredEvent)
    return this.filterByTenant(stored, options)
  }

  private filterByTenant(events: StoredEvent[], options?: EventQueryOptions): StoredEvent[] {
    if (!options) return events
    return events.filter((e) => {
      if (options.contractAddress && e.metadata.contractAddress !== options.contractAddress) {
        return false
      }
      if (options.tenantId && e.metadata.tenantId !== options.tenantId) {
        return false
      }
      if (options.network && e.metadata.network !== options.network) {
        return false
      }
      return true
    })
  }

  private toStoredEvent(raw: {
    id: string
    type: string
    aggregateId: string
    aggregateType: string
    payload: unknown
    metadata: unknown
    version: number
    sequenceNumber: number
    createdAt: Date
  }): StoredEvent {
    const meta = raw.metadata as {
      userId?: string
      timestamp: string
      version: number
      correlationId?: string
      contractAddress?: string
      tenantId?: string
      network?: string
    }
    return {
      id: raw.id,
      type: raw.type as EventType,
      aggregateId: raw.aggregateId,
      aggregateType: raw.aggregateType,
      payload: raw.payload as Record<string, unknown>,
      metadata: meta,
      sequenceNumber: raw.sequenceNumber,
      createdAt: raw.createdAt,
    }
  }
}

export const eventStore = new EventStore()
