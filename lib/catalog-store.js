/**
 * Editable catalog store (JSON on disk).
 * Source of truth between hse.ru sync and manual admin edits.
 *
 * Layout: .catalog-data.json
 *   { updated, source, programs: [ Program ] }
 *
 * Program fields used by the HTML renderer (update-catalog.js):
 *   id, title, url, type{shortTitle,title}, studyFormat{title},
 *   duration, startDate (ms), isStartDateWithoutDay,
 *   discountPrice | educationPricing, locked, source
 */

'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const { moscowMinutesOfDay } = require('./moscow-time');
const crypto = require('node:crypto');
const { safeHseUrl, CATALOG_URL, summarizeProgram } = require('./hse-catalog');

const ROOT = path.resolve(__dirname, '..');
const DATA_FILE = path.join(ROOT, '.catalog-data.json');
const SCHEDULE_FILE = path.join(ROOT, '.catalog-schedule.json');

const MAX_PROGRAMS = 200;
const MAX_TITLE = 500;
const MAX_DURATION = 120;
const MAX_TYPE = 80;

const DEFAULT_SCHEDULE = Object.freeze({
  enabled: true,
  hour: 3,
  minute: 0,
  lastRun: null,
  lastError: null,
  lastResult: null,
});

// Единственная реализация атомарной записи на проект (update-catalog.js её
// импортирует). Случайный суффикс в имени: одного pid мало — два конкурентных
// вызова в одном процессе (планировщик и PUT из админки) писали бы в один и
// тот же временный файл.
async function writeAtomic(filePath, content) {
  const dir = path.dirname(filePath);
  const suffix = `${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
  const tmp = path.join(dir, `.${path.basename(filePath)}.${suffix}.tmp`);
  try {
    await fsp.writeFile(tmp, content, 'utf8');
    await fsp.rename(tmp, filePath);
  } catch (err) {
    await fsp.unlink(tmp).catch(() => {});
    throw err;
  }
}

function parseStartDate(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const s = String(raw).trim();
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  // ISO date or datetime
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.getTime();
}

function parsePrice(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const cleaned = String(raw).replace(/\s/g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalize a program from API / hse / storage into the renderer shape.
 */
function normalizeProgram(raw, { generateId = true } = {}) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Программа должна быть объектом');
  }

  let id = raw.id != null && String(raw.id).trim() !== '' ? String(raw.id).trim() : null;
  if (!id) {
    if (!generateId) throw new Error('id обязателен');
    id = `local-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  }
  if (id.length > 64) id = id.slice(0, 64);

  const title = String(raw.title || '').trim().slice(0, MAX_TITLE);
  if (!title) throw new Error('Название программы обязательно');

  const typeTitle =
    (typeof raw.type === 'object' && raw.type
      ? raw.type.shortTitle || raw.type.title
      : raw.type) ||
    raw.typeTitle ||
    'Другое';
  const typeStr = String(typeTitle).trim().slice(0, MAX_TYPE) || 'Другое';

  const formatTitle =
    (typeof raw.studyFormat === 'object' && raw.studyFormat
      ? raw.studyFormat.title
      : raw.studyFormat) ||
    raw.format ||
    '';
  const formatStr = String(formatTitle || '').trim().slice(0, MAX_TYPE);

  const duration = String(raw.duration || '').trim().slice(0, MAX_DURATION);
  const startDate = parseStartDate(raw.startDate);
  const price = parsePrice(raw.discountPrice ?? raw.educationPricing ?? raw.price);

  let url = raw.url ? String(raw.url).trim() : '';
  // safeHseUrl отдаёт null для негодного адреса. В автоимпорте такую программу
  // пропускают целиком, но здесь запись завёл человек в админке — молча терять
  // её нельзя, поэтому ссылка откатывается на общий каталог.
  url = (url && safeHseUrl(url)) || CATALOG_URL;

  const source = raw.source === 'manual' || String(id).startsWith('local-') ? 'manual' : 'hse';
  const locked = Boolean(raw.locked) || source === 'manual';

  return {
    id,
    title,
    url,
    type: { shortTitle: typeStr, title: typeStr },
    studyFormat: formatStr ? { title: formatStr } : null,
    duration: duration || null,
    startDate,
    isStartDateWithoutDay: Boolean(raw.isStartDateWithoutDay),
    discountPrice: price,
    educationPricing: price,
    source,
    locked,
  };
}

async function loadStore() {
  try {
    const raw = JSON.parse(await fsp.readFile(DATA_FILE, 'utf8'));
    const programs = Array.isArray(raw.programs)
      ? raw.programs.map((p) => normalizeProgram(p, { generateId: true }))
      : [];
    return {
      updated: raw.updated || null,
      source: raw.source || null,
      programs,
    };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { updated: null, source: null, programs: [] };
    }
    throw err;
  }
}

async function saveStore({ programs, source, updated }) {
  if (!Array.isArray(programs)) throw new Error('programs must be an array');
  if (programs.length > MAX_PROGRAMS) {
    throw new Error(`Слишком много программ (макс. ${MAX_PROGRAMS})`);
  }
  const normalized = programs.map((p) => normalizeProgram(p, { generateId: true }));
  // unique ids
  const seen = new Set();
  for (const p of normalized) {
    if (seen.has(p.id)) throw new Error(`Дублируется id: ${p.id}`);
    seen.add(p.id);
  }
  const payload = {
    updated: updated || new Date().toISOString(),
    source: source || 'manual',
    count: normalized.length,
    programs: normalized,
  };
  await writeAtomic(DATA_FILE, JSON.stringify(payload, null, 2));
  return payload;
}

/**
 * Merge remote hse list with local store.
 * - locked / manual programs kept as-is (or added if only local)
 * - unlocked hse programs refreshed from remote
 * - unlocked programs missing from remote are dropped
 */
function mergeWithRemote(localPrograms, remotePrograms) {
  const localById = new Map((localPrograms || []).map((p) => [String(p.id), p]));
  const remoteById = new Map((remotePrograms || []).map((p) => [String(p.id), p]));
  const out = [];

  // Remote first (catalog order), with lock respect
  for (const [id, remote] of remoteById) {
    const local = localById.get(id);
    if (local && local.locked) {
      out.push(local);
    } else {
      const n = normalizeProgram({ ...remote, source: 'hse', locked: false }, { generateId: false });
      out.push(n);
    }
    localById.delete(id);
  }

  // Remaining local-only (manual / locked extras)
  for (const local of localById.values()) {
    if (local.locked || local.source === 'manual' || String(local.id).startsWith('local-')) {
      out.push(local);
    }
  }

  return out;
}

function toSummaries(programs) {
  return programs.map(summarizeProgram);
}

async function loadSchedule() {
  try {
    const raw = JSON.parse(await fsp.readFile(SCHEDULE_FILE, 'utf8'));
    return {
      enabled: raw.enabled !== false,
      hour: clampInt(raw.hour, 0, 23, DEFAULT_SCHEDULE.hour),
      minute: clampInt(raw.minute, 0, 59, DEFAULT_SCHEDULE.minute),
      lastRun: raw.lastRun || null,
      lastError: raw.lastError || null,
      lastResult: raw.lastResult || null,
    };
  } catch {
    return { ...DEFAULT_SCHEDULE };
  }
}

// saveSchedule — это read-modify-write. Планировщик пишет lastRun вне
// single-flight обновления каталога и может пересечься с PUT /api/schedule из
// админки; без очереди одно из двух обновлений молча терялось бы (например,
// откат lastRun — и задание отрабатывает повторно).
let scheduleWriteChain = Promise.resolve();

function saveSchedule(partial) {
  const run = scheduleWriteChain.then(async () => {
    const cur = await loadSchedule();
    const next = {
      ...cur,
      ...partial,
      hour: clampInt(partial.hour != null ? partial.hour : cur.hour, 0, 23, cur.hour),
      minute: clampInt(partial.minute != null ? partial.minute : cur.minute, 0, 59, cur.minute),
      enabled: partial.enabled != null ? Boolean(partial.enabled) : cur.enabled,
    };
    await writeAtomic(SCHEDULE_FILE, JSON.stringify(next, null, 2));
    return next;
  });
  scheduleWriteChain = run.catch(() => {});
  return run;
}

function clampInt(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

// «Следующий запуск через …» в админке. Считается по московским часам, как и
// само расписание: setHours() взял бы часы контейнера (UTC), и админка
// показывала бы обратный отсчёт до момента, который на три часа расходится с
// тем, когда задание правда сработает.
function msUntilNext(hour, minute) {
  const nowMinutes = moscowMinutesOfDay();
  if (nowMinutes == null) return null;
  const dueMinutes = Number(hour) * 60 + Number(minute);
  if (Number.isNaN(dueMinutes)) return null;
  const diff = dueMinutes - nowMinutes;
  // Секунды текущей минуты вычитаем, иначе отсчёт «прыгает» на минуту вперёд
  const secondsIntoMinute = new Date().getSeconds();
  // diff === 0 — назначенная минута идёт прямо сейчас: показываем «сейчас»,
  // а не отсчёт до завтрашнего запуска.
  const minutesAhead = diff >= 0 ? diff : diff + 24 * 60;
  return Math.max(0, minutesAhead * 60_000 - secondsIntoMinute * 1000);
}

module.exports = {
  DATA_FILE,
  SCHEDULE_FILE,
  MAX_PROGRAMS,
  writeAtomic,
  loadStore,
  saveStore,
  normalizeProgram,
  mergeWithRemote,
  toSummaries,
  loadSchedule,
  saveSchedule,
  msUntilNext,
  DEFAULT_SCHEDULE,
};
