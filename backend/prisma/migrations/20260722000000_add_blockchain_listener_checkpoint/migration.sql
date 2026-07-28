-- Migration: Add blockchain listener checkpoint and processed event dedup tables
-- These two tables together implement durable checkpointing + exactly-once processing
-- for the Soroban contract event listener.

-- Persists the last successfully processed ledger sequence number so the
-- listener resumes from the right place after a crash or restart instead
-- of restarting from "now" and silently missing all events that occurred
-- during the outage.
CREATE TABLE "ListenerCheckpoint" (
    "id"              TEXT NOT NULL DEFAULT 'singleton',
    "lastLedger"      INTEGER NOT NULL DEFAULT 0,
    "lastPagingToken" TEXT,
    "updatedAt"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ListenerCheckpoint_pkey" PRIMARY KEY ("id")
);

-- One row per (contractId, ledger, txHash, eventType) tuple.
-- The listener inserts this row inside the same DB transaction that applies
-- the event's state changes and advances the checkpoint. A crash between
-- "process" and "commit" leaves no row here, so the event is re-processed
-- harmlessly on the next start. A crash after commit leaves the row, so
-- any repeat delivery is detected and skipped.
CREATE TABLE "ProcessedBlockchainEvent" (
    "id"          TEXT NOT NULL,
    "contractId"  TEXT NOT NULL,
    "ledger"      INTEGER NOT NULL,
    "txHash"      TEXT NOT NULL,
    "eventType"   TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedBlockchainEvent_pkey" PRIMARY KEY ("id")
);

-- Unique guard: same event from the same contract cannot be processed twice.
CREATE UNIQUE INDEX "ProcessedBlockchainEvent_contractId_txHash_eventType_key"
    ON "ProcessedBlockchainEvent"("contractId", "txHash", "eventType");

-- Fast existence check on hot path.
CREATE INDEX "ProcessedBlockchainEvent_contractId_ledger_idx"
    ON "ProcessedBlockchainEvent"("contractId", "ledger");
