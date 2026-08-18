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
// Путь к хранилищу переопределяется переменной окружения – тем же приёмом,
// что APPLICATIONS_DIR в lib/application-store.js. Нужно тестам: иначе
// проверка записи каталога била бы по боевому .catalog-data.json.
const DATA_FILE = process.env.CATALOG_DATA_FILE
  ? path.resolve(process.env.CATALOG_DATA_FILE)
  : path.join(ROOT, '.catalog-data.json');
const SCHEDULE_FILE = path.join(ROOT, '.catalog-schedule.json');

const MAX_PROGRAMS = 200;
const MAX_TITLE = 500;
/**
 * Описания программ, подтянутые с hse.ru (см. scripts/fetch-program-descriptions.js).
 * tagline — короткая строка из og:description, about — развёрнутое описание
 * из микроразметки Course. Оба хранятся как обычный текст: разметка вырезается
 * при загрузке, потому что дальше они попадают в HTML страниц программ.
 */
const MAX_TAGLINE = 300;
const MAX_ABOUT = 1500;
const MAX_LIST_ITEMS = 12;
const MAX_LIST_ITEM = 400;
const MAX_MODULES = 40;
const MAX_TEACHERS = 20;
const MAX_FEEDBACK = 20;
const MAX_FEEDBACK_TEXT = 2000;
const MAX_HOURS = 40;
const MAX_NAME = 120;
// Обложки программ и фото преподавателей скачаны к себе скриптом
// scripts/fetch-program-media.js: CSP сайта (img-src 'self') запрещает
// картинки с чужих доменов, поэтому в хранилище допускаются ТОЛЬКО
// локальные относительные пути в наших папках. Всё остальное – включая
// абсолютные URL и обход через «..» – отбрасывается при нормализации.
const IMAGE_PATH_RE = /^images\/programs\/[a-z0-9_.-]+$/i;
const TEACHER_PHOTO_RE = /^images\/teachers\/[a-z0-9_.-]+$/i;
const MAX_TEACHER_PHOTOS = 500;
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
    tagline: plainText(raw.tagline, MAX_TAGLINE),
    about: plainText(raw.about, MAX_ABOUT),
    audience: normalizeAudience(raw.audience),
    results: normalizeList(raw.results),
    modules: normalizeModules(raw.modules),
    teachers: normalizeTeachers(raw.teachers),
    feedback: normalizeFeedback(raw.feedback),
    image: normalizeImagePath(raw.image),
    source,
    locked,
  };
}

/**
 * Путь обложки программы. payUrl здесь не хранится намеренно: ссылка на
 * оплату вычисляется формулой из id при генерации страницы
 * (см. buildPayUrl в scripts/build-program-pages.js) – хранить производное
 * значило бы дать ему разойтись с формулой.
 */
function normalizeImagePath(value) {
  if (typeof value !== 'string') return null;
  const p = value.trim();
  return IMAGE_PATH_RE.test(p) ? p : null;
}

/**
 * Справочник фото преподавателей: { "<точное имя>": "images/teachers/….jpg" }.
 * Ключ – имя ровно в том виде, в каком оно лежит в teachers у программ:
 * по нему генераторы находят снимок. Негодные пути отбрасываются молча –
 * карточка остаётся с монограммой, это штатный фолбэк, а не ошибка.
 */
function normalizeTeacherPhotos(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out = {};
  let n = 0;
  for (const [name, p] of Object.entries(value)) {
    const key = plainText(name, MAX_NAME);
    if (!key || typeof p !== 'string' || !TEACHER_PHOTO_RE.test(p.trim())) continue;
    out[key] = p.trim();
    if (++n >= MAX_TEACHER_PHOTOS) break;
  }
  return n ? out : null;
}

/**
 * Персональные страницы преподавателей на hse.ru: { "<имя>": "https://…" }.
 * Справочник заполняется ТОЛЬКО руками (владельцем или менеджером): поиск
 * адресов по имени автоматом запрещён – однофамильцы и разные написания
 * дали бы ссылки на чужих людей на живом сайте университета. Пустой
 * справочник – штатное состояние: ссылка в карточке просто не выводится.
 * Переживает обновление каталога так же, как teacherPhotos.
 */
const TEACHER_PAGE_RE = /^https:\/\/([a-z0-9-]+\.)*hse\.ru(\/|$)/i;

function normalizeTeacherPages(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out = {};
  let n = 0;
  for (const [name, u] of Object.entries(value)) {
    const key = plainText(name, MAX_NAME);
    if (!key || typeof u !== 'string' || !TEACHER_PAGE_RE.test(u.trim())) continue;
    out[key] = u.trim();
    if (++n >= MAX_TEACHER_PHOTOS) break;
  }
  return n ? out : null;
}

/**
 * Приводит внешний текст к простому виду: снимает теги и схлопывает пробелы.
 * Описания приходят с чужой страницы и уходят в наш HTML, поэтому разметке
 * в них взяться неоткуда — экранирование при выводе это второй рубеж, а не
 * единственный.
 */
/** Список строк с чужой страницы: чистим, режем пустые, ограничиваем длину. */
function normalizeList(value, max = MAX_LIST_ITEMS) {
  if (!Array.isArray(value)) return null;
  const items = value
    .map((v) => plainText(v, MAX_LIST_ITEM))
    .filter(Boolean)
    .slice(0, max);
  return items.length ? items : null;
}

/**
 * Учебный план: список модулей вида { title, hours }. Часы приходят строкой
 * («19 ак. час.») и строкой же остаются: приводить их к числу нельзя, форма
 * записи у программ разная, а показываем мы их как есть.
 */
function normalizeModules(value, max = MAX_MODULES) {
  if (!Array.isArray(value)) return null;
  const items = value
    .map((m) => {
      if (typeof m === 'string') return { title: plainText(m, MAX_LIST_ITEM), hours: null };
      if (!m || typeof m !== 'object') return null;
      return { title: plainText(m.title, MAX_LIST_ITEM), hours: plainText(m.hours, MAX_HOURS) };
    })
    .filter((m) => m && m.title)
    .slice(0, max);
  return items.length ? items : null;
}

/**
 * Преподаватели: имя и краткая справка. Фото сюда НЕ попадает: снимки лежат
 * на hse.ru, а наша политика безопасности запрещает внешние картинки
 * (img-src 'self'). Показывать чужой домен в img означало бы либо ослабить
 * CSP, либо получить пустые рамки.
 */
function normalizeTeachers(value, max = MAX_TEACHERS) {
  if (!Array.isArray(value)) return null;
  const items = value
    .map((t) => {
      if (!t || typeof t !== 'object') return null;
      const name = plainText(t.name, MAX_NAME);
      if (!name) return null;
      return { name, about: plainText(t.about, MAX_LIST_ITEM) };
    })
    .filter(Boolean)
    .slice(0, max);
  return items.length ? items : null;
}

/**
 * Отзывы выпускников с официальной страницы программы (собирает
 * scripts/fetch-program-descriptions.js). Отзыв без автора или без текста
 * отбрасывается: безымянная цитата на витрине выглядела бы выдуманной.
 * Лимит текста щедрее прочих (2000): цитата приводится дословно и целиком,
 * усечение здесь исказило бы чужие слова.
 */
function normalizeFeedback(value, max = MAX_FEEDBACK) {
  if (!Array.isArray(value)) return null;
  const items = value
    .map((f) => {
      if (!f || typeof f !== 'object') return null;
      const text = plainText(f.text, MAX_FEEDBACK_TEXT);
      const author = plainText(f.author, MAX_NAME);
      if (!text || !author) return null;
      return { text, author };
    })
    .filter(Boolean)
    .slice(0, max);
  return items.length ? items : null;
}

/** «Для кого»: подводка плюс список аудиторий. */
function normalizeAudience(value) {
  if (!value || typeof value !== 'object') return null;
  const items = normalizeList(value.items);
  const intro = plainText(value.intro, MAX_TAGLINE);
  if (!items && !intro) return null;
  return { intro, items: items || [] };
}

function plainText(value, max) {
  if (value == null) return null;
  const text = String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, max) : null;
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
      teacherPhotos: normalizeTeacherPhotos(raw.teacherPhotos),
      teacherPages: normalizeTeacherPages(raw.teacherPages),
    };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { updated: null, source: null, programs: [], teacherPhotos: null, teacherPages: null };
    }
    throw err;
  }
}

/**
 * Поля, которых НЕТ ни в выдаче каталога hse.ru, ни в редакторе админки.
 *
 * Их подтягивают отдельные скрипты со страниц программ:
 * scripts/fetch-program-descriptions.js – тексты, scripts/fetch-program-media.js
 * – обложку. Любой путь записи, который их не передал, обязан взять прежние
 * значения из хранилища, иначе одно сохранение обнуляет содержимое каталога.
 *
 * Список один на два места – mergeWithRemote (обновление с hse.ru) и
 * carryOverContent (любая запись). Раньше он был выписан только в первом, и
 * ручной PUT из админки шёл мимо: страницы программ пересобирались с
 * заглушками «Запустите node scripts/fetch-program-descriptions.js».
 */
const CONTENT_FIELDS = Object.freeze([
  'tagline',
  'about',
  'audience',
  'results',
  'modules',
  'teachers',
  'feedback',
  'image',
]);

/**
 * Переносит содержательные поля из прежней записи программы в новую, если
 * новая их не принесла. Сравнение по `??`: пустая строка и пустой массив –
 * это осознанная очистка, а отсутствие поля – просто «не передали».
 *
 * Программы, которых в хранилище не было, возвращаются как есть: подставлять
 * им чужие тексты нельзя.
 */
function carryOverContent(programs, previousById) {
  return programs.map((p) => {
    const prev = previousById.get(String(p?.id ?? '').trim());
    if (!prev) return p;
    const merged = { ...p };
    for (const field of CONTENT_FIELDS) {
      merged[field] = p[field] ?? prev[field] ?? null;
    }
    return merged;
  });
}

async function saveStore({ programs, source, updated, teacherPhotos, teacherPages }) {
  if (!Array.isArray(programs)) throw new Error('programs must be an array');
  if (programs.length > MAX_PROGRAMS) {
    throw new Error(`Слишком много программ (макс. ${MAX_PROGRAMS})`);
  }
  // Прежнее состояние нужно и для переноса содержательных полей, и для
  // справочников фотографий – читаем один раз.
  const current = await loadStore();
  const previousById = new Map((current.programs || []).map((p) => [String(p.id), p]));

  const normalized = carryOverContent(programs, previousById).map((p) =>
    normalizeProgram(p, { generateId: true }),
  );
  // unique ids
  const seen = new Set();
  for (const p of normalized) {
    if (seen.has(p.id)) throw new Error(`Дублируется id: ${p.id}`);
    seen.add(p.id);
  }
  // Справочник фото переживает любой путь записи: и «Актуализировать с
  // hse.ru», и ручной PUT из админки не передают teacherPhotos – тогда
  // берётся текущее значение с диска. Иначе первое же обновление каталога
  // молча стирало бы все скачанные фотографии.
  let photos = normalizeTeacherPhotos(teacherPhotos);
  let pages = normalizeTeacherPages(teacherPages);
  if (teacherPhotos === undefined) photos = current.teacherPhotos;
  if (teacherPages === undefined) pages = current.teacherPages;
  const payload = {
    updated: updated || new Date().toISOString(),
    source: source || 'manual',
    count: normalized.length,
    programs: normalized,
    ...(photos ? { teacherPhotos: photos } : {}),
    ...(pages ? { teacherPages: pages } : {}),
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
      // Описания подтягиваются отдельным скриптом со страниц программ, а в
      // выдаче каталога hse.ru их нет; обложку скачивает
      // scripts/fetch-program-media.js. Без переноса из локальной копии любое
      // обновление каталога молча стирало бы их у всех программ.
      //
      // Перенос делает carryOverContent по общему списку CONTENT_FIELDS – тот
      // же, что защищает запись в saveStore. Раньше поля были выписаны здесь
      // вручную, и второй путь записи (ручной PUT из админки) остался без
      // защиты: список некому было держать в согласии.
      const [carried] = carryOverContent(
        [{ ...remote, source: 'hse', locked: false }],
        local ? new Map([[String(local.id), local]]) : new Map(),
      );
      const n = normalizeProgram(carried, { generateId: false });
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
