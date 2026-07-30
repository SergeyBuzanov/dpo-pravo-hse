#!/usr/bin/env node
/**
 * Refreshes «Каталог программ.html» from hse.ru and/or the local editable store.
 *
 * Usage:
 *   node update-catalog.js              # fetch hse.ru → store → HTML
 *   node update-catalog.js --from-store # rewrite HTML from .catalog-data.json only
 */

'use strict';

const fs = require('node:fs/promises');
const fssync = require('node:fs');
const path = require('node:path');
const {
  fetchProgramItems,
  formatPrice,
  formatDate,
  isoDate,
  CATALOG_URL,
  summarizeProgram,
} = require('./lib/hse-catalog');
const {
  loadStore,
  saveStore,
  mergeWithRemote,
  toSummaries,
} = require('./lib/catalog-store');

const CATALOG_FILE = path.join(__dirname, 'Каталог программ.html');
/** Cross-process lock so CLI and admin-server cannot update concurrently. */
const LOCK_FILE = path.join(__dirname, '.catalog-update.lock');
const LOCK_STALE_MS = 10 * 60 * 1000;

const MARKERS = Object.freeze({
  meta: Object.freeze(['<!-- CATALOG:META -->', '<!-- /CATALOG:META -->']),
  filtersType: Object.freeze(['<!-- CATALOG:FILTERS_TYPE -->', '<!-- /CATALOG:FILTERS_TYPE -->']),
  filtersFormat: Object.freeze(['<!-- CATALOG:FILTERS_FORMAT -->', '<!-- /CATALOG:FILTERS_FORMAT -->']),
  list: Object.freeze(['<!-- CATALOG:LIST -->', '<!-- /CATALOG:LIST -->']),
  jsonld: Object.freeze(['<!-- CATALOG:JSONLD -->', '<!-- /CATALOG:JSONLD -->']),
});

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
        <span class="price">${escapeHtml(formatPrice(item))}</span>
        <span class="go">Подробнее →</span>
      </div>
    </a>`;
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
      // По локальным компонентам: toISOString() сдвигал бы «20 июля 00:00 МСК»
      // на 19 июля, и в микроразметку уходила дата на сутки раньше.
      const iso = isoDate(item.startDate);
      if (iso) instance.startDate = iso;
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

async function acquireUpdateLock() {
  const payload = JSON.stringify({ pid: process.pid, at: Date.now() });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fssync.openSync(LOCK_FILE, 'wx');
      try {
        fssync.writeFileSync(fd, payload, 'utf8');
      } finally {
        fssync.closeSync(fd);
      }
      return;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let stale = false;
      try {
        const st = fssync.statSync(LOCK_FILE);
        stale = Date.now() - st.mtimeMs > LOCK_STALE_MS;
        if (!stale) {
          const raw = JSON.parse(fssync.readFileSync(LOCK_FILE, 'utf8'));
          stale = !raw?.at || Date.now() - Number(raw.at) > LOCK_STALE_MS;
        }
      } catch {
        stale = true;
      }
      if (stale && attempt === 0) {
        console.warn('Снимаю устаревший .catalog-update.lock');
        await fs.unlink(LOCK_FILE).catch(() => {});
        continue;
      }
      throw new Error(
        'Обновление каталога уже выполняется (есть .catalog-update.lock). Дождитесь завершения или удалите lock-файл, если процесс упал.',
      );
    }
  }
}

async function releaseUpdateLock() {
  await fs.unlink(LOCK_FILE).catch(() => {});
}

function formatUpdatedLabel(date = new Date()) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/**
 * Write catalog HTML from an array of program items (renderer shape).
 */
async function writeCatalogHtml(items, { updatedLabel } = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Отказ: пустой список программ — HTML не перезаписываем');
  }
  const now = updatedLabel || formatUpdatedLabel();
  let html = await fs.readFile(CATALOG_FILE, 'utf8');
  html = replaceBetween(
    html,
    MARKERS.meta,
    `<span class="meta">Обновлено: <b>${now}</b> · ${items.length} актуальных программ</span>`,
  );
  html = replaceBetween(html, MARKERS.filtersType, buildTypeChips(items));
  html = replaceBetween(html, MARKERS.filtersFormat, buildFormatChips(items));
  html = replaceBetween(html, MARKERS.list, items.map(renderCard).join('\n'));
  html = replaceBetween(html, MARKERS.jsonld, buildJsonLd(items));
  await writeAtomic(CATALOG_FILE, html);
  return now;
}

/**
 * Persist programs to store and rewrite public HTML.
 * Used by manual admin edits.
 */
async function applyPrograms(programs, { source = 'manual' } = {}) {
  await acquireUpdateLock();
  try {
    const t0 = Date.now();
    const nowLabel = formatUpdatedLabel();
    const store = await saveStore({
      programs,
      source,
      updated: new Date().toISOString(),
    });
    await writeCatalogHtml(store.programs, { updatedLabel: nowLabel });
    const durationMs = Date.now() - t0;
    console.log(
      `Сохранено ${store.programs.length} программ (source=${source}) → HTML (${durationMs} мс).`,
    );
    return {
      count: store.programs.length,
      updated: nowLabel,
      source,
      onlyActual: true,
      durationMs,
      programs: toSummaries(store.programs),
      items: store.programs,
    };
  } finally {
    await releaseUpdateLock();
  }
}

/**
 * Fetch hse.ru, merge with locked/manual local items, save store, rewrite HTML.
 */
async function main({ fromStore = false } = {}) {
  await acquireUpdateLock();
  try {
    return await runUpdate({ fromStore });
  } finally {
    await releaseUpdateLock();
  }
}

async function runUpdate({ fromStore = false } = {}) {
  const t0 = Date.now();
  let items;
  let source;

  if (fromStore) {
    console.log('Пересборка HTML из локального хранилища (.catalog-data.json)…');
    const store = await loadStore();
    if (!store.programs.length) {
      throw new Error('Локальное хранилище пусто — сначала актуализируйте с hse.ru');
    }
    items = store.programs;
    source = store.source || 'store';
  } else {
    console.log(`Актуализация: актуальные программы с ${CATALOG_URL} …`);
    const remote = await fetchProgramItems();
    const local = await loadStore();
    items = mergeWithRemote(local.programs, remote);
    source = CATALOG_URL;
    console.log(
      `  merge: remote=${remote.length}, local=${local.programs.length}, result=${items.length}` +
        ` (locked/manual preserved)`,
    );
  }

  const nowLabel = formatUpdatedLabel();
  await saveStore({
    programs: items,
    source,
    updated: new Date().toISOString(),
  });
  await writeCatalogHtml(items, { updatedLabel: nowLabel });

  const durationMs = Date.now() - t0;
  console.log(
    `Готово: ${items.length} программ в «${path.basename(CATALOG_FILE)}» (${nowLabel}, ${durationMs} мс).`,
  );
  return {
    count: items.length,
    updated: nowLabel,
    source,
    onlyActual: true,
    durationMs,
    programs: toSummaries(items),
    items,
  };
}

if (require.main === module) {
  const fromStore = process.argv.includes('--from-store');
  main({ fromStore }).catch((err) => {
    console.error('update-catalog.js failed:', err.message);
    process.exitCode = 1;
  });
}

module.exports = {
  main,
  writeAtomic,
  applyPrograms,
  writeCatalogHtml,
  escapeHtml,
  formatBucket,
  summarizeProgram,
};
