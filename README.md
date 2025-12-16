# Telegram Stock Operations Bot (Elysia.js)

Backend for a private Telegram bot that manages account stock and seats using Google Sheets through a Google Apps Script Web App.

## Tech Stack
- Node.js runtime (works with Bun via ESM)
- Elysia.js HTTP server
- Telegram Bot API (webhook)
- Google Apps Script Web App (as API gateway to Google Sheets)

## Prerequisites
- Telegram bot token
- Deployed Google Apps Script Web App exposing the endpoints used in `src/clients/gas.client.ts`
- Node 18+ (or Bun 1.1+) installed

## Env Vars
Create `.env` with:
```
PORT=3000
TELEGRAM_BOT_TOKEN=xxxx
TELEGRAM_WEBHOOK_SECRET=optional-secret-from-telegram
TELEGRAM_OWNER_USERNAME=ownerusername
TELEGRAM_ALERT_CHAT_ID=123456789         # chat id for daily expiring push (optional)
GAS_BASE_URL=https://script.google.com/macros/s/xxx/exec
GAS_API_KEY=your-gas-key
DAILY_REMINDER_HOUR_WIB=19               # optional override
```

## Scripts
- `npm run dev` — start server with live TS via `tsx`
- `npm run build` — type-check and emit JS to `dist`
- `npm start` — run compiled server

## Webhook Setup
Call Telegram once (example):
```
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"https://your-domain.com/telegram/webhook\",\"secret_token\":\"$TELEGRAM_WEBHOOK_SECRET\"}"
```

## Main Flows (all via inline buttons)
- **Order Baru / Kirim Akun** → pilih produk → kirim buyer_id & email (force-reply) → bot buat order + assign seat FIFO; order tetap `PENDING_SEND` sampai `/order/sent` dipanggil.
- **Replace Akun Bermasalah** → kirim `seatId productId buyerId buyerEmail` → bot assign seat baru, order tetap aktif.
- **Cancel / Refund** → kirim `orderId alasan`; jika sudah dikirim (`already_sent=true`) wajib sertakan `confirm=true`, lalu seat direlease & order dibatalkan.
- **Expiring Hari Ini** → tombol `[Renew] [Do Not Renew]`; bot juga push harian 19:00 WIB ke `TELEGRAM_ALERT_CHAT_ID`.
- **Report** → ringkas Sales atau Stock & Slot (read-only).
- **Restok / Kelola Admin** → read-only reminders; operasional dilakukan di Google Sheets.

## Notes
- All access is admin-gated. If GAS admin lookup fails, `TELEGRAM_OWNER_USERNAME` works as fallback OWNER.
- No record deletions; services rely on status transitions enforced by the GAS API.
- GAS: `/seat/assign` hanya buat/assign seat, order tetap `PENDING_SEND`; `/order/sent` transisi ke `ACTIVE`. `/order/cancel` dengan `already_sent=true` butuh `confirm=true`.
- GAS client memanggil Web App via query param `?path=/...&key=...` (lebih stabil di Apps Script dibanding path di URL /exec/...).
- GAS endpoints implement FIFO seat assignment and business rules described in the specification.
