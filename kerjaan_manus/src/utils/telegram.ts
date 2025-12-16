import { FAKE_MODE } from '../config';

export type InlineKeyboardMarkup = {
    inline_keyboard: { text: string; callback_data: string }[][];
};

export const telegramClient = {
    sendMessage: async (chatId: number, text: string, options?: any) => {
        if (FAKE_MODE) {
            console.log(`[TG:SEND] Chat ${chatId}: ${text.split('\\n')[0]}...`);
            if (options?.reply_markup) {
                console.log(`[TG:KEYBOARD] ${JSON.stringify(options.reply_markup.inline_keyboard.map((row: any) => row.map((btn: any) => btn.text)))}`);
            }
        } else {
            // Real implementation...
        }
        return { message_id: Math.floor(Math.random() * 1000) };
    },
    answerCallbackQuery: async (callbackId: string, text: string, showAlert: boolean = false) => {
        if (FAKE_MODE) {
            console.log(`[TG:TOAST] Callback ${callbackId}: ${text} (Alert: ${showAlert})`);
        } else {
            // Real implementation...
        }
    },
    editMessageReplyMarkup: async (chatId: number, messageId: number, reply_markup: InlineKeyboardMarkup) => {
        if (FAKE_MODE) {
            const keyboard = reply_markup.inline_keyboard.length > 0 ? 'EDITED' : 'REMOVED';
            console.log(`[TG:EDIT] Chat ${chatId}, Msg ${messageId}: Keyboard ${keyboard}`);
        } else {
            // Real implementation...
        }
    },
};
