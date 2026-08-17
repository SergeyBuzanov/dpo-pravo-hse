/**
 * Live HSE DPO catalog client (faculty of law, orgUnit 22753).
 * Zero dependencies — native fetch (Node 18+).
 *
 * Loads only ACTUAL programs (default hse.ru filter, not onlyActual=0).
 * The catalog is paginated (pageSize≈20); all pages are fetched and
 * de-duplicated by program id.
 */

'use strict';

/** Actual programs only — omit onlyActual=0 so hse.ru returns current set. */
const CATALOG_URL = 'https://www.hse.ru/edu/dpo/?orgUnit=22753';
const ORG_UNIT = '22753';
const FETCH_TIMEOUT_MS = 20_000;
const MAX_PAGES = 20;

const DEFAULT_HEADERS = Object.freeze({
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
});

/**
 * hse.ru embeds catalog data as a non-JSON JS object literal:
 *   window.__INITIAL_STATE__ = { items: [... new Date(169...), __proto__: null ...] }
 * Convert it to valid JSON without evaluating any fetched code.
 */
function quoteKeysOutsideStrings(src) {
  // Копим вывод не в одну строку через `+=`, а кусками в массив: конкатенация
  // строк на каждой итерации сделала бы «убрать висячую запятую» операцией
  // над всем накопленным текстом (квадратичная сложность при частых
  // __proto__:null). Правка последнего куска массива — O(1) относительно уже
  // накопленного объёма, в конце — один join('').
  const parts = [];
  let inString = false;
  let escaped = false;

  // Аналог `out.replace(/,\s*$/, '')`, но без разворачивания всего
  // накопленного вывода: запятая и пробелы перед ней всегда лежат в
  // отдельных, ровно однасимвольных кусках (пунктуация и пробелы вне строк
  // всегда пушатся по одному символу — см. ветку по умолчанию ниже), так что
  // достаточно посмотреть на хвост массива.
  function trimTrailingComma() {
    let k = parts.length - 1;
    while (k >= 0 && parts[k].length === 1 && /\s/.test(parts[k])) k--;
    if (k >= 0 && parts[k] === ',') {
      parts.length = k; // отбрасываем запятую и пробелы после неё
      return true;
    }
    return false;
  }

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      parts.push(ch);
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; parts.push(ch); continue; }
    // Снаружи строк: идентификатор — это либо служебная конструкция
    // (new Date(...), __proto__: null), либо ключ объекта, либо литерал
    // (null/true/false), который ключом не является.
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_$]/.test(src[j])) j++;
      const word = src.slice(i, j);

      // new Date(<цифры>) → число. Проверяем только здесь, вне строк, так
      // что тот же текст внутри строкового значения останется дословным.
      if (word === 'new') {
        const dateMatch = /^\s*Date\s*\(\s*(\d+)\s*\)/.exec(src.slice(j));
        if (dateMatch) {
          parts.push(dateMatch[1]);
          i = j + dateMatch[0].length - 1;
          continue;
        }
      }

      // __proto__: null → вырезаем пару целиком вместе с одной соседней
      // запятой: если перед парой уже есть висячая запятая в выводе — убираем
      // её (пара была не первым ключом); иначе, если пара была первым ключом,
      // съедаем запятую после null (чтобы не осталось «{,title:…}» или
      // двойной запятой).
      if (word === '__proto__') {
        const protoMatch = /^\s*:\s*null\b/.exec(src.slice(j));
        if (protoMatch) {
          let end = j + protoMatch[0].length;
          if (!trimTrailingComma()) {
            const afterComma = /^\s*,/.exec(src.slice(end));
            if (afterComma) end += afterComma[0].length;
          }
          i = end - 1;
          continue;
        }
      }

      // Обычный ключ: идентификатор, за которым (через пробелы) следует ':'.
      let k = j;
      while (k < src.length && /\s/.test(src[k])) k++;
      if (src[k] === ':') {
        parts.push(`"${word}"`);
        i = j - 1;
        continue;
      }
      parts.push(word);
      i = j - 1;
      continue;
    }
    parts.push(ch);
  }
  return parts.join('');
}

function parseInitialState(html) {
  const m = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});\s*window\.__URQL_DATA__/);
  if (!m) {
    throw new Error('window.__INITIAL_STATE__ not found — hse.ru markup may have changed');
  }

  // Раньше три отдельные регулярки шли по сырому тексту и портили такой же
  // текст ВНУТРИ строковых значений: название вида «Комплаенс, compliance:
  // практика» разбиралось как объявление ключа и парсер падал. Теперь всё
  // делается одним посимвольным проходом, который не трогает содержимое строк.
  return JSON.parse(quoteKeysOutsideStrings(m[1]));
}

function pageUrl(baseUrl, page) {
  const u = new URL(baseUrl);
  if (page <= 1) u.searchParams.delete('page');
  else u.searchParams.set('page', String(page));
  // Force actual-only: strip onlyActual=0 if a caller passed it by mistake.
  if (u.searchParams.get('onlyActual') === '0') u.searchParams.delete('onlyActual');
  if (!u.searchParams.has('orgUnit')) u.searchParams.set('orgUnit', ORG_UNIT);
  return u.href;
}

function isHseHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === 'hse.ru' || host === 'www.hse.ru' || host.endsWith('.hse.ru');
}

/** Reject open-redirect / non-hse final URLs after fetch redirects. */
function assertHseHttpsUrl(finalUrl, context) {
  let u;
  try {
    u = new URL(finalUrl);
  } catch {
    throw new Error(`Invalid catalog URL after redirect (${context})`);
  }
  if (u.protocol !== 'https:' || !isHseHost(u.hostname)) {
    throw new Error(
      `Catalog fetch left https://*.hse.ru (got ${u.protocol}//${u.hostname}) — refusing to parse (${context})`,
    );
  }
  return u;
}

async function fetchCatalogPage(url) {
  const res = await fetch(url, {
    headers: DEFAULT_HEADERS,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: 'follow',
  });
  assertHseHttpsUrl(res.url || url, url);
  if (!res.ok) throw new Error(`hse.ru HTTP ${res.status} for ${url}`);
  const html = await res.text();
  return parseInitialState(html);
}

function collectItems(into, items) {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    if (item && item.id != null) into.set(item.id, item);
  }
}

/**
 * Load every page of the DPO catalog (actual programs only) and return a
 * de-duplicated list with URLs clamped to https://*.hse.ru.
 */
async function fetchProgramItems(url = CATALOG_URL) {
  const firstUrl = pageUrl(url, 1);
  console.log(`  page 1: ${firstUrl}`);
  const first = await fetchCatalogPage(firstUrl);

  const byId = new Map();
  collectItems(byId, first.items);

  const total = Number(first.total) || byId.size;
  const pageSize = Number(first.pageSize) || byId.size || 20;
  const totalPages = Math.min(MAX_PAGES, Math.max(1, Math.ceil(total / pageSize)));

  if (totalPages > 1) {
    const pageNums = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
    const results = await Promise.all(
      pageNums.map(async (page) => {
        const nextUrl = pageUrl(url, page);
        console.log(`  page ${page}/${totalPages}: ${nextUrl}`);
        return fetchCatalogPage(nextUrl);
      }),
    );
    for (const state of results) collectItems(byId, state.items);
  }

  // Программу с неразобранной ссылкой лучше не показывать вовсе, чем показать
  // с подменённым адресом: карточка выглядела бы обычной, а вела на общий
  // каталог — посетитель не понял бы, почему попал не туда.
  const items = [];
  for (const item of byId.values()) {
    const url = safeHseUrl(item.url);
    if (!url) {
      console.warn(`  пропущена программа с неразобранной ссылкой: ${item.title || '(без названия)'}`);
      continue;
    }
    items.push({ ...item, url });
  }

  if (items.length === 0) {
    throw new Error('Ни одной программы с корректной ссылкой — обновление отменено');
  }

  console.log(`  fetched ${items.length} actual programs (hse.ru total=${total}, pages=${totalPages})`);
  return items;
}

function safeHseUrl(raw) {
  try {
    const u = new URL(String(raw));
    if (u.protocol === 'https:' && isHseHost(u.hostname)) return u.href;
  } catch {
    // проваливаемся ниже: неразобранный адрес — это null, а не «какая-нибудь» ссылка
  }
  return null;
}

function formatPrice(item) {
  const price = item.discountPrice ?? item.educationPricing;
  // Отсутствующую цену нельзя выдавать за «Бесплатно» — это дезинформация:
  // «нет данных» и «ноль рублей» это разные вещи. Ноль указан явно — бесплатно.
  if (price == null) return 'Цена по запросу';
  if (price === 0) return 'Бесплатно';
  return `${new Intl.NumberFormat('ru-RU').format(price)} ₽`;
}

// Часовой пояс программ: hse.ru отдаёт старт меткой московской полуночи,
// поэтому формат прибит к Москве, а не к зоне процесса. Подробности — в
// lib/moscow-time.js.
const { MOSCOW_TZ, moscowParts } = require('./moscow-time');

/**
 * Дата для микроразметки Schema.org — YYYY-MM-DD по московскому календарю.
 * Собирается из частей, а не toISOString() и не из локальных компонентов:
 * оба варианта дают дату на сутки раньше, если процесс запущен не в Москве.
 */
function isoDate(value) {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MOSCOW_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  const [y, m, day] = [get('year'), get('month'), get('day')];
  if (!y || !m || !day) return null;
  return `${y}-${m}-${day}`;
}

function formatDate(item) {
  if (!item.startDate) return null;
  const d = new Date(item.startDate);
  if (Number.isNaN(d.getTime())) return null;
  const opts = item.isStartDateWithoutDay
    ? { timeZone: MOSCOW_TZ, month: 'long', year: 'numeric' }
    : { timeZone: MOSCOW_TZ, day: 'numeric', month: 'long', year: 'numeric' };
  return new Intl.DateTimeFormat('ru-RU', opts).format(d);
}

/**
 * Подпись «Старт: …» для карточек программ — единая для всех витрин
 * (блок «по сферам», «Топ-5», каталог).
 *
 * Правила заказчика (август 2026):
 *  - даты нет или набор не объявлен — строки нет вовсе, «уточняется» не
 *    подставляется;
 *  - дата уже прошла — строки тоже нет: каталог обновляется не каждый день,
 *    и просроченный старт в карточке выглядит как заброшенный сайт.
 *
 * Сравнение — по московскому календарю (moscowParts), а не по локальным
 * компонентам процесса: метка полуночи МСК в другом поясе съезжает на сутки.
 * Для дат с точностью до месяца (isStartDateWithoutDay) «прошла» означает
 * «месяц кончился»: программа с сентябрьским стартом в середине сентября
 * ещё актуальна.
 */
function upcomingStartLabel(item, now = new Date()) {
  if (!item || !item.startDate) return null;
  const d = new Date(item.startDate);
  if (Number.isNaN(d.getTime())) return null;
  const start = moscowParts(d);
  const today = moscowParts(now);
  if (!start || !today) return null;
  const cmp = item.isStartDateWithoutDay
    ? start.year - today.year || start.month - today.month
    : start.year - today.year || start.month - today.month || start.day - today.day;
  if (cmp < 0) return null;
  const label = formatDate(item);
  return label ? `Старт: ${label}` : null;
}

function summarizeProgram(item) {
  return {
    id: item.id,
    title: item.title || '',
    url: item.url || CATALOG_URL,
    type: item.type?.shortTitle || item.type?.title || '',
    format: item.studyFormat?.title || '',
    price: item.discountPrice ?? item.educationPricing ?? null,
    startDate: item.startDate || null,
  };
}

module.exports = {
  CATALOG_URL,
  MOSCOW_TZ,
  fetchProgramItems,
  fetchCatalogPage,
  parseInitialState,
  formatPrice,
  formatDate,
  upcomingStartLabel,
  isoDate,
  safeHseUrl,
  isHseHost,
  summarizeProgram,
};
