#!/usr/bin/env node
/**
 * Refreshes «Каталог программ.html» from the live hse.ru DPO catalog
 * (Law faculty, orgUnit 22753). Marker-based replace — no templates engine.
 *
 * Usage:  node update-catalog.js
 */

'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {
  fetchProgramItems,
  formatPrice,
  formatDate,
  CATALOG_URL,
  summarizeProgram,
} = require('./lib/hse-catalog');

const CATALOG_FILE = path.join(__dirname, 'Каталог программ.html');
const LANDING_FILE = path.join(__dirname, 'ДПО Лендинг (standalone).html');

const MARKERS = Object.freeze({
  meta: Object.freeze(['<!-- CATALOG:META -->', '<!-- /CATALOG:META -->']),
  filtersType: Object.freeze(['<!-- CATALOG:FILTERS_TYPE -->', '<!-- /CATALOG:FILTERS_TYPE -->']),
  filtersFormat: Object.freeze(['<!-- CATALOG:FILTERS_FORMAT -->', '<!-- /CATALOG:FILTERS_FORMAT -->']),
  list: Object.freeze(['<!-- CATALOG:LIST -->', '<!-- /CATALOG:LIST -->']),
  jsonld: Object.freeze(['<!-- CATALOG:JSONLD -->', '<!-- /CATALOG:JSONLD -->']),
});

const UPCOMING_MARKERS = Object.freeze([
  '<!-- UPCOMING:STARTS -->',
  '<!-- /UPCOMING:STARTS -->',
]);
const UPCOMING_LIMIT = 6;

/** Schema.org courseMode values Google recognizes, keyed by our format bucket. */
const COURSE_MODE = Object.freeze({
  online: 'online',
  offline: 'onsite',
  mixed: 'blended',
  hybrid: 'blended',
});

const ESCAPE_MAP = Object.freeze({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
});

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch]);
}

/**
 * Order matters: compound formats often contain the word «онлайн»,
 * so match hybrid/mixed before the generic online check.
 */
function formatBucket(title = '') {
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
  const search = escapeHtml(
    [item.title, typeShort, format, item.duration, date].filter(Boolean).join(' ').toLowerCase(),
  );

  return `    <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" class="card" data-type="${typeShort}" data-format="${bucket.value}" data-search="${search}">
      <span class="badge">${typeShort}</span>
      <h3>${escapeHtml(item.title)}</h3>
      <div class="meta">${metaBits}</div>
      <div class="foot">
        <span class="price">${formatPrice(item)}</span>
        <span class="go">Подробнее →</span>
      </div>
    </a>`;
}

/** Nearest upcoming programs (with startDate), for landing teaser. */
function pickUpcoming(items, limit = UPCOMING_LIMIT) {
  const now = Date.now();
  return items
    .filter((it) => it.startDate && Number(it.startDate) >= now - 24 * 3600 * 1000)
    .sort((a, b) => Number(a.startDate) - Number(b.startDate))
    .slice(0, limit);
}

function renderUpcomingCard(item) {
  const typeShort = escapeHtml(item.type?.shortTitle || item.type?.title || '');
  const format = item.studyFormat?.title || '';
  const date = formatDate(item) || 'Дата уточняется';
  const metaBits = [typeShort, format, item.duration].filter(Boolean).map(escapeHtml).join(' · ');

  return `    <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" class="upcoming-card">
      <span class="when">${escapeHtml(date)}</span>
      <h3>${escapeHtml(item.title)}</h3>
      <div class="meta">${metaBits}</div>
      <div class="foot">
        <span class="price">${formatPrice(item)}</span>
        <span class="go">Подробнее →</span>
      </div>
    </a>`;
}

function buildUpcomingHtml(items) {
  const upcoming = pickUpcoming(items);
  if (!upcoming.length) {
    return `    <a href="Каталог программ.html" class="upcoming-card">
      <span class="when">Каталог</span>
      <h3>Актуальные программы факультета права</h3>
      <div class="meta">Откройте полный каталог — фильтры по типу, формату и поиск</div>
      <div class="foot">
        <span class="price">${items.length} программ</span>
        <span class="go">Каталог →</span>
      </div>
    </a>`;
  }
  return upcoming.map(renderUpcomingCard).join('\n');
}

function renderChip(label, value, count, active) {
  return `  <button type="button" class="chip${active ? ' active' : ''}" data-value="${escapeHtml(value)}">${escapeHtml(label)} (${count})</button>`;
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
  const counts = new Map();
  for (const item of items) {
    const bucket = formatBucket(item.studyFormat?.title);
    const existing = counts.get(bucket.value);
    counts.set(bucket.value, { label: bucket.label, count: (existing?.count || 0) + 1 });
  }
  const chips = [renderChip('Любой формат', 'all', items.length, true)];
  for (const [value, { label, count }] of counts) chips.push(renderChip(label, value, count, false));
  return chips.join('\n');
}

function buildJsonLd(items) {
  const itemListElement = items.map((item, i) => {
    const price = item.discountPrice ?? item.educationPricing;
    const mode = COURSE_MODE[formatBucket(item.studyFormat?.title).value];
    const course = {
      '@type': 'Course',
      name: item.title,
      description: `${item.type?.title || 'Программа ДПО'} — факультет права НИУ ВШЭ.`,
      url: item.url,
      provider: {
        '@type': 'Organization',
        name: 'НИУ ВШЭ, факультет права',
        sameAs: 'https://pravo.hse.ru/',
      },
    };

    const instance = { '@type': 'CourseInstance' };
    if (mode) instance.courseMode = mode;
    if (item.startDate) {
      const d = new Date(item.startDate);
      if (!Number.isNaN(d.getTime())) instance.startDate = d.toISOString().slice(0, 10);
    }
    if (instance.courseMode || instance.startDate) {
      course.hasCourseInstance = instance;
    }
    if (price) {
      course.offers = {
        '@type': 'Offer',
        price: String(price),
        priceCurrency: 'RUB',
        category: 'Paid',
      };
    }
    return { '@type': 'ListItem', position: i + 1, item: course };
  });

  const data = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Программы ДПО факультета права НИУ ВШЭ',
    itemListElement,
  };

  // Escape "</" so a hostile title can't break out of the script tag.
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<script type="application/ld+json">${json}</script>`;
}

function replaceBetween(html, [startMarker, endMarker], replacement) {
  const startIdx = html.indexOf(startMarker);
  const endIdx = html.indexOf(endMarker);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(`Markers ${startMarker} / ${endMarker} not found in catalog file`);
  }
  return (
    html.slice(0, startIdx + startMarker.length) +
    '\n' +
    replacement +
    '\n  ' +
    html.slice(endIdx)
  );
}

/** Atomic write: temp file in same dir + rename (survives crash mid-write). */
async function writeAtomic(filePath, content) {
  const dir = path.dirname(filePath);
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.tmp`);
  try {
    await fs.writeFile(tmp, content, 'utf8');
    await fs.rename(tmp, filePath);
  } catch (err) {
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
}

async function main() {
  const t0 = Date.now();
  console.log(`Актуализация: только актуальные программы с ${CATALOG_URL} …`);
  const items = await fetchProgramItems();

  const now = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date());

  let html = await fs.readFile(CATALOG_FILE, 'utf8');
  html = replaceBetween(html, MARKERS.meta, `<span class="meta">Обновлено: <b>${now}</b> · ${items.length} актуальных программ</span>`);
  html = replaceBetween(html, MARKERS.filtersType, buildTypeChips(items));
  html = replaceBetween(html, MARKERS.filtersFormat, buildFormatChips(items));
  html = replaceBetween(html, MARKERS.list, items.map(renderCard).join('\n'));
  html = replaceBetween(html, MARKERS.jsonld, buildJsonLd(items));
  await writeAtomic(CATALOG_FILE, html);

  // Landing: «Ближайшие старты»
  let upcomingCount = 0;
  try {
    let landing = await fs.readFile(LANDING_FILE, 'utf8');
    const upcomingHtml = buildUpcomingHtml(items);
    upcomingCount = pickUpcoming(items).length;
    landing = replaceBetween(landing, UPCOMING_MARKERS, upcomingHtml);
    await writeAtomic(LANDING_FILE, landing);
    console.log(`Лендинг: ${upcomingCount} ближайших стартов в «${path.basename(LANDING_FILE)}».`);
  } catch (err) {
    console.warn(`Лендинг не обновлён (ближайшие старты): ${err.message}`);
  }

  const durationMs = Date.now() - t0;
  const programs = items.map(summarizeProgram);

  console.log(`Готово: записано ${items.length} актуальных программ в «${path.basename(CATALOG_FILE)}» (${now}, ${durationMs} мс).`);
  return {
    count: items.length,
    updated: now,
    source: CATALOG_URL,
    onlyActual: true,
    durationMs,
    programs,
    upcomingCount,
  };
}

if (require.main === module) {
  main().catch((err) => {
    console.error('update-catalog.js failed:', err.message);
    process.exitCode = 1;
  });
}

module.exports = { main, escapeHtml, formatBucket };
