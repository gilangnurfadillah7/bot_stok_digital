import { gasClient } from '../clients/gas.client';
import { ExpiringSeatSummary, Seat } from '../types';
import { sheetsService } from './sheets.service';

class SeatService {
  async listExpiringToday(): Promise<ExpiringSeatSummary[]> {
    const today = new Date();
    const iso = today.toISOString().slice(0, 10);
    return gasClient.listExpiringSeats(iso);
  }

  async confirmRenew(seatId: string, actor: string): Promise<any> {
    const seat = await gasClient.confirmRenew(seatId, actor);
    await gasClient.log('SEAT_RENEW', actor, seatId);
    return seat;
  }

  async skipRenew(seatId: string, actor: string): Promise<any> {
    const seat = await gasClient.skipRenew(seatId, actor);
    await gasClient.log('SEAT_SKIP_RENEW', actor, seatId);
    return seat;
  }

  async releaseSeat(seatId: string, reason: string, actor: string): Promise<Seat> {
    const seat = await gasClient.releaseSeat(seatId, reason, actor);
    await gasClient.log('SEAT_RELEASE', actor, seatId, reason);
    return seat;
  }

  async replaceSeatWithReason(seatId: string, actor: string, reason: string): Promise<any> {
    return sheetsService.replaceSeatWithReason(seatId, actor, reason);
  }
}

export const seatService = new SeatService();
