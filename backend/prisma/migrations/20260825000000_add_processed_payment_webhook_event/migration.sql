-- Migration: Add ProcessedPaymentWebhookEvent for payment webhook idempotency
--
-- Payment providers (Stripe, PayPal, ...) document at-least-once webhook
-- delivery: the same event can be redelivered and must be deduped by the
-- receiver. This table is the durable "already processed" record, inserted
-- inside the same DB transaction as the payment side effects it guards, so
-- a duplicate delivery hits the unique constraint and is skipped instead of
-- racing a plain check-then-act read against another in-flight delivery of
-- the same event.
CREATE TABLE "ProcessedPaymentWebhookEvent" (
    "id"          TEXT NOT NULL,
    "gateway"     TEXT NOT NULL,
    "eventId"     TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedPaymentWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- Unique guard: the same event from the same gateway cannot be processed twice.
CREATE UNIQUE INDEX "ProcessedPaymentWebhookEvent_gateway_eventId_key"
    ON "ProcessedPaymentWebhookEvent"("gateway", "eventId");
