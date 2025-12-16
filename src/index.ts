import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { Elysia } from 'elysia';
import cron from 'node-cron';
import { config } from './config';
import { telegramController } from './controllers/telegram.controller';
import { seatService } from './services/seat.service';
import { telegramClient } from './utils/telegram';
import { encodeCallbackData } from './utils/callback';

const app = new Elysia();

app.get('/health', () => ({ status: 'ok' }));

app.post('/telegram/webhook', async ({ body, headers, set }) => {
  if (config.telegramSecret) {
    const secret = headers['x-telegram-bot-api-secret-token'];
    if (secret !== config.telegramSecret) {
      set.status = 403;
      return { error: 'Invalid secret token' };
    }
  }

  await telegramController.handleUpdate(body as any);
  return { ok: true };
});

const startDailyExpireSweep = () => {
  const spec = `0 ${config.dailyReminderHourWIB} * * *`;
  cron.schedule(
    spec,
    async () => {
      try {
        const seats = await seatService.listExpiringToday();
        if (!seats.length || !config.alertChatId) return;

        const keyboard = {
          inline_keyboard: seats.map((s) => [
            {
              text: `${s.buyer_id} - ${s.end_date}`,
              callback_data: encodeCallbackData('RENEW_CONFIRM', { seat_id: s.seat_id }),
            },
            {
              text: 'Do Not Renew',
              callback_data: encodeCallbackData('RENEW_SKIP', { seat_id: s.seat_id }),
            },
          ]),
        };

        const text =
          '<b>Seat expired hari ini</b>\n' +
          seats.map((s) => `${s.buyer_id} (${s.buyer_email}) - ${s.end_date}`).join('\n');

        await telegramClient.sendMessage(Number(config.alertChatId), text, { reply_markup: keyboard });
      } catch (error) {
        console.error('Failed to push expiring seats', error);
      }
    },
    { timezone: 'Asia/Jakarta' }
  );
};

const handler = app.handle;

const server = createServer(async (req, res) => {
  try {
    const host = req.headers.host ?? `localhost:${config.port}`;
    const url = new URL(req.url || '/', `http://${host}`);

    const headers = new Headers();
    Object.entries(req.headers).forEach(([key, value]) => {
      if (value === undefined) return;
      if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
      else headers.set(key, value);
    });

    const hasBody = req.method && !(req.method === 'GET' || req.method === 'HEAD');
    const body = hasBody ? (Readable.toWeb(req) as unknown as BodyInit) : undefined;
    const request = new Request(url, {
      method: req.method,
      headers,
      body,
      ...(hasBody ? { duplex: 'half' as const } : {}),
    });

    const response = await handler(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) {
      const buffer = Buffer.from(await response.arrayBuffer());
      res.end(buffer);
    } else {
      res.end();
    }
  } catch (error) {
    console.error('HTTP server error', error);
    res.statusCode = 500;
    res.end('Internal server error');
  }
});

server.listen(config.port, () => {
  console.log(`Elysia server (node adapter) running on port ${config.port}`);
  startDailyExpireSweep();
});

export type App = typeof server;
