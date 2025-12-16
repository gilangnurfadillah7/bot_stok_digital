import { FAKE_MODE } from '../config';

export const seatService = {
    replaceSeatWithReason: async (seatId: string, actor: string, reason: string) => {
        if (FAKE_MODE && seatId === 'replaced_seat') {
            return { seat_id: seatId, account_id: 'new_mock_acc', end_date: '2026-01-01', already_replaced: true };
        }
        return { seat_id: seatId, account_id: 'new_mock_acc', end_date: '2026-01-01', already_replaced: false };
    },
    listExpiringToday: async () => ([{ seat_id: 'exp_seat', buyer_id: 'buyer1', end_date: '2025-12-17' }]),
    confirmRenew: async (seatId: string, actor: string) => ({ already_renewed: seatId === 'renewed_seat' }),
    skipRenew: async (seatId: string, actor: string) => ({ already_skipped: seatId === 'skipped_seat' }),
};
