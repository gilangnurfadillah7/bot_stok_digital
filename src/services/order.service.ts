import { gasClient } from '../clients/gas.client';
import { AssignSeatPayload, ReplaceSeatPayload, Seat } from '../types';

class OrderService {
  async createAndAssignSeat(input: {
    product_id: string;
    platform: string;
    channel: string;
    buyer_id: string;
    buyer_email: string;
    actor: string;
  }): Promise<{ seat: Seat; orderId: string }> {
    const created = await gasClient.createOrder(input);
    const seat = await gasClient.assignSeat({
      order_id: created.order_id,
      product_id: input.product_id,
      buyer_id: input.buyer_id,
      buyer_email: input.buyer_email,
      actor: input.actor,
    } satisfies AssignSeatPayload);

    await gasClient.log('ORDER_ASSIGN', input.actor, created.order_id, `Seat ${seat.seat_id}`);
    return { seat, orderId: created.order_id };
  }

  async replaceSeat(payload: ReplaceSeatPayload) {
    const seat = await gasClient.replaceSeat(payload);
    await gasClient.log('SEAT_REPLACE', payload.actor, payload.order_id ?? seat.order_id, `Seat ${seat.seat_id}`);
    return seat;
  }

  async cancelOrder(orderId: string, reason: string, actor: string) {
    await gasClient.cancelOrder(orderId, reason, actor);
    await gasClient.log('ORDER_CANCEL', actor, orderId, reason);
  }

  async markOrderSent(orderId: string, actor: string) {
    await gasClient.markOrderSent(orderId, actor);
  }
}

export const orderService = new OrderService();
