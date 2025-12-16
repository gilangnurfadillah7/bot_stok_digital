import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { google, sheets_v4 } from 'googleapis';
import { config } from '../config';
import {
  AdminUser,
  AssignSeatPayload,
  ExpiringSeatSummary,
  Product,
  ReplaceSeatPayload,
  Seat,
  StockSummary,
  RestockAccountInput,
} from '../types';

type RawTable = { headers: string[]; rows: any[][] };

const ORDER_STATUS = {
  PENDING_SEND: 'PENDING_SEND',
  ACTIVE: 'ACTIVE',
  CANCELLED: 'CANCELLED',
} as const;

const SEAT_STATUS = {
  ACTIVE: 'ACTIVE',
  RESERVED: 'RESERVED',
  PENDING_CONFIRM: 'PENDING_CONFIRM',
  RELEASED: 'RELEASED',
  PROBLEM: 'PROBLEM',
} as const;

const SHEET = {
  ACCOUNTS: 'ACCOUNTS',
  PRODUCTS: 'PRODUCTS',
  ORDERS: 'ORDERS',
  SEATS: 'SEATS',
  ADMIN_USERS: 'ADMIN_USERS',
  LOGS: 'LOGS',
};

const colLetter = (col: number) => {
  let c = col;
  let s = '';
  while (c > 0) {
    const m = (c - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    c = Math.floor((c - m) / 26);
  }
  return s || 'A';
};

class GasClient {
  private sheets!: sheets_v4.Sheets;
  private spreadsheetId = config.sheets.spreadsheetId;
  private ready: Promise<void>;

  constructor() {
    this.ready = this.init();
  }

  private async init() {
    const credRaw = fs.readFileSync(config.sheets.credentialsPath, 'utf8');
    const credentials = JSON.parse(credRaw);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    this.sheets = google.sheets({ version: 'v4', auth });
  }

  private async getTable(sheetName: string): Promise<RawTable> {
    await this.ready;
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: sheetName,
    });
    const values = res.data.values || [];
    const headers = (values.shift() || []) as string[];
    return { headers, rows: values };
  }

  private async appendRow(sheet: string, headers: string[], obj: Record<string, any>) {
    await this.ready;
    const row = headers.map((h) => obj[h]);
    await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: sheet,
      valueInputOption: 'RAW',
      requestBody: { values: [row] },
    });
  }

  private async updateRow(sheet: string, rowIndex1Based: number, headers: string[], updates: Record<string, any>) {
    await this.ready;
    const cols = headers.length;
    const endCol = colLetter(cols);
    const range = `${sheet}!A${rowIndex1Based}:${endCol}${rowIndex1Based}`;
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range,
    });
    const current = res.data.values?.[0] ?? headers.map(() => '');
    headers.forEach((h, i) => {
      if (updates.hasOwnProperty(h)) current[i] = updates[h];
    });
    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range,
      valueInputOption: 'RAW',
      requestBody: { values: [current] },
    });
  }

  private isoNow() {
    return new Date().toISOString();
  }

  private isActive(val: any) {
    const v = (val || '').toString().toLowerCase();
    return v === 'active' || v === 'aktif' || v === 'true' || v === '1';
  }

  private addDays(date: Date, days: number) {
    const d = new Date(date.getTime());
    d.setDate(d.getDate() + Number(days));
    return d;
  }

  private toObject(headers: string[], row: any[]): Record<string, any> {
    const o: Record<string, any> = {};
    headers.forEach((h, i) => (o[h] = row[i]));
    return o;
  }

  async log(action: string, actor: string, refId: string, note?: string) {
    try {
      const { headers } = await this.getTable(SHEET.LOGS);
      await this.appendRow(SHEET.LOGS, headers, {
        timestamp: this.isoNow(),
        action,
        actor,
        ref_id: refId,
        note: note || '',
      });
    } catch {
      // ignore logging errors
    }
  }

  async getAdminByUsername(username: string): Promise<AdminUser> {
    const { headers, rows } = await this.getTable(SHEET.ADMIN_USERS);
    const idxUser = headers.indexOf('telegram_username');
    const idxStatus = headers.indexOf('status');
    const idxRole = headers.indexOf('role');
    const row = rows.find((r) => (r[idxUser] || '').toString().toLowerCase() === username.toLowerCase());
    if (!row) throw new Error('Admin not found');
    if (!this.isActive(row[idxStatus])) throw new Error('Admin not active');
    return {
      telegram_username: row[idxUser],
      role: row[idxRole],
      status: 'ACTIVE',
    };
  }

  async listActiveProducts(): Promise<Product[]> {
    const { headers, rows } = await this.getTable(SHEET.PRODUCTS);
    const idxId = headers.indexOf('product_id');
    const idxPlatform = headers.indexOf('platform');
    const idxMode = headers.indexOf('mode');
    const idxDuration = headers.indexOf('duration_days');
    const idxActive = headers.indexOf('active');
    return rows
      .filter((r) => this.isActive(r[idxActive]))
      .map((r) => ({
        product_id: r[idxId],
        platform: r[idxPlatform],
        mode: (r[idxMode] || 'sharing').toLowerCase() as 'sharing' | 'private',
        duration_days: Number(r[idxDuration] || 0),
        active: true,
      }));
  }

  private async findProductById(productId: string): Promise<Product> {
    const products = await this.listActiveProducts();
    const p = products.find((x) => x.product_id === productId);
    if (!p) throw new Error('Product not active');
    return p;
  }

  async createOrder(data: {
    product_id: string;
    platform: string;
    channel: string;
    buyer_id: string;
    buyer_email: string;
    actor: string;
  }): Promise<{ order_id: string }> {
    const product = await this.findProductById(data.product_id);
    const { headers } = await this.getTable(SHEET.ORDERS);
    const orderId = `ORD-${randomUUID()}`;
    await this.appendRow(SHEET.ORDERS, headers, {
      order_id: orderId,
      product_id: data.product_id,
      platform: data.platform,
      channel: data.channel,
      buyer_id: data.buyer_id,
      buyer_email: data.buyer_email,
      status: ORDER_STATUS.PENDING_SEND,
      assigned_admin: data.actor,
      created_at: this.isoNow(),
    });
    await this.log('ORDER_CREATED', data.actor, orderId, `product ${product.product_id}`);
    return { order_id: orderId };
  }

  private async getOrderContext(orderId: string) {
    const orderTable = await this.getTable(SHEET.ORDERS);
    const idxId = orderTable.headers.indexOf('order_id');
    const rowIdx0 = orderTable.rows.findIndex((r) => r[idxId] === orderId);
    if (rowIdx0 === -1) throw new Error('Order not found');
    const order = this.toObject(orderTable.headers, orderTable.rows[rowIdx0]);
    const product = await this.findProductById(order.product_id);
    return {
      order,
      orderHeaders: orderTable.headers,
      orderRowNumber: rowIdx0 + 2,
      product,
    };
  }

  private async getSeatsTable() {
    return this.getTable(SHEET.SEATS);
  }

  private countUsedSlots(seats: RawTable['rows'], seatHeaders: string[]) {
    const idxStatus = seatHeaders.indexOf('status');
    const idxAccount = seatHeaders.indexOf('account_id');
    const used: Record<string, number> = {};
    seats.forEach((r) => {
      const stat = r[idxStatus];
      const acc = r[idxAccount];
      if (
        stat === SEAT_STATUS.ACTIVE ||
        stat === SEAT_STATUS.PENDING_CONFIRM ||
        stat === SEAT_STATUS.RESERVED
      ) {
        used[acc] = (used[acc] || 0) + 1;
      }
    });
    return used;
  }

  async assignSeat(payload: AssignSeatPayload): Promise<Seat> {
    const orderCtx = await this.getOrderContext(payload.order_id);
    if (orderCtx.order.status !== ORDER_STATUS.PENDING_SEND) {
      throw new Error('seat assignment allowed only when order status = PENDING_SEND');
    }

    const durationDays = Number(payload.duration_days ?? orderCtx.product.duration_days ?? 0);

    // existing seat?
    const seatTable = await this.getSeatsTable();
    const idxOrder = seatTable.headers.indexOf('order_id');
    const idxStatus = seatTable.headers.indexOf('status');
    const idxSeatId = seatTable.headers.indexOf('seat_id');
    const idxAcc = seatTable.headers.indexOf('account_id');
    const idxEnd = seatTable.headers.indexOf('end_date');
    const keepStatuses = [SEAT_STATUS.ACTIVE, SEAT_STATUS.PENDING_CONFIRM, SEAT_STATUS.RESERVED];
    const existing = seatTable.rows.find((r) => r[idxOrder] === payload.order_id && keepStatuses.includes(r[idxStatus]));
    if (existing) {
      return {
        seat_id: existing[idxSeatId],
        account_id: existing[idxAcc],
        order_id: payload.order_id,
        buyer_id: payload.buyer_id,
        buyer_email: payload.buyer_email,
        start_date: '',
        end_date: existing[idxEnd],
        status: existing[idxStatus] as any,
      };
    }

    const accountsTable = await this.getTable(SHEET.ACCOUNTS);
    const accIdxId = accountsTable.headers.indexOf('account_id');
    const accIdxMode = accountsTable.headers.indexOf('mode');
    const accIdxStatus = accountsTable.headers.indexOf('status');
    const accIdxMaxSlot = accountsTable.headers.indexOf('max_slot');

    const seatIdxReleasedAt = seatTable.headers.indexOf('released_at');

    const isPrivate = String(orderCtx.product.mode).toLowerCase() === 'private';
    const usedSlots = this.countUsedSlots(seatTable.rows, seatTable.headers);

    // reuse released seat FIFO (sharing)
    if (!isPrivate) {
      const releasedSeats = seatTable.rows
        .map((r, i) => ({ row: r, idx: i }))
        .filter((r) => r.row[idxStatus] === SEAT_STATUS.RELEASED)
        .sort((a, b) => {
          const da = a.row[seatIdxReleasedAt] ? new Date(a.row[seatIdxReleasedAt]) : new Date(0);
          const db = b.row[seatIdxReleasedAt] ? new Date(b.row[seatIdxReleasedAt]) : new Date(0);
          return da.getTime() - db.getTime();
        });
      if (releasedSeats.length) {
        const pick = releasedSeats[0];
        const rowNumber = pick.idx + 2;
        const nowIso = this.isoNow();
        const endDate = this.addDays(new Date(), durationDays).toISOString();
        await this.updateRow(SHEET.SEATS, rowNumber, seatTable.headers, {
          status: SEAT_STATUS.RESERVED,
          order_id: payload.order_id,
          buyer_id: payload.buyer_id,
          buyer_email: payload.buyer_email,
          start_date: nowIso,
          end_date: endDate,
          released_at: '',
        });
        await this.log('SEAT_ASSIGNED', payload.actor, payload.order_id, `reuse seat ${pick.row[idxSeatId]}`);
        return {
          seat_id: pick.row[idxSeatId],
          account_id: pick.row[idxAcc],
          order_id: payload.order_id,
          buyer_id: payload.buyer_id,
          buyer_email: payload.buyer_email,
          start_date: nowIso,
          end_date: endDate,
          status: SEAT_STATUS.RESERVED,
        };
      }
    }

    const candidates = accountsTable.rows
      .map((r, i) => ({ row: r, idx: i }))
      .filter((r) => this.isActive(r.row[accIdxStatus]))
      .filter((r) => String(r.row[accIdxMode]).toLowerCase() === (isPrivate ? 'private' : 'sharing'))
      .filter((r) => {
        const maxSlot = Number(r.row[accIdxMaxSlot] || 1);
        const used = usedSlots[r.row[accIdxId]] || 0;
        return isPrivate ? used === 0 : used < maxSlot;
      })
      .sort((a, b) => a.idx - b.idx);

    if (!candidates.length) {
      throw new Error('NEED_NEW_ACCOUNT');
    }

    const account = candidates[0].row;
    const accountId = account[accIdxId];
    const seatId = `SEAT-${randomUUID()}`;
    const nowIso = this.isoNow();
    const endDate = this.addDays(new Date(), durationDays).toISOString();

    await this.appendRow(SHEET.SEATS, seatTable.headers, {
      seat_id: seatId,
      account_id: accountId,
      order_id: payload.order_id,
      buyer_id: payload.buyer_id,
      buyer_email: payload.buyer_email,
      start_date: nowIso,
      end_date: endDate,
      status: SEAT_STATUS.RESERVED as any,
      released_at: '',
    });

    await this.log('SEAT_ASSIGNED', payload.actor, payload.order_id, `seat ${seatId} acc ${accountId}`);
    return {
      seat_id: seatId,
      account_id: accountId,
      order_id: payload.order_id,
      buyer_id: payload.buyer_id,
      buyer_email: payload.buyer_email,
      start_date: nowIso,
      end_date: endDate,
      status: SEAT_STATUS.RESERVED as any,
    };
  }

  async replaceSeat(payload: ReplaceSeatPayload): Promise<Seat> {
    if (!payload.reason) payload.reason = 'problem';
    const seatTable = await this.getSeatsTable();
    const idxSeat = seatTable.headers.indexOf('seat_id');
    const idxOrder = seatTable.headers.indexOf('order_id');
    const rowIdx0 = seatTable.rows.findIndex((r) => r[idxSeat] === payload.seat_id);
    if (rowIdx0 === -1) throw new Error('Seat not found');
    const seatObj = this.toObject(seatTable.headers, seatTable.rows[rowIdx0]);

    // mark problem
    await this.updateRow(SHEET.SEATS, rowIdx0 + 2, seatTable.headers, { status: SEAT_STATUS.PROBLEM });
    await this.log('SEAT_MARK_PROBLEM', payload.actor, payload.seat_id, payload.reason);

    // assign new seat (ACTIVE)
    const seat = await this.assignSeat({
      order_id: seatObj.order_id,
      product_id: seatObj.product_id || payload.product_id || '',
      buyer_id: seatObj.buyer_id || payload.buyer_id,
      buyer_email: seatObj.buyer_email || payload.buyer_email,
      actor: payload.actor,
    });

    // activate immediately
    await this.activateReservedSeat(seat.seat_id);
    await this.log('SEAT_REPLACED', payload.actor, seatObj.order_id, `old ${payload.seat_id} -> ${seat.seat_id}`);
    return { ...seat, status: SEAT_STATUS.ACTIVE };
  }

  private async activateReservedSeat(seatId: string) {
    const seatTable = await this.getSeatsTable();
    const idxSeat = seatTable.headers.indexOf('seat_id');
    const idxStatus = seatTable.headers.indexOf('status');
    const idxStart = seatTable.headers.indexOf('start_date');
    const idxEnd = seatTable.headers.indexOf('end_date');
    const rowIdx0 = seatTable.rows.findIndex((r) => r[idxSeat] === seatId);
    if (rowIdx0 === -1) throw new Error('Seat not found');
    const current = seatTable.rows[rowIdx0];
    const updates: Record<string, any> = { status: SEAT_STATUS.ACTIVE };
    if (!current[idxStart]) updates.start_date = this.isoNow();
    if (!current[idxEnd]) updates.end_date = this.addDays(new Date(), 0).toISOString();
    await this.updateRow(SHEET.SEATS, rowIdx0 + 2, seatTable.headers, updates);
  }

  async releaseSeat(seatId: string, reason: string, actor: string): Promise<Seat> {
    const seatTable = await this.getSeatsTable();
    const idxSeat = seatTable.headers.indexOf('seat_id');
    const rowIdx0 = seatTable.rows.findIndex((r) => r[idxSeat] === seatId);
    if (rowIdx0 === -1) throw new Error('Seat not found');
    await this.updateRow(SHEET.SEATS, rowIdx0 + 2, seatTable.headers, {
      status: SEAT_STATUS.RELEASED,
      released_at: this.isoNow(),
    });
    await this.log('SEAT_RELEASE', actor, seatId, reason);
    const row = seatTable.rows[rowIdx0];
    return this.toObject(seatTable.headers, row) as Seat;
  }

  async confirmRenew(seatId: string, actor: string) {
    const seatInfo = await this.findSeat(seatId);
    const orderCtx = await this.getOrderContext(seatInfo.seatObj.order_id);
    const duration = Number(orderCtx.product.duration_days);
    const currentEnd = seatInfo.seatObj.end_date ? new Date(seatInfo.seatObj.end_date) : new Date();
    const newEnd = this.addDays(currentEnd, duration);
    await this.updateRow(SHEET.SEATS, seatInfo.seatRowIdx, seatInfo.seatHeaders, {
      status: SEAT_STATUS.ACTIVE,
      end_date: newEnd.toISOString(),
      released_at: '',
    });
    await this.log('SEAT_RENEWED', actor, seatId, `order ${seatInfo.seatObj.order_id}`);
    return { ...seatInfo.seatObj, end_date: newEnd.toISOString(), status: SEAT_STATUS.ACTIVE } as any;
  }

  async skipRenew(seatId: string, actor: string) {
    return this.releaseSeat(seatId, 'skip_renew', actor);
  }

  async listExpiringSeats(dateIso: string): Promise<ExpiringSeatSummary[]> {
    const today = dateIso || new Date().toISOString().slice(0, 10);
    const seatTable = await this.getSeatsTable();
    const idxStatus = seatTable.headers.indexOf('status');
    const idxEnd = seatTable.headers.indexOf('end_date');
    const expiring: ExpiringSeatSummary[] = [];
    for (let i = 0; i < seatTable.rows.length; i++) {
      const r = seatTable.rows[i];
      const endDate = (r[idxEnd] || '').toString();
      if (r[idxStatus] === SEAT_STATUS.ACTIVE && endDate.slice(0, 10) === today) {
        // mark pending confirm
        await this.updateRow(SHEET.SEATS, i + 2, seatTable.headers, { status: SEAT_STATUS.PENDING_CONFIRM });
        const obj = this.toObject(seatTable.headers, r);
        expiring.push(obj as ExpiringSeatSummary);
      }
    }
    return expiring;
  }

  async reportStock(): Promise<StockSummary[]> {
    const accounts = await this.getTable(SHEET.ACCOUNTS);
    const seats = await this.getSeatsTable();
    const idxAccId = accounts.headers.indexOf('account_id');
    const idxMode = accounts.headers.indexOf('mode');
    const idxStatus = accounts.headers.indexOf('status');
    const idxMaxSlot = accounts.headers.indexOf('max_slot');

    const sIdxAccount = seats.headers.indexOf('account_id');
    const sIdxStatus = seats.headers.indexOf('status');

    const usedSlots = this.countUsedSlots(seats.rows, seats.headers);
    const activeSeats = seats.rows.filter((r) => r[sIdxStatus] === SEAT_STATUS.ACTIVE).length;
    const releasedSeats = seats.rows.filter((r) => r[sIdxStatus] === SEAT_STATUS.RELEASED).length;

    let fullAccounts = 0;
    let availableSlots = 0;
    accounts.rows.forEach((r) => {
      if (!this.isActive(r[idxStatus])) return;
      const maxSlot = Number(r[idxMaxSlot] || 1);
      const used = usedSlots[r[idxAccId]] || 0;
      if (used >= maxSlot) fullAccounts += 1;
      else availableSlots += Math.max(0, maxSlot - used);
    });

    return [
      {
        platform: 'ALL',
        mode: 'sharing',
        total_accounts: accounts.rows.length,
        used_slots: activeSeats,
        free_slots: availableSlots,
        released_slots: releasedSeats,
      },
    ];
  }

  async reportSales(): Promise<any> {
    const orders = await this.getTable(SHEET.ORDERS);
    const idxCreated = orders.headers.indexOf('created_at');
    const idxStatus = orders.headers.indexOf('status');
    const idxProduct = orders.headers.indexOf('product_id');
    const idxChannel = orders.headers.indexOf('channel');

    const filtered = orders.rows;
    const total_orders = filtered.length;
    const active = filtered.filter((r) => r[idxStatus] === ORDER_STATUS.ACTIVE).length;
    const cancelled = filtered.filter((r) => r[idxStatus] === ORDER_STATUS.CANCELLED).length;
    const replaced = 0;

    const group = (rows: any[][], idx: number) => {
      const map: Record<string, number> = {};
      rows.forEach((r) => {
        const k = r[idx] || 'UNKNOWN';
        map[k] = (map[k] || 0) + 1;
      });
      return Object.keys(map).map((k) => ({ key: k, count: map[k] }));
    };

    return {
      total_orders,
      active,
      cancelled,
      replaced,
      by_product: group(filtered, idxProduct),
      by_channel: group(filtered, idxChannel),
    };
  }

  async restockAccounts(payload: { accounts: RestockAccountInput[]; actor: string }) {
    const table = await this.getTable(SHEET.ACCOUNTS);
    const created: { account_id: string }[] = [];
    for (const acc of payload.accounts) {
      const accountId = `ACC-${randomUUID()}`;
      await this.appendRow(SHEET.ACCOUNTS, table.headers, {
        account_id: accountId,
        platform: acc.platform,
        mode: acc.mode,
        email: acc.email || '',
        max_slot: Number(acc.max_slot || 1),
        status: acc.status || 'active',
        expired_at: acc.expired_at || '',
        created_at: this.isoNow(),
      });
      await this.log('ACCOUNT_RESTOCK', payload.actor, accountId, `${acc.platform} ${acc.mode}`);
      created.push({ account_id: accountId });
    }
    return { accounts: created };
  }

  async cancelOrder(orderId: string, reason: string, actor: string) {
    const orderCtx = await this.getOrderContext(orderId);
    await this.updateRow(SHEET.ORDERS, orderCtx.orderRowNumber, orderCtx.orderHeaders, {
      status: ORDER_STATUS.CANCELLED,
    });

    const seats = await this.getSeatsTable();
    const idxOrder = seats.headers.indexOf('order_id');
    for (let i = 0; i < seats.rows.length; i++) {
      const r = seats.rows[i];
      if (r[idxOrder] === orderId) {
        await this.updateRow(SHEET.SEATS, i + 2, seats.headers, {
          status: SEAT_STATUS.RELEASED,
          released_at: this.isoNow(),
        });
      }
    }
    await this.log('ORDER_CANCELLED', actor, orderId, reason);
    return { order_status: ORDER_STATUS.CANCELLED };
  }

  async listExpiringSeatsToday() {
    const iso = new Date().toISOString().slice(0, 10);
    return this.listExpiringSeats(iso);
  }

  async markOrderSent(orderId: string, actor: string) {
    const orderCtx = await this.getOrderContext(orderId);
    const seatTable = await this.getSeatsTable();
    const idxOrder = seatTable.headers.indexOf('order_id');
    const idxStatus = seatTable.headers.indexOf('status');
    const idxStart = seatTable.headers.indexOf('start_date');
    const idxEnd = seatTable.headers.indexOf('end_date');
    for (let i = 0; i < seatTable.rows.length; i++) {
      const r = seatTable.rows[i];
      if (r[idxOrder] === orderId && r[idxStatus] === SEAT_STATUS.RESERVED) {
        const updates: Record<string, any> = { status: SEAT_STATUS.ACTIVE };
        if (!r[idxStart]) updates.start_date = this.isoNow();
        if (!r[idxEnd]) updates.end_date = this.addDays(new Date(), Number(orderCtx.product.duration_days || 0)).toISOString();
        await this.updateRow(SHEET.SEATS, i + 2, seatTable.headers, updates);
      }
    }
    await this.updateRow(SHEET.ORDERS, orderCtx.orderRowNumber, orderCtx.orderHeaders, { status: ORDER_STATUS.ACTIVE });
    await this.log('ORDER_SENT', actor, orderId, '');
    return { success: true };
  }

  async listRecentActiveOrders(limit = 10) {
    const orders = await this.getTable(SHEET.ORDERS);
    const seats = await this.getSeatsTable();
    const idxStatus = orders.headers.indexOf('status');
    const idxCreated = orders.headers.indexOf('created_at');
    const idxId = orders.headers.indexOf('order_id');
    const idxProd = orders.headers.indexOf('product_id');
    const idxBuyer = orders.headers.indexOf('buyer_id');
    const idxEmail = orders.headers.indexOf('buyer_email');
    const filtered = orders.rows
      .filter((r) => [ORDER_STATUS.PENDING_SEND, ORDER_STATUS.ACTIVE].includes(r[idxStatus]))
      .sort((a, b) => {
        const ta = a[idxCreated] ? new Date(a[idxCreated]).getTime() : 0;
        const tb = b[idxCreated] ? new Date(b[idxCreated]).getTime() : 0;
        return tb - ta;
      })
      .slice(0, limit);

    const sIdxOrder = seats.headers.indexOf('order_id');
    const sIdxSeat = seats.headers.indexOf('seat_id');
    const sIdxAcc = seats.headers.indexOf('account_id');
    const sIdxStatus = seats.headers.indexOf('status');

    return filtered.map((r) => {
      const order_id = r[idxId];
      const seatRow = seats.rows.find((s) => s[sIdxOrder] === order_id && s[sIdxStatus] !== SEAT_STATUS.RELEASED);
      return {
        order_id,
        product_id: r[idxProd],
        buyer_id: r[idxBuyer],
        buyer_email: r[idxEmail],
        seat_id: seatRow ? seatRow[sIdxSeat] : '',
        account_id: seatRow ? seatRow[sIdxAcc] : '',
        status: r[idxStatus],
        created_at: r[idxCreated],
      };
    });
  }

  async listAccountIdentities(platform: string): Promise<Set<string>> {
    const acc = await this.getTable(SHEET.ACCOUNTS);
    const idxPlatform = acc.headers.indexOf('platform');
    const idxEmail = acc.headers.indexOf('email');
    const set = new Set<string>();
    acc.rows.forEach((r) => {
      if (r[idxPlatform] === platform && r[idxEmail]) set.add(String(r[idxEmail]));
    });
    return set;
  }

  private async findSeat(seatId: string) {
    const seatSheet = await this.getSeatsTable();
    const idx = seatSheet.headers.indexOf('seat_id');
    const rowIdx0 = seatSheet.rows.findIndex((r) => r[idx] === seatId);
    if (rowIdx0 === -1) throw new Error('Seat not found');
    const seatObj = this.toObject(seatSheet.headers, seatSheet.rows[rowIdx0]);
    return {
      seatSheet,
      seatHeaders: seatSheet.headers,
      seatRowIdx: rowIdx0 + 2,
      seatObj,
    };
  }
}

export const gasClient = new GasClient();
