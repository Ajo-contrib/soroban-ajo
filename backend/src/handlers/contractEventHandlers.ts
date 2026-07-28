/**
 * contractEventHandlers.ts
 *
 * Each handler:
 *  - Accepts an optional Prisma transaction client `tx`.  When supplied (by
 *    BlockchainListener) all DB writes use `tx` so they commit atomically with
 *    the dedup record and the checkpoint advance.  When omitted (legacy path /
 *    tests) the handler uses the global `prisma` client.
 *  - Is idempotent: processing the same event twice produces no duplicate
 *    DB rows, notifications, or webhook deliveries.
 */

import { prisma } from '../config/database'
import { dbService } from '../services/databaseService'
import { notificationService } from '../services/notificationService'
import { webhookService, WebhookEventType } from '../services/webhookService'
import { createModuleLogger } from '../utils/logger'
import type { ParsedContractEvent } from '../utils/eventParser'

const logger = createModuleLogger('ContractEventHandlers')

// The transaction client type mirrors what Prisma exposes inside $transaction.
type PrismaTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Returns a Prisma client scoped to the given transaction, or the global one. */
function db(tx?: PrismaTx) {
  return (tx ?? prisma) as typeof prisma
}

// ── Handlers ─────────────────────────────────────────────────────────────────

export async function handleGroupCreated(
  event: ParsedContractEvent,
  tx?: PrismaTx
): Promise<void> {
  const { groupId, data } = event
  if (!groupId) return

  const raw = data.raw as [string, bigint, number] | undefined
  if (!raw) return

  const [creator, contributionAmount, maxMembers] = raw

  // upsert is inherently idempotent
  await db(tx).group.upsert({
    where: { id: groupId },
    update: {
      contributionAmount: BigInt(contributionAmount),
      maxMembers,
      isActive: true,
      updatedAt: new Date(),
    },
    create: {
      id: groupId,
      name: `Group ${groupId}`,
      contributionAmount: BigInt(contributionAmount),
      frequency: 30,
      maxMembers,
      isActive: true,
    },
  })

  await dbService.upsertUser(creator)

  // Notifications / webhooks fire outside the transaction (best-effort, non-blocking)
  webhookService
    .triggerEvent(
      WebhookEventType.GROUP_CREATED,
      {
        groupId,
        creator,
        contributionAmount: contributionAmount.toString(),
        maxMembers,
        createdAt: new Date().toISOString(),
      },
      {
        groupId,
        userId: creator,
        network: process.env['SOROBAN_NETWORK'] ?? 'testnet',
      }
    )
    .catch((err) => logger.warn('Webhook dispatch failed', { handler: 'handleGroupCreated', err }))

  logger.info('Group created', { groupId, creator })
}

export async function handleMemberJoined(
  event: ParsedContractEvent,
  tx?: PrismaTx
): Promise<void> {
  const { groupId, data } = event
  if (!groupId) return

  const member = data.raw as string | undefined
  if (!member) return

  // upsert: idempotent — repeated calls for the same member are no-ops
  await db(tx).user.upsert({
    where: { walletAddress: member },
    update: { updatedAt: new Date() },
    create: { walletAddress: member },
  })

  await db(tx).groupMember.upsert({
    where: { groupId_userId: { groupId, userId: member } },
    update: {},
    create: { groupId, userId: member },
  })

  notificationService.sendToGroup(
    groupId,
    { type: 'member_joined', title: 'New Member', message: 'A new member joined the group.', groupId },
    member
  )

  webhookService
    .triggerEvent(
      WebhookEventType.MEMBER_JOINED,
      { groupId, memberAddress: member, joinedAt: new Date().toISOString() },
      { groupId, userId: member, network: process.env['SOROBAN_NETWORK'] ?? 'testnet' }
    )
    .catch((err) => logger.warn('Webhook dispatch failed', { handler: 'handleMemberJoined', err }))

  logger.info('Member joined', { groupId, member })
}

export async function handleContributionMade(
  event: ParsedContractEvent,
  tx?: PrismaTx
): Promise<void> {
  const { groupId, data, txHash } = event
  if (!groupId) return

  const raw = data.raw as [string, bigint] | undefined
  if (!raw) return

  const [member, amount] = raw
  const cycle = (data.cycle as number) ?? 0

  // DB-level idempotency: Contribution.txHash is @unique — the create will
  // throw a P2002 if this txHash was already recorded; we catch it and skip.
  try {
    await db(tx).user.upsert({
      where: { walletAddress: member },
      update: { updatedAt: new Date() },
      create: { walletAddress: member },
    })

    await db(tx).contribution.create({
      data: { groupId, userId: member, amount: BigInt(amount), round: cycle, txHash },
    })
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code
    if (code === 'P2002') {
      logger.debug('Contribution already recorded — skipping duplicate', { txHash })
      return
    }
    throw err
  }

  notificationService.sendToUser(member, {
    type: 'contribution_received',
    title: 'Contribution Confirmed',
    message: `Your contribution of ${amount} stroops was recorded.`,
    groupId,
  })

  webhookService
    .triggerEvent(
      WebhookEventType.CONTRIBUTION_MADE,
      { groupId, contributor: member, amount: amount.toString(), txHash, cycle, contributedAt: new Date().toISOString() },
      { groupId, userId: member, transactionHash: txHash, network: process.env['SOROBAN_NETWORK'] ?? 'testnet' }
    )
    .catch((err) => logger.warn('Webhook dispatch failed', { handler: 'handleContributionMade', err }))

  logger.info('Contribution made', { groupId, member, amount: amount.toString(), cycle })
}

export async function handlePayoutExecuted(
  event: ParsedContractEvent,
  tx?: PrismaTx
): Promise<void> {
  const { groupId, data, txHash } = event
  if (!groupId) return

  const raw = data.raw as [string, bigint] | undefined
  if (!raw) return

  const [recipient, amount] = raw
  const cycleNumber = (data.cycle as number) ?? 0

  // Idempotency guard: upsert by (groupId, cycleNumber) — the schema has a
  // @@unique constraint on this pair.  On conflict we skip all side effects.
  const payout = await db(tx).payout.upsert({
    where: { groupId_cycleNumber: { groupId, cycleNumber } },
    update: {},
    create: {
      groupId,
      recipientId: recipient,
      amount: BigInt(amount),
      cycleNumber,
      transactionHash: txHash,
      status: 'completed',
      processedAt: new Date(),
    },
  })

  // Only fire notifications / webhooks for newly created payout records.
  if (payout.status !== 'completed' || !payout.transactionHash) {
    logger.debug('PayoutExecuted: payout row already existed — skipping notifications', { groupId, cycleNumber })
    return
  }

  notificationService.sendToUser(recipient, {
    type: 'payout_received',
    title: 'Payout Received',
    message: `You received a payout of ${amount} stroops.`,
    groupId,
  })

  const payoutData = {
    groupId,
    recipient,
    amount: amount.toString(),
    dispatchedAt: new Date().toISOString(),
  }
  const payoutMeta = { groupId, userId: recipient, network: process.env['SOROBAN_NETWORK'] ?? 'testnet' }

  await Promise.all([
    webhookService.triggerEvent(WebhookEventType.PAYOUT_EXECUTED, payoutData, payoutMeta),
    webhookService.triggerEvent(WebhookEventType.PAYOUT_COMPLETED, payoutData, payoutMeta),
  ]).catch((err) => logger.warn('Webhook dispatch failed', { handler: 'handlePayoutExecuted', err }))

  logger.info('Payout executed', { groupId, recipient, amount: amount.toString() })
}

export async function handleGroupCompleted(
  event: ParsedContractEvent,
  tx?: PrismaTx
): Promise<void> {
  const { groupId } = event
  if (!groupId) return

  await db(tx).group.upsert({
    where: { id: groupId },
    update: { isActive: false, updatedAt: new Date() },
    create: {
      id: groupId,
      name: `Group ${groupId}`,
      contributionAmount: BigInt(0),
      frequency: 0,
      maxMembers: 0,
      isActive: false,
    },
  })

  notificationService.sendToGroup(groupId, {
    type: 'cycle_completed',
    title: 'Group Completed',
    message: 'All cycles have been completed. The group is now closed.',
    groupId,
  })

  webhookService
    .triggerEvent(
      WebhookEventType.GROUP_COMPLETED,
      { groupId, completedAt: new Date().toISOString() },
      { groupId, network: process.env['SOROBAN_NETWORK'] ?? 'testnet' }
    )
    .catch((err) => logger.warn('Webhook dispatch failed', { handler: 'handleGroupCompleted', err }))

  logger.info('Group completed', { groupId })
}

export async function handleCycleAdvanced(
  event: ParsedContractEvent,
  tx?: PrismaTx
): Promise<void> {
  const { groupId, data } = event
  if (!groupId) return

  const raw = data.raw as [number, bigint] | undefined
  const newCycle = raw?.[0]

  await db(tx).group.upsert({
    where: { id: groupId },
    update: { currentRound: newCycle, updatedAt: new Date() },
    create: {
      id: groupId,
      name: `Group ${groupId}`,
      contributionAmount: BigInt(0),
      frequency: 0,
      maxMembers: 0,
      currentRound: newCycle,
    },
  })

  webhookService
    .triggerEvent(
      WebhookEventType.CYCLE_STARTED,
      { groupId, cycleNumber: newCycle, startedAt: new Date().toISOString() },
      { groupId, network: process.env['SOROBAN_NETWORK'] ?? 'testnet' }
    )
    .catch((err) => logger.warn('Webhook dispatch failed', { handler: 'handleCycleAdvanced', err }))

  logger.info('Cycle advanced', { groupId, newCycle })
}
