import { gasClient } from '../clients/gas.client';
import { Seat } from '../types';

class SheetsService {
  markOrderSent(orderId: string, actor: string) {
    return gasClient.markOrderSent(orderId, actor);
  }

  listRecentActiveOrders(limit = 10) {
    return gasClient.listRecentActiveOrders(limit);
  }

  listAccountIdentities(platform: string) {
    return gasClient.listAccountIdentities(platform);
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
