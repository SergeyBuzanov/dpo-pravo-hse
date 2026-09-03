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
  upcomingStartLabel,
  isoDate,
  CATALOG_URL,
  MOSCOW_TZ,
  summarizeProgram,
} = require('./lib/hse-catalog');
const {
  loadStore,
  saveStore,
  mergeWithRemote,
  toSummaries,
  // Реэкспортируется ниже: на writeAtomic из этого модуля завязан
  // tests/unit/atomic-write.test.js.
  writeAtomic,
} = require('./lib/catalog-store');
const { programHref } = require('./lib/program-slug');
const { docBadge, shortFormat, formatTip } = require('./lib/program-labels');
const { SPHERES, sphereOf } = require('./lib/program-spheres');

const CATALOG_FILE = path.join(__dirname, 'Каталог программ.html');
/** Cross-process lock so CLI and admin-server cannot update concurrently. */
const LOCK_FILE = path.join(__dirname, '.catalog-update.lock');
const LOCK_STALE_MS = 10 * 60 * 1000;

const MARKERS = Object.freeze({
  meta: Object.freeze(['<!-- CATALOG:META -->', '<!-- /CATALOG:META -->']),
  filtersType: Object.freeze(['<!-- CATALOG:FILTERS_TYPE -->', '<!-- /CATALOG:FILTERS_TYPE -->']),
  filtersFormat: Object.freeze(['<!-- CATALOG:FILTERS_FORMAT -->', '<!-- /CATALOG:FILTERS_FORMAT -->']),
  filtersSphere: Object.freeze(['<!-- CATALOG:FILTERS_SPHERE -->', '<!-- /CATALOG:FILTERS_SPHERE -->']),
  filtersDuration: Object.freeze(['<!-- CATALOG:FILTERS_DURATION -->', '<!-- /CATALOG:FILTERS_DURATION -->']),
  list: Object.freeze(['<!-- CATALOG:LIST -->', '<!-- /CATALOG:LIST -->']),
  starts: Object.freeze(['<!-- CATALOG:STARTS -->', '<!-- /CATALOG:STARTS -->']),
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

// Em dash в видимых текстах сайта запрещён типографикой проекта, а данные
// с hse.ru его приносят. Правка при выводе, а не в хранилище: хранилище
// перезаписывается каждым обновлением каталога.
function enDash(str) {
  return String(str).replace(/\s—\s/g, ' – ').replace(/—/g, '–');
}

function escapeHtml(str) {
  return enDash(str).replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch]);
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

/**
 * Длительность в каталоге приходит свободной строкой («5 недель», «1,5 месяца»,
 * «8 месяцев») или отсутствует. Раскладываем в три корзины плюс «не указана»:
 * фильтровать по сырой строке нельзя, вариантов почти столько же, сколько
 * программ.
 */
function durationBucket(raw) {
  if (!raw) return { value: 'unknown', label: 'Не указана' };
  const s = String(raw).toLowerCase().replace(',', '.');
  const num = parseFloat(s.match(/[\d.]+/)?.[0] || '');
  if (!Number.isFinite(num)) return { value: 'unknown', label: 'Не указана' };
  const months = /недел/.test(s) ? num / 4.345 : /месяц/.test(s) ? num : /год|лет/.test(s) ? num * 12 : null;
  if (months === null) return { value: 'unknown', label: 'Не указана' };
  if (months < 1.5) return { value: 'short', label: 'До 1,5 месяца' };
  if (months <= 3) return { value: 'medium', label: '1,5–3 месяца' };
  return { value: 'long', label: 'Более 3 месяцев' };
}

/**
 * Миниатюра карточки: обложка программы, скачанная scripts/fetch-program-media.js.
 * Берётся thumb 640px, если он есть; иначе оригинал. Путь проверяется той же
 * строгой маской, что в lib/catalog-store.js, и файл обязан лежать на диске –
 * битая картинка в каталоге хуже, чем карточка без неё (без image карточка
 * рендерится как раньше, пустой дыры не остаётся).
 */
function cardImage(item) {
  const image = typeof item.image === 'string' ? item.image.trim() : '';
  if (!/^images\/programs\/[a-z0-9_.-]+$/i.test(image)) return null;
  if (!fssync.existsSync(path.join(__dirname, image))) return null;
  const thumb = `images/programs/thumbs/${String(item.id)}.jpg`;
  return fssync.existsSync(path.join(__dirname, thumb)) ? thumb : image;
}

function renderCard(item) {
  const typeShort = escapeHtml(item.type?.shortTitle || item.type?.title || '');
  const format = item.studyFormat?.title || '';
  const bucket = formatBucket(format);
  const sphere = sphereOf(item);
  const duration = durationBucket(item.duration);
  // «Старт: …» – единая подпись всех витрин (upcomingStartLabel): прошедшая
  // или отсутствующая дата не выводится вовсе, «уточняется» не подставляется.
  const date = upcomingStartLabel(item);
  // Формат и продолжительность ушли из строки меты в овалы .card-tags
  // (указание заказчика 02.09.2026); в data-search оба остаются – поиск
  // по «онлайн» должен находить карточки, как раньше.
  const metaBits = [date].filter(Boolean).map(escapeHtml).join(' · ');
  const search = escapeHtml(
    [item.title, typeShort, format, item.duration, date].filter(Boolean).join(' ').toLowerCase(),
  );

  // Карточка ведёт на страницу программы внутри сайта, а не сразу на hse.ru:
  // запись всё равно происходит там, но между каталогом и заявкой теперь
  // есть своя страница. Ссылка внутренняя, поэтому без target="_blank".
  const href = escapeHtml(programHref(item));

  // Метка сферы под шапкой карточки: без неё направление программы видно
  // только в чипах фильтра, а на самой карточке – нет.
  const sphereLine = sphere
    ? `\n      <div class="sphere">${escapeHtml(sphere.title)}</div>`
    : '';

  // Обёртка .card-media несёт затемняющий слой (::after) – единый приём с
  // тайлами «Топ-5» на главной; сам img на псевдоэлементы не способен.
  //
  // Про alt и aria-hidden – связка неочевидная, поэтому объясняем.
  //
  // Раньше стоял alt="" с обоснованием «миниатюра декоративна: суть карточки
  // продублирована текстом». Для скринридера это верно и остаётся верным.
  // Но пустой alt означал ещё и то, что 25 обложек не существовали для
  // Яндекс.Картинок и Google Images: поиск по картинкам читает атрибут alt,
  // и пустой атрибут – это отсутствие подписи, а не «пропусти».
  //
  // Поэтому alt теперь описательный, а aria-hidden на обёртке СОХРАНЯЕТСЯ.
  // Так закрываются обе стороны: скринридер по-прежнему пропускает картинку
  // и не читает название программы дважды (карточка – это <a>, её доступное
  // имя собирается из текста внутри, и незакрытый alt попал бы туда вторым
  // экземпляром заголовка), а поисковый робот получает подпись. Роботы
  // строят индекс по разметке, а не по дереву доступности, и aria-hidden
  // для них не помеха.
  //
  // Ключи в alt не пишем. Alt описывает изображение; набивка ключей здесь
  // даёт сигнал переспама на странице, где ключ и так стоит в h1, в title и
  // в заголовке карточки.
  const thumb = cardImage(item);
  const thumbLine = thumb
    ? `\n      <span class="card-media" aria-hidden="true"><img class="card-thumb" src="${escapeHtml(thumb)}" alt="${escapeHtml(`Обложка программы «${item.title}»`)}" loading="lazy"></span>`
    : '';

  // Овалы-пометки (указание заказчика 02.09.2026, вторая итерация): тип
  // документа пишется КАК ТИП (ПК, ПП, …), а не словом «Удостоверение»;
  // формат – без скобочного пояснения; продолжительность – как пришла с
  // hse.ru. Расшифровки типа и формата уходят в подсказку data-tip
  // (CSS-тултип при наведении, разметке помогает lib/program-labels.js).
  const doc = docBadge(item.type);
  const tag = (cls, text, tip) =>
    `<span class="tag${cls ? ` ${cls}` : ''}"${tip ? ` data-tip="${escapeHtml(tip)}"` : ''}>${escapeHtml(text)}</span>`;
  const tags = [
    format ? tag('', shortFormat(format), formatTip(format)) : '',
    doc ? tag('tag-doc', doc.label, doc.tip) : '',
    item.duration ? tag('tag-dur', item.duration, '') : '',
  ].filter(Boolean);
  const tagsLine = tags.length
    ? `\n      <span class="card-tags">${tags.join('')}</span>`
    : '';
  const metaLine = metaBits ? `\n      <div class="meta">${metaBits}</div>` : '';

  // Карточка – <div> с растянутой ссылкой внутри (01.09.2026): раньше вся
  // карточка была <a>, и кнопку «Заявка» внутрь положить было нельзя –
  // интерактивный элемент в интерактивном. Ссылка .card-link накрывает
  // карточку псевдоэлементом (клик в любом месте – переход на страницу
  // программы, как раньше), кнопка лежит выше по z-index. Решение
  // владельца 19.08 «Подать заявку везде» доехало и до каталога.
  return `    <div class="card" data-type="${typeShort}" data-format="${bucket.value}" data-sphere="${escapeHtml(sphere ? sphere.id : 'other')}" data-duration="${duration.value}" data-price="${Number(item.educationPricing) || 0}" data-start="${item.startDate || 0}" data-title="${escapeHtml(String(item.title || '').toLowerCase())}" data-search="${search}">
      <a href="${href}" class="card-link">${thumbLine}${sphereLine}
      <h3>${escapeHtml(item.title)}</h3>${tagsLine}${metaLine}
      </a>
      <div class="foot">
        <span class="price">${escapeHtml(formatPrice(item))}</span>
        <span class="foot-actions">
          <button type="button" class="card-apply" data-application
            data-program-id="${escapeHtml(String(item.id || ''))}"
            data-program-title="${escapeHtml(item.title)}"
            data-program-url="${href}"
            aria-label="Заявка: ${escapeHtml(item.title)}">Заявка</button>
          <span class="go" aria-hidden="true">Подробнее →</span>
        </span>
      </div>
    </div>`;
}

/**
 * Блок «Ближайшие старты» на странице каталога (просьба владельца
 * 18.08.2026) – по образцу страницы анонсов pravo.hse.ru/dpo/announcement:
 * месяц -> число -> название-ссылка, без цен и прочих метаданных.
 *
 * Будущность старта определяет upcomingStartLabel – та же логика, что у
 * подписи «Старт: …» на карточках, поэтому блок не протухает вместе с
 * ними. Месяц и число считаются по московскому календарю (Intl с
 * MOSCOW_TZ): локальные компоненты процесса сдвигали бы полуночный старт
 * на сутки. Дата с точностью до месяца (isStartDateWithoutDay) попадает
 * в свой месяц с подписью «в течение месяца» и стоит первой. Год у
 * месяца пишется только когда он не текущий: «Сентябрь», но «Январь
 * 2027». Если будущих стартов нет, секция не выводится вовсе – маркеры
 * обнимают её целиком.
 */
/** «10 стартов» / «2 старта» / «1 старт». */
function pluralStarts(n) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} старт`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} старта`;
  return `${n} стартов`;
}

/** «5 программ» / «2 программы» / «1 программа». */
function pluralPrograms(n) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} программа`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} программы`;
  return `${n} программ`;
}

/**
 * «Ближайшие старты» каталога – настоящая ось времени (владелец 03.09.2026,
 * вариант 3 после табло по месяцам). Горизонтальная шкала с сентября по
 * последний месяц стартов, DAY_PX на день: карточка каждого старта висит на
 * булавке ровно над своей датой, поэтому плотность сезона видна глазом.
 * Близкие даты разводятся по четырём дорожкам (две над осью, две под):
 * карточка идёт на первую дорожку, где предыдущая уже закончилась. Полосы
 * месяцев с подписями, риски дней (каждая седьмая длиннее), метка «сегодня».
 * Порядок в DOM хронологический – диктор читает по датам. Дорожка
 * прокручивается горизонтально (tabindex=0, role=region); чипы месяцев
 * (js/starts-board.js) прокручивают к началу месяца.
 */
const TL_DAY_PX = 28;
const TL_CARD_W = 190;
const TL_GAP_PX = 12;

function buildStartsBlock(items, now = new Date()) {
  const upcoming = items
    .filter((i) => upcomingStartLabel(i, now))
    .sort((a, b) => {
      const am = a.isStartDateWithoutDay ? 1 : 0;
      const bm = b.isStartDateWithoutDay ? 1 : 0;
      return new Date(a.startDate) - new Date(b.startDate) || bm - am;
    });
  if (!upcoming.length) return '';

  const fmt = (opts) => new Intl.DateTimeFormat('ru-RU', { timeZone: MOSCOW_TZ, ...opts });
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  // Календарный день по Москве как число дней от эпохи: разница двух таких
  // чисел – ровно число суток между датами, без сдвигов часовых поясов.
  const dayNum = (d) => {
    const p = fmt({ year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
    const get = (t) => Number(p.find((x) => x.type === t).value);
    return Math.round(Date.UTC(get('year'), get('month') - 1, get('day')) / 86400000);
  };
  const ymd = (d) => {
    const p = fmt({ year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
    const get = (t) => Number(p.find((x) => x.type === t).value);
    return { y: get('year'), m: get('month'), d: get('day') };
  };
  const first = ymd(new Date(upcoming[0].startDate));
  const last = ymd(new Date(upcoming[upcoming.length - 1].startDate));
  const axisStart = Math.round(Date.UTC(first.y, first.m - 1, 1) / 86400000);
  const axisEnd = Math.round(Date.UTC(last.y, last.m, 0) / 86400000); // последний день последнего месяца
  const totalDays = axisEnd - axisStart + 1;
  const xOf = (dn) => (dn - axisStart) * TL_DAY_PX + TL_DAY_PX / 2;
  const totalW = totalDays * TL_DAY_PX;

  // Полосы месяцев
  const months = [];
  for (let y = first.y, m = first.m; y < last.y || (y === last.y && m <= last.m); m === 12 ? (m = 1, y += 1) : (m += 1)) {
    const startDn = Math.round(Date.UTC(y, m - 1, 1) / 86400000);
    const days = Math.round(Date.UTC(y, m, 0) / 86400000) - startDn + 1;
    const label = cap(fmt({ month: 'long' }).format(new Date(Date.UTC(y, m - 1, 15))));
    months.push({ key: `${y}-${String(m).padStart(2, '0')}`, label, left: (startDn - axisStart) * TL_DAY_PX, width: days * TL_DAY_PX, count: 0 });
  }

  // Дорожки: карточка встаёт на первую, где предыдущая уже закончилась.
  const LANES = ['up1', 'down1', 'up2', 'down2'];
  const laneRight = [-Infinity, -Infinity, -Infinity, -Infinity];
  const cards = upcoming.map((item) => {
    const d = new Date(item.startDate);
    const dn = dayNum(d);
    const x = xOf(dn);
    const cardLeft = Math.max(0, Math.min(x - 28, totalW - TL_CARD_W));
    let lane = LANES.findIndex((_, i) => cardLeft >= laneRight[i] + TL_GAP_PX);
    if (lane === -1) lane = laneRight.indexOf(Math.min(...laneRight));
    laneRight[lane] = cardLeft + TL_CARD_W;
    const { y, m } = ymd(d);
    const month = months.find((mo) => mo.key === `${y}-${String(m).padStart(2, '0')}`);
    if (month) month.count += 1;

    const when = item.isStartDateWithoutDay
      ? cap(fmt({ month: 'long' }).format(d))
      : fmt({ day: 'numeric', month: 'long' }).format(d);
    const whenFull = item.isStartDateWithoutDay ? when : fmt({ day: 'numeric', month: 'long', year: 'numeric' }).format(d);
    const kind = (item.type && (item.type.shortTitle || item.type.title)) || '';
    const meta = [kind, shortFormat(item.studyFormat?.title), formatPrice(item)].filter(Boolean).join(' · ');
    const sphere = sphereOf(item);
    const dot = sphere ? `<i class="tl-dot" data-sphere="${escapeHtml(sphere.id)}" aria-hidden="true"></i>` : '';
    return `      <div class="tl-item tl-${LANES[lane]}" style="left:${cardLeft}px;--tl-pin:${x - cardLeft}px">
        <a class="tl-card" href="${escapeHtml(programHref(item))}" title="${escapeHtml(item.title)}" aria-label="${escapeHtml(item.title)} – старт: ${escapeHtml(whenFull)}">
          <span class="tl-when" aria-hidden="true">${escapeHtml(when)}</span>
          <span class="tl-name" aria-hidden="true">${escapeHtml(item.title)}</span>
          <span class="tl-meta" aria-hidden="true">${dot}${escapeHtml(meta)}</span>
        </a>
        <span class="tl-pin" aria-hidden="true"></span>
      </div>`;
  });

  const bands = months
    .map((mo) => `      <div class="tl-month" style="left:${mo.left}px;width:${mo.width}px" aria-hidden="true"><span class="tl-month-label">${escapeHtml(mo.label)} <b>${mo.count}</b></span></div>`)
    .join('\n');
  const ticks = [];
  for (let i = 0; i < totalDays; i += 1) {
    const dn = axisStart + i;
    const dom = new Date(dn * 86400000).getUTCDate();
    const cls = dom === 1 ? ' is-month' : dom % 7 === 0 ? ' is-week' : '';
    ticks.push(`<i class="tl-tick${cls}" style="left:${xOf(dn)}px"></i>`);
  }
  const todayDn = dayNum(now);
  const today = todayDn >= axisStart && todayDn <= axisEnd
    ? `      <div class="tl-today" style="left:${xOf(todayDn)}px" aria-hidden="true"><span>Сегодня</span></div>`
    : '';
  const chips = months
    .map((mo, i) => `    <button type="button" class="starts-chip" data-scroll="${Math.max(0, mo.left - 8)}" aria-pressed="${i === 0 ? 'true' : 'false'}">${escapeHtml(mo.label)} <b>${mo.count}</b></button>`)
    .join('\n');
  // Родительный падеж первого месяца («с сентября») берётся из формата «1 сентября».
  const genitive = (mo) => fmt({ day: 'numeric', month: 'long' }).format(new Date(Date.UTC(Number(mo.key.slice(0, 4)), Number(mo.key.slice(5)) - 1, 1, 12))).replace(/^\d+\s+/, '');
  const span = months.length > 1 ? `с ${genitive(months[0])} по ${months[months.length - 1].label.toLowerCase()}` : `в ${genitive(months[0]).replace(/я$/, 'е')}`;

  return `<section class="starts" aria-label="Ближайшие старты программ">
  <div class="starts-head">
    <h2>Ближайшие старты</h2>
    <p class="starts-sub">${escapeHtml(pluralStarts(upcoming.length))} ${escapeHtml(span)} – каждый на своей дате. Прокрутите ось или выберите месяц.</p>
  </div>
  <div class="starts-months" aria-label="Месяцы">
${chips}
  </div>
  <div class="tl-wrap" tabindex="0" role="region" aria-label="Ось времени ближайших стартов, прокручивается горизонтально">
    <div class="tl" style="width:${totalW}px">
${bands}
      <div class="tl-axis" aria-hidden="true">${ticks.join('')}</div>
${today}
${cards.join('\n')}
    </div>
  </div>
</section>`;
}

function renderChip(label, value, count, active) {
  return `  <button type="button" class="chip${active ? ' active' : ''}" data-value="${escapeHtml(value)}">${escapeHtml(label)} (${count})</button>`;
}

/**
 * Аббревиатура остаётся в чипе: она связывает чип с бейджем «ПК» на
 * карточках. Но одна она ничего не говорит человеку не из отрасли,
 * поэтому рядом расшифровка. data-value не трогаем: на «ПК»/«ПП»
 * завязаны ссылки с фильтром из блока форматов на лендинге
 * («Выберите свою траекторию развития»).
 */
const TYPE_CHIP_LABELS = Object.freeze({
  'ПК': 'ПК · Повышение квалификации',
  'ПП': 'ПП · Профессиональная переподготовка',
});

function buildTypeChips(items) {
  const counts = new Map();
  for (const item of items) {
    const key = item.type?.shortTitle || item.type?.title || 'Другое';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const chips = [renderChip('Все программы', 'all', items.length, true)];
  for (const [key, count] of counts) {
    chips.push(renderChip(TYPE_CHIP_LABELS[key] || key, key, count, false));
  }
  return chips.join('\n');
}

/** Чипы направлений в порядке SPHERES, а не в порядке появления в каталоге. */
function buildSphereChips(items) {
  const counts = new Map();
  for (const item of items) {
    const s = sphereOf(item);
    const key = s ? s.id : 'other';
    const label = s ? s.title : 'Прочее';
    const prev = counts.get(key);
    counts.set(key, { label, count: (prev?.count || 0) + 1 });
  }
  const chips = [renderChip('Все направления', 'all', items.length, true)];
  for (const s of SPHERES) {
    const hit = counts.get(s.id);
    if (hit) chips.push(renderChip(s.title, s.id, hit.count, false));
  }
  const other = counts.get('other');
  if (other) chips.push(renderChip(other.label, 'other', other.count, false));
  return chips.join('\n');
}

/** Чипы длительности в осмысленном порядке, а не по частоте. */
function buildDurationChips(items) {
  const ORDER = ['short', 'medium', 'long', 'unknown'];
  const counts = new Map();
  for (const item of items) {
    const b = durationBucket(item.duration);
    const prev = counts.get(b.value);
    counts.set(b.value, { label: b.label, count: (prev?.count || 0) + 1 });
  }
  const chips = [renderChip('Любая длительность', 'all', items.length, true)];
  for (const key of ORDER) {
    const hit = counts.get(key);
    if (hit) chips.push(renderChip(hit.label, key, hit.count, false));
  }
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

/**
 * Домен для микроразметки. Заглушка меняется на боевой адрес скриптом
 * scripts/set-domain.js – он же правит SITE в scripts/build-program-pages.js,
 * canonical на всех страницах, sitemap и robots. Держать здесь отдельную
 * константу нельзя иначе: адрес курса в разметке обязан совпадать с
 * canonical его страницы, иначе поисковик считает их разными адресами.
 */
const SITE = 'https://example.com';

/**
 * Описание курса для микроразметки: первое предложение того, что человек
 * видит на странице программы.
 *
 * Раньше здесь у всех 26 курсов стояла одна из двух строк – «ПК – факультет
 * права НИУ ВШЭ.» либо «ПП – …». Двадцать шесть объектов с двумя описаниями
 * на всех – это не описание, а заполнитель, и Google такой блок склонен
 * игнорировать целиком.
 *
 * Берём tagline (он же og:description на hse.ru), иначе первое предложение
 * about. Выдумывать нечего: если оба поля пусты, честно остаётся тип
 * программы – но уже с названием, а не одинаковый для всех.
 */
function courseDescription(item) {
  const source = String(item.tagline || item.about || '').trim();
  if (source) {
    const firstSentence = source.split(/(?<=[.!?])\s+/)[0].trim();
    const text = firstSentence.length >= 40 ? firstSentence : source;
    return enDash(text.length > 300 ? text.slice(0, 297).replace(/\s+\S*$/, '') + '…' : text);
  }
  const kind = item.type?.shortTitle === 'ПП' ? 'Профессиональная переподготовка' : 'Повышение квалификации';
  return enDash(`${kind}: ${item.title}. Факультет права НИУ ВШЭ.`);
}

function buildJsonLd(items) {
  const itemListElement = items.map((item, i) => {
    const price = item.discountPrice ?? item.educationPricing;
    const mode = COURSE_MODE[formatBucket(item.studyFormat?.title).value];
    const course = {
      '@type': 'Course',
      // enDash и здесь: JSON-LD собирается мимо escapeHtml, а название
      // программы приходит с hse.ru и может принести em dash.
      name: enDash(item.title),
      // En dash: em dash в текстах сайта запрещён, микроразметка – тоже текст.
      description: courseDescription(item),
      // url – СВОЙ адрес, а не hse.ru. Раньше здесь стоял item.url, то есть
      // сайт описывал курс и тут же сообщал поисковику, что настоящая
      // страница курса на чужом домене: право на расширенный сниппет уходило
      // маркетплейсу целиком. Ссылка на hse.ru не потеряна – она переехала в
      // sameAs, поле ровно для этого и предназначено.
      url: `${SITE}/${programHref(item)}`,
      inLanguage: 'ru',
      provider: {
        '@type': 'CollegeOrUniversity',
        name: 'НИУ ВШЭ, факультет права',
        sameAs: 'https://pravo.hse.ru/',
      },
    };
    if (item.url) course.sameAs = item.url;

    const instance = { '@type': 'CourseInstance' };
    if (mode) instance.courseMode = mode;
    if (item.startDate) {
      // Дата по московскому календарю (см. lib/moscow-time.js): и toISOString(),
      // и локальные компоненты сервера отдавали бы «20 июля 00:00 МСК» как
      // 19 июля, и в микроразметку уходила дата на сутки раньше.
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

// «Обновлено ...» на странице — по Москве. Контейнер живёт в UTC, и без явного
// пояса подпись врала на три часа: обновление в 06:00 по Москве подписывалось
// как «в 03:00». Посетитель читает московское время, а не время дата-центра.
function formatUpdatedLabel(date = new Date()) {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: MOSCOW_TZ,
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
  // Плашка «Обновлено: … · N актуальных программ» снята по решению
  // владельца 01.09.2026. Маркеры и метка времени остаются: дата попадает
  // в HTML-комментарий для отладки, наружу не показывается.
  html = replaceBetween(html, MARKERS.meta, `<!-- каталог обновлён: ${now}, программ: ${items.length} -->`);
  html = replaceBetween(html, MARKERS.filtersType, buildTypeChips(items));
  html = replaceBetween(html, MARKERS.filtersSphere, buildSphereChips(items));
  html = replaceBetween(html, MARKERS.filtersFormat, buildFormatChips(items));
  html = replaceBetween(html, MARKERS.filtersDuration, buildDurationChips(items));
  html = replaceBetween(html, MARKERS.list, items.map(renderCard).join('\n'));
  html = replaceBetween(html, MARKERS.starts, buildStartsBlock(items));
  html = replaceBetween(html, MARKERS.jsonld, buildJsonLd(items));
  await writeAtomic(CATALOG_FILE, html);

  // Страницы программ пересобираются здесь, а не в вызывающем коде: через
  // эту функцию проходят все пути обновления — CLI, кнопка «Актуализировать»
  // в админке, ручной редактор и ночное расписание. Иначе карточки каталога
  // ссылались бы на страницы снятых программ.
  try {
    require('./scripts/build-program-pages').build();
  } catch (err) {
    // Каталог уже записан и валиден; страницы — производный артефакт,
    // и их сбой не должен откатывать обновление витрины.
    console.error('Не удалось пересобрать страницы программ:', err.message);
  }

  // Участки лендинга, зависящие от каталога: панель «Направления» (счётчики
  // по сферам и названия программ) и блок форматов «Выберите свою траекторию
  // развития» (цены по типам). Написанные однажды, они разошлись бы с каталогом при
  // первом же снятии программы с hse.ru.
  try {
    require('./scripts/build-landing').build();
  } catch (err) {
    console.error('Не удалось пересобрать участки лендинга:', err.message);
  }

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
  buildStartsBlock,
  writeAtomic,
  applyPrograms,
  writeCatalogHtml,
  escapeHtml,
  formatBucket,
  summarizeProgram,
};
