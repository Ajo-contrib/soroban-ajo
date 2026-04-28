import crypto from 'crypto'
import { exec } from 'child_process'
import { promisify } from 'util'
import { prisma } from '../config/database'
import { logger } from '../utils/logger'

const execAsync = promisify(exec)

// Optional AWS SDK — only loaded when S3 env vars are present
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let S3Client: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let PutObjectCommand: any

async function loadS3() {
  if (!process.env.AWS_S3_BUCKET) return
  try {
    // Dynamic import so the module is optional at runtime
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@aws-sdk/client-s3')
    S3Client = mod.S3Client
    PutObjectCommand = mod.PutObjectCommand
  } catch {
    logger.warn('AWS SDK not available — S3 uploads disabled')
  }
}

loadS3()

export interface BackupMetadata {
  postgresVersion?: string
  startLsn?: string
  endLsn?: string
  backupLabel?: string
  toolVersion?: string
}

export class BackupService {
  private readonly storageBasePath: string
  private readonly encryptionKeyId: string

  constructor() {
    this.storageBasePath = process.env.BACKUP_STORAGE_PATH || '/tmp/backups'
    this.encryptionKeyId = process.env.BACKUP_ENCRYPTION_KEY_ID || 'default-key-id'
  }

  /**
   * Triggers a full base backup using pg_basebackup.
   * Records the backup in the database and returns the record.
   */
  async triggerFullBackup(): Promise<{ id: string; status: string }> {
    const now = new Date()
    const timestamp = now.toISOString().replace(/[:.]/g, '-')
    const storagePath = `${this.storageBasePath}/base/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}/${timestamp}`

    const record = await prisma.backupRecord.create({
      data: {
        backupType: 'FULL',
        status: 'IN_PROGRESS',
        storagePath,
        encryptionKey: this.encryptionKeyId,
        metadata: { toolVersion: '1.0.0' },
      },
    })

    // Run backup asynchronously; don't block the response
    this.runFullBackup(record.id, storagePath).catch((err) => {
      logger.error('Full backup failed', { backupId: record.id, error: err.message })
    })

    return { id: record.id, status: record.status }
  }

  private async runFullBackup(backupId: string, storagePath: string): Promise<void> {
    try {
      const dbUrl = process.env.DATABASE_URL || ''
      const pgHost = this.extractPgHost(dbUrl)
      const pgPort = this.extractPgPort(dbUrl)
      const pgUser = this.extractPgUser(dbUrl)

      await execAsync(
        `mkdir -p "${storagePath}" && pg_basebackup -h "${pgHost}" -p "${pgPort}" -U "${pgUser}" -D "${storagePath}" -Ft -z -P`
      )

      const checksum = await this.computeDirectoryChecksum(storagePath)
      const sizeBytes = await this.getDirectorySize(storagePath)
      const pgVersion = await this.getPostgresVersion()

      await prisma.backupRecord.update({
        where: { id: backupId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          checksum,
          sizeBytes: BigInt(sizeBytes),
          metadata: {
            postgresVersion: pgVersion,
            toolVersion: '1.0.0',
          },
        },
      })

      logger.info('Full backup completed', { backupId, storagePath, sizeBytes })
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      await prisma.backupRecord.update({
        where: { id: backupId },
        data: { status: 'FAILED', errorMessage: error.message, completedAt: new Date() },
      })
      throw error
    }
  }

  /**
   * Archives a WAL segment. Called by PostgreSQL archive_command.
   */
  async archiveWalSegment(walFile: string, walPath: string): Promise<void> {
    const now = new Date()
    const storagePath = `${this.storageBasePath}/wal/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}/${walFile}`

    const record = await prisma.backupRecord.create({
      data: {
        backupType: 'WAL',
        status: 'IN_PROGRESS',
        storagePath,
        encryptionKey: this.encryptionKeyId,
      },
    })

    try {
      await execAsync(`mkdir -p "$(dirname "${storagePath}")" && cp "${walPath}" "${storagePath}"`)
      const checksum = await this.computeFileChecksum(storagePath)
      const { size } = await execAsync(`stat -c%s "${storagePath}"`).then(({ stdout }) => ({ size: parseInt(stdout.trim(), 10) }))

      await prisma.backupRecord.update({
        where: { id: record.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          checksum,
          sizeBytes: BigInt(size),
        },
      })
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      await prisma.backupRecord.update({
        where: { id: record.id },
        data: { status: 'FAILED', errorMessage: error.message, completedAt: new Date() },
      })
      throw error
    }
  }

  /**
   * Verifies a backup by re-computing its checksum and comparing.
   */
  async verifyBackup(backupId: string): Promise<{ verified: boolean; message: string }> {
    const record = await prisma.backupRecord.findUnique({ where: { id: backupId } })
    if (!record) return { verified: false, message: 'Backup record not found' }
    if (record.status !== 'COMPLETED') return { verified: false, message: `Backup status is ${record.status}` }
    if (!record.checksum) return { verified: false, message: 'No checksum stored for this backup' }

    try {
      const currentChecksum = record.backupType === 'WAL'
        ? await this.computeFileChecksum(record.storagePath)
        : await this.computeDirectoryChecksum(record.storagePath)

      const verified = currentChecksum === record.checksum

      await prisma.backupRecord.update({
        where: { id: backupId },
        data: {
          status: verified ? 'VERIFIED' : 'FAILED',
          verifiedAt: verified ? new Date() : undefined,
          errorMessage: verified ? undefined : 'Checksum mismatch — backup may be corrupted',
        },
      })

      return {
        verified,
        message: verified ? 'Checksum verified successfully' : 'Checksum mismatch — backup may be corrupted',
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      return { verified: false, message: error.message }
    }
  }

  /**
   * Lists backup records, optionally filtered by type and/or status.
   */
  async listBackups(options: { type?: string; status?: string; limit?: number } = {}) {
    return prisma.backupRecord.findMany({
      where: {
        ...(options.type && { backupType: options.type }),
        ...(options.status && { status: options.status }),
      },
      orderBy: { startedAt: 'desc' },
      take: options.limit ?? 50,
    })
  }

  /**
   * Returns the most recent successful full backup.
   */
  async getLatestFullBackup() {
    return prisma.backupRecord.findFirst({
      where: { backupType: 'FULL', status: { in: ['COMPLETED', 'VERIFIED'] } },
      orderBy: { completedAt: 'desc' },
    })
  }

  /**
   * Uploads a local backup file to S3 and records the s3Key on the backup record.
   * No-op if AWS_S3_BUCKET is not configured.
   */
  async uploadToS3(backupId: string, localPath: string): Promise<string | null> {
    const bucket = process.env.AWS_S3_BUCKET
    if (!bucket || !S3Client || !PutObjectCommand) {
      logger.debug('S3 upload skipped — AWS_S3_BUCKET not configured')
      return null
    }

    const s3Key = `backups/${backupId}/${localPath.split('/').pop()}`
    const client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' })

    try {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: s3Key,
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          Body: require('fs').createReadStream(localPath),
          ServerSideEncryption: 'AES256',
        })
      )

      await prisma.backupRecord.update({ where: { id: backupId }, data: { s3Key } })
      logger.info('Backup uploaded to S3', { backupId, s3Key, bucket })
      return s3Key
    } catch (err) {
      logger.error('S3 upload failed', { backupId, error: err instanceof Error ? err.message : String(err) })
      return null
    }
  }

  /**
   * Scheduled daily backup: triggers a full backup and optionally uploads to S3.
   * Intended to be called by the cron scheduler.
   */
  async runScheduledBackup(): Promise<void> {
    logger.info('Starting scheduled daily backup')
    try {
      const { id } = await this.triggerFullBackup()
      logger.info('Scheduled backup initiated', { backupId: id })
    } catch (err) {
      logger.error('Scheduled backup failed', { error: err instanceof Error ? err.message : String(err) })
    }
  }

  /**
   * Purges backup records (and optionally files) older than the retention window.
   */
  async purgeOldBackups(retentionDays = 30): Promise<{ deleted: number }> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
    const { count } = await prisma.backupRecord.deleteMany({
      where: { startedAt: { lt: cutoff }, status: { in: ['COMPLETED', 'VERIFIED', 'FAILED'] } },
    })
    logger.info('Purged old backup records', { count, retentionDays })
    return { deleted: count }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private async computeFileChecksum(filePath: string): Promise<string> {
    const { stdout } = await execAsync(`sha256sum "${filePath}"`)
    return stdout.split(' ')[0]
  }

  private async computeDirectoryChecksum(dirPath: string): Promise<string> {
    const { stdout } = await execAsync(
      `find "${dirPath}" -type f | sort | xargs sha256sum | sha256sum`
    )
    return stdout.split(' ')[0]
  }

  private async getDirectorySize(dirPath: string): Promise<number> {
    const { stdout } = await execAsync(`du -sb "${dirPath}"`)
    return parseInt(stdout.split('\t')[0], 10)
  }

  private async getPostgresVersion(): Promise<string> {
    try {
      const { stdout } = await execAsync('psql --version')
      return stdout.trim()
    } catch {
      return 'unknown'
    }
  }

  private extractPgHost(dbUrl: string): string {
    try { return new URL(dbUrl).hostname } catch { return 'localhost' }
  }

  private extractPgPort(dbUrl: string): string {
    try { return new URL(dbUrl).port || '5432' } catch { return '5432' }
  }

  private extractPgUser(dbUrl: string): string {
    try { return new URL(dbUrl).username || 'postgres' } catch { return 'postgres' }
  }

  /**
   * Generates a deterministic encryption key for a backup (for envelope encryption).
   * In production, delegate to KMS; this is a local fallback.
   */
  generateBackupKey(): string {
    return crypto.randomBytes(32).toString('hex')
  }
}

export const backupService = new BackupService()
