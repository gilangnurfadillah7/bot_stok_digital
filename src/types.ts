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
  seat_mode: 'PRIVATE' | 'SHARING' | 'HEAD';
  fulfillment_type: 'LOGIN' | 'INVITE';
  sharing_max_slot?: number;
  fallback_policy?: 'STRICT' | 'FALLBACK_PRIVATE_UNUSED_TO_SHARING';
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
  account_kind?: 'LOGIN' | 'HEAD';
  account_identity?: string;
  account_email?: string;
  seat_mode?: 'PRIVATE' | 'SHARING' | 'HEAD';
  order_id: string;
  buyer_id: string;
  buyer_email: string;
  start_date: string;
  end_date: string;
  status: SeatStatus;
  released_at?: string;
  already_replaced?: boolean;
  already_renewed?: boolean;
  already_skipped?: boolean;
  invite_email?: string;
  invite_status?: 'PENDING_INVITE' | 'INVITE_SENT';
  invite_sent_at?: string;
  fallback_used?: boolean;
}

export interface AssignSeatPayload {
  order_id: string;
  product_id: string;
  buyer_id: string;
  buyer_email: string;
  actor: string;
  duration_days?: number;
  invite_email?: string;
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
  mode: string;
  total_accounts: number;
  used_slots: number;
  free_slots: number;
  released_slots: number;
  full_accounts?: number;
  active_by_label?: Record<string, number>;
  free_by_label?: Record<string, number>;
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
    | 'NEW_ORDER_INVITE_EMAIL'
    | 'ORDER_CHANNEL'
    | 'ORDER_DURATION'
    | 'REPLACE_SEAT'
    | 'CANCEL_REASON'
    | 'ADMIN_ADD_PRODUCT'
    | 'ADMIN_PLATFORM'
    | 'ADMIN_DURATION_CUSTOM'
    | 'ADMIN_NAME_INPUT'
    | 'ADMIN_SHARING_SLOT_CUSTOM'
    | 'ADMIN_HEAD_SLOT_CUSTOM'
    | 'RESTOCK_EXPIRE'
    | 'RESTOCK_ACCOUNTS';
  meta: Record<string, string>;
}

export interface RestockAccountInput {
  platform: string;
  mode: string;
  account_kind: 'LOGIN' | 'HEAD';
  identity: string;
  email: string;
  max_slot: number;
  expired_at?: string;
  status?: string;
}

// Minimal account result shape returned from restock operations
export type AccountResult = {
  account_id: string;
};

// Telegram update shape used by the controller
export type TelegramUpdate = {
  message?: {
    message_id: number;
    chat: { id: number };
    text?: string;
    from?: { id: number; username?: string; first_name: string; last_name?: string };
  };
  callback_query?: {
    id: string;
    from: { id: number; username?: string; first_name: string; last_name?: string };
    data?: string;
    message?: { message_id: number; chat: { id: number } };
  };
};
