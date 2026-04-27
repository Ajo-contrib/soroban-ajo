import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';

export class ReportGenerator {
  async generatePDF(data: any, options: any = {}): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument();
      const chunks: Buffer[] = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Header
      doc.fontSize(20).text(options.title || 'Analytics Report', { align: 'center' });
      doc.moveDown();

      // Content
      doc.fontSize(12).text(JSON.stringify(data, null, 2));

      doc.end();
    });
  }

  async generateExcel(data: any, options: any = {}): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Report');

    // Add headers
    worksheet.columns = [
      { header: 'Metric', key: 'metric', width: 30 },
      { header: 'Value', key: 'value', width: 20 }
    ];

    // Add data
    Object.entries(data).forEach(([key, value]) => {
      worksheet.addRow({ metric: key, value: String(value) });
    });

    return await workbook.xlsx.writeBuffer() as Buffer;
  }

  async generateCSV(data: any): Promise<string> {
    const headers = Object.keys(data).join(',');
    const values = Object.values(data).join(',');
    return `${headers}\n${values}`;
  }
}
