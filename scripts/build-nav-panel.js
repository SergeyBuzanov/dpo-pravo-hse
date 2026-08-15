#!/usr/bin/env node
/**
 * Собирает панель «Направления» в шапке лендинга из данных каталога.
 *
 *   node scripts/build-nav-panel.js
 *
 * Зачем генератор, а не разметка руками
 * -------------------------------------
 * В панели стоят счётчики («6 программ») и названия курсов. Написанные
 * руками, они расходятся с каталогом при первом же обновлении с hse.ru:
 * программа снимается, а панель продолжает обещать шесть. Поэтому панель
 * строится из `.catalog-data.json` тем же разбором по сферам, что и блок
 * «Программы по сферам» и страницы программ – источник истины один
 * (`lib/program-spheres.js`).
 *
 * Как попадает в лендинг
 * ----------------------
 * У лендинга нет исходника: разметка лежит JSON-строкой внутри index.html.
 * Скрипт достаёт её через scripts/landing-template.js, заменяет содержимое
 * между маркерами и упаковывает обратно.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { extract, inject } = require('./landing-template');
const { groupBySphere, pluralPrograms } = require('../lib/program-spheres');
const { programHref } = require('../lib/program-slug');

const ROOT = path.resolve(__dirname, '..');
const STORE = path.join(ROOT, '.catalog-data.json');
const WORK = path.join(ROOT, '.landing-template.html');

const START = '<!-- dpo:nav-panel:start -->';
const END = '<!-- dpo:nav-panel:end -->';

/** Сколько названий показываем в сфере, прежде чем свернуть в «ещё N». */
const PREVIEW = 3;

const escapeHtml = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** «ещё 3 программы» – та же грамматика, что и у счётчика сферы. */
function moreLabel(n) {
  return 'ещё ' + pluralPrograms(n);
}

function renderSphere(sphere) {
  const total = sphere.items.length;
  if (!total) return '';

  const shown = sphere.items.slice(0, PREVIEW);
  const rest = total - shown.length;
  const catalogHref = 'Каталог программ.html?sphere=' + encodeURIComponent(sphere.id);

  const programs = shown
    .map(
      (p) =>
        `            <li><a class="dpo-menu-program" href="${escapeHtml(programHref(p))}">` +
        `${escapeHtml(p.title)}</a></li>`,
    )
    .join('\n');

  // «ещё N» ведёт в каталог с уже применённым фильтром по сфере: это
  // единственное место, где видны все программы направления сразу.
  const more = rest
    ? `\n          <a class="dpo-menu-more" href="${escapeHtml(catalogHref)}">${escapeHtml(
        moreLabel(rest),
      )}</a>`
    : '';

  return `        <div class="dpo-menu-sphere">
          <a class="dpo-menu-sphere-head" href="${escapeHtml(catalogHref)}">
            <span class="dpo-menu-sphere-title">${escapeHtml(sphere.title)}</span>
            <span class="dpo-menu-sphere-count">${escapeHtml(pluralPrograms(total))}</span>
          </a>
          <ul class="dpo-menu-programs">
${programs}
          </ul>${more}
        </div>`;
}

function buildPanel(programs) {
  const { spheres, unassigned } = groupBySphere(programs);
  const filled = spheres.filter((s) => s.items.length);

  // Нераспределённые не теряем молча: иначе панель обещает меньше, чем есть.
  if (unassigned.length) {
    console.warn(
      `  ВНИМАНИЕ: ${unassigned.length} программ не попали ни в одну сферу и в панели не видны:`,
    );
    for (const p of unassigned) console.warn('   - ' + p.title);
  }

  // Подвал генерируется вместе с сеткой: в нём стоит общее число программ,
  // и написанное руками оно разошлось бы с каталогом ровно так же.
  const html = `      <div class="dpo-menu-grid">
${filled.map(renderSphere).join('\n')}
      </div>
      <div class="dpo-menu-foot">
        <a class="dpo-menu-all" href="Каталог программ.html">Все ${programs.length} программ с фильтрами</a>
        <a class="dpo-menu-side" href="#top5">Топ-5 программ</a>
        <a class="dpo-menu-side" href="#spheres">Обзор по сферам</a>
      </div>`;

  return { html, spheres: filled.length, unassigned: unassigned.length };
}

function build() {
  if (!fs.existsSync(STORE)) {
    throw new Error('нет .catalog-data.json – сначала запустите node update-catalog.js');
  }
  const store = JSON.parse(fs.readFileSync(STORE, 'utf8'));
  const programs = store.programs || [];
  if (!programs.length) throw new Error('в каталоге нет программ, панель не собирается');

  const template = extract(WORK);
  const from = template.indexOf(START);
  const to = template.indexOf(END);
  if (from < 0 || to < 0) {
    throw new Error(`в шаблоне лендинга не найдены маркеры ${START} / ${END}`);
  }
  if (to < from) throw new Error('маркеры панели идут в обратном порядке');

  const { html, spheres, unassigned } = buildPanel(programs);
  const next =
    template.slice(0, from + START.length) + '\n' + html + '\n        ' + template.slice(to);

  fs.writeFileSync(WORK, next, 'utf8');
  inject(WORK);

  // Ссылку «Все N программ» держим в согласии с каталогом отдельно: она
  // живёт в подвале панели, вне маркеров, потому что это не список сфер.
  console.log(
    `Панель «Направления»: сфер ${spheres}, программ ${programs.length}` +
      (unassigned ? `, вне сфер ${unassigned}` : ''),
  );
  return { spheres, total: programs.length, unassigned };
}

if (require.main === module) {
  try {
    build();
  } catch (err) {
    console.error('Ошибка: ' + err.message);
    process.exitCode = 1;
  }
}

module.exports = { build, buildPanel };
