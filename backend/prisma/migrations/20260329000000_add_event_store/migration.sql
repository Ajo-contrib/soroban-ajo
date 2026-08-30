-- CreateTable
CREATE TABLE "EventStore" (
    "id" TEXT NOT NULL,
    "sequenceNumber" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "metadata" JSONB NOT NULL,
    "version" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventStore_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventStore_aggregateId_idx" ON "EventStore"("aggregateId");

-- CreateIndex
CREATE INDEX "EventStore_type_idx" ON "EventStore"("type");

-- CreateIndex
CREATE INDEX "EventStore_sequenceNumber_idx" ON "EventStore"("sequenceNumber");

