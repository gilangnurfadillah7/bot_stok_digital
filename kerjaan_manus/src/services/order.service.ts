import { FAKE_MODE } from '../config';

export const orderService = {
    createAndAssignSeat: async (data: any) => {
        if (FAKE_MODE && data.buyer_id === 'error_buyer') {
            throw new Error('Stok habis untuk produk ini.');
        }
        return { seat: { account_id: 'mock_acc', end_date: '2026-01-01', seat_id: 'mock_seat_id' }, orderId: 'mock_order_id' };
    },
    markOrderSent: async (orderId: string, actor: string) => {
        if (FAKE_MODE && orderId === 'sent_order') {
            return { already_sent: true };
        }
        return { already_sent: false };
    },
    cancelOrder: async (orderId: string, reason: string, actor: string) => ({}),
};
