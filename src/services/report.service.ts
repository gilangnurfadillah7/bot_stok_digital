import { gasClient } from '../clients/gas.client';
class ReportService {
  async stockSummary(): Promise<{ text: string; rows: any[] }> {
    const report = await gasClient.reportStock() as any;
    const row = report[0] || {};
    const activeLines =
      row.active_by_label &&
      Object.entries(row.active_by_label)
        .map(([k, v]) => `- ${k}: ${v}`)
        .join('\n');
    const freeLines =
      row.free_by_label &&
      Object.entries(row.free_by_label)
        .map(([k, v]) => `- ${k}: ${v}`)
        .join('\n');
    const text =
      `Aktif: ${row.used_slots ?? 0}\n` +
      `Released: ${row.released_slots ?? 0}\n` +
      `Akun Penuh: ${row.full_accounts ?? 0}\n` +
      `Slot Tersedia: ${row.free_slots ?? 0}` +
      (activeLines ? `\n\nAktif per produk:\n${activeLines}` : '') +
      (freeLines ? `\n\nSlot tersedia:\n${freeLines}` : '');
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
