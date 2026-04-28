import { prisma } from '../config/database'
import { logger } from '../utils/logger'

// ── Security event helpers ────────────────────────────────────────────────────

export type SecurityEventType =
  | 'login_success'
  | 'login_failure'
  | 'logout'
  | 'password_change'
  | 'api_key_created'
  | 'api_key_revoked'
  | 'ip_blocked'
  | 'rate_limit_exceeded'
  | 'suspicious_activity'
  | 'admin_action'

/**
 * Log a security-specific event. Wraps auditLog with actorType=SYSTEM and
 * a structured metadata payload for easy querying.
 */
export async function logSecurityEvent(
  event: SecurityEventType,
  details: {
    actorId?: string
    ipAddress?: string
    userAgent?: string
    metadata?: Record<string, unknown>
  }
) {
  return auditLog({
    actorId: details.actorId ?? 'system',
    actorType: 'SYSTEM',
    action: event,
    targetType: 'security',
    ipAddress: details.ipAddress,
    userAgent: details.userAgent,
    metadata: { event, ...details.metadata },
  })
}

export interface AuditLogEntry {
  actorId: string
  actorType?: 'USER' | 'ADMIN' | 'SYSTEM'
  action: string
  targetType?: string
  targetId?: string
  ipAddress?: string
  userAgent?: string
  metadata?: Record<string, unknown>
}

// Keep backward-compat alias used by existing code
export interface AuditLogEntry_Legacy {
  adminId: string
  action: string
  targetType: string
  targetId: string
  metadata: Record<string, unknown>
  ipAddress?: string
}

export async function auditLog(entry: AuditLogEntry | AuditLogEntry_Legacy) {
  // Normalise legacy shape
  const normalised: AuditLogEntry = 'adminId' in entry
    ? { actorId: entry.adminId, actorType: 'ADMIN', action: entry.action, targetType: entry.targetType, targetId: entry.targetId, ipAddress: entry.ipAddress, metadata: entry.metadata }
    : entry

  try {
    return await prisma.auditLog.create({ data: { ...normalised, actorType: normalised.actorType ?? 'USER' } })
  } catch (err) {
    logger.error('Failed to write audit log', { error: err instanceof Error ? err.message : String(err), entry: normalised })
  }
}

export async function searchAuditLogs(params: {
  actorId?: string
  action?: string
  targetType?: string
  targetId?: string
  startDate?: Date
  endDate?: Date
  page?: number
  limit?: number
}) {
  const { page = 1, limit = 50 } = params
  const where = {
    ...(params.actorId && { actorId: params.actorId }),
    ...(params.action && { action: { contains: params.action, mode: 'insensitive' as const } }),
    ...(params.targetType && { targetType: params.targetType }),
    ...(params.targetId && { targetId: params.targetId }),
    ...((params.startDate || params.endDate) && {
      createdAt: {
        ...(params.startDate ? { gte: params.startDate } : {}),
        ...(params.endDate ? { lte: params.endDate } : {}),
      },
    }),
  }

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
    prisma.auditLog.count({ where }),
  ])

  return { logs, total, page, pages: Math.ceil(total / limit) }
}

// Keep backward-compat name
export const getAuditLogs = searchAuditLogs

export async function purgeAuditLogs(retentionDays = 90): Promise<{ deleted: number }> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
  const { count } = await prisma.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } })
  logger.info('Audit log purge complete', { deleted: count, retentionDays })
  return { deleted: count }
}

export async function generateComplianceReport(startDate: Date, endDate: Date) {
  const [total, byAction, byActor, byTarget] = await Promise.all([
    prisma.auditLog.count({ where: { createdAt: { gte: startDate, lte: endDate } } }),
    prisma.auditLog.groupBy({ by: ['action'], where: { createdAt: { gte: startDate, lte: endDate } }, _count: { action: true }, orderBy: { _count: { action: 'desc' } } }),
    prisma.auditLog.groupBy({ by: ['actorId', 'actorType'], where: { createdAt: { gte: startDate, lte: endDate } }, _count: { actorId: true }, orderBy: { _count: { actorId: 'desc' } }, take: 20 }),
    prisma.auditLog.groupBy({ by: ['targetType'], where: { createdAt: { gte: startDate, lte: endDate }, targetType: { not: null } }, _count: { targetType: true }, orderBy: { _count: { targetType: 'desc' } } }),
  ])

  return {
    period: { startDate, endDate },
    summary: { totalEvents: total },
    topActions: byAction.map(r => ({ action: r.action, count: r._count.action })),
    topActors: byActor.map(r => ({ actorId: r.actorId, actorType: r.actorType, count: r._count.actorId })),
    targetBreakdown: byTarget.map(r => ({ targetType: r.targetType, count: r._count.targetType })),
    generatedAt: new Date(),
  }
}
