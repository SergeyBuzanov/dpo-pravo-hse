#!/usr/bin/env node
/**
 * Собирает участки лендинга, которые зависят от данных каталога.
 *
 *   node scripts/build-landing.js
 *
 * Сейчас таких участков три:
 *   - панель «Направления» в шапке (сферы и по три программы в каждой);
 *   - блок «Наши форматы» (число программ и цены по типам ПК и ПП);
 *   - карусель «Авторы и преподаватели» (люди из данных программ).
 *
 * Зачем генератор, а не разметка руками
 * -------------------------------------
 * Оба участка держат числа: «6 программ», «Все 26 программ», «23 программы,
 * от 22 000 ₽». Написанные руками, они расходятся с каталогом при первом же
 * обновлении с hse.ru: программа снимается, а лендинг продолжает обещать
 * прежнее. Источник истины один – `.catalog-data.json` и разбор по сферам
 * из `lib/program-spheres.js`, тот же, что у страниц программ.
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
// Наружу пускаем только https://*.hse.ru – тот же контракт, что у каталога
// и у генератора страниц программ. Проверка живёт в одном месте.
const { safeHseUrl } = require('../lib/hse-catalog');

const ROOT = path.resolve(__dirname, '..');
const STORE = path.join(ROOT, '.catalog-data.json');
const WORK = path.join(ROOT, '.landing-template.html');

/** Участки шаблона, которые скрипт переписывает целиком. */
const REGIONS = {
  panel: { start: '<!-- dpo:nav-panel:start -->', end: '<!-- dpo:nav-panel:end -->' },
  formats: { start: '<!-- dpo:formats:start -->', end: '<!-- dpo:formats:end -->' },
  teachers: { start: '<!-- dpo:teachers:start -->', end: '<!-- dpo:teachers:end -->' },
};

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

/** «22 000» с неразрывными пробелами: цена не должна рваться по строкам. */
function formatPrice(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0') + '\u00A0₽';
}

/**
 * Форматы обучения.
 *
 * Тексты и названия документов – редакторские, они перенесены с прежней
 * версии блока и не выдумываются здесь. Из описаний убрано только упоминание
 * документа: он вынесен в строку фактов, и в прежнем виде назывался дважды
 * подряд («…и удостоверение о повышении квалификации» плюс «Удостоверение о
 * повышении квалификации»). Из данных берутся только числа: сколько программ
 * каждого типа и от какой цены.
 *
 * «Второе высшее» в каталоге ДПО отсутствует – это программа бакалавриата,
 * и данных о ней в `.catalog-data.json` нет. Поэтому её счётчик задан
 * явно, а адрес страницы (`url`) прописан здесь же: его прислал владелец
 * 16.08.2026. Выдумывать URL по-прежнему нельзя – если однажды ссылка
 * пропадёт из этого места, строка снова останется без кнопки, а не уведёт
 * человека в никуда.
 */
const FORMATS = [
  {
    type: 'ПК',
    title: 'Повышение квалификации',
    desc: 'Относительно короткие курсы: новые компетенции для текущей профессии.',
    document: 'Удостоверение о повышении квалификации',
    lead: true,
  },
  {
    type: 'ПП',
    title: 'Профессиональная переподготовка',
    desc: 'Более длительные программы – для смены профессии или существенного роста квалификации.',
    document: 'Диплом о профессиональной переподготовке',
  },
  {
    type: null,
    fixedCount: 1,
    title: 'Второе высшее образование',
    desc: '«Юриспруденция: правовое регулирование бизнеса» – бакалавриат. Профили: корпоративный юрист, юрист в сфере строительства и недвижимости, финансового и налогового права.',
    document: 'Диплом о высшем образовании',
    url: 'https://pravo.hse.ru/doplaw/',
    ctaLabel: 'О программе на pravo.hse.ru',
  },
];

function renderFormats(programs) {
  const rows = FORMATS.map((fmt) => {
    const items = fmt.type
      ? programs.filter((p) => (p.type && (p.type.shortTitle || p.type.title)) === fmt.type)
      : [];
    const count = fmt.type ? items.length : fmt.fixedCount;
    if (!count) return '';

    const prices = items
      .map((p) => p.discountPrice || p.educationPricing)
      .filter((n) => Number.isFinite(n) && n > 0)
      .sort((a, b) => a - b);

    const facts = [escapeHtml(fmt.document)];
    if (prices.length) facts.push('от ' + formatPrice(prices[0]));

    // Кнопка ведёт в каталог с уже применённым фильтром по типу: механика
    // чтения фильтров из адреса в каталоге уже работает. У формата без типа
    // (второе высшее) своей страницы в каталоге нет, поэтому ссылка ведёт
    // на официальную страницу программы – и только если она задана.
    let cta = '';
    if (fmt.type) {
      cta = `\n            <a class="dpo-format-cta" href="Каталог программ.html?type=${encodeURIComponent(
        fmt.type,
      )}">Смотреть ${escapeHtml(pluralPrograms(count))}</a>`;
    } else if (fmt.url) {
      const href = safeHseUrl(fmt.url);
      if (href) {
        cta = `\n            <a class="dpo-format-cta" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(
          fmt.ctaLabel || 'Подробнее',
        )}</a>`;
      }
    }

    const [num, unit] = pluralPrograms(count).split(' ');

    return `        <li class="dpo-format${fmt.lead ? ' dpo-format--lead' : ''}">
          <p class="dpo-format-figure">
            <span class="dpo-format-count">${escapeHtml(num)}</span>
            <span class="dpo-format-unit">${escapeHtml(unit)}</span>
          </p>
          <div class="dpo-format-body">
            <h3 class="dpo-format-title">${escapeHtml(fmt.title)}</h3>
            <p class="dpo-format-desc">${escapeHtml(fmt.desc)}</p>
            <p class="dpo-format-facts">${facts
              .map((f) => `<span>${f}</span>`)
              .join('')}</p>${cta}
          </div>
        </li>`;
  }).filter(Boolean);

  return `      <ul class="dpo-formats">
${rows.join('\n')}
      </ul>`;
}

/**
 * Слияние записей об одном человеке.
 *
 * Источник пишет имена по-разному: «Максимов Дмитрий Михайлович» на одной
 * странице и «Дмитрий Максимов» на другой. Показать обоих в карусели значило
 * бы выдать одного человека за двоих.
 *
 * Правило слияния намеренно узкое: набор слов одного имени должен быть
 * ПОДМНОЖЕСТВОМ другого. «Дмитрий Максимов» ⊂ «Максимов Дмитрий Михайлович»
 * – сливаем, оставляя более полную форму. Просто совпадения фамилии мало:
 * однофамильцы существуют, и склеить их хуже, чем показать дважды.
 */
function mergeTeachers(programs) {
  const raw = [];
  for (const p of programs) {
    for (const t of p.teachers || []) {
      if (t && t.name) raw.push({ name: t.name, about: t.about || null, program: p.title });
    }
  }

  const tokens = (name) =>
    new Set(
      String(name)
        .toLowerCase()
        .replace(/[^\p{L}\s-]/gu, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 1),
    );
  const isSubset = (a, b) => [...a].every((w) => b.has(w));

  const people = [];
  for (const r of raw) {
    const tk = tokens(r.name);
    let hit = null;
    for (const person of people) {
      if (isSubset(tk, person.tokens) || isSubset(person.tokens, tk)) {
        hit = person;
        break;
      }
    }
    if (!hit) {
      people.push({ name: r.name, tokens: tk, about: r.about, programs: [r.program] });
      continue;
    }
    // Держим более полную форму имени и самую подробную справку.
    if (tk.size > hit.tokens.size) {
      hit.name = r.name;
      hit.tokens = tk;
    }
    if (r.about && (!hit.about || r.about.length > hit.about.length)) hit.about = r.about;
    if (!hit.programs.includes(r.program)) hit.programs.push(r.program);
  }

  // Порядок: сначала те, кто ведёт больше программ, затем по алфавиту.
  people.sort((a, b) => b.programs.length - a.programs.length || a.name.localeCompare(b.name, 'ru'));
  return { people, rawCount: raw.length };
}

function renderTeachers(programs) {
  const { people, rawCount } = mergeTeachers(programs);
  if (!people.length) throw new Error('в данных нет ни одного преподавателя');

  const cards = people
    .map((t) => {
      // Число программ показываем только тем, у кого их больше одной:
      // «1 программа» под каждым вторым именем – шум, а не сведение.
      const note =
        t.programs.length > 1
          ? `\n          <p class="dpo-teacher-role">${escapeHtml(
              pluralPrograms(t.programs.length),
            )}</p>`
          : '';
      const about = t.about
        ? `\n          <p class="dpo-teacher-desc">${escapeHtml(t.about)}</p>`
        : '';
      return `        <li class="dpo-teacher">
          <span class="dpo-portrait" aria-hidden="true">
            <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" width="34" height="34" opacity="0.45"><circle cx="20" cy="15" r="6.5"/><path d="M8.5 32.5c1.8-5.6 6.3-8.6 11.5-8.6s9.7 3 11.5 8.6"/></svg>
          </span>
          <h3 class="dpo-teacher-name">${escapeHtml(t.name)}</h3>${note}${about}
        </li>`;
    })
    .join('\n');

  return {
    html: `      <ul id="teachersTrack" class="dpo-track" tabindex="0" role="list" aria-label="Преподаватели программ ДПО" style="list-style: none; margin-top: 0; margin-bottom: 0;">
${cards}
      </ul>`,
    people: people.length,
    merged: rawCount - people.length,
  };
}

/** Меняет содержимое одной размеченной области шаблона. */
function replaceRegion(template, region, html) {
  const from = template.indexOf(region.start);
  const to = template.indexOf(region.end);
  if (from < 0 || to < 0) {
    throw new Error(`в шаблоне лендинга не найдены маркеры ${region.start} / ${region.end}`);
  }
  if (to < from) throw new Error(`маркеры ${region.start} идут в обратном порядке`);
  return template.slice(0, from + region.start.length) + '\n' + html + '\n        ' + template.slice(to);
}

function build() {
  if (!fs.existsSync(STORE)) {
    throw new Error('нет .catalog-data.json – сначала запустите node update-catalog.js');
  }
  const store = JSON.parse(fs.readFileSync(STORE, 'utf8'));
  const programs = store.programs || [];
  if (!programs.length) throw new Error('в каталоге нет программ, лендинг не собирается');

  let template = extract(WORK);
  const { html, spheres, unassigned } = buildPanel(programs);
  template = replaceRegion(template, REGIONS.panel, html);
  template = replaceRegion(template, REGIONS.formats, renderFormats(programs));
  const teachers = renderTeachers(programs);
  template = replaceRegion(template, REGIONS.teachers, teachers.html);

  fs.writeFileSync(WORK, template, 'utf8');
  inject(WORK);

  const byType = FORMATS.filter((f) => f.type)
    .map((f) => f.type + ' ' + programs.filter((p) => (p.type && (p.type.shortTitle || p.type.title)) === f.type).length)
    .join(', ');
  console.log(
    `Панель «Направления»: сфер ${spheres}, программ ${programs.length}` +
      (unassigned ? `, вне сфер ${unassigned}` : ''),
  );
  console.log(`Блок «Наши форматы»: ${byType}`);
  console.log(
    `Карусель преподавателей: ${teachers.people} человек` +
      (teachers.merged ? `, склеено повторов ${teachers.merged}` : ''),
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

module.exports = { build, buildPanel, renderFormats };
