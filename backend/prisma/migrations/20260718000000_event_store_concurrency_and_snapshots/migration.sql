-- Migration: event_store_concurrency_and_snapshots (Issue: event-sourcing consistency audit)
--
-- 1) Enforces optimistic concurrency on EventStore: two writers can no
--    longer append the same (aggregateId, version) pair, which previously
--    allowed the event log for an aggregate to develop ambiguous/duplicate
--    versions under concurrent writes.
-- 2) Adds Snapshot, one row per aggregate, so replay can resume from a
--    known state instead of always processing the full event history from
--    genesis.

-- CreateTable
CREATE TABLE "Snapshot" (
    "aggregateId" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "state" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Snapshot_pkey" PRIMARY KEY ("aggregateId")
);

-- CreateIndex
CREATE INDEX "Snapshot_aggregateType_idx" ON "Snapshot"("aggregateType");

-- CreateIndex
CREATE UNIQUE INDEX "EventStore_aggregateId_version_key" ON "EventStore"("aggregateId", "version");
