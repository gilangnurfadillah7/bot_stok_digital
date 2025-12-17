import { adminService } from '../services/admin.service';
import { orderService } from '../services/order.service';
import { reportService } from '../services/report.service';
import { seatService } from '../services/seat.service';
import { gasClient } from '../clients/gas.client';
import { sheetsService } from '../services/sheets.service';
import { decodeCallbackData, encodeCallbackData } from '../utils/callback';
import { telegramClient, InlineKeyboardMarkup } from '../utils/telegram';
import { PendingInput, Product, AccountResult, TelegramUpdate as TUpdate } from '../types';

// Re-declare types locally for clarity and to avoid circular dependency issues with the harness
type TelegramUser = {
  id: number;
  username?: string;
  first_name: string;
  last_name?: string;
};

type TelegramMessage = {
  message_id: number;
  chat: { id: number };
  text?: string;
  from?: TelegramUser;
};

type CallbackQuery = {
  id: string;
  from: TelegramUser;
  data?: string;
  message?: TelegramMessage;
};

// Use the imported type for the controller's public interface
type TelegramUpdate = TUpdate;

const pendingInputs = new Map<number, PendingInput>();
const restockBuffers = new Map<number, { product: Product; lines: string[]; expire_at?: string }>();
const RESTOCK_MAX_LINES = 30;

const durations = [
  { label: '7 hari', value: 7 },
  { label: '1 bulan', value: 30 },
  { label: '3 bulan', value: 90 },
  { label: '6 bulan', value: 180 },
  { label: '1 tahun', value: 365 },
];

const homeKeyboard = (isOwner: boolean): InlineKeyboardMarkup => ({
  inline_keyboard: [
    [{ text: '📦 Order Baru', callback_data: encodeCallbackData('ORDER_NEW') }],
    [{ text: '📤 Kirim / Invite Akun', callback_data: encodeCallbackData('INVITE') }],
    [{ text: '🔁 Akun Bermasalah', callback_data: encodeCallbackData('PROBLEM') }],
    [{ text: '❌ Cancel / Refund', callback_data: encodeCallbackData('CANCEL') }],
    [{ text: '⏰ Akun Expiring', callback_data: encodeCallbackData('EXPIRING') }],
    [{ text: '📊 Report', callback_data: encodeCallbackData('REPORT') }],
    [{ text: '📥 Restok Akun', callback_data: encodeCallbackData('RESTOCK') }],
    ...(isOwner ? [[{ text: '⚙️ Pengaturan', callback_data: encodeCallbackData('ADMIN') }]] : []),
  ],
});

const backOrCancel = (backAction: string) => ({
  inline_keyboard: [
    [
      { text: '⬅️ Kembali', callback_data: encodeCallbackData(backAction) },
      { text: '❌ Batal', callback_data: encodeCallbackData('HOME') },
    ],
  ],
});

const sendHome = async (chatId: number, isOwner: boolean) =>
  telegramClient.sendMessage(chatId, 'Pilih menu:', {
    reply_markup: homeKeyboard(isOwner),
  });

// --------- UTIL ---------
const listRecentActiveOrders = async (limit = 10) => sheetsService.listRecentActiveOrders(limit);

const editMessageReplyMarkup = async (chatId: number, messageId: number, reply_markup: InlineKeyboardMarkup) => {
  try {
    await telegramClient.editMessageReplyMarkup(chatId, messageId, reply_markup);
  } catch (e) {
    // Ignore error if message is too old or already edited
    console.warn(`Failed to edit message ${messageId} in chat ${chatId}: ${e}`);
  }
};

// --------- ORDER FLOW ----------
const sendOrderChannel = async (chatId: number) => {
  const keyboard: InlineKeyboardMarkup = {
    inline_keyboard: [
      [
        { text: '🛒 Shopee', callback_data: encodeCallbackData('ORDER_CH', { ch: 'Shopee' }) },
        { text: '🌐 Website', callback_data: encodeCallbackData('ORDER_CH', { ch: 'Website' }) },
      ],
      [{ text: '💬 Telegram', callback_data: encodeCallbackData('ORDER_CH', { ch: 'Telegram' }) }],
      ...backOrCancel('HOME').inline_keyboard,
    ],
  };
  await telegramClient.sendMessage(chatId, 'Order dari mana?', { reply_markup: keyboard });
};

const sendProductSelection = async (chatId: number, backAction: string, duration?: number, channel?: string) => {
  const products = await gasClient.listActiveProducts();
  if (!products.length) {
    await telegramClient.sendMessage(chatId, 'Tidak ada produk aktif. Tambahkan di sheet PRODUCTS.');
    return;
  }
  const rows: InlineKeyboardMarkup['inline_keyboard'] = products.map((p) => [
    {
      text: `${p.product_name || p.platform} (${p.seat_mode})`,
      callback_data: encodeCallbackData('ORDER_PICK', {
        pid: p.product_id,
        ch: channel || '',
        dur: String(duration ?? p.duration_days ?? 0),
      }),
    },
  ]);
  rows.push(...backOrCancel(backAction).inline_keyboard);
  await telegramClient.sendMessage(chatId, 'Pilih produk', { reply_markup: { inline_keyboard: rows } });
};

const sendDurationSelection = async (chatId: number, payload: Record<string, string>) => {
  const rows = durations.map((d) => [
    {
      text: d.label,
      callback_data: encodeCallbackData('ORDER_DURATION', { ...payload, dur: String(d.value) }),
    },
  ]);
  rows.push(...backOrCancel('ORDER_NEW').inline_keyboard);
  await telegramClient.sendMessage(chatId, 'Pilih durasi', { reply_markup: { inline_keyboard: rows } });
};

const askBuyerId = async (chatId: number) => {
  await telegramClient.sendMessage(chatId, 'Masukkan username pembeli (contoh: shopee_user123)', { force_reply: true });
};

// --------- RESTOCK FLOW ----------
const startRestock = async (chatId: number) => {
  const products = await gasClient.listActiveProducts();
  if (!products.length) {
    await telegramClient.sendMessage(chatId, 'Tidak ada produk aktif. Tambahkan di sheet PRODUCTS.');
    return;
  }
  const rows: InlineKeyboardMarkup['inline_keyboard'] = products.map((p) => [
    {
      text: `${p.product_name || p.platform} (${p.seat_mode})`,
      callback_data: encodeCallbackData('RESTOCK_PICK', { product_id: p.product_id }),
    },
  ]);
  rows.push(...backOrCancel('HOME').inline_keyboard);
  await telegramClient.sendMessage(chatId, 'Restok akun untuk produk apa?', { reply_markup: { inline_keyboard: rows } });
};

const restockPrompt = `Masukkan daftar akun (1 baris = 1 akun) - maks ${RESTOCK_MAX_LINES} akun per restok

Bebas format:
- email
- email|password
- email|password|profile|pin

Contoh:
akun1@gmail.com|pass
akun2@gmail.com

Ketik /selesai jika sudah selesai input.`;
const restockExpirePrompt =
  'Pilih masa berlaku akun untuk stok ini:\n- 30 hari\n- 1 tahun\n- Custom (isi hari)\nAtau pilih kosong jika tanpa tanggal.';

const adminAddProductPrompt =
  'Format: platform|seat_mode(PRIVATE/SHARING/HEAD)|durasi_hari|nama_opsional|fulfillment(LOGIN/INVITE)_opsional|sharing_max_slot_opsional|fallback_policy(STRICT/FALLBACK_PRIVATE_UNUSED_TO_SHARING)_opsional\nContoh: Netflix|HEAD|30|Netflix Head|INVITE|1|STRICT';

const sendAdminMenu = async (chatId: number) => {
  const keyboard: InlineKeyboardMarkup = {
    inline_keyboard: [
      [{ text: 'Tambah Platform/Produk', callback_data: encodeCallbackData('ADMIN_ADD_PRODUCT') }],
      ...backOrCancel('HOME').inline_keyboard,
    ],
  };
  await telegramClient.sendMessage(chatId, 'Menu Pengaturan:', { reply_markup: keyboard });
};

const restockExpireKeyboard = () => ({
  inline_keyboard: [
    [{ text: '30 hari', callback_data: encodeCallbackData('RESTOCK_EXPIRE_PRESET', { d: '30' }) }],
    [{ text: '1 tahun', callback_data: encodeCallbackData('RESTOCK_EXPIRE_PRESET', { d: '365' }) }],
    [{ text: 'Custom (isi hari)', callback_data: encodeCallbackData('RESTOCK_EXPIRE_CUSTOM') }],
    [{ text: 'Kosongkan', callback_data: encodeCallbackData('RESTOCK_EXPIRE_PRESET', { d: '0' }) }],
    ...backOrCancel('HOME').inline_keyboard,
  ],
});

const expireDateFromDays = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

// --------- REPORT ----------
const sendReportMenu = async (chatId: number) => {
  const keyboard: InlineKeyboardMarkup = {
    inline_keyboard: [
      [{ text: '📆 Hari Ini', callback_data: encodeCallbackData('REPORT_DAY') }],
      [{ text: '📅 Mingguan', callback_data: encodeCallbackData('REPORT_WEEK') }],
      [{ text: '📈 Bulanan', callback_data: encodeCallbackData('REPORT_MONTH') }],
      [{ text: '📦 Stok & Slot', callback_data: encodeCallbackData('REPORT_STOCK') }],
      ...backOrCancel('HOME').inline_keyboard,
    ],
  };
  await telegramClient.sendMessage(chatId, 'Pilih laporan', { reply_markup: keyboard });
};

// --------- PENDING INPUT HANDLER ----------
const handlePendingInput = async (message: TelegramMessage, adminUsername: string) => {
  const pending = pendingInputs.get(message.chat.id);
  if (!pending || !message.text) return false;

  // Clear pending state immediately as the message has been consumed
  // This is only for single-message inputs (NEW_ORDER_BUYER, CANCEL_REASON)
  // RESTOCK_EXPIRE and RESTOCK_ACCOUNTS manage their own state
  if (!['RESTOCK_ACCOUNTS', 'RESTOCK_EXPIRE'].includes(pending.action)) {
    pendingInputs.delete(message.chat.id);
  }

    if (pending.action === 'NEW_ORDER_BUYER') {
    try {
      const buyer_id = message.text.trim();
      const buyer_email = `${buyer_id}@unknown`;
      const productId = pending.meta.product_id;
      const platform = pending.meta.platform;
      const channel = pending.meta.channel || 'Telegram';
      const fulfillment = (pending.meta.fulfillment_type || '').toUpperCase();
      if (fulfillment === 'INVITE') {
        pendingInputs.set(message.chat.id, { action: 'NEW_ORDER_INVITE_EMAIL', meta: { ...pending.meta, buyer_id } });
        await telegramClient.sendMessage(message.chat.id, 'Masukkan email untuk kirim invite:', { force_reply: true });
        return true;
      }
      const durationDays = pending.meta.duration_days ? Number(pending.meta.duration_days) : undefined;

      const { seat, orderId } = await orderService.createAndAssignSeat({
        product_id: productId,
        platform,
        channel,
        buyer_id,
        buyer_email,
        actor: adminUsername,
        duration_days: durationDays,
      });

      const expire = seat.end_date ? new Date(seat.end_date).toLocaleDateString('id-ID') : '-';
      const accountDisplay = seat.account_identity || seat.account_email || seat.account_id;
      const fallbackNote = seat.fallback_used ? '\nFallback: memakai akun private dipromosikan ke sharing.' : '';
      await telegramClient.sendMessage(
        message.chat.id,
        `✅ Akun siap dikirim\n\nProduk: ${pending.meta.product_name || platform}\nMode: ${pending.meta.seat_mode}\nAkun: ${accountDisplay}\nBuyer: ${buyer_id}\nBerlaku sampai: ${expire}${fallbackNote}`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: 'Tandai Sudah Dikirim', callback_data: encodeCallbackData('ORDER_SENT', { order_id: orderId }) },
                { text: 'Ganti Akun', callback_data: encodeCallbackData('ORDER_REPLACE', { seat_id: seat.seat_id }) },
              ],
              [
                { text: 'Batalkan Order', callback_data: encodeCallbackData('ORDER_CANCEL', { order_id: orderId }) },
                { text: 'Kembali', callback_data: encodeCallbackData('HOME') },
              ],
            ],
          },
        }
      );
    } catch (err: any) {
      console.error('Order create error', err);
      await telegramClient.sendMessage(
        message.chat.id,
        `? Order gagal diproses.
${err?.message || 'Silakan coba lagi atau cek stok akun.'}`
      );
    }
  }

  if (pending.action === 'NEW_ORDER_INVITE_EMAIL') {
    try {
      const inviteEmail = message.text.trim();
      const buyer_id = pending.meta.buyer_id;
      const productId = pending.meta.product_id;
      const platform = pending.meta.platform;
      const channel = pending.meta.channel || 'Telegram';
      const durationDays = pending.meta.duration_days ? Number(pending.meta.duration_days) : undefined;

      const { seat, orderId } = await orderService.createAndAssignSeat({
        product_id: productId,
        platform,
        channel,
        buyer_id,
        buyer_email: inviteEmail,
        actor: adminUsername,
        duration_days: durationDays,
        invite_email: inviteEmail,
      });

      const expire = seat.end_date ? new Date(seat.end_date).toLocaleDateString('id-ID') : '-';
      const accountDisplay = seat.account_identity || seat.account_email || seat.account_id;
      await telegramClient.sendMessage(
        message.chat.id,
        `? Invite siap dikirim

Produk: ${pending.meta.product_name || platform}
Mode: ${pending.meta.seat_mode}
Akun: ${accountDisplay}
Buyer: ${buyer_id}
Invite ke: ${inviteEmail}
Berlaku sampai: ${expire}`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: 'Invite Terkirim', callback_data: encodeCallbackData('ORDER_SENT', { order_id: orderId }) },
                { text: 'Ganti Akun', callback_data: encodeCallbackData('ORDER_REPLACE', { seat_id: seat.seat_id }) },
              ],
              [
                { text: 'Batalkan Order', callback_data: encodeCallbackData('ORDER_CANCEL', { order_id: orderId }) },
                { text: 'Kembali', callback_data: encodeCallbackData('HOME') },
              ],
            ],
          },
        }
      );
    } catch (err: any) {
      console.error('Order invite error', err);
      await telegramClient.sendMessage(
        message.chat.id,
        `? Order gagal diproses.
${err?.message || 'Silakan coba lagi atau cek stok akun.'}`
      );
    }
  }

  if (pending.action === 'CANCEL_REASON') {
    const orderId = pending.meta.order_id || '';
    const reason = message.text.trim() || 'Tidak disebutkan';
    try {
      await orderService.cancelOrder(orderId, reason, adminUsername);
      await telegramClient.sendMessage(message.chat.id, `Order ${orderId} dibatalkan.\nAlasan: ${reason}`);
    } catch (err: any) {
      console.error('Cancel order error', err);
      await telegramClient.sendMessage(
        message.chat.id,
        `❌ Pembatalan order gagal.\n${err?.message || 'Silakan coba lagi.'}`
      );
    }
  }

  if (pending.action === 'ADMIN_ADD_PRODUCT') {
    const text = message.text.trim();
    if (text.toLowerCase() === 'batal') {
      await telegramClient.sendMessage(message.chat.id, 'Tambah platform dibatalkan.');
      return true;
    }

    const parts = text.split('|').map((p) => p.trim()).filter(Boolean);
    if (parts.length < 3) {
      pendingInputs.set(message.chat.id, pending);
      await telegramClient.sendMessage(
        message.chat.id,
        `Format salah.\n${adminAddProductPrompt}\n\nKetik batal untuk membatalkan.`,
        { reply_markup: backOrCancel('HOME') }
      );
      return true;
    }

    const [platformRaw, seatModeRaw, durationRaw, nameRaw, fulfillmentRaw, sharingSlotRaw, fallbackRaw] = parts;
    const seatMode = (seatModeRaw || '').toUpperCase();
    const allowedSeat = ['PRIVATE', 'SHARING', 'HEAD'];
    if (!allowedSeat.includes(seatMode)) {
      pendingInputs.set(message.chat.id, pending);
      await telegramClient.sendMessage(
        message.chat.id,
        'seat_mode harus PRIVATE/SHARING/HEAD. Contoh: Netflix|HEAD|30|Netflix Head',
        { reply_markup: backOrCancel('HOME') }
      );
      return true;
    }

    const durationDays = Number(durationRaw);
    if (!Number.isFinite(durationDays) || durationDays <= 0) {
      pendingInputs.set(message.chat.id, pending);
      await telegramClient.sendMessage(
        message.chat.id,
        'Durasi harus angka > 0. Contoh: Netflix|private|30',
        { reply_markup: backOrCancel('HOME') }
      );
      return true;
    }

    const fulfillment = (fulfillmentRaw || (seatMode === 'HEAD' ? 'INVITE' : 'LOGIN')).toUpperCase();
    const sharingMaxSlot = Number(sharingSlotRaw || (seatMode === 'SHARING' ? 1 : 0));
    const fallbackPolicy = (fallbackRaw || 'STRICT').toUpperCase();

    try {
      const result = await gasClient.addProduct({
        platform: platformRaw,
        mode: seatMode,
        seat_mode: seatMode,
        fulfillment_type: fulfillment,
        sharing_max_slot: sharingMaxSlot || undefined,
        fallback_policy: fallbackPolicy,
        duration_days: durationDays,
        product_name: nameRaw || platformRaw,
        active: true,
        actor: adminUsername,
      });
      await telegramClient.sendMessage(
        message.chat.id,
        `Produk ditambahkan.\nID: ${result.product_id}\nPlatform: ${platformRaw}\nSeat Mode: ${seatMode}\nFulfillment: ${fulfillment}\nDurasi: ${durationDays} hari\nSlot Sharing: ${
          sharingMaxSlot || '-'
        }\nFallback: ${fallbackPolicy}\nNama: ${nameRaw || platformRaw}\nStatus: active`
      );
    } catch (err: any) {
      console.error('Add product error', err);
      pendingInputs.set(message.chat.id, pending);
      await telegramClient.sendMessage(
        message.chat.id,
        `Gagal menambah produk.\n${err?.message || 'Silakan coba lagi.'}`,
        { reply_markup: backOrCancel('HOME') }
      );
    }
  }

  if (pending.action === 'RESTOCK_EXPIRE') {
    const buffer = restockBuffers.get(message.chat.id);
    if (!buffer) return true;

    const raw = message.text.trim();
    const lower = raw.toLowerCase();
    const isSkip = !raw || lower === 'skip' || lower === 'kosong' || lower === '-';

    let expireAt = '';
    if (!isSkip) {
      const asNumber = Number(raw);
      if (Number.isFinite(asNumber) && asNumber > 0) {
        expireAt = expireDateFromDays(asNumber);
      } else {
        const normalized = raw.replace(/\//g, '-');
        const parts = normalized.split('-').map((p) => p.trim());
        const [y, m, d] = parts.map(Number);
        const valid =
          parts.length === 3 &&
          !Number.isNaN(y) &&
          !Number.isNaN(m) &&
          !Number.isNaN(d) &&
          m >= 1 &&
          m <= 12 &&
          d >= 1 &&
          d <= 31;
        const date = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
        const isValidDate = !Number.isNaN(date.getTime());
        if (!valid || !isValidDate) {
          pendingInputs.set(message.chat.id, pending);
          await telegramClient.sendMessage(
            message.chat.id,
            'Masukkan angka hari atau tanggal YYYY-MM-DD. Ketik skip jika tidak ada tanggal.',
            { reply_markup: restockExpireKeyboard() }
          );
          return true;
        }
        expireAt = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
    }

    restockBuffers.set(message.chat.id, { ...buffer, expire_at: expireAt });
    pendingInputs.set(message.chat.id, { action: 'RESTOCK_ACCOUNTS', meta: pending.meta });
    await telegramClient.sendMessage(
      message.chat.id,
      `${expireAt ? `Masa berlaku diset: ${expireAt}` : 'Masa berlaku dikosongkan.'}\n\n${restockPrompt}`,
      { reply_markup: backOrCancel('HOME') }
    );
  }

  if (pending.action === 'RESTOCK_ACCOUNTS') {
    const buffer = restockBuffers.get(message.chat.id);
    if (!buffer) return true;
    const text = message.text.trim();
    const lowerText = text.toLowerCase();

    if (lowerText === '/selesai' || lowerText === 'selesai') {
      // Clear pending state as input is finished, waiting for confirmation
      pendingInputs.delete(message.chat.id);

      const uniqueInput = Array.from(new Set(buffer.lines));
      const existing = await sheetsService.listAccountIdentities(buffer.product.platform);
      const deduped = uniqueInput.filter((line) => !existing.has(line));
      const skipped = uniqueInput.length - deduped.length;
      const capped = deduped.slice(0, RESTOCK_MAX_LINES);
      const trimmedByLimit = deduped.length - capped.length;
      const expireLabel = buffer.expire_at || '-';

      await telegramClient.sendMessage(
        message.chat.id,
        `Ringkasan Restok\n\nProduk: ${buffer.product.product_name || buffer.product.platform}\nTotal input: ${
          uniqueInput.length
        }\nDuplikat dilewati: ${skipped}\n${
          trimmedByLimit ? `Melebihi batas ${RESTOCK_MAX_LINES}, ${trimmedByLimit} baris diabaikan.\n` : ''
        }Akan ditambahkan: ${capped.length}\nMasa berlaku: ${expireLabel}\n\nData tidak bisa dibatalkan`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: 'Konfirmasi',
                  callback_data: encodeCallbackData('RESTOCK_CONFIRM', { product_id: buffer.product.product_id }),
                },
                { text: 'Batal', callback_data: encodeCallbackData('RESTOCK_CANCEL') },
              ],
            ],
          },
        }
      );
      restockBuffers.set(message.chat.id, { ...buffer, lines: capped });
    } else {
      // Re-set pending state for multi-message input
      pendingInputs.set(message.chat.id, pending);

      const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
      if (lines.length) {
        const available = RESTOCK_MAX_LINES - buffer.lines.length;
        if (available <= 0) {
          await telegramClient.sendMessage(
            message.chat.id,
            `Batas ${RESTOCK_MAX_LINES} akun tercapai. Ketik /selesai untuk lanjut konfirmasi.`
          );
          return true;
        }
        const allowed = lines.slice(0, Math.max(available, 0));
        const skippedByLimit = lines.length - allowed.length;
        buffer.lines.push(...allowed);
        restockBuffers.set(message.chat.id, buffer);
        await telegramClient.sendMessage(
          message.chat.id,
          `Ditambahkan ${allowed.length} baris${
            skippedByLimit ? `, ${skippedByLimit} dilewati karena batas ${RESTOCK_MAX_LINES}` : ''
          }. Total: ${buffer.lines.length}. Ketik /selesai jika sudah selesai input.`
        );
      }
    }
  }

  return true;
};

// --------- CALLBACK HANDLER ----------
const handleCallback = async (callback: CallbackQuery, adminUsername: string, isOwner: boolean) => {
  const chatId = callback.message?.chat.id;
  const messageId = callback.message?.message_id;
  if (!chatId || !callback.data || !messageId) {
    await telegramClient.answerCallbackQuery(callback.id, 'Aksi tidak valid atau pesan tidak ditemukan.', true);
    return;
  }

  // State Isolation Fix: Clear pending input state on any callback action
  // This prevents message input from being processed as a stale pending action.
  pendingInputs.delete(chatId);
  // restockBuffers is kept until HOME or RESTOCK_CANCEL to allow multi-step restock

  const { action, payload } = decodeCallbackData(callback.data);

  switch (action) {
    case 'HOME':
      // State Isolation Fix: Use delete(chatId) instead of global clear()
      pendingInputs.delete(chatId);
      restockBuffers.delete(chatId);
      await sendHome(chatId, isOwner);
      break;
    case 'ORDER_NEW': {
      // Stale Button Fix: Remove keyboard from the message that contained the 'ORDER_NEW' button
      await editMessageReplyMarkup(chatId, messageId, { inline_keyboard: [] });
      pendingInputs.set(chatId, { action: 'ORDER_CHANNEL', meta: {} });
      await sendOrderChannel(chatId);
      break;
    }
    case 'ORDER_CH': {
      // Stale Button Fix: Remove keyboard from the message that contained the channel buttons
      await editMessageReplyMarkup(chatId, messageId, { inline_keyboard: [] });
      pendingInputs.set(chatId, { action: 'ORDER_CHANNEL', meta: { channel: payload.ch } });
      await sendProductSelection(chatId, 'ORDER_NEW', undefined, payload.ch);
      break;
    }
    case 'ORDER_PICK': {
      // Stale Button Fix: Remove keyboard from the message that contained the product buttons
      await editMessageReplyMarkup(chatId, messageId, { inline_keyboard: [] });
      await sendDurationSelection(chatId, payload);
      break;
    }
    case 'ORDER_DURATION': {
      // Stale Button Fix: Remove keyboard from the message that contained the duration buttons
      await editMessageReplyMarkup(chatId, messageId, { inline_keyboard: [] });
      const products = await gasClient.listActiveProducts();
      const product = products.find((p) => p.product_id === payload.pid);
      if (!product) {
        await telegramClient.sendMessage(chatId, 'Produk tidak ditemukan.');
        break;
      }
      const seatMode = product.seat_mode || 'SHARING';
      const fulfillmentType = product.fulfillment_type || (seatMode === 'HEAD' ? 'INVITE' : 'LOGIN');
      pendingInputs.set(chatId, {
        action: 'NEW_ORDER_BUYER',
        meta: {
          product_id: product.product_id,
          product_name: product.product_name || '',
          platform: product.platform,
          seat_mode: seatMode,
          fulfillment_type: fulfillmentType,
          sharing_max_slot: String(product.sharing_max_slot || ''),
          fallback_policy: product.fallback_policy || 'STRICT',
          duration_days: payload.dur,
          channel: payload.ch || pendingInputs.get(chatId)?.meta.channel || 'Telegram',
        },
      });
      await askBuyerId(chatId);
      break;
    }
    case 'ORDER_SENT': {
      // Idempotency Fix: Acknowledge immediately and rely on service layer for check
      await telegramClient.answerCallbackQuery(callback.id, 'Memproses...');
      try {
        const result = await orderService.markOrderSent(payload.order_id, adminUsername);
        if (result.already_sent) {
          await telegramClient.answerCallbackQuery(callback.id, 'Order sudah ditandai terkirim', true);
          break;
        }
        // Stale Button Fix: Remove keyboard after action is complete
        await editMessageReplyMarkup(chatId, messageId, { inline_keyboard: [] });
        await telegramClient.answerCallbackQuery(callback.id, 'Order ditandai terkirim');
      } catch (err: any) {
        console.error('Order sent error', err);
        await telegramClient.answerCallbackQuery(callback.id, 'Gagal menandai terkirim', true);
        await telegramClient.sendMessage(
          chatId,
          `❌ Gagal menandai order ${payload.order_id} terkirim.\n${err?.message || 'Silakan coba lagi.'}`
        );
      }
      break;
    }
    case 'ORDER_REPLACE': {
      // Idempotency Fix: Acknowledge immediately and rely on service layer for check
      await telegramClient.answerCallbackQuery(callback.id, 'Memproses penggantian akun...');
      if (!payload.seat_id) {
        await telegramClient.answerCallbackQuery(callback.id, 'Seat tidak diketahui', true);
        break;
      }
      try {
        const seat = await seatService.replaceSeatWithReason(payload.seat_id, adminUsername, 'replace_request');
        if (seat.already_replaced) {
          await telegramClient.answerCallbackQuery(callback.id, 'Seat sudah diganti', true);
          break;
        }
        // Stale Button Fix: Remove keyboard after action is complete
        await editMessageReplyMarkup(chatId, messageId, { inline_keyboard: [] });
        await telegramClient.sendMessage(
          chatId,
          `✅ Akun pengganti siap\nSeat: ${seat.seat_id}\nAkun: \nExpire: ${seat.end_date}`
        );
      } catch (err: any) {
        console.error('Order replace error', err);
        await telegramClient.answerCallbackQuery(callback.id, 'Gagal mengganti akun', true);
        await telegramClient.sendMessage(
          chatId,
          `❌ Gagal mengganti akun untuk seat ${payload.seat_id}.\n${err?.message || 'Silakan coba lagi.'}`
        );
      }
      break;
    }
    case 'ORDER_CANCEL': {
      // Stale Button Fix: Remove keyboard from the message that contained the cancel button
      await editMessageReplyMarkup(chatId, messageId, { inline_keyboard: [] });
      pendingInputs.set(chatId, { action: 'CANCEL_REASON', meta: { order_id: payload.order_id } });
      await telegramClient.sendMessage(chatId, 'Masukkan alasan cancel/refund:', { force_reply: true });
      break;
    }
    case 'INVITE': {
      await telegramClient.sendMessage(chatId, 'Gunakan menu Order Baru untuk kirim/invite akun.');
      break;
    }
    case 'CANCEL': {
      await editMessageReplyMarkup(chatId, messageId, { inline_keyboard: [] });
      const orders = await listRecentActiveOrders(10);
      if (!orders.length) {
        await telegramClient.sendMessage(chatId, 'Tidak ada order aktif untuk dibatalkan.');
        break;
      }
      const rows: InlineKeyboardMarkup['inline_keyboard'] = orders.map((o) => [
        {
          text: `${o.product_label || o.product_id} - ${o.buyer_id}`,
          callback_data: encodeCallbackData('CANCEL_PICK', { order_id: o.order_id }),
        },
      ]);
      rows.push(...backOrCancel('HOME').inline_keyboard);
      await telegramClient.sendMessage(chatId, 'Pilih order untuk cancel/refund:', {
        reply_markup: { inline_keyboard: rows },
      });
      break;
    }
    case 'CANCEL_PICK': {
      await editMessageReplyMarkup(chatId, messageId, { inline_keyboard: [] });
      pendingInputs.set(chatId, { action: 'CANCEL_REASON', meta: { order_id: payload.order_id } });
      await telegramClient.sendMessage(chatId, 'Masukkan alasan cancel/refund:', { force_reply: true });
      break;
    }
    case 'PROBLEM': {
      // Stale Button Fix: Remove keyboard from the message that contained the PROBLEM button
      await editMessageReplyMarkup(chatId, messageId, { inline_keyboard: [] });
      const keyboard: InlineKeyboardMarkup = {
        inline_keyboard: [
          [{ text: '❌ Akun tidak bisa dipakai', callback_data: encodeCallbackData('PROBLEM_TYPE', { t: 'problem' }) }],
          [{ text: '🔄 Minta ganti akun', callback_data: encodeCallbackData('PROBLEM_TYPE', { t: 'replace' }) }],
          [{ text: '💸 Refund / Cancel', callback_data: encodeCallbackData('PROBLEM_TYPE', { t: 'cancel' }) }],
          ...backOrCancel('HOME').inline_keyboard,
        ],
      };
      await telegramClient.sendMessage(chatId, 'Pilih jenis masalah', { reply_markup: keyboard });
      break;
    }
    case 'PROBLEM_TYPE': {
      // Stale Button Fix: Remove keyboard from the message that contained the PROBLEM_TYPE buttons
      await editMessageReplyMarkup(chatId, messageId, { inline_keyboard: [] });
      const orders = await listRecentActiveOrders(10);
      if (!orders.length) {
        await telegramClient.sendMessage(chatId, 'Tidak ada order aktif.');
        break;
      }
      const rows: InlineKeyboardMarkup['inline_keyboard'] = orders.map((o) => [
        {
          text: `${o.product_label || o.product_id} - ${o.buyer_id}`,
          callback_data: encodeCallbackData('PROBLEM_PICK', { ...payload, order_id: o.order_id, seat_id: o.seat_id }),
        },
      ]);
      rows.push(...backOrCancel('HOME').inline_keyboard);
      await telegramClient.sendMessage(chatId, 'Pilih order yang bermasalah:', {
        reply_markup: { inline_keyboard: rows },
      });
      break;
    }
    case 'PROBLEM_PICK': {
      // Stale Button Fix: Remove keyboard from the message that contained the PROBLEM_PICK buttons
      await editMessageReplyMarkup(chatId, messageId, { inline_keyboard: [] });
      if (payload.t === 'cancel') {
        pendingInputs.set(chatId, { action: 'CANCEL_REASON', meta: { order_id: payload.order_id } });
        await telegramClient.sendMessage(chatId, 'Masukkan alasan cancel/refund:', { force_reply: true });
      } else if (payload.t === 'replace') {
        // Idempotency Fix: Acknowledge immediately and rely on service layer for check
        await telegramClient.answerCallbackQuery(callback.id, 'Memproses penggantian akun...');
        try {
          const seat = await seatService.replaceSeatWithReason(payload.seat_id, adminUsername, 'problem_replace');
          if (seat.already_replaced) {
            await telegramClient.answerCallbackQuery(callback.id, 'Seat sudah diganti', true);
            break;
          }
          await telegramClient.sendMessage(
            chatId,
            `✅ Akun pengganti siap\nSeat: ${seat.seat_id}\nAkun: \nExpire: ${seat.end_date}`
          );
        } catch (err: any) {
          console.error('Problem replace error', err);
          await telegramClient.answerCallbackQuery(callback.id, 'Gagal mengganti akun', true);
          await telegramClient.sendMessage(
            chatId,
            `❌ Gagal mengganti akun untuk seat ${payload.seat_id}.\n${err?.message || 'Silakan coba lagi.'}`
          );
        }
      } else {
        await telegramClient.sendMessage(chatId, 'Catat masalah. Silakan ganti atau cancel sesuai kebutuhan.');
      }
      break;
    }
    case 'EXPIRING': {
      // Stale Button Fix: Remove keyboard from the message that contained the EXPIRING button
      await editMessageReplyMarkup(chatId, messageId, { inline_keyboard: [] });
      const seats = await seatService.listExpiringToday();
      if (!seats.length) {
        await telegramClient.sendMessage(chatId, 'Tidak ada akun expired hari ini.');
        break;
      }
      const keyboard: InlineKeyboardMarkup = {
        inline_keyboard: seats.map((s, i) => [
          {
            text: `${i + 1}. ${s.buyer_id} (${s.end_date})`,
            callback_data: encodeCallbackData('EXP_PICK', { seat_id: s.seat_id }),
          },
        ]),
      };
      keyboard.inline_keyboard.push(...backOrCancel('HOME').inline_keyboard);
      await telegramClient.sendMessage(chatId, '📅 Akun yang akan expired hari ini', { reply_markup: keyboard });
      break;
    }
    case 'EXP_PICK': {
      // Stale Button Fix: Remove keyboard from the message that contained the EXP_PICK buttons
      await editMessageReplyMarkup(chatId, messageId, { inline_keyboard: [] });
      const keyboard: InlineKeyboardMarkup = {
        inline_keyboard: [
          [{ text: '✅ Perpanjang', callback_data: encodeCallbackData('RENEW_CONFIRM', { seat_id: payload.seat_id }) }],
          [{ text: '❌ Tidak Perpanjang', callback_data: encodeCallbackData('RENEW_SKIP', { seat_id: payload.seat_id }) }],
          [{ text: '⏰ Tunda', callback_data: encodeCallbackData('HOME') }],
        ],
      };
      await telegramClient.sendMessage(chatId, 'Pilih aksi:', { reply_markup: keyboard });
      break;
    }
    case 'RENEW_CONFIRM': {
      // Idempotency Fix: Acknowledge immediately and rely on service layer for check
      await telegramClient.answerCallbackQuery(callback.id, 'Memproses...');
      try {
        const result = await seatService.confirmRenew(payload.seat_id, adminUsername);
        if (result.already_renewed) {
          await telegramClient.answerCallbackQuery(callback.id, 'Sudah diperpanjang', true);
          break;
        }
        // Stale Button Fix: Remove keyboard after action is complete
        await editMessageReplyMarkup(chatId, messageId, { inline_keyboard: [] });
        await telegramClient.answerCallbackQuery(callback.id, 'Diperpanjang');
      } catch (err: any) {
        console.error('Renew confirm error', err);
        await telegramClient.answerCallbackQuery(callback.id, 'Gagal perpanjang', true);
        await telegramClient.sendMessage(
          chatId,
          `❌ Gagal perpanjang seat ${payload.seat_id}.\n${err?.message || 'Silakan coba lagi.'}`
        );
      }
      break;
    }
    case 'RENEW_SKIP': {
      // Idempotency Fix: Acknowledge immediately and rely on service layer for check
      await telegramClient.answerCallbackQuery(callback.id, 'Memproses...');
      try {
        const result = await seatService.skipRenew(payload.seat_id, adminUsername);
        if (result.already_skipped) {
          await telegramClient.answerCallbackQuery(callback.id, 'Sudah ditandai tidak perpanjang', true);
          break;
        }
        // Stale Button Fix: Remove keyboard after action is complete
        await editMessageReplyMarkup(chatId, messageId, { inline_keyboard: [] });
        await telegramClient.answerCallbackQuery(callback.id, 'Ditandai tidak perpanjang');
      } catch (err: any) {
        console.error('Renew skip error', err);
        await telegramClient.answerCallbackQuery(callback.id, 'Gagal skip perpanjangan', true);
        await telegramClient.sendMessage(
          chatId,
          `❌ Gagal skip perpanjangan seat ${payload.seat_id}.\n${err?.message || 'Silakan coba lagi.'}`
        );
      }
      break;
    }
    case 'REPORT': {
      // Stale Button Fix: Remove keyboard from the message that contained the REPORT button
      await editMessageReplyMarkup(chatId, messageId, { inline_keyboard: [] });
      await sendReportMenu(chatId);
      break;
    }
    case 'REPORT_STOCK': {
      // Idempotency Fix: Acknowledge immediately
      await telegramClient.answerCallbackQuery(callback.id, 'Mengambil laporan stok...');
      try {
        const report = await reportService.stockSummary();
        await telegramClient.sendMessage(chatId, `📦 Stok & Slot\n${report.text}`);
      } catch (err: any) {
        console.error('Report stock error', err);
        await telegramClient.answerCallbackQuery(callback.id, 'Gagal ambil laporan stok', true);
        await telegramClient.sendMessage(chatId, `❌ Gagal ambil laporan stok.\n${err?.message || 'Silakan coba lagi.'}`);
      }
      break;
    }
    case 'REPORT_DAY':
    case 'REPORT_WEEK':
    case 'REPORT_MONTH': {
      // Idempotency Fix: Acknowledge immediately
      await telegramClient.answerCallbackQuery(callback.id, 'Mengambil laporan...');
      try {
        const report = await reportService.salesSummary();
        await telegramClient.sendMessage(chatId, `📊 Report\n${report.text}`);
      } catch (err: any) {
        console.error('Report sales error', err);
        await telegramClient.answerCallbackQuery(callback.id, 'Gagal ambil laporan', true);
        await telegramClient.sendMessage(chatId, `❌ Gagal ambil laporan.\n${err?.message || 'Silakan coba lagi.'}`);
      }
      break;
    }
    case 'RESTOCK': {
      // Stale Button Fix: Remove keyboard from the message that contained the RESTOCK button
      await editMessageReplyMarkup(chatId, messageId, { inline_keyboard: [] });
      await startRestock(chatId);
      break;
    }
    case 'RESTOCK_PICK': {
      // Stale Button Fix: Remove keyboard from the message that contained the RESTOCK_PICK buttons
      await editMessageReplyMarkup(chatId, messageId, { inline_keyboard: [] });
      const products = await gasClient.listActiveProducts();
      const product = products.find((p) => p.product_id === payload.product_id);
      if (!product) {
        await telegramClient.sendMessage(chatId, 'Produk tidak ditemukan.');
        break;
      }
      restockBuffers.set(chatId, { product, lines: [], expire_at: '' });
      pendingInputs.set(chatId, { action: 'RESTOCK_EXPIRE', meta: { product_id: product.product_id } });
      await telegramClient.sendMessage(chatId, restockExpirePrompt, { reply_markup: restockExpireKeyboard() });
      break;
    }
    case 'RESTOCK_EXPIRE_PRESET': {
      const buffer = restockBuffers.get(chatId);
      if (!buffer) break;
      const days = Number(payload.d || 0);
      const expireAt = days > 0 ? expireDateFromDays(days) : '';
      restockBuffers.set(chatId, { ...buffer, expire_at: expireAt });
      pendingInputs.set(chatId, { action: 'RESTOCK_ACCOUNTS', meta: { product_id: buffer.product.product_id } });
      await telegramClient.sendMessage(
        chatId,
        `${expireAt ? `Masa berlaku diset: ${expireAt}` : 'Masa berlaku dikosongkan.'}\n\n${restockPrompt}`,
        { reply_markup: backOrCancel('HOME') }
      );
      break;
    }
    case 'RESTOCK_EXPIRE_CUSTOM': {
      const buffer = restockBuffers.get(chatId);
      if (!buffer) break;
      pendingInputs.set(chatId, { action: 'RESTOCK_EXPIRE', meta: { product_id: buffer.product.product_id } });
      await telegramClient.sendMessage(
        chatId,
        'Masukkan jumlah hari (angka) atau tanggal YYYY-MM-DD. Ketik skip jika tidak ada tanggal.',
        { reply_markup: restockExpireKeyboard() }
      );
      break;
    }
    case 'RESTOCK_CONFIRM': {
      // Idempotency Fix: Acknowledge immediately
      await telegramClient.answerCallbackQuery(callback.id, 'Memproses konfirmasi restok...');
      const buffer = restockBuffers.get(chatId);
      if (!buffer) {
        await telegramClient.answerCallbackQuery(callback.id, 'Tidak ada data restok', true);
        break;
      }

      // Race-Safe Restock Fix: Re-run deduplication check before final write
      const uniqueInput = buffer.lines; // Already deduped against initial check
      const existing = await sheetsService.listAccountIdentities(buffer.product.platform);
      const finalDeduped = uniqueInput.filter((line) => !existing.has(line));
      const newlySkipped = uniqueInput.length - finalDeduped.length;

      if (newlySkipped > 0) {
        await telegramClient.sendMessage(
          chatId,
          `⚠️ ${newlySkipped} akun baru saja ditambahkan oleh admin lain dan dilewati.`
        );
      }

      const accounts = finalDeduped.map((line) => ({
        platform: buffer.product.platform,
        mode: buffer.product.seat_mode,
        email: line,
        identity: line,
        account_kind: (buffer.product.seat_mode === 'HEAD' ? 'HEAD' : 'LOGIN') as 'HEAD' | 'LOGIN',
        max_slot:
          buffer.product.seat_mode === 'SHARING'
            ? Number(buffer.product.sharing_max_slot || 1)
            : 1,
        expired_at: buffer.expire_at || '',
      }));

      if (accounts.length === 0) {
        await telegramClient.sendMessage(chatId, 'Tidak ada akun baru untuk ditambahkan.');
        restockBuffers.delete(chatId);
        pendingInputs.delete(chatId);
        // Stale Button Fix: Remove keyboard after action is complete
        await editMessageReplyMarkup(chatId, messageId, { inline_keyboard: [] });
        break;
      }

      try {
        const result = await gasClient.restockAccounts({ accounts, actor: adminUsername });
        // Simulate adding the new accounts to the existing set for the next dedupe check (Race-Safe)
        finalDeduped.forEach(sheetsService.addAccountIdentity);

        await telegramClient.sendMessage(
          chatId,
          `✅ Stok berhasil ditambahkan\nAkun dibuat: ${result.accounts.map((a: AccountResult) => a.account_id).join(', ')}`
        );
        // Stale Button Fix: Remove keyboard after action is complete
        await editMessageReplyMarkup(chatId, messageId, { inline_keyboard: [] });
      } catch (err: any) {
        console.error('Restock confirm error', err);
        await telegramClient.answerCallbackQuery(callback.id, 'Gagal konfirmasi restok', true);
        await telegramClient.sendMessage(
          chatId,
          `❌ Gagal konfirmasi restok.\n${err?.message || 'Silakan coba lagi.'}`
        );
      }

      restockBuffers.delete(chatId);
      pendingInputs.delete(chatId);
      break;
    }
    case 'RESTOCK_CANCEL': {
      // Stale Button Fix: Remove keyboard after action is complete
      await editMessageReplyMarkup(chatId, messageId, { inline_keyboard: [] });
      restockBuffers.delete(chatId);
      pendingInputs.delete(chatId);
      await telegramClient.sendMessage(chatId, 'Restok dibatalkan.');
      break;
    }
    case 'ADMIN': {
      if (!isOwner) {
        await telegramClient.sendMessage(chatId, 'Menu ini hanya untuk owner.');
        break;
      }
      await sendAdminMenu(chatId);
      break;
    }
    case 'ADMIN_ADD_PRODUCT': {
      if (!isOwner) {
        await telegramClient.sendMessage(chatId, 'Menu ini hanya untuk owner.');
        break;
      }
      pendingInputs.set(chatId, { action: 'ADMIN_ADD_PRODUCT', meta: {} });
      await telegramClient.sendMessage(chatId, adminAddProductPrompt, { reply_markup: backOrCancel('HOME') });
      break;
    }
    default:
      await telegramClient.answerCallbackQuery(callback.id, 'Aksi belum didukung', true);
  }
};

export const telegramController = {
  handleUpdate: async (update: TelegramUpdate) => {
    const from = update.message?.from ?? update.callback_query?.from;
    if (!from) return { status: 'ignored' };

    const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;

    try {
      const tag = update.callback_query
        ? `callback:${update.callback_query.data ?? ''}`
        : `message:${(update.message?.text ?? '').slice(0, 50)}`;
      console.log(
        `[TG] from=@${from.username ?? from.id} chat=${chatId ?? 'n/a'} ${tag}`
      );
    } catch {
      /* ignore */
    }

    let admin;
    try {
      admin = await adminService.ensureActive(from.username);
    } catch (error) {
      if (update.callback_query) {
        // Error UX Fix: Use persistent message for unauthorized access
        await telegramClient.answerCallbackQuery(update.callback_query.id, 'Tidak punya akses', true);
        if (chatId) {
          await telegramClient.sendMessage(chatId, '❌ Akses ditolak. Hubungi owner.');
        }
      } else if (update.message) {
        await telegramClient.sendMessage(update.message.chat.id, '❌ Akses ditolak. Hubungi owner.');
      }
      return { status: 'unauthorized' };
    }

    if (update.callback_query) {
      try {
        await handleCallback(update.callback_query, admin.telegram_username, adminService.isOwner(admin));
      } catch (err: any) {
        console.error('TG callback error:', err);
        // Error UX Fix: Send persistent error message to chat
        await telegramClient.answerCallbackQuery(
          update.callback_query.id,
          'Terjadi error, coba lagi atau cek log.',
          true
        );
        if (chatId) {
          await telegramClient.sendMessage(
            chatId,
            `❌ Terjadi error saat memproses aksi. Silakan coba lagi.\nDetail: ${err?.message || 'Unknown error'}`
          );
        }
      }
      return { status: 'ok' };
    }

    if (update.message?.text) {
      const handled = await handlePendingInput(update.message, admin.telegram_username);
      if (!handled) {
        await sendHome(update.message.chat.id, adminService.isOwner(admin));
      }
    }

    return { status: 'ok' };
  },
};
