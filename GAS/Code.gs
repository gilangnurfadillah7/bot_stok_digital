const SHEET = {
  ACCOUNTS: 'ACCOUNTS',
  PRODUCTS: 'PRODUCTS',
  ORDERS: 'ORDERS',
  SEATS: 'SEATS',
  ADMIN_USERS: 'ADMIN_USERS',
  LOGS: 'LOGS',
};

const ORDER_STATUS = {
  PENDING_SEND: 'PENDING_SEND',
  ACTIVE: 'ACTIVE',
  CANCELLED: 'CANCELLED',
};

const SEAT_STATUS = {
  ACTIVE: 'ACTIVE',
  RESERVED: 'RESERVED',
  PENDING_CONFIRM: 'PENDING_CONFIRM',
  RELEASED: 'RELEASED',
  PROBLEM: 'PROBLEM',
};

// Hardcoded API key override (bypass Script Properties).
// NOTE: use lowercase "l" in this segment: ...UON3l9tas...
const HARDCODE_API_KEY = 'qP02biQ7FVmzThZgUON3l9tas5vjHJyd';

function doGet(e) {
  return handleRequest('GET', e);
}

function doPost(e) {
  return handleRequest('POST', e);
}

function handleRequest(method, e) {
  try {
    const path = normalizePath((e && e.parameter && e.parameter.path) ? e.parameter.path : (e && e.pathInfo));
    const params = e && e.parameter ? e.parameter : {};
    const body = method === 'POST' ? parseBody(e) : {};
    const apiKey = extractApiKey(e, params, body);
    assertApiKey(apiKey);

    switch (`${method} ${path}`) {
      case 'GET /ping':
        return json({ ok: true });
      case 'GET /admin/check':
        return json(handleAdminCheck(params));
      case 'POST /order/create':
        return json(handleCreateOrder(body));
      case 'POST /seat/assign':
        return json(handleAssignSeat(body));
      case 'POST /order/sent':
        return json(handleOrderSent(body));
      case 'POST /seat/expire_check':
        return json(handleExpireCheck());
      case 'POST /seat/renew':
        return json(handleRenew(body));
      case 'POST /seat/release':
        return json(handleRelease(body));
      case 'POST /seat/replace':
        return json(handleReplace(body));
      case 'POST /order/cancel':
        return json(handleCancel(body));
      case 'POST /accounts/restock':
        return json(handleRestock(body));
      case 'GET /report/sales':
        return json(handleReportSales(params));
      case 'GET /report/stock':
        return json(handleReportStock());
      default:
        return jsonError('Not found', 404);
    }
  } catch (err) {
    return jsonError(err.message || 'Unhandled error', 500);
  }
}

// -------- Auth & helpers --------
function extractApiKey(e, params, body) {
  return (
    body.apiKey ||
    body.key ||
    params.key ||
    params.apiKey ||
    ((e && e.headers && (e.headers['x-api-key'] || e.headers['X-API-KEY'])) || '') ||
    ''
  );
}

function assertApiKey(key) {
  const expected = HARDCODE_API_KEY || PropertiesService.getScriptProperties().getProperty('API_KEY');
  if (!expected || key !== expected) throw new Error('Unauthorized');
}

function normalizePath(pathInfo) {
  if (!pathInfo) return '/';
  return pathInfo.startsWith('/') ? pathInfo : `/${pathInfo}`;
}

function parseBody(e) {
  if (!e || !e.postData || !e.postData.contents) return {};
  const ct = (e.postData.type || '').toLowerCase();
  if (ct.indexOf('application/json') !== -1) {
    return JSON.parse(e.postData.contents || '{}');
  }
  return e.parameter || {};
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function jsonError(message, status) {
  return json({ success: false, status: status || 400, error: message });
}

function getSheet(name) {
  return SpreadsheetApp.getActive().getSheetByName(name);
}

function getTable(sheet) {
  const values = sheet.getDataRange().getValues();
  const headers = values.shift();
  return { headers, rows: values };
}

function toObject(headers, row) {
  const o = {};
  headers.forEach((h, i) => (o[h] = row[i]));
  return o;
}

function appendRow(sheet, headers, obj) {
  const row = headers.map((h) => obj[h]);
  sheet.appendRow(row);
}

function updateRow(sheet, rowIndex1Based, headers, updates) {
  const rowValues = sheet.getRange(rowIndex1Based, 1, 1, headers.length).getValues()[0];
  headers.forEach((h, i) => {
    if (updates.hasOwnProperty(h)) rowValues[i] = updates[h];
  });
  sheet.getRange(rowIndex1Based, 1, 1, headers.length).setValues([rowValues]);
}

function addDays(date, days) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + Number(days));
  return d;
}

function isoNow() {
  return new Date().toISOString();
}

function asDateOnlyString(date) {
  return date.toISOString().slice(0, 10);
}

function logAction(action, actor, refId, note) {
  const sheet = getSheet(SHEET.LOGS);
  const { headers } = getTable(sheet);
  appendRow(sheet, headers, {
    timestamp: isoNow(),
    action,
    actor,
    ref_id: refId,
    note: note || '',
  });
}

// -------- Endpoint handlers --------
function handleAdminCheck(params) {
  const username = (params.telegram_username || '').toLowerCase();
  if (!username) throw new Error('telegram_username required');

  const sheet = getSheet(SHEET.ADMIN_USERS);
  const { headers, rows } = getTable(sheet);
  const idxUser = headers.indexOf('telegram_username');
  const idxStatus = headers.indexOf('status');
  const idxRole = headers.indexOf('role');

  const row = rows.find((r) => String(r[idxUser]).toLowerCase() === username);
  if (!row) throw new Error('Admin not found');
  if (!isActive(row[idxStatus])) throw new Error('Admin not active');

  return { success: true, role: row[idxRole] };
}

function handleCreateOrder(body) {
  const required = ['product_id', 'platform', 'channel', 'buyer_id', 'buyer_email', 'admin_username'];
  required.forEach((k) => {
    if (!body[k]) throw new Error(`${k} required`);
  });

  const product = findProductById(body.product_id);
  if (!product || !isActive(product.active)) throw new Error('Product not active');

  const sheet = getSheet(SHEET.ORDERS);
  const { headers } = getTable(sheet);
  const orderId = `ORD-${Utilities.getUuid()}`;

  const now = isoNow();
  appendRow(sheet, headers, {
    order_id: orderId,
    product_id: body.product_id,
    platform: body.platform,
    channel: body.channel,
    buyer_id: body.buyer_id,
    buyer_email: body.buyer_email,
    status: ORDER_STATUS.PENDING_SEND,
    assigned_admin: body.admin_username,
    created_at: now,
  });

  logAction('ORDER_CREATED', body.admin_username, orderId, `product ${body.product_id}`);
  return { success: true, order_id: orderId, order_status: ORDER_STATUS.PENDING_SEND };
}

function handleAssignSeat(body) {
  const required = ['order_id', 'admin_username'];
  required.forEach((k) => {
    if (!body[k]) throw new Error(`${k} required`);
  });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const orderCtx = getOrderContext(body.order_id);
    if (orderCtx.order.status !== ORDER_STATUS.PENDING_SEND) {
      throw new Error('seat assignment allowed only when order status = PENDING_SEND');
    }

    const existing = findExistingSeatForOrder(body.order_id);
    if (existing) {
      return {
        success: true,
        seat_id: existing.seat_id,
        account_id: existing.account_id,
        end_date: existing.end_date,
        status: existing.status,
        reused: true,
      };
    }

    const seatResult = assignSeatInternal(orderCtx, body.admin_username, SEAT_STATUS.RESERVED);
    return seatResult;
  } finally {
    lock.releaseLock();
  }
}

function handleOrderSent(body) {
  const required = ['order_id', 'admin_username'];
  required.forEach((k) => {
    if (!body[k]) throw new Error(`${k} required`);
  });

  const sheet = getSheet(SHEET.ORDERS);
  const { headers, rows } = getTable(sheet);
  const idxOrderId = headers.indexOf('order_id');
  const idxStatus = headers.indexOf('status');

  const rowIndex = rows.findIndex((r) => r[idxOrderId] === body.order_id);
  if (rowIndex === -1) throw new Error('Order not found');
  if (rows[rowIndex][idxStatus] !== ORDER_STATUS.PENDING_SEND) throw new Error('Order not PENDING_SEND');

  // Activate reserved seat(s) for this order
  const seatSheet = getSheet(SHEET.SEATS);
  const seatTable = getTable(seatSheet);
  const sIdxOrderId = seatTable.headers.indexOf('order_id');
  const sIdxStatus = seatTable.headers.indexOf('status');
  const sIdxStart = seatTable.headers.indexOf('start_date');
  const sIdxEnd = seatTable.headers.indexOf('end_date');

  let activated = 0;
  seatTable.rows.forEach((r, i) => {
    if (r[sIdxOrderId] === body.order_id && r[sIdxStatus] === SEAT_STATUS.RESERVED) {
      const rowNumber = i + 2;
      const updates = { status: SEAT_STATUS.ACTIVE };
      if (!r[sIdxStart]) updates.start_date = isoNow();
      if (!r[sIdxEnd]) updates.end_date = addDays(new Date(), 0).toISOString();
      updateRow(seatSheet, rowNumber, seatTable.headers, updates);
      activated += 1;
    }
  });
  if (activated === 0) {
    throw new Error('No RESERVED seat found for order');
  }

  const rowNumber = rowIndex + 2;
  updateRow(sheet, rowNumber, headers, { status: ORDER_STATUS.ACTIVE });

  logAction('ORDER_SENT', body.admin_username, body.order_id, '');
  return { success: true, order_status: ORDER_STATUS.ACTIVE };
}

function handleExpireCheck() {
  const today = asDateOnlyString(new Date());
  const seatSheet = getSheet(SHEET.SEATS);
  const { headers, rows } = getTable(seatSheet);
  const idxStatus = headers.indexOf('status');
  const idxEndDate = headers.indexOf('end_date');

  const expiring = [];
  rows.forEach((r, i) => {
    const status = r[idxStatus];
    const endDate = (r[idxEndDate] || '').toString();
    if (status === SEAT_STATUS.ACTIVE && endDate.slice(0, 10) === today) {
      const rowNumber = i + 2;
      const updated = Object.assign({}, toObject(headers, r), { status: SEAT_STATUS.PENDING_CONFIRM });
      updateRow(seatSheet, rowNumber, headers, { status: SEAT_STATUS.PENDING_CONFIRM });
      expiring.push(updated);
    }
  });

  return { success: true, seats: expiring };
}

function handleRenew(body) {
  const required = ['seat_id', 'admin_username'];
  required.forEach((k) => {
    if (!body[k]) throw new Error(`${k} required`);
  });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const { seatSheet, seatHeaders, seatRowIdx, seatObj } = findSeat(body.seat_id);
    const orderCtx = getOrderContext(seatObj.order_id);
    const duration = Number(orderCtx.product.duration_days);
    const currentEnd = seatObj.end_date ? new Date(seatObj.end_date) : new Date();
    const newEnd = addDays(currentEnd, duration);

    updateRow(seatSheet, seatRowIdx, seatHeaders, {
      status: SEAT_STATUS.ACTIVE,
      end_date: newEnd.toISOString(),
      released_at: '',
    });

    logAction('SEAT_RENEWED', body.admin_username, body.seat_id, `order ${seatObj.order_id}`);
    return { success: true, seat_id: body.seat_id, end_date: newEnd.toISOString() };
  } finally {
    lock.releaseLock();
  }
}

function handleRelease(body) {
  const required = ['seat_id', 'admin_username'];
  required.forEach((k) => {
    if (!body[k]) throw new Error(`${k} required`);
  });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const { seatSheet, seatHeaders, seatRowIdx } = findSeat(body.seat_id);
    updateRow(seatSheet, seatRowIdx, seatHeaders, {
      status: SEAT_STATUS.RELEASED,
      released_at: isoNow(),
    });
    logAction('SEAT_RELEASED', body.admin_username, body.seat_id, body.reason || '');
    return { success: true };
  } finally {
    lock.releaseLock();
  }
}

function handleReplace(body) {
  const required = ['seat_id', 'admin_username', 'reason'];
  required.forEach((k) => {
    if (!body[k]) throw new Error(`${k} required`);
  });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const { seatSheet, seatHeaders, seatRowIdx, seatObj } = findSeat(body.seat_id);
    updateRow(seatSheet, seatRowIdx, seatHeaders, {
      status: SEAT_STATUS.PROBLEM,
    });
    logAction('SEAT_MARK_PROBLEM', body.admin_username, body.seat_id, body.reason);

    const orderCtx = getOrderContext(seatObj.order_id);
    const seatResult = assignSeatInternal(orderCtx, body.admin_username, SEAT_STATUS.ACTIVE);
    logAction('SEAT_REPLACED', body.admin_username, seatObj.order_id, `old ${body.seat_id} -> ${seatResult.seat_id}`);
    return seatResult;
  } finally {
    lock.releaseLock();
  }
}

function handleCancel(body) {
  const required = ['order_id', 'admin_username'];
  required.forEach((k) => {
    if (!body[k]) throw new Error(`${k} required`);
  });
  const alreadySent = body.already_sent === true || body.already_sent === 'true';
  const confirm = body.confirm === true || body.confirm === 'true';
  if (alreadySent && !confirm) {
    throw new Error('confirm=true required when already_sent=true');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const orderSheet = getSheet(SHEET.ORDERS);
    const { headers, rows } = getTable(orderSheet);
    const idxOrderId = headers.indexOf('order_id');
    const idxStatus = headers.indexOf('status');
    const orderRowIdx0 = rows.findIndex((r) => r[idxOrderId] === body.order_id);
    if (orderRowIdx0 === -1) throw new Error('Order not found');
    const currentStatus = rows[orderRowIdx0][idxStatus];

    const orderRowNumber = orderRowIdx0 + 2;
    updateRow(orderSheet, orderRowNumber, headers, { status: ORDER_STATUS.CANCELLED });

    const seatSheet = getSheet(SHEET.SEATS);
    const seatTable = getTable(seatSheet);
    const sIdxOrderId = seatTable.headers.indexOf('order_id');
    seatTable.rows.forEach((r, i) => {
      if (r[sIdxOrderId] === body.order_id) {
        const rowNumber = i + 2;
        updateRow(seatSheet, rowNumber, seatTable.headers, {
          status: SEAT_STATUS.RELEASED,
          released_at: isoNow(),
        });
      }
    });

    const reasonNote = body.reason || '';
    const note = alreadySent ? `sent-cancel${reasonNote ? `: ${reasonNote}` : ''}` : reasonNote || 'not_sent';
    logAction(
      'ORDER_CANCELLED',
      body.admin_username,
      body.order_id,
      note
    );
    return { success: true, order_status: ORDER_STATUS.CANCELLED, previous_status: currentStatus };
  } finally {
    lock.releaseLock();
  }
}

function handleReportSales(params) {
  const { start_date, end_date } = params;
  const from = start_date ? new Date(start_date) : null;
  const to = end_date ? new Date(end_date) : null;

  const orderSheet = getSheet(SHEET.ORDERS);
  const { headers, rows } = getTable(orderSheet);
  const idxCreated = headers.indexOf('created_at');
  const idxStatus = headers.indexOf('status');
  const idxProduct = headers.indexOf('product_id');
  const idxChannel = headers.indexOf('channel');

  const filtered = rows.filter((r) => {
    const ts = r[idxCreated] ? new Date(r[idxCreated]) : null;
    if (from && ts && ts < from) return false;
    if (to && ts && ts > to) return false;
    return true;
  });

  const summary = {
    total_orders: filtered.length,
    active: filtered.filter((r) => r[idxStatus] === ORDER_STATUS.ACTIVE).length,
    cancelled: filtered.filter((r) => r[idxStatus] === ORDER_STATUS.CANCELLED).length,
    replaced: 0,
    by_product: groupCount(filtered, idxProduct),
    by_channel: groupCount(filtered, idxChannel),
  };

  return { success: true, report: summary };
}

function handleReportStock() {
  const accounts = getTable(getSheet(SHEET.ACCOUNTS));
  const seats = getTable(getSheet(SHEET.SEATS));

  const idxAccId = accounts.headers.indexOf('account_id');
  const idxMode = accounts.headers.indexOf('mode');
  const idxStatus = accounts.headers.indexOf('status');
  const idxMaxSlot = accounts.headers.indexOf('max_slot');

  const sIdxAccount = seats.headers.indexOf('account_id');
  const sIdxStatus = seats.headers.indexOf('status');

  const activeSeats = seats.rows.filter((r) => r[sIdxStatus] === SEAT_STATUS.ACTIVE).length;
  const releasedSeats = seats.rows.filter((r) => r[sIdxStatus] === SEAT_STATUS.RELEASED).length;

  const usedSlots = {};
  seats.rows.forEach((r) => {
    const stat = r[sIdxStatus];
    const acc = r[sIdxAccount];
    if (
      stat === SEAT_STATUS.ACTIVE ||
      stat === SEAT_STATUS.PENDING_CONFIRM ||
      stat === SEAT_STATUS.RESERVED
    ) {
      usedSlots[acc] = (usedSlots[acc] || 0) + 1;
    }
  });

  let fullAccounts = 0;
  let availableSlots = 0;
  accounts.rows.forEach((r) => {
    if (!isActive(r[idxStatus])) return;
    const maxSlot = Number(r[idxMaxSlot] || 1);
    const used = usedSlots[r[idxAccId]] || 0;
    if (used >= maxSlot) fullAccounts += 1;
    else availableSlots += Math.max(0, maxSlot - used);
  });

  return {
    success: true,
    report: {
      active_seats: activeSeats,
      released_seats: releasedSeats,
      full_accounts: fullAccounts,
      available_slots: availableSlots,
    },
  };
}

function handleRestock(body) {
  const required = ['accounts', 'actor'];
  required.forEach((k) => {
    if (!body[k]) throw new Error(`${k} required`);
  });

  if (!Array.isArray(body.accounts) || body.accounts.length === 0) {
    throw new Error('accounts array required');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = getSheet(SHEET.ACCOUNTS);
    const { headers } = getTable(sheet);
    const created = [];

    body.accounts.forEach((acc) => {
      const accountId = `ACC-${Utilities.getUuid()}`;
      appendRow(sheet, headers, {
        account_id: accountId,
        platform: acc.platform,
        mode: acc.mode,
        email: acc.email || '',
        max_slot: Number(acc.max_slot || 1),
        status: acc.status || 'active',
        expired_at: acc.expired_at || '',
        created_at: isoNow(),
      });
      logAction('ACCOUNT_RESTOCK', body.actor, accountId, `${acc.platform} ${acc.mode}`);
      created.push({ account_id: accountId });
    });

    return { success: true, accounts: created };
  } finally {
    lock.releaseLock();
  }
}

// -------- Core logic helpers --------
function findProductById(productId) {
  const { headers, rows } = getTable(getSheet(SHEET.PRODUCTS));
  const idxId = headers.indexOf('product_id');
  const row = rows.find((r) => r[idxId] === productId);
  return row ? toObject(headers, row) : null;
}

function isActive(val) {
  const v = (val || '').toString().toLowerCase();
  return v === 'active' || v === 'aktif' || v === 'true' || v === '1';
}

function getOrderContext(orderId) {
  const orderSheet = getSheet(SHEET.ORDERS);
  const { headers, rows } = getTable(orderSheet);
  const idxId = headers.indexOf('order_id');
  const rowIdx0 = rows.findIndex((r) => r[idxId] === orderId);
  if (rowIdx0 === -1) throw new Error('Order not found');
  const order = toObject(headers, rows[rowIdx0]);

  const product = findProductById(order.product_id);
  if (!product) throw new Error('Product not found for order');

  return {
    orderSheet,
    orderHeaders: headers,
    orderRowNumber: rowIdx0 + 2,
    order,
    product,
  };
}

function findSeat(seatId) {
  const seatSheet = getSheet(SHEET.SEATS);
  const { headers, rows } = getTable(seatSheet);
  const idx = headers.indexOf('seat_id');
  const rowIdx0 = rows.findIndex((r) => r[idx] === seatId);
  if (rowIdx0 === -1) throw new Error('Seat not found');
  const seatObj = toObject(headers, rows[rowIdx0]);
  return {
    seatSheet,
    seatHeaders: headers,
    seatRowIdx: rowIdx0 + 2,
    seatObj,
  };
}

function findExistingSeatForOrder(orderId) {
  const seatSheet = getSheet(SHEET.SEATS);
  const { headers, rows } = getTable(seatSheet);
  const idxOrder = headers.indexOf('order_id');
  const idxStatus = headers.indexOf('status');
  const keepStatuses = [SEAT_STATUS.ACTIVE, SEAT_STATUS.PENDING_CONFIRM, SEAT_STATUS.RESERVED];
  const idxSeatId = headers.indexOf('seat_id');
  const idxAcc = headers.indexOf('account_id');
  const idxEnd = headers.indexOf('end_date');

  const found = rows.find((r) => r[idxOrder] === orderId && keepStatuses.indexOf(r[idxStatus]) !== -1);
  if (!found) return null;
  return {
    seat_id: found[idxSeatId],
    account_id: found[idxAcc],
    end_date: found[idxEnd],
    status: found[idxStatus],
  };
}

function assignSeatInternal(orderCtx, adminUsername, seatStatus) {
  const targetStatus = seatStatus || SEAT_STATUS.RESERVED;
  const accountsTable = getTable(getSheet(SHEET.ACCOUNTS));
  const seatsTable = getTable(getSheet(SHEET.SEATS));

  const accIdxId = accountsTable.headers.indexOf('account_id');
  const accIdxMode = accountsTable.headers.indexOf('mode');
  const accIdxStatus = accountsTable.headers.indexOf('status');
  const accIdxMaxSlot = accountsTable.headers.indexOf('max_slot');

  const seatIdxStatus = seatsTable.headers.indexOf('status');
  const seatIdxAccount = seatsTable.headers.indexOf('account_id');
  const seatIdxReleasedAt = seatsTable.headers.indexOf('released_at');

  const order = orderCtx.order;
  const product = orderCtx.product;
  const isPrivate = String(product.mode).toLowerCase() === 'private';

  const usedSlots = {};
  seatsTable.rows.forEach((r) => {
    const status = r[seatIdxStatus];
    const acc = r[seatIdxAccount];
    if (
      status === SEAT_STATUS.ACTIVE ||
      status === SEAT_STATUS.PENDING_CONFIRM ||
      status === SEAT_STATUS.RESERVED
    ) {
      usedSlots[acc] = (usedSlots[acc] || 0) + 1;
    }
  });

  const nowIso = isoNow();
  const endDate = addDays(new Date(), Number(product.duration_days || 0)).toISOString();

  if (!isPrivate) {
    const releasedSeats = seatsTable.rows
      .map((r, i) => ({ row: r, idx: i }))
      .filter((r) => r.row[seatIdxStatus] === SEAT_STATUS.RELEASED)
      .sort((a, b) => {
        const da = a.row[seatIdxReleasedAt] ? new Date(a.row[seatIdxReleasedAt]) : new Date(0);
        const db = b.row[seatIdxReleasedAt] ? new Date(b.row[seatIdxReleasedAt]) : new Date(0);
        return da - db;
      });

    if (releasedSeats.length) {
      const pick = releasedSeats[0];
      const rowNumber = pick.idx + 2;
      const seatSheet = getSheet(SHEET.SEATS);
      const seatHeaders = seatsTable.headers;
      updateRow(seatSheet, rowNumber, seatHeaders, {
        status: targetStatus,
        order_id: order.order_id,
        buyer_id: order.buyer_id,
        buyer_email: order.buyer_email,
        start_date: nowIso,
        end_date: endDate,
        released_at: '',
      });
      logAction('SEAT_ASSIGNED', adminUsername, order.order_id, `reuse seat ${pick.row[seatHeaders.indexOf('seat_id')]}`);
      return {
        success: true,
        seat_id: pick.row[seatHeaders.indexOf('seat_id')],
        account_id: pick.row[seatHeaders.indexOf('account_id')],
        end_date: endDate,
      };
    }
  }

  const candidates = accountsTable.rows
    .map((r, i) => ({ row: r, idx: i }))
    .filter((r) => isActive(r.row[accIdxStatus]))
    .filter((r) => String(r.row[accIdxMode]).toLowerCase() === (isPrivate ? 'private' : 'sharing'))
    .filter((r) => {
      const maxSlot = Number(r.row[accIdxMaxSlot] || 1);
      const used = usedSlots[r.row[accIdxId]] || 0;
      return isPrivate ? used === 0 : used < maxSlot;
    })
    .sort((a, b) => a.idx - b.idx);

  if (!candidates.length) {
    return { success: false, need_new_account: true, message: 'NEED_NEW_ACCOUNT' };
  }

  const account = candidates[0].row;
  const accountId = account[accIdxId];
  const seatId = `SEAT-${Utilities.getUuid()}`;

  appendRow(getSheet(SHEET.SEATS), seatsTable.headers, {
    seat_id: seatId,
    account_id: accountId,
    order_id: order.order_id,
    buyer_id: order.buyer_id,
    buyer_email: order.buyer_email,
    start_date: nowIso,
    end_date: endDate,
    status: targetStatus,
    released_at: '',
  });

  logAction('SEAT_ASSIGNED', adminUsername, order.order_id, `seat ${seatId} acc ${accountId}`);
  return { success: true, seat_id: seatId, account_id: accountId, end_date: endDate };
}

// -------- Reporting helpers --------
function groupCount(rows, idx) {
  const map = {};
  rows.forEach((r) => {
    const key = r[idx] || 'UNKNOWN';
    map[key] = (map[key] || 0) + 1;
  });
  return Object.keys(map).map((k) => ({ key: k, count: map[k] }));
}
