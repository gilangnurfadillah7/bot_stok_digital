import { gasClient } from '../clients/gas.client';
class ReportService {
  async stockSummary(): Promise<{ text: string; rows: any[] }> {
    const report = await gasClient.reportStock() as any;
    const text =
      `Aktif: ${report[0]?.used_slots ?? 0}\n` +
      `Released: ${report[0]?.released_slots ?? 0}\n` +
      `Akun Penuh: ${report[0]?.full_accounts ?? 'N/A'}\n` +
      `Slot Tersedia: ${report[0]?.free_slots ?? 0}`;
    return { text, rows: [] };
  }

  async salesSummary(): Promise<{ text: string; rows: any[] }> {
    const report = (await gasClient.reportSales()) as any;
    const lines = [
      `Total Orders: ${report.total_orders}`,
      `Active: ${report.active}`,
      `Cancelled: ${report.cancelled}`,
      `Replaced: ${report.replaced}`,
      '',
      'By Product:',
      ...(report.by_product || []).map((r: any) => `- ${r.key}: ${r.count}`),
      '',
      'By Channel:',
      ...(report.by_channel || []).map((r: any) => `- ${r.key}: ${r.count}`),
    ];
    return { text: lines.join('\n'), rows: [] };
  }
}

export const reportService = new ReportService();
