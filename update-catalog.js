#!/usr/bin/env node
// Refreshes "Каталог программ.html" — the standalone programs showcase — from the
// live hse.ru catalog (Law faculty, orgUnit 22753) via plain marker-based replace.
// No accounts, no order/application forms: every card just links out to the
// program's real page on hse.ru.
//
// Usage:  node update-catalog.js

const fs = require('fs');
const path = require('path');
const { fetchProgramItems, formatPrice, formatDate, CATALOG_URL } = require('./lib/hse-catalog');

const CATALOG_FILE = path.join(__dirname, 'Каталог программ.html');

const MARKERS = {
  meta: ['<!-- CATALOG:META -->', '<!-- /CATALOG:META -->'],
  filtersType: ['<!-- CATALOG:FILTERS_TYPE -->', '<!-- /CATALOG:FILTERS_TYPE -->'],
  filtersFormat: ['<!-- CATALOG:FILTERS_FORMAT -->', '<!-- /CATALOG:FILTERS_FORMAT -->'],
  list: ['<!-- CATALOG:LIST -->', '<!-- /CATALOG:LIST -->'],
  jsonld: ['<!-- CATALOG:JSONLD -->', '<!-- /CATALOG:JSONLD -->'],
};

// Schema.org courseMode values Google recognizes, keyed by our format bucket.
const COURSE_MODE = { online: 'online', offline: 'onsite', mixed: 'blended', hybrid: 'blended' };

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatBucket(title = '') {
  // Order matters: "Гибридный"/"Смешанный" descriptions often contain the word
  // "онлайн" (e.g. "...очно и параллельно в онлайн"), so match those compound
  // formats BEFORE the generic "онлайн" check, or they'd be misfiled as Онлайн.
  if (/гибрид/i.test(title)) return { value: 'hybrid', label: 'Гибридный' };
  if (/смешан/i.test(title)) return { value: 'mixed', label: 'Смешанный' };
  if (/онлайн/i.test(title)) return { value: 'online', label: 'Онлайн' };
  if (/очн/i.test(title)) return { value: 'offline', label: 'Очно' };
  return { value: 'other', label: title || 'Другое' };
}

function renderCard(item) {
  const typeShort = escapeHtml(item.type?.shortTitle || item.type?.title || '');
  const format = item.studyFormat?.title || '';
  const bucket = formatBucket(format);
  const date = formatDate(item);
  const metaBits = [format, item.duration, date].filter(Boolean).map(escapeHtml).join(' · ');

  return `    <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener" class="card" data-type="${typeShort}" data-format="${bucket.value}">
      <span class="badge">${typeShort}</span>
      <h3>${escapeHtml(item.title)}</h3>
      <div class="meta">${metaBits}</div>
      <div class="foot">
        <span class="price">${formatPrice(item)}</span>
        <span class="go">Подробнее →</span>
      </div>
    </a>`;
}

function renderChip(label, value, count, active) {
  return `  <button class="chip${active ? ' active' : ''}" data-value="${escapeHtml(value)}">${escapeHtml(label)} (${count})</button>`;
}

function buildTypeChips(items) {
  const counts = new Map();
  for (const item of items) {
    const key = item.type?.shortTitle || item.type?.title || 'Другое';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const chips = [renderChip('Все программы', 'all', items.length, true)];
  for (const [key, count] of counts) chips.push(renderChip(key, key, count, false));
  return chips.join('\n');
}

function buildFormatChips(items) {
  const counts = new Map(); // value -> { label, count }
  for (const item of items) {
    const bucket = formatBucket(item.studyFormat?.title);
    const existing = counts.get(bucket.value);
    counts.set(bucket.value, { label: bucket.label, count: (existing?.count || 0) + 1 });
  }
  const chips = [renderChip('Любой формат', 'all', items.length, true)];
  for (const [value, { label, count }] of counts) chips.push(renderChip(label, value, count, false));
  return chips.join('\n');
}

// Builds Schema.org structured data (ItemList of Course) so search engines can
// show the programs as course rich-results. Injected as a <script type=ld+json>.
function buildJsonLd(items) {
  const itemListElement = items.map((item, i) => {
    const price = item.discountPrice ?? item.educationPricing;
    const mode = COURSE_MODE[formatBucket(item.studyFormat?.title).value];
    const course = {
      '@type': 'Course',
      name: item.title,
      description: `${item.type?.title || 'Программа ДПО'} — факультет права НИУ ВШЭ.`,
      url: item.url,
      provider: { '@type': 'Organization', name: 'НИУ ВШЭ, факультет права', sameAs: 'https://pravo.hse.ru/' },
    };
    const instance = {};
    if (mode) instance.courseMode = mode;
    if (item.startDate) instance.startDate = new Date(item.startDate).toISOString().slice(0, 10);
    if (Object.keys(instance).length) {
      course.hasCourseInstance = { '@type': 'CourseInstance', ...instance };
    }
    if (price) {
      course.offers = { '@type': 'Offer', price: String(price), priceCurrency: 'RUB', category: 'Paid' };
    }
    return { '@type': 'ListItem', position: i + 1, item: course };
  });

  const data = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Программы ДПО факультета права НИУ ВШЭ',
    itemListElement,
  };

  // Minified (one line) to keep the HTML tidy; "<" is escaped so a program title
  // containing "</script>" can't break out of the tag.
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<script type="application/ld+json">${json}</script>`;
}

function replaceBetween(html, [startMarker, endMarker], replacement) {
  const startIdx = html.indexOf(startMarker);
  const endIdx = html.indexOf(endMarker);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(`Markers ${startMarker} / ${endMarker} not found in ${CATALOG_FILE}`);
  }
  const before = html.slice(0, startIdx + startMarker.length);
  const after = html.slice(endIdx);
  return `${before}\n${replacement}\n  ${after}`;
}

async function main() {
  console.log(`Fetching ${CATALOG_URL} ...`);
  const items = await fetchProgramItems();

  const now = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date());

  const metaHtml = `<span class="meta">Обновлено: <b>${now}</b> · ${items.length} программ</span>`;
  const listHtml = items.map(renderCard).join('\n');
  const typeChipsHtml = buildTypeChips(items);
  const formatChipsHtml = buildFormatChips(items);

  let html = fs.readFileSync(CATALOG_FILE, 'utf8');
  html = replaceBetween(html, MARKERS.meta, metaHtml);
  html = replaceBetween(html, MARKERS.filtersType, typeChipsHtml);
  html = replaceBetween(html, MARKERS.filtersFormat, formatChipsHtml);
  html = replaceBetween(html, MARKERS.list, listHtml);
  html = replaceBetween(html, MARKERS.jsonld, buildJsonLd(items));
  fs.writeFileSync(CATALOG_FILE, html, 'utf8');

  console.log(`Done: wrote ${items.length} programs into "${path.basename(CATALOG_FILE)}" (${now}).`);
  return { count: items.length, updated: now };
}

if (require.main === module) {
  main().catch((err) => {
    console.error('update-catalog.js failed:', err.message);
    process.exitCode = 1;
  });
}

module.exports = { main };
