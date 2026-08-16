#!/usr/bin/env node
/**
 * Собирает страницу под каждую программу из .catalog-data.json.
 *
 *   node scripts/build-program-pages.js
 *
 * Страницы пересобираются вместе с каталогом: данные берутся из того же
 * хранилища, поэтому цена, формат и дата старта не могут разойтись с
 * витриной. Файлы программ, которых больше нет в каталоге, удаляются –
 * иначе на сайте оставались бы страницы снятых программ.
 *
 * ВАЖНО про содержание. Описания программ (tagline и about) подтягиваются
 * со страниц hse.ru скриптом scripts/fetch-program-descriptions.js и лежат
 * в том же хранилище. Учебного плана и преподавателей там по-прежнему нет,
 * поэтому эти два блока выводятся явными слотами, а не выдумываются:
 * заполнять их нужно полями modules / teachers у программы.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { groupBySphere, pluralPrograms } = require('../lib/program-spheres');
const { programHref } = require('../lib/program-slug');
const { formatPrice, formatDate } = require('../lib/hse-catalog');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'programs');
const STORE = path.join(ROOT, '.catalog-data.json');
const SITEMAP = path.join(ROOT, 'sitemap.xml');

/**
 * Заглушка домена – та же, что во всех остальных страницах, чтобы
 * scripts/check-deploy.js продолжал ловить её перед публикацией.
 */
const SITE = 'https://example.com';
const SITEMAP_MARKERS = ['<!-- PROGRAMS:BEGIN -->', '<!-- PROGRAMS:END -->'];

/** Дописывает адреса страниц программ в карту сайта между маркерами. */
function writeSitemap(programs) {
  if (!fs.existsSync(SITEMAP)) return false;
  const xml = fs.readFileSync(SITEMAP, 'utf8');
  const [begin, end] = SITEMAP_MARKERS;
  const from = xml.indexOf(begin);
  const to = xml.indexOf(end);
  if (from === -1 || to === -1 || to < from) return false;

  const entries = programs
    .map(
      (p) => `  <url>
    <loc>${esc(SITE)}/${esc(programHref(p))}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`,
    )
    .join('\n');

  fs.writeFileSync(
    SITEMAP,
    xml.slice(0, from + begin.length) + '\n' + entries + '\n' + xml.slice(to),
    'utf8',
  );
  return true;
}

const ESCAPE_MAP = Object.freeze({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
});
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch]);

/** Наружу пускаем только hse.ru – тот же контракт, что у каталога. */
function safeUrl(url) {
  try {
    const u = new URL(String(url));
    if (u.protocol !== 'https:') return null;
    if (u.hostname !== 'hse.ru' && !u.hostname.endsWith('.hse.ru')) return null;
    return u.toString();
  } catch {
    return null;
  }
}

const DOC_BY_TYPE = {
  ПК: {
    name: 'Удостоверение о повышении квалификации',
    note: 'Подтверждает новые компетенции в рамках текущей профессии.',
  },
  ПП: {
    name: 'Диплом о профессиональной переподготовке',
    note: 'Даёт право вести профессиональную деятельность в новой области.',
  },
};

function typeLabel(p) {
  const s = p.type?.shortTitle || p.type?.title || '';
  if (s === 'ПК') return 'Повышение квалификации';
  if (s === 'ПП') return 'Профессиональная переподготовка';
  return s || 'Программа ДПО';
}

function renderFacts(p) {
  const rows = [
    ['Тип программы', typeLabel(p)],
    ['Формат', p.studyFormat?.title || 'уточняется'],
    ['Длительность', p.duration || 'уточняется'],
    ['Старт', formatDate(p) || 'уточняется'],
  ];
  return rows
    .map(
      ([k, v]) =>
        `        <div class="fact"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`,
    )
    .join('\n');
}

/** Блок-слот: честно показывает, что содержимое ещё не заполнено. */
function slot(title, hint) {
  return `      <section class="block">
        <h2>${esc(title)}</h2>
        <p class="slot">${esc(hint)}</p>
      </section>`;
}

/**
 * Блок «О программе». Описания подтягиваются с hse.ru скриптом
 * scripts/fetch-program-descriptions.js: tagline из og:description,
 * about из микроразметки Course. Если у программы нет ни того, ни другого,
 * остаётся честный слот, а не выдуманный текст.
 */
function renderAbout(p) {
  if (!p.about && !p.tagline) {
    return slot(
      'О программе',
      'Описание пока не заполнено. Запустите node scripts/fetch-program-descriptions.js, ' +
        'чтобы подтянуть его со страницы программы на hse.ru.',
    );
  }
  const lead = p.tagline ? `        <p class="about-lead">${esc(p.tagline)}</p>\n` : '';
  const body = p.about ? `        <p class="about-body">${esc(p.about)}</p>\n` : '';
  return `      <section class="block">
        <h2>О программе</h2>
${lead}${body}        <p class="about-source">Описание с официальной страницы программы на hse.ru.</p>
      </section>`;
}

/** «Для кого»: подводка и список аудиторий со страницы программы. */
function renderAudience(p) {
  const a = p.audience;
  if (!a || !a.items || !a.items.length) return '';
  const intro = a.intro ? `        <p class="block-sub">${esc(a.intro)}</p>\n` : '';
  const items = a.items.map((x) => `          <li>${esc(x)}</li>`).join('\n');
  return `      <section class="block">
        <h2>Для кого</h2>
${intro}        <ul class="pills">
${items}
        </ul>
      </section>`;
}

/** «Результаты»: чему научится выпускник. */
/**
 * Учебный план. Нумерованный список: порядок модулей содержателен, это
 * последовательность обучения, а не набор. Часы стоят рядом с названием
 * строкой, как пришли с hse.ru – форма записи там разная, приводить её к
 * числу значило бы додумывать за источник.
 */
function renderModules(p) {
  if (!p.modules || !p.modules.length) {
    return slot('Программа обучения', 'Модули и объём часов пока не заполнены. Заполняются полем modules у программы – его подтягивает scripts/fetch-program-descriptions.js.');
  }
  const items = p.modules
    .map(
      (m) =>
        `          <li><span class="module-title">${esc(m.title)}</span>` +
        (m.hours ? `<span class="module-hours">${esc(m.hours)}</span>` : '') +
        '</li>',
    )
    .join('\n');
  const total = p.modules.length;
  return `      <section class="block">
        <h2>Программа обучения</h2>
        <p class="block-note">${esc(pluralModules(total))}</p>
        <ol class="modules">
${items}
        </ol>
      </section>`;
}

/** «9 модулей» / «4 модуля» / «1 модуль». */
function pluralModules(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} модуль`;
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return `${n} модуля`;
  return `${n} модулей`;
}

/**
 * Преподаватели: имя и краткая справка. Фотографий нет намеренно – снимки
 * лежат на hse.ru, а CSP страницы запрещает внешние картинки. Тянуть их к
 * себе это отдельное решение, а не побочный эффект обновления каталога.
 */
function renderTeachers(p) {
  if (!p.teachers || !p.teachers.length) {
    return slot('Преподаватели', 'Состав преподавателей пока не заполнен. Заполняется полем teachers у программы – его подтягивает scripts/fetch-program-descriptions.js.');
  }
  const items = p.teachers
    .map(
      (t) =>
        `          <li>\n            <p class="teacher-name">${esc(t.name)}</p>` +
        (t.about ? `\n            <p class="teacher-about">${esc(t.about)}</p>` : '') +
        '\n          </li>',
    )
    .join('\n');
  return `      <section class="block">
        <h2>${p.teachers.length === 1 ? 'Преподаватель' : 'Преподаватели'}</h2>
        <ul class="teachers">
${items}
        </ul>
      </section>`;
}

function renderResults(p) {
  if (!p.results || !p.results.length) return '';
  const items = p.results.map((x) => `          <li>${esc(x)}</li>`).join('\n');
  return `      <section class="block">
        <h2>Результаты обучения</h2>
        <ul class="results">
${items}
        </ul>
      </section>`;
}

function renderSiblings(sphere, current) {
  const others = sphere.items.filter((x) => x.id !== current.id);
  if (!others.length) return '';
  const links = others
    .map(
      (o) =>
        `          <li><a href="${esc(path.basename(programHref(o)))}">${esc(o.title)}</a></li>`,
    )
    .join('\n');
  return `      <section class="block">
        <h2>Другие программы сферы</h2>
        <p class="block-sub">${esc(sphere.title)} · ${esc(pluralPrograms(sphere.items.length))}</p>
        <ul class="siblings">
${links}
        </ul>
      </section>`;
}

function renderPage(p, sphere) {
  const official = safeUrl(p.url);
  const short = p.type?.shortTitle || '';
  const doc = DOC_BY_TYPE[short];
  const metaBits = [typeLabel(p), p.studyFormat?.title, p.duration]
    .filter(Boolean)
    .map((s) => `<span>${esc(s)}</span>`)
    .join('');

  const cta = official
    ? `        <a class="cta" href="${esc(official)}" target="_blank" rel="noopener noreferrer">Перейти к записи на hse.ru</a>
        <p class="cta-note">Заявку принимает учебный офис на официальной странице программы.</p>`
    : `        <p class="cta-note">Ссылка на официальную страницу программы не подтверждена.</p>`;

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.title)} · Центр ДПО факультета права НИУ ВШЭ</title>
<meta name="description" content="${esc(
    `${p.title} – ${typeLabel(p)} в Центре ДПО факультета права НИУ ВШЭ.`,
  )}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="${esc(SITE)}/${esc(programHref(p))}">
<meta property="og:type" content="website">
<meta property="og:locale" content="ru_RU">
<meta property="og:site_name" content="Центр ДПО · Факультет права НИУ ВШЭ">
<meta property="og:title" content="${esc(p.title)}">
<meta property="og:url" content="${esc(SITE)}/${esc(programHref(p))}">
<link rel="icon" type="image/svg+xml" href="../favicon.svg">
<meta name="theme-color" content="#1658DA">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'unsafe-inline' https://mc.yandex.ru; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: https://mc.yandex.ru; connect-src 'self' https://mc.yandex.ru; base-uri 'self'; form-action 'none'">
<meta name="referrer" content="strict-origin-when-cross-origin">
<link rel="stylesheet" href="../fonts/fonts-hse.css">
<link rel="stylesheet" href="../fonts/fonts-main.css">
<link rel="stylesheet" href="program.css">
</head>
<body>
<a href="#main" class="skip-link">Перейти к содержанию</a>

<header>
  <a class="logo" href="../index.html">
    <span class="name">Право</span>
    <span class="sub">Центр ДПО · НИУ ВШЭ</span>
  </a>
  <span class="header-side">
    <button id="viToggle" class="vi-btn" type="button" aria-pressed="false" title="Версия для слабовидящих">Версия для слабовидящих</button>
    <a class="back" href="../Каталог программ.html">← В каталог</a>
  </span>
</header>

<section class="hero">
  <nav class="crumbs" aria-label="Навигационная цепочка">
    <a href="../Каталог программ.html">Каталог программ</a>
    <span aria-hidden="true">/</span>
    <span>${esc(sphere ? sphere.title : 'Программа')}</span>
  </nav>
  <h1>${esc(p.title)}</h1>
  <div class="chips">${metaBits}</div>
</section>

<main id="main" class="layout">
  <div class="content">
${renderAbout(p)}
${renderAudience(p)}
${renderResults(p)}
${renderModules(p)}
${renderTeachers(p)}
${renderSiblings(sphere || { title: '', items: [] }, p)}
  </div>

  <aside class="side">
    <div class="card">
      <div class="price">${esc(formatPrice(p))}</div>
      <dl class="facts">
${renderFacts(p)}
      </dl>
${cta}
    </div>
    ${
      doc
        ? `<div class="card doc">
      <span class="doc-tag">${esc(short)}</span>
      <h2>${esc(doc.name)}</h2>
      <p>${esc(doc.note)}</p>
      <p class="doc-note">Документ выдаёт НИУ ВШЭ.</p>
    </div>`
        : ''
    }
  </aside>
</main>

<footer>
  <span>Центр дополнительного профессионального образования · Факультет права НИУ ВШЭ</span>
  <span class="footer-links">
    <a href="../privacy.html">Политика обработки персональных данных</a>
    <a href="https://www.hse.ru/sveden/" rel="noopener">Сведения об образовательной организации</a>
  </span>
</footer>

<script src="../js/site-analytics.js" defer></script>
<script src="../js/cookie-consent.js" defer></script>
<script>
(function () {
  var btn = document.getElementById('viToggle');
  function setVi(on) {
    document.documentElement.classList.toggle('vi-mode', on);
    btn.setAttribute('aria-pressed', String(on));
    try { localStorage.setItem('vi-mode', on ? '1' : '0'); } catch (e) {}
  }
  btn.addEventListener('click', function () {
    setVi(!document.documentElement.classList.contains('vi-mode'));
  });
  try { if (localStorage.getItem('vi-mode') === '1') setVi(true); } catch (e) {}
})();
</script>
</body>
</html>
`;
}

function build() {
  if (!fs.existsSync(STORE)) {
    console.error('Нет .catalog-data.json – сначала запустите node update-catalog.js');
    process.exitCode = 1;
    return null;
  }
  const store = JSON.parse(fs.readFileSync(STORE, 'utf8'));
  const programs = store.programs || [];
  const { spheres, unassigned } = groupBySphere(programs);
  const byId = new Map();
  for (const s of spheres) for (const p of s.items) byId.set(p.id, s);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'program.css'), CSS, 'utf8');

  const written = new Set(['program.css']);
  for (const p of programs) {
    const file = path.basename(programHref(p));
    fs.writeFileSync(path.join(OUT_DIR, file), renderPage(p, byId.get(p.id) || null), 'utf8');
    written.add(file);
  }

  // Снятые программы не должны оставлять за собой живые страницы.
  let removed = 0;
  for (const existing of fs.readdirSync(OUT_DIR)) {
    if (!written.has(existing)) {
      fs.unlinkSync(path.join(OUT_DIR, existing));
      removed++;
    }
  }

  const mapped = writeSitemap(programs);

  console.log(
    `Страниц программ: ${programs.length}, удалено устаревших: ${removed}, ` +
      `карта сайта: ${mapped ? 'обновлена' : 'маркеры не найдены'}`,
  );
  if (unassigned.length) {
    console.warn(
      `ВНИМАНИЕ: без сферы осталось ${unassigned.length}:\n` +
        unassigned.map((p) => '  - ' + p.title).join('\n'),
    );
  }
  return { count: programs.length, removed, unassigned: unassigned.length };
}

const CSS = `/* Страницы программ. Тёплая ось из DESIGN.md; файл собирается
   генератором scripts/build-program-pages.js – правки вносите там. */
:root{
  --accent:#1658DA; --accent-dark:#1145AA; --gold-light:#FFD982;
  --ink:#211E1B; --ink-soft:#48423A; --ink-mute:#6B6459;
  --bg:#FBF9F5; --bg-tint:#F2ECE1; --card:#FFFFFF;
  --line:rgba(33,30,27,0.1);
  --gutter:clamp(20px,5vw,56px);
  --ease:cubic-bezier(.22,1,.36,1);
}
*{box-sizing:border-box}
@media (prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}}
body{margin:0;background:var(--bg);color:var(--ink);
  font-family:'HSE Sans','IBM Plex Sans',-apple-system,sans-serif}
a{color:inherit;text-decoration:none}
h1,h2{font-family:'HSE Slab','Source Serif 4',Georgia,serif;margin:0}

a:focus-visible,button:focus-visible{outline:3px solid var(--accent);outline-offset:3px}

.skip-link{position:absolute;left:-9999px;top:0;z-index:10001;background:#fff;color:var(--accent);
  font:600 15px/1.4 'HSE Sans','IBM Plex Sans',sans-serif;padding:12px 20px;border-radius:0 0 10px 0;
  box-shadow:0 4px 18px rgba(0,0,0,.22);text-decoration:underline}
.skip-link:focus{left:0}

header{position:sticky;top:0;z-index:20;display:flex;align-items:center;justify-content:space-between;
  gap:16px;padding:16px var(--gutter);background:rgba(251,249,245,0.9);backdrop-filter:blur(10px);
  border-bottom:1px solid var(--line)}
.logo{display:flex;flex-direction:column;gap:1px}
.logo .name{font-weight:700;font-size:15px;color:var(--accent)}
.logo .sub{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-mute)}
.header-side{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.back{font-size:14px;font-weight:600;color:var(--accent)}
.back:hover{text-decoration:underline}
.vi-btn{font:inherit;font-size:13px;font-weight:600;cursor:pointer;color:var(--ink-soft);
  background:transparent;border:1px solid rgba(33,30,27,.25);border-radius:999px;padding:8px 14px;
  white-space:nowrap;transition:color .28s var(--ease),border-color .28s var(--ease)}
.vi-btn:hover{border-color:var(--accent);color:var(--accent)}

.hero{background:linear-gradient(160deg,var(--accent) 0%,var(--accent-dark) 100%);color:#fff;
  padding:clamp(32px,5vw,56px) var(--gutter) clamp(36px,6vw,64px)}
.crumbs{font-size:13px;color:rgba(255,255,255,.88);display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px}
.crumbs a{text-decoration:underline}
.hero h1{font-weight:600;font-size:clamp(28px,3.2vw,42px);line-height:1.15;max-width:20ch;
  max-width:900px;text-wrap:balance}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:20px}
.chips span{font-size:13px;background:rgba(255,255,255,.14);border-radius:999px;padding:8px 16px}

.layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,340px);
  gap:clamp(28px,4vw,56px);padding:clamp(32px,5vw,64px) var(--gutter) clamp(56px,8vw,96px);
  align-items:start}
@media (max-width:900px){.layout{grid-template-columns:minmax(0,1fr)}}

.block{margin-bottom:clamp(28px,4vw,48px)}
.block h2{font-size:clamp(21px,2.2vw,28px);font-weight:600;margin-bottom:12px}
.block-sub{font-size:13.5px;color:var(--ink-mute);margin:0 0 16px}
.about-lead{font-size:17px;line-height:1.6;font-weight:600;color:var(--ink);margin:0 0 14px}
.about-body{font-size:15.5px;line-height:1.7;color:var(--ink-soft);margin:0 0 14px;max-width:68ch}
.about-source{font-size:13px;color:var(--ink-mute);margin:0}
.slot{font-size:15.5px;line-height:1.6;color:var(--ink-mute);background:var(--bg-tint);
  border:1px dashed rgba(33,30,27,.25);border-radius:16px;padding:20px;margin:0}
.pills{list-style:none;display:flex;flex-wrap:wrap;gap:10px;margin:0;padding:0}
.pills li{font-size:14.5px;line-height:1.4;color:var(--ink-soft);background:var(--bg-tint);
  border-radius:999px;padding:10px 18px}
.results{list-style:none;margin:0;padding:0;display:grid;gap:2px}
.results li{position:relative;font-size:15.5px;line-height:1.6;color:var(--ink-soft);
  padding:14px 0 14px 34px;border-top:1px solid var(--line)}
/* Галочка нарисована фоном, а не символом: в режиме для слабовидящих
   svg скрывается, а псевдоэлемент с текстом остаётся читаемым. */
.results li::before{content:"";position:absolute;left:8px;top:19px;width:7px;height:12px;
  border-right:2px solid var(--accent);border-bottom:2px solid var(--accent);
  transform:rotate(45deg)}
.block-note{font-size:13.5px;color:var(--ink-mute);margin:0 0 14px}

/* Учебный план. Номер рисуется счётчиком, а не маркером списка: нужен
   моноширинный столбец, иначе двузначные номера сдвигают все названия. */
.modules{list-style:none;margin:0;padding:0;counter-reset:module}
.modules li{counter-increment:module;display:grid;
  grid-template-columns:28px minmax(0,1fr) auto;gap:4px 12px;align-items:baseline;
  padding:13px 0;border-top:1px solid var(--line)}
.modules li::before{content:counter(module);font-size:13px;color:var(--ink-mute);
  font-variant-numeric:tabular-nums}
.module-title{font-size:15.5px;line-height:1.5;color:var(--ink-soft)}
.module-hours{font-size:13px;color:var(--ink-mute);white-space:nowrap;
  font-variant-numeric:tabular-nums}

/* Преподаватели. Фотографий нет: снимки лежат на hse.ru, а CSP страницы
   запрещает внешние картинки. Поэтому вес несёт имя, а не портрет. */
.teachers{list-style:none;margin:0;padding:0}
.teachers li{padding:16px 0;border-top:1px solid var(--line)}
.teacher-name{font-size:16px;font-weight:600;margin:0 0 4px;color:var(--ink)}
.teacher-about{font-size:14.5px;line-height:1.55;color:var(--ink-soft);margin:0}

@media (max-width:520px){
  .modules li{grid-template-columns:22px minmax(0,1fr);gap:2px 10px}
  .module-hours{grid-column:2}
}

.siblings{list-style:none;margin:0;padding:0}
.siblings li{border-top:1px solid var(--line)}
.siblings a{display:block;padding:14px 0;font-size:14.5px;line-height:1.5;color:var(--ink-soft);
  transition:color .28s var(--ease)}
.siblings a:hover{color:var(--accent)}

.side{position:sticky;top:96px;display:flex;flex-direction:column;gap:16px}
@media (max-width:900px){.side{position:static}}
.card{background:var(--card);border:1px solid var(--line);border-radius:24px;padding:26px}
.price{font-size:clamp(22px,2vw,30px);font-weight:700;font-family:'HSE Slab','Source Serif 4',serif;
  margin-bottom:18px}
.facts{margin:0 0 20px}
.fact{display:flex;justify-content:space-between;gap:12px;padding:10px 0;
  border-top:1px solid var(--line)}
.fact dt{font-size:13px;color:var(--ink-mute);margin:0}
.fact dd{font-size:14.5px;font-weight:600;margin:0;text-align:right}
.cta{display:block;text-align:center;font-size:15px;font-weight:600;color:#fff;
  background:var(--accent);border-radius:999px;padding:15px 24px;
  transition:background .28s var(--ease),transform 140ms ease}
.cta:hover{background:var(--accent-dark)}
.cta:active{transform:scale(.97)}
.cta-note{font-size:13px;line-height:1.5;color:var(--ink-mute);margin:12px 0 0;text-align:center}
.doc{background:var(--bg-tint)}
.doc-tag{display:inline-block;font-size:12.5px;font-weight:700;color:#fff;background:var(--accent);
  border-radius:999px;padding:4px 11px;margin-bottom:12px}
.doc h2{font-size:19px;font-weight:600;margin-bottom:8px}
.doc p{font-size:14.5px;line-height:1.55;color:var(--ink-soft);margin:0}
.doc-note{font-size:13px;color:var(--ink-mute);margin-top:10px}

footer{padding:28px var(--gutter);border-top:1px solid var(--line);display:flex;flex-wrap:wrap;
  align-items:center;justify-content:space-between;gap:12px;font-size:13px;color:var(--ink-mute)}
.footer-links{display:flex;gap:18px;flex-wrap:wrap}
.footer-links a{color:var(--accent)}

/* Версия для слабовидящих (ГОСТ Р 52872-2019) */
html.vi-mode body{zoom:1.25;background:#fff !important}
html.vi-mode *{background:transparent !important;background-image:none !important;color:#000 !important;
  box-shadow:none !important;text-shadow:none !important;animation:none !important;transition:none !important}
html.vi-mode a{text-decoration:underline !important}
html.vi-mode .card,html.vi-mode .slot,html.vi-mode .cta,html.vi-mode .vi-btn{border:2px solid #000 !important}
`;

if (require.main === module) build();

module.exports = { build, renderPage, safeUrl, slugifyHref: programHref };
