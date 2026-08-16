#!/usr/bin/env node
/**
 * Local admin panel for the DPO Law faculty static site.
 *
 * Usage:  node admin-server.js
 * Open:   http://127.0.0.1:5178/admin.html
 *
 * Security model (local tool, not for public internet):
 *  - Binds only to 127.0.0.1
 *  - HTTP Basic auth with scrypt-hashed password
 *  - CSRF token required for state-changing POSTs
 *  - Brute-force lockout + request throttling
 *  - Path traversal blocked; allowlisted static assets only
 *  - Strict security headers on every response
 *  - Single-flight lock around catalog updates
 */

'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
// Расписание владелец задаёт в московском времени — контейнер живёт в UTC,
// поэтому «локальные» часы сервера здесь не годятся (см. lib/moscow-time.js).
const { moscowDayKey, moscowMinutesOfDay } = require('./lib/moscow-time');
const {
  MIME,
  PUBLIC_HTML,
  ASSET_DIRS,
  ASSET_EXT,
  resolveSafe: resolveSafeShared,
  readBody,
} = require('./lib/static-http');
const {
  verifyPassword,
  safeEqualStr,
  loadOrCreateCredentials,
} = require('./lib/admin-credentials');


const PORT = Number(process.env.PORT) || 5178;
// По умолчанию слушаем только петлевой интерфейс — админка не должна быть
// видна из сети. В контейнере нужен 0.0.0.0 (иначе снаружи не достучаться),
// поэтому адрес переопределяется переменной HOST, а наружу порт публикуется
// только на 127.0.0.1 хоста — см. docker-compose.yml.
const HOST = process.env.HOST || '127.0.0.1';
// За nginx-прокси remoteAddress — это адрес контейнера nginx, и все посетители
// делили бы один бакет троттлинга: один флудер исчерпывает лимит /api/collect
// для всех. Заголовку X-Real-IP верим только по явному флагу (docker-compose):
// без прокси клиент мог бы подставить его сам и обойти per-IP лимиты.
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const ROOT = __dirname;
const STATUS_FILE = path.join(ROOT, '.admin-status.json');
const CREDENTIALS_FILE = path.join(ROOT, '.admin-credentials.json');
const STARTED_AT = Date.now();

/**
 * Адреса, с которых принимается маяк аналитики (POST /api/collect).
 * Собственные локальные адреса — всегда; адрес сайта на проде добавляется
 * через SITE_ORIGIN (можно несколько через запятую), потому что там страницу
 * отдаёт nginx с другого адреса, а маяк проксируется в этот сервис.
 */
const COLLECT_ORIGINS = new Set(
  [
    `http://${HOST}:${PORT}`,
    `http://127.0.0.1:${PORT}`,
    `http://localhost:${PORT}`,
    ...String(process.env.SITE_ORIGIN || '')
      .split(',')
      .map((s) => s.trim().replace(/\/+$/, ''))
      .filter(Boolean),
  ].filter(Boolean),
);

const MAX_FAILS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const REQS_PER_MIN = 120;
const COLLECT_REQS_PER_MIN = 600; // analytics beacons
const MAX_URL_LEN = 2048;
/** Catalog PUT can be larger (full program list). */
const MAX_PROGRAMS_BODY = 512 * 1024;
/**
 * Заявка целиком помещается в несколько килобайт: длины полей ограничены в
 * lib/application-form.js. Лимит с запасом, но далеко от 512 КБ каталога.
 */
const MAX_APPLICATION_BODY = 16 * 1024;
/** Заявок в минуту с одного адреса. Человеку хватает одной. */
const APPLICATION_REQS_PER_MIN = 5;
const REQUIRED_MARKERS = [
  '<!-- CATALOG:META -->',
  '<!-- CATALOG:LIST -->',
  '<!-- CATALOG:JSONLD -->',
  '<!-- CATALOG:FILTERS_TYPE -->',
  '<!-- CATALOG:FILTERS_FORMAT -->',
];

// ─── Auth / rate limit ────────────────────────────────────────────────────────

const authFails = new Map(); // ip -> { count, lockedUntil }
const reqCounts = new Map(); // ip -> { windowStart, count }

function isLockedOut(ip) {
  const rec = authFails.get(ip);
  return Boolean(rec && rec.lockedUntil > Date.now());
}

function recordAuthFail(ip) {
  const rec = authFails.get(ip) || { count: 0, lockedUntil: 0 };
  rec.count += 1;
  const attempt = rec.count;
  if (rec.count >= MAX_FAILS) {
    rec.lockedUntil = Date.now() + LOCKOUT_MS;
    rec.count = 0;
    console.warn(`[auth] ${new Date().toISOString()} ${ip}: ${MAX_FAILS} неверных паролей — блокировка на ${LOCKOUT_MS / 60000} мин`);
  } else {
    console.warn(`[auth] ${new Date().toISOString()} ${ip}: неверный пароль (попытка ${attempt}/${MAX_FAILS})`);
  }
  authFails.set(ip, rec);
}

/**
 * Тарпит: ответ на НЕВЕРНЫЕ учётные данные задерживается, поэтому перебор
 * словаря замедляется на порядок ещё до срабатывания блокировки. Верный
 * пароль и первый запрос браузера без Authorization не задерживаются.
 */
const FAIL_DELAY_MS = 700;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const collectCounts = new Map(); // analytics beacons — separate budget
/**
 * Заявки считаются отдельно и строго. Маяк аналитики шлётся десятками в
 * минуту с одной вкладки, заявка — единицы за день с одного человека, и
 * общий с аналитикой бюджет означал бы, что активный посетитель не может
 * подать заявку, потому что сам же исчерпал лимит просмотром страниц.
 */
const applicationCounts = new Map();

function isThrottled(ip, map = reqCounts, limit = REQS_PER_MIN) {
  const now = Date.now();
  const rec = map.get(ip);
  if (!rec || now - rec.windowStart > 60_000) {
    map.set(ip, { windowStart: now, count: 1 });
    return false;
  }
  rec.count += 1;
  return rec.count > limit;
}

/** Сколько «хвоста» запроса согласны дочитать и выбросить, чтобы отдать 413. */
const LINGER_BYTES = 4 * 1024 * 1024;
const LINGER_MS = 2000;

/**
 * Ответ на превышение лимита тела запроса.
 *
 * Тонкость в том, что клиент в этот момент ещё ДОСЫЛАЕТ тело. Если просто
 * оборвать соединение, его запись упадёт с «broken pipe» раньше, чем он
 * прочитает ответ, — и вместо понятного 413 в админке будет «сеть недоступна».
 * Поэтому ответ отправляется сразу, а остаток запроса ещё недолго дочитывается
 * и выбрасывается (так же поступает nginx — lingering_close). Дочитывание
 * ограничено и по объёму, и по времени: иначе смысл лимита терялся бы.
 */
function sendTooLarge(req, res) {
  let discarded = 0;
  let timer = null;
  const stop = (hard) => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    req.removeAllListeners('data');
    if (hard) req.destroy();
  };
  req.on('data', (chunk) => {
    discarded += chunk.length;
    if (discarded > LINGER_BYTES) stop(true);
  });
  req.on('end', () => stop(false));
  req.on('error', () => stop(false));
  timer = setTimeout(() => stop(true), LINGER_MS);
  req.resume();
  sendText(res, 413, 'Payload too large');
}

async function handleCollect(req, res) {
  try {
    const raw = await readBody(req);
    let parsed;
    try {
      parsed = JSON.parse(raw || '{}');
    } catch {
      sendJson(res, 400, { error: 'invalid json' });
      return;
    }
    const events = Array.isArray(parsed) ? parsed : parsed.events;
    const { ingestBatch } = require('./lib/analytics-store');
    const result = ingestBatch(events);
    res.writeHead(204, { ...SECURITY_HEADERS });
    res.end();
    return result;
  } catch (err) {
    if (err.code === 'BODY_TOO_LARGE') {
      sendTooLarge(req, res);
      return;
    }
    console.error('collect error:', err.message);
    sendJson(res, 500, { error: 'collect failed' });
  }
}

/**
 * Приём заявки на программу. Публичный маршрут — как и маяк аналитики, он
 * доступен без авторизации, потому что его вызывает посетитель сайта.
 *
 * Отличие от маяка в том, что здесь персональные данные, поэтому:
 *   — ответ всегда содержит, что именно не так с формой (иначе человек
 *     останется перед кнопкой, которая «не работает»), но никогда не
 *     повторяет присланные значения обратно в текст ошибки;
 *   — тело жёстко ограничено, а частота — пятью заявками в минуту;
 *   — ловушка для роботов: поле, невидимое человеку. Заполнено — отвечаем
 *     как при успехе и молча ничего не сохраняем. Робот не должен узнать,
 *     что его отличили.
 */
async function handleApplication(req, res) {
  try {
    const raw = await readBody(req, MAX_APPLICATION_BODY);
    let parsed;
    try {
      parsed = JSON.parse(raw || '{}');
    } catch {
      sendJson(res, 400, { error: 'invalid json' });
      return;
    }

    if (parsed && typeof parsed === 'object' && String(parsed.website || '').trim()) {
      sendJson(res, 200, { ok: true });
      return;
    }

    const { parseApplication } = require('./lib/application-form');
    const result = parseApplication(parsed);
    if (!result.ok) {
      sendJson(res, 400, { error: 'validation', fields: result.errors });
      return;
    }

    const { deliver } = require('./lib/application-delivery');
    const delivered = await deliver(result.application);
    console.log(
      `заявка ${delivered.id}: ${delivered.duplicate ? 'повтор' : 'принята'}, письмо — ${delivered.mail}`,
    );
    sendJson(res, 200, { ok: true, id: delivered.id });
  } catch (err) {
    if (err.code === 'BODY_TOO_LARGE') {
      sendTooLarge(req, res);
      return;
    }
    // Заявка не сохранена — человек должен об этом узнать и попробовать
    // ещё раз или позвонить. Молчаливый 200 здесь был бы обманом.
    console.error('application error:', err.message);
    sendJson(res, 500, { error: 'save failed' });
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of reqCounts) {
    if (now - rec.windowStart > 60_000) reqCounts.delete(ip);
  }
  for (const [ip, rec] of collectCounts) {
    if (now - rec.windowStart > 60_000) collectCounts.delete(ip);
  }
  for (const [ip, rec] of applicationCounts) {
    if (now - rec.windowStart > 60_000) applicationCounts.delete(ip);
  }
  for (const [ip, rec] of authFails) {
    if (!rec.lockedUntil || rec.lockedUntil < now) authFails.delete(ip);
  }
}, 60 * 60 * 1000).unref();

// Basic auth означает, что браузер шлёт креды с КАЖДЫМ запросом, а каждая
// проверка — это полный scrypt (N=16384, десятки миллисекунд в threadpool).
// Кэшируем sha256 пары «логин:пароль», уже прошедшей scrypt: повторные запросы
// сверяются одним timingSafeEqual. Кредов ровно одна пара и меняются они только
// перезапуском сервера, так что одного слота достаточно.
let verifiedAuthDigest = null;

async function checkAuth(req, credentials) {
  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme !== 'Basic' || !encoded) return false;

  let decoded;
  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf8');
  } catch {
    return false;
  }

  const sep = decoded.indexOf(':');
  if (sep === -1) return false;
  const user = decoded.slice(0, sep);
  const pass = decoded.slice(sep + 1);

  const digest = crypto.createHash('sha256').update(decoded, 'utf8').digest();
  if (verifiedAuthDigest && crypto.timingSafeEqual(digest, verifiedAuthDigest)) {
    return true;
  }

  if (!safeEqualStr(user, credentials.username)) return false;
  const ok = await verifyPassword(pass, credentials.passwordSalt, credentials.passwordHash);
  if (ok) verifiedAuthDigest = digest;
  return ok;
}

// ─── CSRF (per-process token; double-submit via header) ───────────────────────

const csrfToken = crypto.randomBytes(32).toString('base64url');

function checkCsrf(req) {
  const header = req.headers['x-csrf-token'] || '';
  return safeEqualStr(header, csrfToken);
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

const SECURITY_HEADERS = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store, max-age=0',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-DNS-Prefetch-Control': 'off',
});

const ADMIN_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
  "font-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'self'; " +
  "form-action 'none'; frame-ancestors 'none'; object-src 'none'";

function send(res, code, body, headers = {}) {
  const payload = body == null ? '' : body;
  const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  res.writeHead(code, {
    ...SECURITY_HEADERS,
    ...headers,
    'Content-Length': buf.length,
  });
  res.end(buf);
}

function sendJson(res, code, obj) {
  send(res, code, JSON.stringify(obj), {
    'Content-Type': 'application/json; charset=utf-8',
  });
}

function sendText(res, code, text) {
  send(res, code, text, { 'Content-Type': 'text/plain; charset=utf-8' });
}

async function readStatus() {
  try {
    return JSON.parse(await fsp.readFile(STATUS_FILE, 'utf8'));
  } catch {
    return { updated: null, count: null, error: null };
  }
}

async function writeStatus(status) {
  await fsp.writeFile(STATUS_FILE, JSON.stringify(status, null, 2), 'utf8');
}

function captureConsole(fn) {
  const lines = [];
  const orig = { log: console.log, error: console.error, warn: console.warn };
  const push = (...args) => lines.push(args.map(String).join(' '));
  console.log = (...a) => {
    push(...a);
    orig.log(...a);
  };
  console.error = (...a) => {
    push(...a);
    orig.error(...a);
  };
  console.warn = (...a) => {
    push(...a);
    orig.warn(...a);
  };

  return Promise.resolve()
    .then(() => fn())
    .finally(() => {
      console.log = orig.log;
      console.error = orig.error;
      console.warn = orig.warn;
    })
    .then(
      (result) => ({ result, log: lines.join('\n') }),
      (err) => {
        err.log = lines.join('\n');
        throw err;
      },
    );
}

// ─── Update lock (single-flight) ──────────────────────────────────────────────

let updateInFlight = null;

function clearCatalogRequireCache() {
  for (const key of Object.keys(require.cache)) {
    if (
      key.includes(`${path.sep}update-catalog.js`) ||
      key.includes(`${path.sep}hse-catalog.js`) ||
      key.includes(`${path.sep}catalog-store.js`)
    ) {
      delete require.cache[key];
    }
  }
}

function assertCsrfAndOrigin(req) {
  if (!checkCsrf(req)) {
    return { ok: false, code: 403, error: 'Неверный CSRF-токен. Обновите страницу админки.' };
  }
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  // Список допустимых источников, а не один адрес: браузер присылает тот хост,
  // который набрал пользователь (localhost / 127.0.0.1), и он не обязан
  // совпадать с адресом привязки. В контейнере HOST=0.0.0.0 — такого Origin
  // браузер не пришлёт никогда, поэтому сверяться с ним напрямую нельзя.
  const allowed = new Set([
    `http://127.0.0.1:${PORT}`,
    `http://localhost:${PORT}`,
    `http://[::1]:${PORT}`,
  ]);
  if (HOST !== '0.0.0.0' && HOST !== '::') allowed.add(`http://${HOST}:${PORT}`);

  if (origin && !allowed.has(origin)) {
    return { ok: false, code: 403, error: 'Недопустимый Origin' };
  }
  if (referer && ![...allowed].some((a) => referer.startsWith(a + '/'))) {
    return { ok: false, code: 403, error: 'Недопустимый Referer' };
  }
  return { ok: true };
}

async function runCatalogJob(jobFn) {
  if (updateInFlight) {
    const err = new Error('Обновление уже выполняется');
    err.code = 'UPDATE_IN_FLIGHT';
    throw err;
  }
  updateInFlight = (async () => {
    clearCatalogRequireCache();
    return captureConsole(() => jobFn());
  })();
  try {
    return await updateInFlight;
  } finally {
    updateInFlight = null;
  }
}

/**
 * Единый вид статуса после успешного пересбора каталога. Раньше этот объект
 * собирался в трёх местах почти одинаковыми литералами, и поля расходились.
 */
function buildStatus(prev, result, { source, onlyActual, log }) {
  const prevCount = prev.count ?? null;
  return {
    updated: result.updated,
    count: result.count,
    prevCount,
    delta: prevCount == null ? null : result.count - prevCount,
    source,
    onlyActual,
    durationMs: result.durationMs ?? null,
    programs: result.programs || [],
    error: null,
    log,
  };
}

async function handleUpdate(res, { fromStore = false } = {}) {
  const prev = await readStatus();
  try {
    const { result, log } = await runCatalogJob(() => {
      const { main } = require('./update-catalog');
      return main({ fromStore });
    });
    const status = buildStatus(prev, result, {
      source: result.source || null,
      onlyActual: result.onlyActual !== false,
      log,
    });
    await writeStatus(status);
    sendJson(res, 200, { ...status, csrfToken });
  } catch (err) {
    if (err.code === 'UPDATE_IN_FLIGHT') {
      sendJson(res, 409, {
        error: 'Обновление уже выполняется',
        log: 'Дождитесь завершения текущего запроса.',
        csrfToken,
      });
      return;
    }
    const status = {
      ...prev,
      error: err.message,
      log: err.log || err.message,
    };
    await writeStatus(status);
    sendJson(res, 500, { ...status, csrfToken });
  }
}

function programToEditorRow(p) {
  const price = p.discountPrice ?? p.educationPricing ?? null;
  let startDate = '';
  if (p.startDate) {
    // hse.ru отдаёт старт меткой московской полуночи. toISOString() дал бы
    // UTC-дату — на сутки раньше, и «Сохранить в каталог» сдвигал бы все даты.
    startDate = moscowDayKey(p.startDate) || '';
  }
  return {
    id: p.id,
    title: p.title || '',
    url: p.url || '',
    type: p.type?.shortTitle || p.type?.title || '',
    format: p.studyFormat?.title || '',
    duration: p.duration || '',
    price,
    startDate,
    locked: Boolean(p.locked),
    source: p.source || 'hse',
  };
}

async function handleGetPrograms(res) {
  const { loadStore, toSummaries } = require('./lib/catalog-store');
  const store = await loadStore();
  sendJson(res, 200, {
    updated: store.updated,
    source: store.source,
    count: store.programs.length,
    programs: store.programs.map(programToEditorRow),
    summaries: toSummaries(store.programs),
    csrfToken,
  });
}

async function handlePutPrograms(req, res) {
  try {
    const raw = await readBody(req, MAX_PROGRAMS_BODY);
    let parsed;
    try {
      parsed = JSON.parse(raw || '{}');
    } catch {
      sendJson(res, 400, { error: 'invalid json', csrfToken });
      return;
    }
    const list = Array.isArray(parsed) ? parsed : parsed.programs;
    if (!Array.isArray(list)) {
      sendJson(res, 400, { error: 'Ожидается { programs: [...] }', csrfToken });
      return;
    }
    const prev = await readStatus();
    const { result, log } = await runCatalogJob(() => {
      const { applyPrograms } = require('./update-catalog');
      const { normalizeProgram } = require('./lib/catalog-store');
      const programs = list.map((row) =>
        normalizeProgram({
          id: row.id,
          title: row.title,
          url: row.url,
          type: row.type,
          studyFormat: row.format || row.studyFormat,
          duration: row.duration,
          startDate: row.startDate,
          price: row.price,
          discountPrice: row.price ?? row.discountPrice,
          locked: row.locked,
          source: row.source || (row.locked || String(row.id || '').startsWith('local-') ? 'manual' : 'hse'),
        }),
      );
      return applyPrograms(programs, { source: 'manual' });
    });
    const status = buildStatus(prev, result, {
      source: 'manual',
      onlyActual: true,
      log: log || 'Сохранено вручную',
    });
    await writeStatus(status);
    sendJson(res, 200, {
      ...status,
      programsEditor: (result.items || []).map(programToEditorRow),
      csrfToken,
    });
  } catch (err) {
    if (err.code === 'UPDATE_IN_FLIGHT') {
      sendJson(res, 409, { error: err.message, csrfToken });
      return;
    }
    if (err.code === 'BODY_TOO_LARGE') {
      sendTooLarge(req, res);
      return;
    }
    console.error('put programs:', err.message);
    sendJson(res, 400, { error: err.message, csrfToken });
  }
}

async function handleScheduleGet(res) {
  const { loadSchedule, msUntilNext } = require('./lib/catalog-store');
  const schedule = await loadSchedule();
  sendJson(res, 200, {
    ...schedule,
    nextInMs: schedule.enabled ? msUntilNext(schedule.hour, schedule.minute) : null,
    csrfToken,
  });
}

async function handleSchedulePut(req, res) {
  try {
    const raw = await readBody(req);
    let parsed;
    try {
      parsed = JSON.parse(raw || '{}');
    } catch {
      sendJson(res, 400, { error: 'invalid json', csrfToken });
      return;
    }
    // Час и минуту проверяем здесь, а не полагаемся на нормализацию в
    // catalog-store: она молча зажимает значение в допустимый диапазон, и
    // опечатка «99» превращалась в 23:00 — владелец сохранял расписание,
    // видел «сохранено» и узнавал о другом времени только по факту.
    for (const [field, value, max] of [['hour', parsed.hour, 23], ['minute', parsed.minute, 59]]) {
      if (value === undefined) continue;
      const num = Number(value);
      if (!Number.isInteger(num) || num < 0 || num > max) {
        sendJson(res, 400, {
          error: `Поле «${field}» должно быть целым числом от 0 до ${max}, получено: ${JSON.stringify(value)}`,
          csrfToken,
        });
        return;
      }
    }

    const { saveSchedule, msUntilNext } = require('./lib/catalog-store');
    const schedule = await saveSchedule({
      enabled: parsed.enabled,
      hour: parsed.hour,
      minute: parsed.minute,
    });
    // reschedule timer
    rescheduleDailyJob();
    sendJson(res, 200, {
      ...schedule,
      nextInMs: schedule.enabled ? msUntilNext(schedule.hour, schedule.minute) : null,
      csrfToken,
    });
  } catch (err) {
    sendJson(res, 400, { error: err.message, csrfToken });
  }
}

async function handleStatus(req, res) {
  const status = await readStatus();
  let schedule = null;
  try {
    const { loadSchedule, msUntilNext } = require('./lib/catalog-store');
    schedule = await loadSchedule();
    schedule = {
      ...schedule,
      nextInMs: schedule.enabled ? msUntilNext(schedule.hour, schedule.minute) : null,
    };
  } catch {
    /* ignore */
  }
  // Prefer store count/programs when available
  try {
    const { loadStore, toSummaries } = require('./lib/catalog-store');
    const store = await loadStore();
    if (store.programs.length) {
      status.count = store.programs.length;
      status.programs = toSummaries(store.programs);
      if (store.updated && !status.updated) status.updated = store.updated;
      if (store.source) status.source = store.source;
    }
  } catch {
    /* ignore */
  }
  sendJson(res, 200, {
    ...status,
    schedule,
    csrfToken,
    server: {
      uptimeSec: Math.round((Date.now() - STARTED_AT) / 1000),
      node: process.version,
      host: HOST,
      port: PORT,
      onlyActual: true,
    },
  });
}

async function handleHealth(req, res) {
  const health = await runHealthCheck();
  sendJson(res, health.ok ? 200 : 503, { ...health, csrfToken });
}

async function handleProgramsJson(req, res) {
  // Prefer live store; fall back to last status snapshot.
  try {
    const { loadStore, toSummaries } = require('./lib/catalog-store');
    const store = await loadStore();
    if (store.programs.length) {
      sendJson(res, 200, {
        updated: store.updated || null,
        count: store.programs.length,
        onlyActual: true,
        source: store.source || null,
        programs: toSummaries(store.programs),
      });
      return;
    }
  } catch {
    /* fall through */
  }
  const status = await readStatus();
  sendJson(res, 200, {
    updated: status.updated || null,
    count: status.count ?? 0,
    onlyActual: status.onlyActual !== false,
    source: status.source || null,
    programs: status.programs || [],
  });
}

async function handleAnalytics(req, res) {
  const urlObj = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  const days = Number(urlObj.searchParams.get('days') || 30);
  const { getSummary } = require('./lib/analytics-store');
  const summary = await getSummary(days);
  sendJson(res, 200, { ...summary, csrfToken });
}

async function handleAnalyticsSeed(req, res) {
  const { seedDemo, getSummary } = require('./lib/analytics-store');
  const result = await seedDemo(100);
  const summary = await getSummary(30);
  sendJson(res, 200, { ...summary, seed: result, csrfToken });
}

/**
 * Список заявок для менеджера. Маршрут закрыт той же авторизацией, что и
 * весь остальной API админки, а сама админка живёт только на 127.0.0.1 —
 * персональные данные не покидают машину центра.
 */
async function handleApplicationsList(req, res) {
  const urlObj = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  const limit = Math.min(Number(urlObj.searchParams.get('limit') || 200), 1000);
  const store = require('./lib/application-store');
  const [items, stats] = await Promise.all([store.list({ limit }), store.stats()]);
  sendJson(res, 200, { items, stats, csrfToken });
}

async function handleApplicationStatus(req, res) {
  const store = require('./lib/application-store');
  try {
    const raw = await readBody(req, 4 * 1024);
    const { id, status } = JSON.parse(raw || '{}');
    if (!id || typeof id !== 'string') {
      sendJson(res, 400, { error: 'нет идентификатора заявки', csrfToken });
      return;
    }
    if (!store.STATUSES.includes(status)) {
      sendJson(res, 400, { error: `статус должен быть одним из: ${store.STATUSES.join(', ')}`, csrfToken });
      return;
    }
    const updated = await store.setStatus(id, status);
    sendJson(res, 200, { ok: true, id, ...updated, csrfToken });
  } catch (err) {
    if (err.code === 'BODY_TOO_LARGE') {
      sendTooLarge(req, res);
      return;
    }
    sendJson(res, 400, { error: 'invalid json', csrfToken });
  }
}

// ─── Daily auto-update ────────────────────────────────────────────────────────

let dailyTimer = null;

async function runScheduledCatalogUpdate() {
  const { loadSchedule, saveSchedule } = require('./lib/catalog-store');
  const schedule = await loadSchedule();
  if (!schedule.enabled) return;

  // «Сегодня» — московские сутки, а не UTC-сутки. С UTC-ключом задание,
  // назначенное на ночные часы по Москве, попадало во вчерашний UTC-день и
  // могло отработать дважды за одни московские сутки.
  const today = moscowDayKey();
  if (schedule.lastRun && moscowDayKey(new Date(schedule.lastRun)) === today) {
    return; // already ran today
  }

  console.log('[schedule] daily catalog update starting…');
  try {
    const { result, log } = await runCatalogJob(() => {
      const { main } = require('./update-catalog');
      return main({ fromStore: false });
    });
    const prev = await readStatus();
    const status = buildStatus(prev, result, {
      source: result.source || null,
      onlyActual: true,
      log: `[auto] ${log || ''}`.trim(),
    });
    await writeStatus(status);
    await saveSchedule({
      lastRun: new Date().toISOString(),
      lastError: null,
      lastResult: { count: result.count, updated: result.updated },
    });
    console.log(`[schedule] ok: ${result.count} programs`);
  } catch (err) {
    if (err.code === 'UPDATE_IN_FLIGHT') {
      console.warn('[schedule] skipped — update already in flight');
      return;
    }
    console.error('[schedule] failed:', err.message);
    await saveSchedule({
      lastRun: new Date().toISOString(),
      lastError: err.message,
    }).catch(() => {});
  }
}

function rescheduleDailyJob() {
  if (dailyTimer) {
    clearTimeout(dailyTimer);
    dailyTimer = null;
  }
  // Проверка раз в минуту; сам запуск ограничен «не чаще раза в московские сутки».
  //
  // Условие — «время наступило», а не «минута совпала». Точное совпадение
  // означало бы, что задание пропущено на весь день, если тик разошёлся с
  // расписанием: контейнер перезапустили в 03:30, машина была занята в нужную
  // минуту, setInterval сдвинулся. Пропуск молчаливый, а на сайте после него
  // сутки висят вчерашние данные.
  //
  // Побочный эффект осознанный: при первом запуске (lastRun ещё нет) обновление
  // стартует сразу, если московское время уже прошло назначенное. Свежий
  // каталог на старте — это то, что нужно.
  dailyTimer = setInterval(async () => {
    try {
      const { loadSchedule } = require('./lib/catalog-store');
      const schedule = await loadSchedule();
      if (!schedule.enabled) return;
      const nowMinutes = moscowMinutesOfDay();
      const dueMinutes = Number(schedule.hour) * 60 + Number(schedule.minute);
      if (nowMinutes == null || Number.isNaN(dueMinutes) || nowMinutes < dueMinutes) return;
      await runScheduledCatalogUpdate();
    } catch (err) {
      console.error('[schedule] tick error:', err.message);
    }
  }, 60 * 1000);
  if (typeof dailyTimer.unref === 'function') dailyTimer.unref();
}

async function runHealthCheck() {
  const checks = [];
  const push = (name, ok, detail = '') => checks.push({ name, ok, detail });

  const criticalFiles = [
    'index.html',
    'Каталог программ.html',
    'privacy.html',
    'admin.html',
    'js/cookie-consent.js',
    'js/site-analytics.js',
    'js/smooth-ui.js',
    'lib/hse-catalog.js',
    'lib/catalog-store.js',
    'lib/analytics-store.js',
    'update-catalog.js',
  ];

  for (const rel of criticalFiles) {
    try {
      const st = await fsp.stat(path.join(ROOT, rel));
      push(`file:${rel}`, st.isFile(), `${Math.round(st.size / 1024)} KB`);
    } catch {
      push(`file:${rel}`, false, 'отсутствует');
    }
  }

  try {
    const catalogHtml = await fsp.readFile(path.join(ROOT, 'Каталог программ.html'), 'utf8');
    const missing = REQUIRED_MARKERS.filter((m) => !catalogHtml.includes(m));
    push(
      'catalog:markers',
      missing.length === 0,
      missing.length ? `нет: ${missing.join(', ')}` : 'все маркеры на месте',
    );
    const cards = (catalogHtml.match(/class="card"/g) || []).length;
    push('catalog:cards', cards > 0, `${cards} карточек в HTML`);
  } catch (err) {
    push('catalog:markers', false, err.message);
  }

  // Reachability of the upstream catalog (does not rewrite local files).
  const t0 = Date.now();
  try {
    const { CATALOG_URL, fetchCatalogPage } = require('./lib/hse-catalog');
    const state = await fetchCatalogPage(CATALOG_URL);
    const total = Number(state.total) || (state.items || []).length;
    push('hse.ru:catalog', total > 0, `${total} актуальных на hse.ru, ${Date.now() - t0} мс`);
  } catch (err) {
    push('hse.ru:catalog', false, `${err.message} (${Date.now() - t0} мс)`);
  }

  push('credentials', fs.existsSync(CREDENTIALS_FILE), path.basename(CREDENTIALS_FILE));
  push('node', true, process.version);

  const ok = checks.every((c) => c.ok);
  return {
    ok,
    checkedAt: new Date().toISOString(),
    uptimeSec: Math.round((Date.now() - STARTED_AT) / 1000),
    checks,
  };
}

// ─── Static file serving (path-safe allowlist) ────────────────────────────────

// Списки и разбор пути — общие с превью-сервером (lib/static-http). Отличие
// админки: служебные файлы корня (robots.txt, sitemap.xml) она не отдаёт,
// а favicon обрабатывает отдельной веткой ниже.
const resolveSafe = (pathname) => resolveSafeShared(pathname, ROOT);

async function serveFile(res, absPath, extraHeaders = {}) {
  try {
    const data = await fsp.readFile(absPath);
    const ext = path.extname(absPath).toLowerCase();
    send(res, 200, data, {
      ...extraHeaders,
      'Content-Type': MIME[ext] || 'application/octet-stream',
    });
  } catch {
    sendText(res, 404, 'Not found');
  }
}

// ─── Request handler ──────────────────────────────────────────────────────────

/**
 * Все API-маршруты в одном месте. csrf: true — изменяющий маршрут, перед
 * обработчиком обязателен гейт assertCsrfAndOrigin; какие маршруты защищены,
 * видно по этой колонке, а не по разбросанным if по телу сервера.
 */
const API_ROUTES = [
  { method: 'GET',  path: '/api/status',         handler: handleStatus },
  { method: 'GET',  path: '/api/csrf',           handler: (req, res) => sendJson(res, 200, { csrfToken }) },
  { method: 'GET',  path: '/api/health',         handler: handleHealth },
  { method: 'GET',  path: '/api/programs.json',  handler: handleProgramsJson },
  { method: 'GET',  path: '/api/programs',       handler: (req, res) => handleGetPrograms(res) },
  { method: 'PUT',  path: '/api/programs',       csrf: true, handler: handlePutPrograms },
  { method: 'GET',  path: '/api/schedule',       handler: (req, res) => handleScheduleGet(res) },
  { method: 'PUT',  path: '/api/schedule',       csrf: true, handler: handleSchedulePut },
  { method: 'POST', path: '/api/schedule',       csrf: true, handler: handleSchedulePut },
  { method: 'GET',  path: '/api/analytics',      handler: handleAnalytics },
  { method: 'POST', path: '/api/analytics/seed', csrf: true, handler: handleAnalyticsSeed },
  { method: 'GET',  path: '/api/applications',   handler: handleApplicationsList },
  { method: 'POST', path: '/api/applications/status', csrf: true, handler: handleApplicationStatus },
  { method: 'POST', path: '/api/update',         csrf: true, handler: (req, res) => handleUpdate(res, { fromStore: false }) },
  { method: 'POST', path: '/api/rebuild',        csrf: true, handler: (req, res) => handleUpdate(res, { fromStore: true }) },
];

async function createServer(credentials) {
  const server = http.createServer(async (req, res) => {
    try {
      const ip =
        (TRUST_PROXY && String(req.headers['x-real-ip'] || '').trim()) ||
        req.socket.remoteAddress ||
        'unknown';
      const method = req.method || 'GET';
      const rawUrl = req.url || '/';

      if (rawUrl.length > MAX_URL_LEN) {
        sendText(res, 414, 'URI too long');
        return;
      }

      // Only allow methods we implement.
      if (!['GET', 'HEAD', 'POST', 'PUT'].includes(method)) {
        send(res, 405, 'Method Not Allowed', {
          'Content-Type': 'text/plain; charset=utf-8',
          Allow: 'GET, HEAD, POST, PUT',
        });
        return;
      }

      let pathname;
      try {
        pathname = decodeURIComponent(rawUrl.split('?')[0]);
      } catch {
        sendText(res, 400, 'Bad request');
        return;
      }

      // Public analytics collect — no auth (same-origin only; no CORS).
      if (method === 'POST' && pathname === '/api/collect') {
        if (isThrottled(ip, collectCounts, COLLECT_REQS_PER_MIN)) {
          send(res, 429, 'Too many beacons', {
            'Content-Type': 'text/plain; charset=utf-8',
            'Retry-After': '60',
          });
          return;
        }
        // Reject cross-origin browser POSTs (no ACAO headers either).
        // На проде сайт отдаётся nginx с другого адреса, а маяк проксируется
        // сюда — Origin приходит сайтовый. Разрешённые адреса сайта задаются
        // переменной SITE_ORIGIN (см. docker-compose.yml); без неё поведение
        // прежнее — принимаются только собственные локальные адреса.
        const collectOrigin = req.headers.origin;
        if (collectOrigin && !COLLECT_ORIGINS.has(collectOrigin)) {
          sendJson(res, 403, { error: 'origin not allowed' });
          return;
        }
        await handleCollect(req, res);
        return;
      }

      // Публичный приём заявок — тоже без авторизации: форму заполняет
      // посетитель. Проверка Origin общая с маяком: и то и другое приходит
      // со страниц сайта, адрес которого задан переменной SITE_ORIGIN.
      if (method === 'POST' && pathname === '/api/application') {
        if (isThrottled(ip, applicationCounts, APPLICATION_REQS_PER_MIN)) {
          sendJson(res, 429, { error: 'too many applications' });
          return;
        }
        const appOrigin = req.headers.origin;
        if (appOrigin && !COLLECT_ORIGINS.has(appOrigin)) {
          sendJson(res, 403, { error: 'origin not allowed' });
          return;
        }
        await handleApplication(req, res);
        return;
      }

      if (isThrottled(ip)) {
        send(res, 429, 'Слишком много запросов. Попробуйте позже.', {
          'Content-Type': 'text/plain; charset=utf-8',
          'Retry-After': '60',
        });
        return;
      }

      if (isLockedOut(ip)) {
        send(res, 429, 'Слишком много неудачных попыток входа. Попробуйте позже.', {
          'Content-Type': 'text/plain; charset=utf-8',
          'Retry-After': String(Math.ceil(LOCKOUT_MS / 1000)),
        });
        return;
      }

      const authed = await checkAuth(req, credentials);
      if (!authed) {
        if (req.headers.authorization) {
          recordAuthFail(ip);
          await sleep(FAIL_DELAY_MS); // тарпит — только для неверных кред
        }
        send(res, 401, 'Требуется авторизация', {
          'Content-Type': 'text/plain; charset=utf-8',
          'WWW-Authenticate': 'Basic realm="DPO Admin", charset="UTF-8"',
        });
        return;
      }
      authFails.delete(ip);

      // ── API ──────────────────────────────────────────────────────────────
      const route = API_ROUTES.find((r) => r.method === method && r.path === pathname);
      if (route) {
        if (route.csrf) {
          const gate = assertCsrfAndOrigin(req);
          if (!gate.ok) {
            sendJson(res, gate.code, { error: gate.error, csrfToken });
            return;
          }
        }
        await route.handler(req, res);
        return;
      }

      if (method === 'POST' || method === 'PUT') {
        sendText(res, 404, 'Not found');
        return;
      }


      // ── Static ───────────────────────────────────────────────────────────
      if (pathname === '/' || pathname === '/admin.html') {
        await serveFile(res, path.join(ROOT, 'admin.html'), {
          'Content-Security-Policy': ADMIN_CSP,
        });
        return;
      }

      const safe = resolveSafe(pathname);
      if (!safe) {
        sendText(res, 400, 'Bad path');
        return;
      }

      const base = path.basename(safe.rel);
      if (PUBLIC_HTML.has(base) && safe.rel === base) {
        await serveFile(res, safe.abs);
        return;
      }

      // Root-level favicon (not under fonts/js/images)
      if (method === 'GET' && (pathname === '/favicon.svg' || pathname === '/favicon.ico')) {
        const fav = path.join(ROOT, 'favicon.svg');
        if (fs.existsSync(fav)) {
          await serveFile(res, fav);
          return;
        }
      }

      const topDir = safe.rel.split('/')[0];
      const ext = path.extname(safe.rel).toLowerCase();
      if (ASSET_DIRS.has(topDir) && ASSET_EXT.has(ext)) {
        await serveFile(res, safe.abs);
        return;
      }

      sendText(res, 404, 'Not found');
    } catch (err) {
      console.error('Request handler error:', err.stack || err.message);
      if (!res.headersSent) sendText(res, 500, 'Internal error');
    }
  });

  server.requestTimeout = 120_000;
  server.headersTimeout = 30_000;
  server.maxHeadersCount = 50;

  return server;
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception — shutting down:', err.stack || err.message);
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection — shutting down:', err?.stack || err);
  process.exit(1);
});

(async () => {
  // 90-day retention for first-party analytics JSONL
  try {
    const { purgeOld } = require('./lib/analytics-store');
    await purgeOld();
    setInterval(() => {
      purgeOld().catch((e) => console.warn('analytics purge:', e.message));
    }, 24 * 60 * 60 * 1000).unref();
  } catch (err) {
    console.warn('analytics purge on boot skipped:', err.message);
  }

  const credentials = await loadOrCreateCredentials(CREDENTIALS_FILE);
  const server = await createServer(credentials);

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use — is admin-server.js already running?`);
      console.error(`Stop it, or run:  set PORT=5179&& node admin-server.js`);
    } else {
      console.error('Server failed to start:', err.message);
    }
    process.exitCode = 1;
  });

  server.listen(PORT, HOST, () => {
    console.log(`Admin panel: http://${HOST}:${PORT}/admin.html`);
    console.log(`Логин: ${credentials.username}`);
    if (credentials.isNew && credentials.plainPassword) {
      console.log(`Пароль (показывается один раз): ${credentials.plainPassword}`);
      console.log('Сохраните пароль. Хеш записан в .admin-credentials.json (в git не попадает).');
    } else {
      console.log('Пароль: см. ранее сохранённый. Сброс — удалите .admin-credentials.json и перезапустите.');
    }
    // Daily auto-update of catalog page
    rescheduleDailyJob();
    require('./lib/catalog-store')
      .loadSchedule()
      .then((s) => {
        if (s.enabled) {
          const hh = String(s.hour).padStart(2, '0');
          const mm = String(s.minute).padStart(2, '0');
          console.log(`Автообновление каталога: каждый день в ${hh}:${mm} по Москве`);
        } else {
          console.log('Автообновление каталога: выключено (включите во вкладке «Каталог» админки)');
        }
      })
      .catch(() => {});
  });
})().catch((err) => {
  console.error('Fatal boot error:', err);
  process.exit(1);
});
