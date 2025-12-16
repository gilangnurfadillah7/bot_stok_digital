import 'dotenv/config';

const requireEnv = (key: string, fallback?: string) => {
  const value = process.env[key] ?? fallback;
  if (!value) {
    throw new Error(`Missing required env ${key}`);
  }
  return value;
};

export const config = {
  port: Number(process.env.PORT ?? 3000),
  telegramToken: requireEnv('TELEGRAM_BOT_TOKEN'),
  telegramSecret: process.env.TELEGRAM_WEBHOOK_SECRET ?? '',
  ownerUsername: process.env.TELEGRAM_OWNER_USERNAME ?? '',
  alertChatId: process.env.TELEGRAM_ALERT_CHAT_ID,
  sheets: {
    credentialsPath: requireEnv('GOOGLE_SHEETS_CREDENTIALS_PATH'),
    spreadsheetId: requireEnv('GOOGLE_SHEETS_SPREADSHEET_ID'),
  },
  dailyReminderHourWIB: Number(process.env.DAILY_REMINDER_HOUR_WIB ?? 19),
};
