import { config } from '../config';

export type InlineKeyboardButton = {
  text: string;
  callback_data: string;
  url?: string;
};

export type InlineKeyboardMarkup = {
  inline_keyboard: InlineKeyboardButton[][];
};

interface SendMessageOptions {
  reply_markup?: InlineKeyboardMarkup;
  parse_mode?: 'MarkdownV2' | 'HTML' | 'Markdown';
  reply_to_message_id?: number;
  disable_notification?: boolean;
  force_reply?: boolean;
}

class TelegramClient {
  private baseUrl = `https://api.telegram.org/bot${config.telegramToken}`;

  async request<T>(method: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.baseUrl}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Telegram API error ${res.status}: ${text}`);
    }

    return (await res.json()) as T;
  }

  sendMessage(chatId: number | string, text: string, options: SendMessageOptions = {}) {
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      text,
      parse_mode: options.parse_mode ?? 'HTML',
      disable_notification: options.disable_notification,
    };

    if (options.reply_markup) payload.reply_markup = options.reply_markup;
    if (options.reply_to_message_id) payload.reply_to_message_id = options.reply_to_message_id;
    if (options.force_reply) payload.reply_markup = { force_reply: true };

    return this.request('sendMessage', payload);
  }

  editMessageText(chatId: number | string, messageId: number, text: string, replyMarkup?: InlineKeyboardMarkup) {
    return this.request('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML',
      reply_markup: replyMarkup,
    });
  }

  editMessageReplyMarkup(chatId: number | string, messageId: number, replyMarkup: InlineKeyboardMarkup) {
    return this.request('editMessageReplyMarkup', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: replyMarkup,
    });
  }

  answerCallbackQuery(callbackQueryId: string, text?: string, showAlert = false) {
    return this.request('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      text,
      show_alert: showAlert,
    });
  }
}

export const telegramClient = new TelegramClient();
