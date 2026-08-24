import { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import { applyPlugin } from 'jspdf-autotable'

applyPlugin(jsPDF)
import * as fs from 'fs'
import * as path from 'path'
import { createModuleLogger } from '../utils/logger'

const logger = createModuleLogger('UserDataExportService')
const EXPORTS_DIR = path.join(process.cwd(), 'exports')

export type ExportFormat = 'csv' | 'json' | 'pdf'
export type ExportDataType = 'user' | 'groups' | 'transactions' | 'all'

export interface UserExportRequest {
  format: ExportFormat
  dataType: ExportDataType
  dateRange?: { start: Date; end: Date }
}

export interface ExportResult {
  exportId: string
  format: ExportFormat
  dataType: ExportDataType
  status: 'pending' | 'processing' | 'completed' | 'failed'
  filePath?: string
  fileSize?: number
  createdAt: Date
  completedAt?: Date
}

function ensureExportsDir() {
  if (!fs.existsSync(EXPORTS_DIR)) {
    fs.mkdirSync(EXPORTS_DIR, { recursive: true })
  }
}

export class UserDataExportService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Initiates a new data export request for a user.
   * Creates a 'pending' record and starts asynchronous processing.
   *
   * @param userId - Wallet address of the user requesting the export
   * @param request - Configuration for the export (format, data types, date range)
   * @returns Promise resolving to the initial ExportResult
   */
  async createExport(userId: string, request: UserExportRequest): Promise<ExportResult> {
    const exportRecord = await this.prisma.dataExport.create({
      data: {
        userId,
        exportType: request.dataType,
        format: request.format,
        query: request as object,
        status: 'pending',
      },
    })

    // Fire-and-forget async processing
    this.processExport(exportRecord.id, userId, request).catch((err) =>
      logger.error('Export processing failed', { exportId: exportRecord.id, err })
    )

    return {
      exportId: exportRecord.id,
      format: request.format,
      dataType: request.dataType,
      status: 'pending',
      createdAt: exportRecord.createdAt,
    }
  }

  private async processExport(
    exportId: string,
    userId: string,
    request: UserExportRequest
  ): Promise<void> {
    await this.prisma.dataExport.update({ where: { id: exportId }, data: { status: 'processing' } })

    try {
      const data = await this.gatherData(userId, request)
      const filePath = await this.generateFile(exportId, request.format, request.dataType, data)
      const { size } = fs.statSync(filePath)

      await this.prisma.dataExport.update({
        where: { id: exportId },
        data: { status: 'completed', filePath, fileSize: size, completedAt: new Date() },
      })

      logger.info('Export completed', { exportId, format: request.format, size })
    } catch (err) {
      await this.prisma.dataExport.update({ where: { id: exportId }, data: { status: 'failed' } })
      logger.error('Export failed', { exportId, err })
      throw err
    }
  }

  // ─── Data Gathering ───────────────────────────────────────────────────────

  private async gatherData(userId: string, request: UserExportRequest) {
    const { dataType, dateRange } = request
    const dateFilter = dateRange ? { createdAt: { gte: dateRange.start, lte: dateRange.end } } : {}

    const [userData, groupsData, transactionsData] = await Promise.all([
      dataType === 'user' || dataType === 'all' ? this.getUserData(userId) : null,
      dataType === 'groups' || dataType === 'all' ? this.getGroupsData(userId, dateFilter) : null,
      dataType === 'transactions' || dataType === 'all'
        ? this.getTransactionsData(userId, dateFilter)
        : null,
    ])

    return { user: userData, groups: groupsData, transactions: transactionsData }
  }

  private async getUserData(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { walletAddress: userId },
      select: {
        walletAddress: true,
        createdAt: true,
        updatedAt: true,
        metrics: {
          select: {
            totalContributed: true,
            totalReceived: true,
            groupsJoined: true,
            groupsCompleted: true,
            retentionRate: true,
            lastActiveAt: true,
          },
        },
        gamification: {
          select: { points: true, level: true, contributionStreak: true, groupsCompleted: true },
        },
      },
    })
    return user
  }

  private async getGroupsData(userId: string, dateFilter: object) {
    return this.prisma.groupMember.findMany({
      where: { userId, ...dateFilter },
      select: {
        joinedAt: true,
        group: {
          select: {
            id: true,
            name: true,
            contributionAmount: true,
            frequency: true,
            maxMembers: true,
            currentRound: true,
            isActive: true,
            createdAt: true,
          },
        },
      },
      orderBy: { joinedAt: 'desc' },
    })
  }

  private async getTransactionsData(userId: string, dateFilter: object) {
    return this.prisma.contribution.findMany({
      where: { userId, ...dateFilter },
      select: {
        id: true,
        amount: true,
        round: true,
        txHash: true,
        createdAt: true,
        group: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
  }

  // ─── File Generation ──────────────────────────────────────────────────────

  private async generateFile(
    exportId: string,
    format: ExportFormat,
    dataType: ExportDataType,
    data: Awaited<ReturnType<typeof this.gatherData>>
  ): Promise<string> {
    ensureExportsDir()

    switch (format) {
      case 'csv':
        return this.generateCSV(exportId, dataType, data)
      case 'json':
        return this.generateJSON(exportId, dataType, data)
      case 'pdf':
        return this.generatePDF(exportId, dataType, data)
      default:
        throw new Error(`Unsupported format: ${format}`)
    }
  }

  private generateCSV(
    exportId: string,
    dataType: ExportDataType,
    data: Awaited<ReturnType<typeof this.gatherData>>
  ): string {
    const filePath = path.join(EXPORTS_DIR, `${exportId}.csv`)
    const workbook = XLSX.utils.book_new()

    if (data.user) {
      const u = data.user
      const rows = [
        ['Field', 'Value'],
        ['Wallet Address', u.walletAddress],
        ['Member Since', u.createdAt.toISOString()],
        ['Last Updated', u.updatedAt.toISOString()],
        ['Total Contributed', u.metrics?.totalContributed?.toString() ?? '0'],
        ['Total Received', u.metrics?.totalReceived?.toString() ?? '0'],
        ['Groups Joined', u.metrics?.groupsJoined ?? 0],
        ['Groups Completed', u.metrics?.groupsCompleted ?? 0],
        ['Retention Rate', u.metrics?.retentionRate ?? 0],
        ['Points', u.gamification?.points ?? 0],
        ['Level', u.gamification?.level ?? 'BRONZE'],
        ['Contribution Streak', u.gamification?.contributionStreak ?? 0],
      ]
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'User Profile')
    }

    if (data.groups?.length) {
      const rows = [
        [
          'Group ID',
          'Group Name',
          'Contribution Amount',
          'Frequency',
          'Max Members',
          'Current Round',
          'Active',
          'Joined At',
        ],
        ...data.groups.map((m: any) => [
          m.group.id,
          m.group.name,
          m.group.contributionAmount.toString(),
          m.group.frequency,
          m.group.maxMembers,
          m.group.currentRound,
          m.group.isActive,
          m.joinedAt.toISOString(),
        ]),
      ]
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Groups')
    }

    if (data.transactions?.length) {
      const rows = [
        ['Transaction ID', 'Group ID', 'Group Name', 'Amount', 'Round', 'Tx Hash', 'Date'],
        ...data.transactions.map((t: any) => [
          t.id,
          t.group.id,
          t.group.name,
          t.amount.toString(),
          t.round,
          t.txHash,
          t.createdAt.toISOString(),
        ]),
      ]
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Transactions')
    }

    XLSX.writeFile(workbook, filePath, { bookType: 'csv' })
    return filePath
  }

  private generateJSON(
    exportId: string,
    _dataType: ExportDataType,
    data: Awaited<ReturnType<typeof this.gatherData>>
  ): string {
    const filePath = path.join(EXPORTS_DIR, `${exportId}.json`)

    const output: Record<string, unknown> = { exportedAt: new Date().toISOString() }

    if (data.user) {
      output.user = {
        walletAddress: data.user.walletAddress,
        createdAt: data.user.createdAt,
        updatedAt: data.user.updatedAt,
        metrics: data.user.metrics
          ? {
              ...data.user.metrics,
              totalContributed: data.user.metrics.totalContributed.toString(),
              totalReceived: data.user.metrics.totalReceived.toString(),
            }
          : null,
        gamification: data.user.gamification,
      }
    }

    if (data.groups) {
      output.groups = data.groups.map((m: any) => ({
        joinedAt: m.joinedAt,
        group: {
          ...m.group,
          contributionAmount: m.group.contributionAmount.toString(),
        },
      }))
    }

    if (data.transactions) {
      output.transactions = data.transactions.map((t: any) => ({
        ...t,
        amount: t.amount.toString(),
      }))
    }

    fs.writeFileSync(filePath, JSON.stringify(output, null, 2))
    return filePath
  }

  private generatePDF(
    exportId: string,
    dataType: ExportDataType,
    data: Awaited<ReturnType<typeof this.gatherData>>
  ): string {
    const filePath = path.join(EXPORTS_DIR, `${exportId}.pdf`)
    const doc = new jsPDF()
    let y = 20

    doc.setFontSize(18)
    doc.text('Data Export Report', 14, y)
    y += 8

    doc.setFontSize(10)
    doc.setTextColor(120)
    doc.text(`Generated: ${new Date().toLocaleString()}  |  Type: ${dataType}`, 14, y)
    doc.setTextColor(0)
    y += 12

    if (data.user) {
      const u = data.user
      doc.setFontSize(13)
      doc.text('User Profile', 14, y)
      y += 6
      ;(doc as any).autoTable({
        startY: y,
        head: [['Field', 'Value']],
        body: [
          ['Wallet Address', u.walletAddress],
          ['Member Since', u.createdAt.toLocaleDateString()],
          ['Total Contributed', u.metrics?.totalContributed?.toString() ?? '0'],
          ['Total Received', u.metrics?.totalReceived?.toString() ?? '0'],
          ['Groups Joined', String(u.metrics?.groupsJoined ?? 0)],
          ['Points', String(u.gamification?.points ?? 0)],
          ['Level', u.gamification?.level ?? 'BRONZE'],
          ['Streak', String(u.gamification?.contributionStreak ?? 0)],
        ],
        theme: 'striped',
        styles: { fontSize: 9 },
      })
      y = (doc as any).lastAutoTable.finalY + 12
    }

    if (data.groups?.length) {
      if (y > 220) {
        doc.addPage()
        y = 20
      }
      doc.setFontSize(13)
      doc.text('Groups', 14, y)
      y += 6
      ;(doc as any).autoTable({
        startY: y,
        head: [['Group Name', 'Contribution', 'Round', 'Active', 'Joined']],
        body: data.groups.map((m: any) => [
          m.group.name,
          m.group.contributionAmount.toString(),
          m.group.currentRound,
          m.group.isActive ? 'Yes' : 'No',
          new Date(m.joinedAt).toLocaleDateString(),
        ]),
        theme: 'striped',
        styles: { fontSize: 9 },
      })
      y = (doc as any).lastAutoTable.finalY + 12
    }

    if (data.transactions?.length) {
      if (y > 220) {
        doc.addPage()
        y = 20
      }
      doc.setFontSize(13)
      doc.text('Transactions', 14, y)
      y += 6
      ;(doc as any).autoTable({
        startY: y,
        head: [['Group', 'Amount', 'Round', 'Tx Hash', 'Date']],
        body: data.transactions.map((t: any) => [
          t.group.name,
          t.amount.toString(),
          t.round,
          t.txHash.slice(0, 16) + '...',
          new Date(t.createdAt).toLocaleDateString(),
        ]),
        theme: 'striped',
        styles: { fontSize: 9 },
      })
    }

    fs.writeFileSync(filePath, Buffer.from(doc.output('arraybuffer')))
    return filePath
  }

  // ─── Status & Management ──────────────────────────────────────────────────

  async getExport(exportId: string, userId: string) {
    return this.prisma.dataExport.findFirst({ where: { id: exportId, userId } })
  }

  async listExports(userId: string) {
    return this.prisma.dataExport.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
  }

  /**
   * Permanently deletes an export record and its associated file from the filesystem.
   *
   * @param exportId - The unique ID of the export
   * @param userId - The wallet address of the owner (to verify ownership)
   */
  async deleteExport(exportId: string, userId: string): Promise<void> {
    const record = await this.prisma.dataExport.findFirst({ where: { id: exportId, userId } })
    if (!record) return

    if (record.filePath && fs.existsSync(record.filePath)) {
      fs.unlinkSync(record.filePath)
    }

    await this.prisma.dataExport.delete({ where: { id: exportId } })
  }

  /**
   * Retrieves file information for streaming an export to a client.
   *
   * @param exportId - The unique ID of the export
   * @param userId - The wallet address of the owner
   * @returns Promise resolving to the file path, MIME type, and filename, or null if not ready/found
   */
  async streamExport(
    exportId: string,
    userId: string
  ): Promise<{ filePath: string; mimeType: string; filename: string } | null> {
    const record = await this.prisma.dataExport.findFirst({ where: { id: exportId, userId } })
    if (!record || record.status !== 'completed' || !record.filePath) return null
    if (!fs.existsSync(record.filePath)) return null

    const mimeTypes: Record<string, string> = {
      csv: 'text/csv',
      json: 'application/json',
      pdf: 'application/pdf',
    }

    return {
      filePath: record.filePath,
      mimeType: mimeTypes[record.format] ?? 'application/octet-stream',
      filename: `export-${record.exportType}-${exportId}.${record.format}`,
    }
  }
}
