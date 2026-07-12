// Fetches and parses the live HSE DPO program catalog (used by both the
// plain-HTML landing updater and the Design-bundle updater).

const CATALOG_URL = 'https://www.hse.ru/edu/dpo/?orgUnit=22753';

// The catalog page embeds its data as a non-JSON JS object literal:
//   window.__INITIAL_STATE__ = {items:[...new Date(169...), __proto__:null...]}
// This turns it into valid JSON without executing any of the fetched code.
function parseInitialState(html) {
  const m = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});\s*window\.__URQL_DATA__/);
  if (!m) throw new Error('window.__INITIAL_STATE__ not found in page — hse.ru markup may have changed');

  let s = m[1];
  s = s.replace(/new Date\((\d+)\)/g, '$1');
  s = s.replace(/,?\s*__proto__\s*:\s*null/g, '');
  s = s.replace(/([{,])\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g, '$1"$2":');

  return JSON.parse(s);
}

async function fetchProgramItems(url = CATALOG_URL) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    },
  });
  if (!res.ok) throw new Error(`hse.ru responded with HTTP ${res.status}`);
  const html = await res.text();
  const state = parseInitialState(html);
  const items = Array.isArray(state.items) ? state.items : [];
  if (items.length === 0) throw new Error('Parsed catalog but found 0 programs — refusing to overwrite existing list');
  // Program URLs go into hrefs and JSON-LD on our pages. Even though the data
  // comes from hse.ru, pin the scheme and host so a compromised or malformed
  // upstream can't inject javascript:/foreign links into our markup.
  for (const item of items) {
    item.url = safeHseUrl(item.url);
  }
  return items;
}

function safeHseUrl(raw) {
  try {
    const u = new URL(String(raw));
    if (u.protocol === 'https:' && (u.hostname === 'www.hse.ru' || u.hostname.endsWith('.hse.ru') || u.hostname === 'hse.ru')) {
      return u.href;
    }
  } catch {
    // fall through to the safe default below
  }
  return CATALOG_URL;
}

function formatPrice(item) {
  const price = item.discountPrice ?? item.educationPricing;
  if (!price) return 'Бесплатно';
  return `${new Intl.NumberFormat('ru-RU').format(price)} ₽`;
}

function formatDate(item) {
  if (!item.startDate) return null;
  const d = new Date(item.startDate);
  const opts = item.isStartDateWithoutDay
    ? { month: 'long', year: 'numeric' }
    : { day: 'numeric', month: 'long', year: 'numeric' };
  return new Intl.DateTimeFormat('ru-RU', opts).format(d);
}

module.exports = { CATALOG_URL, fetchProgramItems, formatPrice, formatDate };
