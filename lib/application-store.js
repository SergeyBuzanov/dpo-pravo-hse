/**
 * Хранилище заявок на программы.
 *
 * Заявка — это персональные данные, и хранилище устроено так, чтобы на
 * каждый вопрос проверяющего был короткий ответ:
 *
 *   ГДЕ лежит      — `.applications/YYYY-MM.jsonl`, один каталог, вне git;
 *   КТО читает     — только владелец процесса: каталог 0700, файлы 0600;
 *   СКОЛЬКО живёт  — `purgeOld()` удаляет файлы старше срока хранения
 *                    (по умолчанию год), и удаляет ЦЕЛИКОМ, а не вычищает
 *                    строки: файл месяца — естественная единица удаления;
 *   ЧТО ВНУТРИ     — только поля из lib/application-form.js. Ни IP, ни
 *                    User-Agent, ни отпечатка браузера здесь нет: для
 *                    обработки заявки они не нужны, а объяснять их
 *                    хранение пришлось бы.
 *
 * Формат — JSONL, как у аналитики: дозапись строки не может испортить уже
 * записанное, даже если процесс убьют посередине. Единственная перезапись
 * во всём модуле — `status.json`, и она атомарная (запись во временный
 * файл плюс переименование).
 */

'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
// Каталог выносится в переменную окружения ради тестов: они не должны
// писать настоящие заявки в рабочую копию проекта.
const DIR = process.env.APPLICATIONS_DIR
  ? path.resolve(process.env.APPLICATIONS_DIR)
  : path.join(ROOT, '.applications');
const STATUS_FILE = path.join(DIR, 'status.json');

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/**
 * Срок хранения. Год — осознанный выбор по умолчанию, а не «побольше»:
 * набор на программы идёт циклами, и заявка прошлого сезона ещё может
 * понадобиться менеджеру, а позапрошлого — уже нет. Переопределяется
 * переменной окружения, когда центр утвердит свой срок.
 */
const RETENTION_DAYS = Number(process.env.APPLICATION_RETENTION_DAYS) || 365;

/** Заявка считается повтором, если то же лицо шлёт то же в это окно. */
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

const STATUSES = Object.freeze(['new', 'in-progress', 'done', 'rejected']);

/**
 * Дозапись сериализуется через один промис: два одновременных POST не
 * должны чередовать половинки строк в файле.
 */
let writeQueue = Promise.resolve();

function monthKey(ts) {
  return new Date(ts).toISOString().slice(0, 7);
}

async function ensureDir() {
  await fsp.mkdir(DIR, { recursive: true, mode: DIR_MODE });
  // mkdir не меняет права уже существующего каталога — а он мог быть
  // создан прежней версией без режима.
  await fsp.chmod(DIR, DIR_MODE).catch(() => {});
}

/**
 * Ключ повтора. Строится по человеку и программе, а не по всему телу:
 * второй клик по кнопке может отличаться, например, галочкой рассылки —
 * заявка от этого не становится новой.
 */
function duplicateKey(app) {
  // Тема в ключе: обращение «идея курса» и заявка на программу от одного
  // человека в один день – два разных обращения, а не повтор.
  return [
    app.topic || 'program',
    app.email.toLowerCase(),
    app.phone.replace(/\D/g, ''),
    app.program?.id || '',
  ].join('|');
}

async function readMonth(key) {
  const file = path.join(DIR, `${key}.jsonl`);
  let raw;
  try {
    raw = await fsp.readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // Битая строка (обрыв записи при падении процесса) не должна делать
      // нечитаемым весь месяц — пропускаем именно её.
    }
  }
  return out;
}

/**
 * Сохраняет заявку.
 * @param {object} application — результат parseApplication
 * @returns {Promise<{id: string, duplicate: boolean}>}
 */
function save(application) {
  const run = async () => {
    await ensureDir();
    const at = Date.parse(application.receivedAt) || Date.now();
    const key = monthKey(at);
    const file = path.join(DIR, `${key}.jsonl`);

    // Повтор ищем в текущем месяце: окно повтора — минуты, а на границе
    // месяца потеря дедупликации безобиднее лишнего чтения двух файлов.
    const recent = await readMonth(key);
    const dupKey = duplicateKey(application);
    const twin = recent.find(
      (rec) =>
        duplicateKey(rec) === dupKey &&
        at - (Date.parse(rec.receivedAt) || 0) < DUPLICATE_WINDOW_MS,
    );
    if (twin) return { id: twin.id, duplicate: true };

    const record = { id: crypto.randomUUID(), ...application };
    await fsp.appendFile(file, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: FILE_MODE });
    await fsp.chmod(file, FILE_MODE).catch(() => {});
    return { id: record.id, duplicate: false };
  };

  writeQueue = writeQueue.then(run, run);
  return writeQueue;
}

async function listMonths() {
  try {
    const names = await fsp.readdir(DIR);
    return names
      .filter((n) => /^\d{4}-\d{2}\.jsonl$/.test(n))
      .map((n) => n.slice(0, 7))
      .sort()
      .reverse();
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function readStatuses() {
  try {
    const raw = await fsp.readFile(STATUS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Последние заявки, новые сверху. Статус подмешивается из отдельного файла:
 * журнал заявок остаётся дозаписываемым и никогда не переписывается.
 */
async function list({ limit = 100 } = {}) {
  const statuses = await readStatuses();
  const out = [];
  for (const key of await listMonths()) {
    const month = await readMonth(key);
    for (const rec of month.reverse()) {
      const st = statuses[rec.id] || {};
      out.push({ ...rec, status: st.status || 'new', mail: st.mail, mailError: st.mailError });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** Меняет статус заявки. Сама заявка при этом не трогается. */
async function setStatus(id, status) {
  if (!STATUSES.includes(status)) throw new Error(`неизвестный статус: ${status}`);
  await ensureDir();
  const statuses = await readStatuses();
  statuses[id] = { ...statuses[id], status, updatedAt: new Date().toISOString() };
  await writeStatuses(statuses);
  return statuses[id];
}

/**
 * Записывает исход письма менеджеру рядом со статусом заявки. Живёт в том же
 * status.json: журнал заявок дозаписываемый, а исход известен позже записи.
 */
async function setMail(id, { mail, error }) {
  await ensureDir();
  const statuses = await readStatuses();
  statuses[id] = { ...statuses[id], mail, mailError: error || undefined, mailAt: new Date().toISOString() };
  await writeStatuses(statuses);
  return statuses[id];
}

/** Атомарная запись файла статусов: временный файл рядом плюс rename. */
async function writeStatuses(statuses) {
  const tmp = `${STATUS_FILE}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    await fsp.writeFile(tmp, JSON.stringify(statuses, null, 2), { encoding: 'utf8', mode: FILE_MODE });
    await fsp.rename(tmp, STATUS_FILE);
  } catch (err) {
    await fsp.unlink(tmp).catch(() => {});
    throw err;
  }
}

/**
 * Удаляет файлы месяцев, целиком вышедших за срок хранения.
 * @returns {Promise<string[]>} удалённые месяцы
 */
async function purgeOld(retentionDays = RETENTION_DAYS, now = Date.now()) {
  const edge = new Date(now - retentionDays * 24 * 3600 * 1000);
  // Месяц удаляется, только когда истёк срок у САМОЙ ПОЗДНЕЙ заявки в нём,
  // то есть когда закончился следующий за ним месяц.
  const edgeKey = monthKey(edge.getTime());
  const removed = [];
  for (const key of await listMonths()) {
    if (key < edgeKey) {
      await fsp.unlink(path.join(DIR, `${key}.jsonl`));
      removed.push(key);
    }
  }
  // Вместе с заявкой уходит и её статус: иначе в status.json навсегда
  // остаётся след обращения, которое мы обязались уничтожить. Идентификатор
  // там случайный (UUID), но время последнего касания – уже сведения о
  // работе с конкретной заявкой.
  if (removed.length) await dropOrphanStatuses();
  return removed;
}

/** Убирает из status.json записи, у которых больше нет заявки. */
async function dropOrphanStatuses() {
  const statuses = await readStatuses();
  const ids = Object.keys(statuses);
  if (!ids.length) return 0;

  const live = new Set();
  for (const key of await listMonths()) {
    for (const rec of await readMonth(key)) live.add(rec.id);
  }
  const kept = {};
  for (const id of ids) if (live.has(id)) kept[id] = statuses[id];

  const dropped = ids.length - Object.keys(kept).length;
  if (dropped) await writeStatuses(kept);
  return dropped;
}

/** Сводка для админки: сколько всего и сколько новых. */
async function stats() {
  const items = await list({ limit: Number.MAX_SAFE_INTEGER });
  return {
    total: items.length,
    new: items.filter((i) => i.status === 'new').length,
    mailFailed: items.filter((i) => i.mail === 'failed').length,
    months: await listMonths(),
    retentionDays: RETENTION_DAYS,
  };
}

module.exports = {
  save,
  list,
  setStatus,
  setMail,
  purgeOld,
  stats,
  STATUSES,
  RETENTION_DAYS,
  // Для тестов: путь наружу, чтобы проверять права и содержимое файлов.
  _dir: DIR,
};
