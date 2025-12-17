import { gasClient } from '../clients/gas.client';
import { Seat } from '../types';

class SheetsService {
  markOrderSent(orderId: string, actor: string) {
    return gasClient.markOrderSent(orderId, actor);
  }

  listRecentActiveOrders(limit = 10) {
    return gasClient.listRecentActiveOrders(limit);
  }

  listAccountIdentities(platform: string, seatMode?: string) {
    return gasClient.listAccountIdentities(platform, seatMode);
  }

  // Used for in-memory deduping in the controller; no-op for real client.
  addAccountIdentity(_account: string) {
    // Intentionally left blank. The real source of truth is Google Sheets.
  }

  async replaceSeatWithReason(seat_id: string, actor: string, reason: string): Promise<Seat> {
    const seat = await gasClient.replaceSeat({
      seat_id,
      order_id: '',
      product_id: '',
      buyer_id: '',
      buyer_email: '',
      actor,
      reason,
    });
    return seat;
  }
}

export const sheetsService = new SheetsService();
