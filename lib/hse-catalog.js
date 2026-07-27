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
function parseInitialState(html) {
  const m = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});\s*window\.__URQL_DATA__/);
  if (!m) {
    throw new Error('window.__INITIAL_STATE__ not found — hse.ru markup may have changed');
  }

  let s = m[1]
    .replace(/new Date\((\d+)\)/g, '$1')
    .replace(/,?\s*__proto__\s*:\s*null/g, '')
    .replace(/([{,])\s*([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":');

  return JSON.parse(s);
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

async function fetchCatalogPage(url) {
  const res = await fetch(url, {
    headers: DEFAULT_HEADERS,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: 'follow',
  });
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

  const items = [...byId.values()].map((item) => ({
    ...item,
    url: safeHseUrl(item.url),
  }));

  if (items.length === 0) {
    throw new Error('Parsed catalog but found 0 programs — refusing to overwrite existing list');
  }

  console.log(`  fetched ${items.length} actual programs (hse.ru total=${total}, pages=${totalPages})`);
  return items;
}

function safeHseUrl(raw) {
  try {
    const u = new URL(String(raw));
    const host = u.hostname.toLowerCase();
    const okHost = host === 'hse.ru' || host === 'www.hse.ru' || host.endsWith('.hse.ru');
    if (u.protocol === 'https:' && okHost) return u.href;
  } catch {
    // fall through
  }
  return CATALOG_URL;
}

function formatPrice(item) {
  const price = item.discountPrice ?? item.educationPricing;
  if (price == null || price === 0) return 'Бесплатно';
  return `${new Intl.NumberFormat('ru-RU').format(price)} ₽`;
}

function formatDate(item) {
  if (!item.startDate) return null;
  const d = new Date(item.startDate);
  if (Number.isNaN(d.getTime())) return null;
  const opts = item.isStartDateWithoutDay
    ? { month: 'long', year: 'numeric' }
    : { day: 'numeric', month: 'long', year: 'numeric' };
  return new Intl.DateTimeFormat('ru-RU', opts).format(d);
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
  fetchProgramItems,
  fetchCatalogPage,
  parseInitialState,
  formatPrice,
  formatDate,
  safeHseUrl,
  summarizeProgram,
};
