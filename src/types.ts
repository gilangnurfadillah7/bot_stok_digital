export type Role = 'OWNER' | 'ADMIN';

export type AdminStatus = 'ACTIVE' | 'INACTIVE';

export interface AdminUser {
  telegram_username: string;
  role: Role;
  status: AdminStatus;
}

export interface Product {
  product_id: string;
  product_name?: string;
  platform: string;
  mode: 'sharing' | 'private';
  duration_days: number;
  active: boolean;
}

export interface Order {
  order_id: string;
  product_id: string;
  platform: string;
  channel: string;
  buyer_id: string;
  buyer_email: string;
  status: string;
  assigned_admin?: string;
  created_at: string;
}

export type SeatStatus = 'ACTIVE' | 'PENDING_CONFIRM' | 'RESERVED' | 'RELEASED' | 'PROBLEM';

export interface Seat {
  seat_id: string;
  account_id: string;
  order_id: string;
  buyer_id: string;
  buyer_email: string;
  start_date: string;
  end_date: string;
  status: SeatStatus;
  released_at?: string;
}

export interface AssignSeatPayload {
  order_id: string;
  product_id: string;
  buyer_id: string;
  buyer_email: string;
  actor: string;
}

export interface ReplaceSeatPayload {
  seat_id: string;
  order_id?: string;
  product_id?: string;
  buyer_id: string;
  buyer_email: string;
  actor: string;
  reason?: string;
}

export interface GasResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface ExpiringSeatSummary {
  seat_id: string;
  buyer_id: string;
  buyer_email: string;
  end_date: string;
  account_id: string;
  order_id: string;
}

export interface StockSummary {
  platform: string;
  mode: 'sharing' | 'private';
  total_accounts: number;
  used_slots: number;
  free_slots: number;
  released_slots: number;
}

export interface SalesSummary {
  platform: string;
  channel: string;
  orders: number;
  seats: number;
  revenue: number;
}

export interface TelegramCallbackData {
  action: string;
  payload?: Record<string, string>;
}

export interface PendingInput {
  action:
    | 'NEW_ORDER_BUYER'
    | 'ORDER_CHANNEL'
    | 'ORDER_DURATION'
    | 'REPLACE_SEAT'
    | 'CANCEL_REASON'
    | 'RESTOCK_ACCOUNTS';
  meta: Record<string, string>;
}

export interface RestockAccountInput {
  platform: string;
  mode: 'sharing' | 'private';
  email: string;
  max_slot: number;
  expired_at?: string;
  status?: string;
}
