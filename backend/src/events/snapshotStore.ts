import { prisma } from '../config/database'
import { logger } from '../utils/logger'

export interface StoredSnapshot<T> {
  version: number
  state: T
}

/**
 * Stores one snapshot per aggregate (upserted in place, not versioned
 * history) so replay can resume from `version` instead of processing the
 * aggregate's full event history from genesis.
 */
export class SnapshotStore {
  async save<T>(aggregateId: string, aggregateType: string, version: number, state: T): Promise<void> {
    await prisma.snapshot.upsert({
      where: { aggregateId },
      create: { aggregateId, aggregateType, version, state: state as object },
      update: { version, state: state as object },
    })

    logger.info('Snapshot saved', { aggregateId, aggregateType, version })
  }

  async getLatest<T>(aggregateId: string): Promise<StoredSnapshot<T> | null> {
    const snapshot = await prisma.snapshot.findUnique({ where: { aggregateId } })
    if (!snapshot) return null

    return { version: snapshot.version, state: snapshot.state as T }
  }
}

export const snapshotStore = new SnapshotStore()
