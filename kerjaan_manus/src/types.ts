export type PendingInput = {
    action: string;
    meta: Record<string, any>;
};

export type Product = {
    product_id: string;
    product_name: string;
    platform: string;
    mode: string;
    duration_days: number;
};

export type AccountResult = {
    account_id: string;
};

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
