import { PrismaClient } from '@prisma/client'
import { logger } from '../utils/logger'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import { applyPlugin } from 'jspdf-autotable'

applyPlugin(jsPDF)

const prisma = new PrismaClient()

export interface ExportRequest {
  format: 'csv' | 'excel' | 'pdf'
  dateRange?: {
    start: Date
    end: Date
  }
  includeMetrics?: boolean
  includePredictions?: boolean
  includeFunnel?: boolean
  includeUserMetrics?: boolean
  includeGroupMetrics?: boolean
  customQuery?: any
}

export class DataExportService {
  /**
   * Creates a background job to export complex analytics and system metrics.
   * Supports CSV, Excel, and PDF formats.
   *
   * @param userId - ID of the administrator or system user requesting the export
   * @param request - Configuration options including specific metrics and date ranges
   * @returns Promise resolving to the created DataExport job record
   */
  async createExportJob(userId: string, request: ExportRequest) {
    const exportJob = await prisma.dataExport.create({
      data: {
        userId,
        exportType: request.format,
        format: request.format,
        query: request as any,
        status: 'pending',
      },
    })

    // Process export asynchronously
    this.processExport(exportJob.id, request).catch((error) => {
      logger.error('Export processing failed', { exportId: exportJob.id, error })
    })

    return exportJob
  }

  private async processExport(exportId: string, request: ExportRequest) {
    try {
      // Update status to processing
      await prisma.dataExport.update({
        where: { id: exportId },
        data: { status: 'processing' },
      })

      const data: any = {}
      let filePath: string
      let fileSize: number

      // Gather data based on request
      if (request.includeMetrics) {
        const { biService } = await import('./biService')
        data.metrics = await biService.calculateAdvancedMetrics(request.dateRange)
      }

      if (request.includePredictions) {
        const { biService } = await import('./biService')
        data.predictions = await biService.generatePredictiveMetrics()
      }

      if (request.includeFunnel) {
        const { biService } = await import('./biService')
        data.funnel = await biService.analyzeFunnel()
      }

      if (request.includeUserMetrics) {
        data.userMetrics = await prisma.userMetrics.findMany({
          include: { user: { select: { walletAddress: true, createdAt: true } } },
          take: 1000, // Limit for performance
        })
      }

      if (request.includeGroupMetrics) {
        data.groupMetrics = await prisma.groupMetrics.findMany({
          include: { group: { select: { id: true, name: true, createdAt: true } } },
          take: 1000, // Limit for performance
        })
      }

      // Generate file based on format
      switch (request.format) {
        case 'csv':
          filePath = await this.generateCSV(data, exportId)
          break
        case 'excel':
          filePath = await this.generateExcel(data, exportId)
          break
        case 'pdf':
          filePath = await this.generatePDF(data, exportId)
          break
        default:
          throw new Error(`Unsupported export format: ${request.format}`)
      }

      // Get file size
      const fs = await import('fs')
      const stats = fs.statSync(filePath)
      fileSize = stats.size

      // Update export job with completion
      await prisma.dataExport.update({
        where: { id: exportId },
        data: {
          status: 'completed',
          filePath,
          fileSize,
          completedAt: new Date(),
        },
      })

      logger.info('Export completed successfully', {
        exportId,
        format: request.format,
        fileSize,
        filePath,
      })
    } catch (error) {
      await prisma.dataExport.update({
        where: { id: exportId },
        data: { status: 'failed' },
      })

      logger.error('Export processing failed', {
        exportId,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  private async generateCSV(data: any, exportId: string): Promise<string> {
    const fs = await import('fs')
    const path = await import('path')

    const filePath = path.join(process.cwd(), 'exports', `${exportId}.csv`)

    // Ensure exports directory exists
    if (!fs.existsSync(path.dirname(filePath))) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
    }

    let csvContent = ''

    // Metrics CSV
    if (data.metrics) {
      csvContent += 'METRICS\n'
      csvContent += 'Category,Metric,Value\n'

      const { userMetrics, groupMetrics, financialMetrics } = data.metrics

      // User metrics
      Object.entries(userMetrics).forEach(([key, value]) => {
        csvContent += `Users,${key},${value}\n`
      })

      // Group metrics
      Object.entries(groupMetrics).forEach(([key, value]) => {
        csvContent += `Groups,${key},${value}\n`
      })

      // Financial metrics
      Object.entries(financialMetrics).forEach(([key, value]) => {
        csvContent += `Financial,${key},${value}\n`
      })

      csvContent += '\n'
    }

    // User metrics CSV
    if (data.userMetrics) {
      csvContent += 'USER METRICS\n'
      csvContent +=
        'User ID,Wallet Address,Total Contributed,Total Received,Groups Joined,Retention Rate,Churn Score,LTV,Predicted Churn\n'

      data.userMetrics.forEach((user: any) => {
        csvContent += `${user.id},${user.walletAddress},${user.totalContributed},${user.totalReceived},${user.groupsJoined},${user.retentionRate},${user.churnScore},${user.ltv},${user.predictedChurn}\n`
      })

      csvContent += '\n'
    }

    // Group metrics CSV
    if (data.groupMetrics) {
      csvContent += 'GROUP METRICS\n'
      csvContent +=
        'Group ID,Group Name,Total Contributions,Total Payouts,Member Count,Success Rate,Default Rate,Risk Score,Predicted Success\n'

      data.groupMetrics.forEach((group: any) => {
        csvContent += `${group.id},${group.group?.name || 'N/A'},${group.totalContributions},${
          group.totalPayouts
        },${group.memberCount},${group.successRate},${group.defaultRate},${group.riskScore},${
          group.predictedSuccess
        }\n`
      })
    }

    fs.writeFileSync(filePath, csvContent)
    return filePath
  }

  private async generateExcel(data: any, exportId: string): Promise<string> {
    const fs = await import('fs')
    const path = await import('path')

    const filePath = path.join(process.cwd(), 'exports', `${exportId}.xlsx`)

    // Ensure exports directory exists
    if (!fs.existsSync(path.dirname(filePath))) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
    }

    const workbook = XLSX.utils.book_new()

    // Metrics sheet
    if (data.metrics) {
      const metricsData: any[] = []
      const { userMetrics, groupMetrics, financialMetrics } = data.metrics

      Object.entries(userMetrics).forEach(([key, value]) => {
        metricsData.push(['Users', key, value])
      })

      Object.entries(groupMetrics).forEach(([key, value]) => {
        metricsData.push(['Groups', key, value])
      })

      Object.entries(financialMetrics).forEach(([key, value]) => {
        metricsData.push(['Financial', key, value])
      })

      const metricsSheet = XLSX.utils.aoa_to_sheet([
        ['Category', 'Metric', 'Value'],
        ...metricsData,
      ])
      XLSX.utils.book_append_sheet(workbook, metricsSheet, 'Metrics')
    }

    // User metrics sheet
    if (data.userMetrics) {
      const userData = data.userMetrics.map((user: any) => [
        user.id,
        user.walletAddress,
        user.totalContributed,
        user.totalReceived,
        user.groupsJoined,
        user.retentionRate,
        user.churnScore,
        user.ltv,
        user.predictedChurn,
      ])

      const userSheet = XLSX.utils.aoa_to_sheet([
        [
          'ID',
          'Wallet Address',
          'Total Contributed',
          'Total Received',
          'Groups Joined',
          'Retention Rate',
          'Churn Score',
          'LTV',
          'Predicted Churn',
        ],
        ...userData,
      ])
      XLSX.utils.book_append_sheet(workbook, userSheet, 'User Metrics')
    }

    // Group metrics sheet
    if (data.groupMetrics) {
      const groupData = data.groupMetrics.map((group: any) => [
        group.id,
        group.group?.name || 'N/A',
        group.totalContributions,
        group.totalPayouts,
        group.memberCount,
        group.successRate,
        group.defaultRate,
        group.riskScore,
        group.predictedSuccess,
      ])

      const groupSheet = XLSX.utils.aoa_to_sheet([
        [
          'ID',
          'Group Name',
          'Total Contributions',
          'Total Payouts',
          'Member Count',
          'Success Rate',
          'Default Rate',
          'Risk Score',
          'Predicted Success',
        ],
        ...groupData,
      ])
      XLSX.utils.book_append_sheet(workbook, groupSheet, 'Group Metrics')
    }

    // Predictions sheet
    if (data.predictions) {
      const { churnPrediction, groupSuccessPrediction } = data.predictions

      // Churn predictions
      const churnData = churnPrediction.map((pred: any) => [
        pred.userId,
        pred.churnProbability,
        pred.riskFactors.join(', '),
      ])

      const churnSheet = XLSX.utils.aoa_to_sheet([
        ['User ID', 'Churn Probability', 'Risk Factors'],
        ...churnData,
      ])
      XLSX.utils.book_append_sheet(workbook, churnSheet, 'Churn Predictions')

      // Group success predictions
      const groupSuccessData = groupSuccessPrediction.map((pred: any) => [
        pred.groupId,
        pred.successProbability,
        pred.riskFactors.join(', '),
      ])

      const groupSuccessSheet = XLSX.utils.aoa_to_sheet([
        ['Group ID', 'Success Probability', 'Risk Factors'],
        ...groupSuccessData,
      ])
      XLSX.utils.book_append_sheet(workbook, groupSuccessSheet, 'Group Success Predictions')
    }

    // Funnel sheet
    if (data.funnel) {
      const funnelData = data.funnel.map((stage: any) => [
        stage.stage,
        stage.totalUsers,
        stage.conversionRate,
        stage.dropoffRate,
        stage.avgTimeInStage,
      ])

      const funnelSheet = XLSX.utils.aoa_to_sheet([
        ['Stage', 'Total Users', 'Conversion Rate', 'Dropoff Rate', 'Avg Time in Stage'],
        ...funnelData,
      ])
      XLSX.utils.book_append_sheet(workbook, funnelSheet, 'Funnel Analysis')
    }

    XLSX.writeFile(workbook, filePath)
    return filePath
  }

  private async generatePDF(data: any, exportId: string): Promise<string> {
    const fs = await import('fs')
    const path = await import('path')

    const filePath = path.join(process.cwd(), 'exports', `${exportId}.pdf`)

    // Ensure exports directory exists
    if (!fs.existsSync(path.dirname(filePath))) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
    }

    const doc = new jsPDF()
    let yPosition = 20

    // Title
    doc.setFontSize(20)
    doc.text('Analytics Export Report', 20, yPosition)
    yPosition += 20

    // Date range
    if (data.dateRange) {
      doc.setFontSize(12)
      doc.text(
        `Date Range: ${data.dateRange.start.toDateString()} - ${data.dateRange.end.toDateString()}`,
        20,
        yPosition
      )
      yPosition += 20
    }

    // Metrics section
    if (data.metrics) {
      doc.setFontSize(16)
      doc.text('Metrics Summary', 20, yPosition)
      yPosition += 15

      doc.setFontSize(10)
      const { userMetrics, groupMetrics, financialMetrics } = data.metrics

      // User metrics table
      const userMetricsData = Object.entries(userMetrics).map(([key, value]) => [
        key,
        String(value),
      ])
      ;(doc as any).autoTable({
        head: [['User Metric', 'Value']],
        body: userMetricsData,
        startY: yPosition,
      })
      yPosition += (userMetricsData.length + 1) * 10 + 10

      // Group metrics table
      const groupMetricsData = Object.entries(groupMetrics).map(([key, value]) => [
        key,
        String(value),
      ])
      ;(doc as any).autoTable({
        head: [['Group Metric', 'Value']],
        body: groupMetricsData,
        startY: yPosition,
      })
      yPosition += (groupMetricsData.length + 1) * 10 + 10

      // Financial metrics table
      const financialMetricsData = Object.entries(financialMetrics).map(([key, value]) => [
        key,
        String(value),
      ])
      ;(doc as any).autoTable({
        head: [['Financial Metric', 'Value']],
        body: financialMetricsData,
        startY: yPosition,
      })
      yPosition += (financialMetricsData.length + 1) * 10 + 20
    }

    // Add new page if needed
    if (yPosition > 250) {
      doc.addPage()
      yPosition = 20
    }

    // Predictions section
    if (data.predictions) {
      doc.setFontSize(16)
      doc.text('Predictions', 20, yPosition)
      yPosition += 15

      const { churnPrediction, groupSuccessPrediction, optimalContributionAmount } =
        data.predictions

      // Churn predictions
      doc.setFontSize(12)
      doc.text('Top Churn Risks:', 20, yPosition)
      yPosition += 10

      doc.setFontSize(10)
      churnPrediction.slice(0, 5).forEach((pred: any) => {
        doc.text(`${pred.userId}: ${(pred.churnProbability * 100).toFixed(1)}%`, 30, yPosition)
        yPosition += 8
      })

      yPosition += 10

      // Group success predictions
      doc.setFontSize(12)
      doc.text('Group Success Predictions:', 20, yPosition)
      yPosition += 10

      doc.setFontSize(10)
      groupSuccessPrediction.slice(0, 5).forEach((pred: any) => {
        doc.text(`${pred.groupId}: ${(pred.successProbability * 100).toFixed(1)}%`, 30, yPosition)
        yPosition += 8
      })

      yPosition += 10

      // Optimal contribution
      doc.setFontSize(12)
      doc.text('Optimal Contribution Amount:', 20, yPosition)
      yPosition += 10

      doc.setFontSize(10)
      doc.text(
        `Recommended: $${optimalContributionAmount.recommendedAmount} (${(
          optimalContributionAmount.confidence * 100
        ).toFixed(0)}% confidence)`,
        30,
        yPosition
      )
      yPosition += 8
      doc.text(
        `Range: $${optimalContributionAmount.minAmount} - $${optimalContributionAmount.maxAmount}`,
        30,
        yPosition
      )
      yPosition += 20
    }

    // Footer
    doc.setFontSize(8)
    doc.text(`Generated on ${new Date().toLocaleString()}`, 20, 280)

    const buffer = Buffer.from(doc.output('arraybuffer'))
    fs.writeFileSync(filePath, buffer)
    return filePath
  }

  async getExportStatus(exportId: string) {
    return prisma.dataExport.findUnique({
      where: { id: exportId },
    })
  }

  async getExportsByUser(userId: string) {
    return prisma.dataExport.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
  }

  /**
   * Deletes an export record and attempts to remove the physical file from disk.
   *
   * @param exportId - Unique ID of the export to delete
   * @returns Promise resolving to the deleted record
   */
  async deleteExport(exportId: string) {
    const exportRecord = await prisma.dataExport.findUnique({
      where: { id: exportId },
    })

    if (exportRecord?.filePath) {
      const fs = await import('fs')
      try {
        fs.unlinkSync(exportRecord.filePath)
      } catch (error) {
        logger.warn('Failed to delete export file', { filePath: exportRecord.filePath, error })
      }
    }

    return prisma.dataExport.delete({
      where: { id: exportId },
    })
  }

  // Scheduled reports
  async scheduleReport(
    userId: string,
    schedule: {
      frequency: 'daily' | 'weekly' | 'monthly'
      format: 'csv' | 'excel' | 'pdf'
      includeMetrics: boolean
      includePredictions: boolean
      email?: string
    }
  ) {
    // This would integrate with a job scheduler like node-cron
    // For now, we'll just create a record in the database
    logger.info('Report scheduled', { userId, schedule })
  }
}

export const dataExportService = new DataExportService()
