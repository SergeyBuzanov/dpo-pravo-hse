#!/usr/bin/env node
/**
 * Собирает участки лендинга, которые зависят от данных каталога.
 *
 *   node scripts/build-landing.js
 *
 * Сейчас таких участков четыре:
 *   - панель «Направления» в шапке (сферы и по три программы в каждой);
 *   - блок «Выберите свою траекторию развития» (четыре формата, цены из
 *     каталога по типам ПК и ПП);
 *   - карусель «Наша команда» (люди из данных программ);
 *   - секция «Программы по сферам» (карточки сфер с тремя программами).
 * Плюс данные тайлов «Топ-5» в data-блоке шаблона (обложки, даты старта).
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
// upcomingStartLabel – единая подпись «Старт: …» для всех витрин: прошедшая
// или отсутствующая дата не выводится вовсе.
const { safeHseUrl, upcomingStartLabel, formatDate } = require('../lib/hse-catalog');

const ROOT = path.resolve(__dirname, '..');
const STORE = path.join(ROOT, '.catalog-data.json');
const INDEX = path.join(ROOT, 'index.html');
const WORK = path.join(ROOT, '.landing-template.html');

/** Участки шаблона, которые скрипт переписывает целиком. */
const REGIONS = {
  panel: { start: '<!-- dpo:nav-panel:start -->', end: '<!-- dpo:nav-panel:end -->' },
  formats: { start: '<!-- dpo:formats:start -->', end: '<!-- dpo:formats:end -->' },
  teachers: { start: '<!-- dpo:teachers:start -->', end: '<!-- dpo:teachers:end -->' },
  spheres: { start: '<!-- dpo:spheres:start -->', end: '<!-- dpo:spheres:end -->' },
  starts: { start: '<!-- dpo:starts:start -->', end: '<!-- dpo:starts:end -->' },
  reviews: { start: '<!-- dpo:reviews:start -->', end: '<!-- dpo:reviews:end -->' },
};

/**
 * Регион в СТАТИЧЕСКОЙ части index.html, вне шаблона бандла: список программ
 * внутри <noscript>. Правится после inject(), иначе упаковка шаблона затрёт
 * правку.
 */
const NOSCRIPT_REGION = {
  start: '<!-- dpo:noscript-programs:start -->',
  end: '<!-- dpo:noscript-programs:end -->',
};

/**
 * Регион с выбором девиза. Тоже в статической части index.html, сразу за
 * элементом девиза на экране загрузки: скрипт обязан отработать до того, как
 * посетитель успеет прочитать дефолтную фразу, иначе он увидит подмену текста.
 */
const SLOGAN_REGION = {
  start: '<!-- dpo:slogan:start -->',
  end: '<!-- dpo:slogan:end -->',
};

const SLOGANS_FILE = path.join(ROOT, 'content', 'slogans.json');
const SLOGAN_LIB = path.join(ROOT, 'lib', 'slogan-bag.js');

/** Сколько названий показываем в сфере, прежде чем свернуть в «ещё N». */
const PREVIEW = 3;

// Em dash в видимых текстах сайта запрещён типографикой проекта, а данные
// с hse.ru его приносят («…института права и развития ВШЭ — Сколково»).
// Правим при выводе, а не в .catalog-data.json: хранилище перезаписывается
// каждым обновлением каталога, и правка в нём не пережила бы ночь.
const enDash = (s) => String(s).replace(/\s—\s/g, ' – ').replace(/—/g, '–');

const escapeHtml = (s) =>
  enDash(s)
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

/** Тип программы словами: «ПК» на карточке сферы ничего не говорит. */
function kindLabel(p) {
  const s = (p.type && (p.type.shortTitle || p.type.title)) || '';
  if (s === 'ПК') return 'Повышение квалификации';
  if (s === 'ПП') return 'Переподготовка';
  return s || 'Программа ДПО';
}

/**
 * Формат без пояснения в скобках: «Гибридный (обучение проходит очно и
 * параллельно в онлайн)» в строке меты карточки сферы занимал бы три строки.
 * Пояснение остаётся на странице программы, где ему и место.
 */
function shortFormat(p) {
  return String(p.studyFormat?.title || '').replace(/\s*\(.*\)\s*$/, '');
}

/**
 * Секция «Программы по сферам»: карточка сферы с тремя программами
 * и строкой-ссылкой в каталог с уже применённым фильтром направления –
 * та же механика адреса, что у «ещё N» в панели «Направления».
 */
function renderSphereCard(sphere) {
  const total = sphere.items.length;
  if (!total) return '';

  const catalogHref = 'Каталог программ.html?sphere=' + encodeURIComponent(sphere.id);

  const rows = sphere.items.slice(0, PREVIEW).map((p) => {
    const price = p.discountPrice || p.educationPricing;
    const priceHtml =
      Number.isFinite(price) && price > 0
        ? `\n              <span class="dpo-prog-price">${escapeHtml(formatPrice(price))}</span>`
        : '';
    const meta = [kindLabel(p), shortFormat(p), upcomingStartLabel(p)].filter(Boolean).join(' · ');
    return `          <li>
            <a class="dpo-prog" href="${escapeHtml(programHref(p))}">
              <span class="dpo-prog-title">${escapeHtml(p.title)}</span>${priceHtml}
              <span class="dpo-prog-meta">${escapeHtml(meta)}</span>
            </a>
          </li>`;
  });

  // Когда скрытых программ нет, «Все 3 программы сферы» обещало бы больше,
  // чем покажет: те же три уже на карточке. Формулировка честнее.
  const allLabel =
    total > PREVIEW ? `Все ${pluralPrograms(total)} сферы` : 'Открыть сферу в каталоге';

  return `        <div class="dpo-sphere">
          <div class="dpo-sphere-head">
            <h3 class="dpo-sphere-title">${escapeHtml(sphere.title)}</h3>
            <span class="dpo-sphere-count">${escapeHtml(pluralPrograms(total))}</span>
          </div>
          <ul class="dpo-sphere-list">
${rows.join('\n')}
          </ul>
          <a class="dpo-sphere-all" href="${escapeHtml(catalogHref)}">${escapeHtml(allLabel)}</a>
        </div>`;
}

function renderSpheres(programs) {
  const { spheres, unassigned } = groupBySphere(programs);
  const filled = spheres.filter((s) => s.items.length);
  if (!filled.length) throw new Error('ни одна сфера не заполнена, секция «по сферам» пуста');

  // Стили строки-ссылки и посадка карточек лежат в регионе, а не в шаблонном
  // <style>: до шаблонного блока генератору не дотянуться, а правило рядом
  // с разметкой переживает пересборку вместе с ней.
  const style = `      <style>
        /* Карточка по контенту: ряд сетки не растягивает соседей до самой
           высокой карточки, пустых хвостов под списком не остаётся. */
        .dpo-spheres { align-items: start; }
        .dpo-sphere { padding-bottom: 0; }
        .dpo-sphere-all {
          display: block;
          margin: 0 -24px;
          padding: 14px 24px 18px;
          border-top: 1px solid rgba(33, 30, 27, 0.1);
          font-size: 14.5px;
          font-weight: 600;
          color: var(--dpo-accent, #1658DA);
        }
        .dpo-sphere-all::after { content: ' →'; }
        @media (hover: hover) and (pointer: fine) {
          .dpo-sphere-all:hover { text-decoration: underline; }
        }
      </style>`;

  const html = `${style}
      <div class="dpo-spheres">
${filled.map(renderSphereCard).join('\n')}
      </div>`;

  return { html, spheres: filled.length, unassigned: unassigned.length };
}

/**
 * Форматы обучения.
 *
 * Тексты и названия документов – заказчика (18.08.2026), слово в слово; из
 * правок только типографские («ёмкие» через ё, кавычки-ёлочки). Он же убрал
 * из блока числа программ: раньше слева стояло живое число (23 / 3 / 1) и
 * оно задавало вес строки. Теперь форматы равнозначны – это выбор траектории,
 * а не рейтинг, – поэтому колонки с числом и признака `lead` больше нет.
 * Из данных берётся только цена: от какой суммы начинаются программы типа.
 *
 * Форматов стало четыре: добавилось «Дополнительное образование для
 * взрослых» – ровно то, по итогам чего выдают свидетельство об обучении
 * (четвёртая позиция переключателя в блоке «Документ»).
 *
 * Ни «Второго высшего», ни «Дополнительного образования для взрослых» в
 * каталоге ДПО нет: первое – программа бакалавриата, второго в
 * `.catalog-data.json` нет как типа. Поэтому у них нет ни числа, ни фильтра
 * в каталоге; кнопка есть только там, где есть куда вести. Адрес второго
 * высшего прислал владелец 16.08.2026 – выдумывать URL нельзя, без него
 * строка просто останется без кнопки, а не уведёт человека в никуда.
 */
const FORMATS = [
  {
    type: 'ПК',
    title: 'Повышение квалификации',
    desc: 'Короткие и ёмкие курсы для практикующих юристов, которые хотят освоить новые компетенции в рамках своей профессии. Идеальный вариант, чтобы быстро закрыть пробел в знаниях или освоить новую отрасль права.',
    document: 'Итоговый документ: удостоверение о повышении квалификации',
  },
  {
    type: 'ПП',
    title: 'Профессиональная переподготовка',
    desc: 'Более длительные и глубокие программы для юристов, которые решили сменить профессиональную траекторию. Вы получаете системные знания, достаточные для ведения деятельности в новой сфере.',
    document: 'Итоговый документ: диплом о профессиональной переподготовке',
  },
  {
    type: null,
    title: 'Дополнительное образование для взрослых',
    desc: 'Отдельные курсы и модули для слушателей без юридического образования, которые хотят повысить свои знания в области юриспруденции без привязки к формальной квалификации. Удобный формат для точечного восполнения пробелов и систематизации знаний в конкретной правовой сфере.',
    document: 'Итоговый документ: свидетельство об обучении (при успешном освоении программы)',
  },
  {
    type: null,
    title: 'Второе высшее образование',
    desc: 'Фундаментальная программа бакалавриата «Юриспруденция: правовое регулирование бизнеса» для тех, у кого нет юридического образования, но есть потребность получить полноценную юридическую квалификацию. Выбор профиля: корпоративный юрист или специалист в сфере строительства, недвижимости, финансового и налогового права.',
    document: 'Итоговый документ: диплом о высшем образовании',
    url: 'https://pravo.hse.ru/doplaw/',
    ctaLabel: 'О программе на pravo.hse.ru',
  },
];

function renderFormats(programs) {
  const rows = FORMATS.map((fmt) => {
    const items = fmt.type
      ? programs.filter((p) => (p.type && (p.type.shortTitle || p.type.title)) === fmt.type)
      : [];
    // Формат с типом, но без программ в каталоге, показывать нечем: кнопка
    // увела бы в фильтр с пустым результатом. Форматы без типа (второе высшее,
    // дополнительное образование для взрослых) в каталоге не считаются и
    // стоят всегда.
    if (fmt.type && !items.length) return '';

    const prices = items
      .map((p) => p.discountPrice || p.educationPricing)
      .filter((n) => Number.isFinite(n) && n > 0)
      .sort((a, b) => a - b);

    // Строка про итоговый документ стоит под описанием, а не в правой
    // колонке: в тексте заказчика она – часть описания формата, и на широком
    // экране прижатая направо она рвалась на две строки посередине фразы.
    // Направо уходит только то, что не проза: цена и кнопка.
    const doc = `\n            <p class="dpo-format-facts"><span>${escapeHtml(fmt.document)}</span></p>`;
    const price = prices.length
      ? `\n            <p class="dpo-format-facts"><span>от ${escapeHtml(formatPrice(prices[0]))}</span></p>`
      : '';

    // Кнопка ведёт в каталог с уже применённым фильтром по типу: механика
    // чтения фильтров из адреса в каталоге уже работает. У формата без типа
    // (второе высшее) своей страницы в каталоге нет, поэтому ссылка ведёт
    // на официальную страницу программы – и только если она задана.
    // Числа в подписи кнопки («Смотреть 23 программы») сняты вместе с
    // колонкой числа: заказчик убирал из блока цифры целиком.
    let cta = '';
    if (fmt.type) {
      cta = `\n            <a class="dpo-format-cta" href="Каталог программ.html?type=${encodeURIComponent(
        fmt.type,
      )}">Смотреть программы</a>`;
    } else if (fmt.url) {
      const href = safeHseUrl(fmt.url);
      if (href) {
        cta = `\n            <a class="dpo-format-cta" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(
          fmt.ctaLabel || 'Подробнее',
        )}</a>`;
      }
    }

    // Пустой правый столбик не рисуется вовсе: у «Дополнительного образования
    // для взрослых» нет ни цены (его нет в каталоге), ни адреса страницы.
    const side = price || cta ? `\n          <div class="dpo-format-side">${price}${cta}\n          </div>` : '';

    return `        <li class="dpo-format">
          <div class="dpo-format-body">
            <h3 class="dpo-format-title">${escapeHtml(fmt.title)}</h3>
            <p class="dpo-format-desc">${escapeHtml(fmt.desc)}</p>${doc}
          </div>${side}
        </li>`;
  }).filter(Boolean);

  // Колонка цены и ссылки добавлена генератором, а не шаблоном: описание
  // ограничено 62ch, и на широком экране правая половина строки пустовала.
  // Стиль живёт в регионе, потому что шаблонный <style> отсюда недостижим,
  // а регион пересобирается целиком.
  //
  // Колонки с числом программ больше нет (заказчик убрал цифры), поэтому
  // вторая колонка появляется только с 980px: до этой ширины описание
  // заказчика в три-четыре строки и правый столбик не уживаются.
  return `      <style>
        .dpo-format-side { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }
        @media (min-width: 980px) {
          .dpo-format { grid-template-columns: minmax(0, 1fr) minmax(240px, 0.42fr); }
          .dpo-format-side { grid-column: 2; align-items: flex-end; text-align: right; }
          /* Точка-разделитель в столбике осталась бы одна в начале строки. */
          .dpo-format-side .dpo-format-facts { flex-direction: column; gap: 4px; align-items: flex-end; }
          .dpo-format-side .dpo-format-facts span + span::before { content: none; }
          .dpo-format-side .dpo-format-cta { align-self: flex-end; }
        }
      </style>
      <ul class="dpo-formats">
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
function mergeTeachers(programs, photos = {}, pages = {}) {
  const raw = [];
  for (const p of programs) {
    for (const t of p.teachers || []) {
      if (t && t.name) {
        raw.push({
          name: t.name,
          about: t.about ? fixTeacherText(t.about) : null,
          program: { title: p.title, href: programHref(p) },
          photo: teacherPhoto(photos, t.name),
          page: teacherPage(pages, t.name),
        });
      }
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
      people.push({ name: r.name, tokens: tk, about: r.about, programs: [r.program], photo: r.photo, page: r.page });
      continue;
    }
    // Держим более полную форму имени и самую подробную справку.
    if (tk.size > hit.tokens.size) {
      hit.name = r.name;
      hit.tokens = tk;
    }
    if (r.about && (!hit.about || r.about.length > hit.about.length)) hit.about = r.about;
    if (!hit.programs.some((p) => p.href === r.program.href)) hit.programs.push(r.program);
    // Фото и персональная страница могли прийти под любой из форм имени.
    if (!hit.photo && r.photo) hit.photo = r.photo;
    if (!hit.page && r.page) hit.page = r.page;
  }

  // Порядок: сначала те, кто ведёт больше программ, затем по алфавиту.
  people.sort((a, b) => b.programs.length - a.programs.length || a.name.localeCompare(b.name, 'ru'));
  return { people, rawCount: raw.length };
}

/**
 * Монограмма для круга-аватара: первая буква имени + первая буква фамилии.
 * Источник пишет имена двояко: «Максимов Дмитрий Михайлович» (три слова,
 * фамилия впереди) и «Дмитрий Максимов» (два, имя впереди). Порядок букв
 * выравниваем по числу слов, чтобы монограмма всегда читалась «Имя Фамилия».
 */
function initials(name) {
  const words = String(name).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const first = (w) => (w[0] || '').toUpperCase();
  if (words.length >= 3) return first(words[1]) + first(words[0]);
  if (words.length === 2) return first(words[0]) + first(words[1]);
  return first(words[0]);
}

/**
 * Фото человека из справочника teacherPhotos (.catalog-data.json, кладёт
 * scripts/fetch-program-media.js). Путь проверяется той же строгой маской,
 * что в lib/catalog-store.js, и файл обязан лежать на диске: битая рамка
 * вместо портрета хуже монограммы.
 */
function teacherPhoto(photos, name) {
  const p = photos && typeof photos[name] === 'string' ? photos[name].trim() : '';
  if (!/^images\/teachers\/[a-z0-9_.-]+$/i.test(p)) return null;
  return fs.existsSync(path.join(ROOT, p)) ? p : null;
}

/**
 * Персональная страница на hse.ru из справочника teacherPages
 * (.catalog-data.json, заполняется руками – автоматический поиск адресов
 * запрещён: однофамильцы дали бы ссылки на чужих людей). Пустое поле –
 * штатно: ссылка в карточке просто не выводится.
 */
function teacherPage(pages, name) {
  const u = pages && typeof pages[name] === 'string' ? pages[name].trim() : '';
  return u ? safeHseUrl(u) : null;
}

/**
 * Точечные правки текстов, приезжающих с hse.ru. Правка при выводе, а не в
 * .catalog-data.json: хранилище перезаписывается каждым обновлением каталога,
 * и правка в нём не пережила бы ночь (тот же принцип, что у enDash выше).
 * Сюда попадают только подтверждённые опечатки источника.
 */
const TEXT_FIXES = [
  ['внешнеэкономический деятельности', 'внешнеэкономической деятельности'],
];

function fixTeacherText(s) {
  let out = String(s);
  for (const [from, to] of TEXT_FIXES) out = out.split(from).join(to);
  return out;
}

function renderTeachers(programs, photos = {}, pages = {}) {
  const { people, rawCount } = mergeTeachers(programs, photos, pages);
  if (!people.length) throw new Error('в данных нет ни одного преподавателя');

  // Кламп в inline-стиле, а не в шаблонном <style>: до шаблонного блока
  // генератору не дотянуться. max-height – запасной ход для движков без
  // -webkit-line-clamp: без него текст не обрезался бы вовсе.
  const clamp =
    'display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; max-height: 4.7em;';

  const cards = people
    .map((t) => {
      // Пустая справка или служебная пометка «todo» – хвост не рисуем:
      // карточка заканчивается кнопкой, а не заглушкой.
      const aboutText = typeof t.about === 'string' ? t.about.trim() : '';
      const hasAbout = aboutText && !/\btodo\b/i.test(aboutText);
      const about = hasAbout
        ? `\n          <p class="dpo-teacher-desc" style="${clamp}">${escapeHtml(aboutText)}</p>`
        : '';
      // Полные сведения для окна «подробнее» (js/team-modal.js) лежат в
      // data-атрибуте карточки, а не собираются из её обрезанной вёрстки:
      // в карточке должность клампится, в окне она обязана быть целиком.
      const payload = JSON.stringify({
        name: t.name,
        about: hasAbout ? aboutText : '',
        programs: t.programs.map((p) => ({ t: p.title, h: p.href })),
        url: t.page || '',
      });
      // Монограмма текстом, не SVG: в режиме для слабовидящих svg скрыты,
      // а текст в круге остаётся. Круг декоративен – имя стоит рядом.
      // Фото (если скачано fetch-program-media.js) лежит ПОВЕРХ монограммы:
      // в режиме для слабовидящих фото снимается правилом региона ниже, и
      // круг сам возвращается к текстовой монограмме. Кадрирование прижато
      // к верхней трети: у портретов в полный рост лицо иначе уходит вверх
      // за круг, а внизу остаётся пустой фон.
      // Alt портрета: имя и должность.
      //
      // Раньше стоял alt="" – для скринридера правильно, потому что круг
      // помечен aria-hidden, а имя стоит рядом заголовком h3, и открытый alt
      // прочитал бы его вторым экземпляром. Но пустой alt означал ещё и то,
      // что 64 портрета не существуют для поиска по картинкам: он читает
      // атрибут, и пустой атрибут для него – отсутствие подписи.
      //
      // Поэтому alt теперь описательный, а aria-hidden на .dpo-portrait
      // СОХРАНЯЕТСЯ: диктор по-прежнему пропускает круг и читает имя один
      // раз, а робот получает подпись. Индекс строится по разметке, а не по
      // дереву доступности.
      //
      // Ключи сюда не пишем. Alt описывает изображение; «преподаватель курсов
      // повышения квалификации юристов» под каждым из 64 портретов – это
      // ровно тот переспам, за который Яндекс накладывает «Баден-Баден».
      // Должность обрезаем: alt длиннее ~125 знаков диктор читает как стену
      // текста, а поисковик усекает.
      const photoAlt = (() => {
        const post = hasAbout ? aboutText.split(/\s*,\s*/)[0].trim() : '';
        const full = post ? `${t.name}, ${post.charAt(0).toLowerCase()}${post.slice(1)}` : t.name;
        return full.length <= 125 ? full : t.name;
      })();
      const photo = t.photo
        ? `<img src="${escapeHtml(t.photo)}" alt="${escapeHtml(photoAlt)}" loading="lazy" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: center 22%; border-radius: 999px;">`
        : '';
      // Кнопка «N программ» – единственный фокусируемый вход в окно
      // подробностей; клик по всей карточке делает то же (делегирование в
      // js/team-modal.js), но клавиатуре и диктору нужна настоящая кнопка.
      // Имя – гиперссылка на личную страницу hse.ru, когда адрес есть в
      // справочнике teacherPages (просьба заказчика 18.08.2026). Клик по
      // ссылке НЕ открывает окно карточки: js/team-modal.js пропускает
      // клики по <a> (target.closest('a')). Без адреса имя остаётся текстом.
      const nameHtml = t.page
        ? `<a class="dpo-teacher-link" href="${escapeHtml(t.page)}" target="_blank" rel="noopener noreferrer">${escapeHtml(t.name)}</a>`
        : escapeHtml(t.name);
      return `        <li class="dpo-teacher" data-dpo-teacher="${escapeHtml(payload)}">
          <span class="dpo-portrait" aria-hidden="true" style="position: relative;">${escapeHtml(
            initials(t.name),
          )}${photo}</span>
          <h3 class="dpo-teacher-name">${nameHtml}</h3>
          <button type="button" class="dpo-teacher-more" aria-haspopup="dialog" aria-label="${escapeHtml(
            'Подробнее: ' + t.name,
          )}">${escapeHtml(pluralPrograms(t.programs.length))}</button>${about}
        </li>`;
    })
    .join('\n');

  const withPhoto = people.filter((t) => t.photo).length;

  // Правила региона (до шаблонного <style> генератору не дотянуться):
  //  - vi-mode: общие правила режима прячут svg и background-image, но фото –
  //    тег img, его надо снимать отдельно;
  //  - карточки одной высоты: дорожка-flex по умолчанию растягивает li до
  //    самой высокой – прежний align-items: flex-start снят намеренно,
  //    заказчик просил одинаковую высоту независимо от длины описания;
  //  - кнопка «N программ» стилизуется здесь же: её рисует генератор.
  return {
    html: `      <style>
        html.vi-mode .dpo-portrait img { display: none !important; }
        .dpo-portrait { position: relative; }
        .dpo-teacher { cursor: pointer; }
        .dpo-teacher-more {
          background: none; border: 0; padding: 0; align-self: center;
          font: 600 13px/1.4 'HSE Sans', 'IBM Plex Sans', sans-serif;
          color: #6B6459; cursor: pointer;
          text-decoration: underline;
          text-decoration-color: rgba(33, 30, 27, 0.35);
          text-underline-offset: 3px;
        }
        .dpo-teacher-link {
          color: inherit;
          text-decoration: underline;
          text-decoration-color: rgba(33, 30, 27, 0.28);
          text-decoration-thickness: 1px;
          text-underline-offset: 4px;
        }
        @media (hover: hover) and (pointer: fine) {
          .dpo-teacher-more:hover,
          .dpo-teacher:hover .dpo-teacher-more { color: var(--dpo-accent, #1658DA); }
          .dpo-teacher-link:hover {
            color: var(--dpo-accent, #1658DA);
            text-decoration-color: var(--dpo-accent, #1658DA);
          }
        }
      </style>
      <ul id="teachersTrack" class="dpo-track" tabindex="0" role="list" aria-label="Преподаватели программ ДПО" style="list-style: none; margin-top: 0; margin-bottom: 0;">
${cards}
      </ul>`,
    people: people.length,
    merged: rawCount - people.length,
    withPhoto,
  };
}

/**
 * Данные тайлам «Топ-5»: обложка и ближайший старт. Сами тайлы рендерит
 * sc-for в шаблоне, который генератор не трогает, – но данные лежат в
 * data-блоке шаблона, и вот их генератор обновить может: каждому элементу
 * top5 дописываются/обновляются поля image (путь миниатюры) и start
 * (подпись «Старт: …» из upcomingStartLabel; пустая строка, когда даты нет
 * или она прошла – пустой span в разметке гасится правилом :empty).
 *
 * Подстановка идемпотентна: старые поля снимаются и пишутся заново.
 * Если структура top5 в шаблоне пропала или переписана – сборка падает,
 * а не молчит: молчание означало бы тайлы навсегда без обложек и с
 * протухшими датами.
 */
/**
 * Сколько программ показываем в блоке. Сетка адаптивная (1/2/3/5 колонок),
 * пятнадцать ложатся тремя полными рядами на широком экране.
 */
const TOP_COUNT = 15;

/**
 * Отобранные вручную программы, идущие первыми. Это редакторское решение, а
 * не выборка: подводка блока прямо говорит, что программы отобраны. Порядок
 * внутри списка сохраняется.
 *
 * Программа, исчезнувшая из каталога, просто выпадает – сверять список руками
 * не нужно.
 */
const TOP_CURATED = Object.freeze([
  '837181759', // Цифровое право для бизнеса
  '816497962', // Интеллектуальная собственность: от закона к практике
  '474596729', // Корпоративное право: основные проблемы
  '1008772871', // Правовые вопросы банкротства: теории и практики
  '474599435', // Международное частное право: трансграничные операции
]);

/**
 * Данные блока программ.
 *
 * Раньше здесь стояла точечная правка: в захардкоженном списке из пяти записей
 * обновлялись обложка и дата старта, всё остальное лежало в шаблоне руками –
 * и расходилось с каталогом при первой же смене цены. Теперь список собирается
 * целиком из .catalog-data.json, тем же способом, что «Направления»,
 * «Форматы», «Преподаватели», «По сферам», «Ближайшие старты» и «Отзывы».
 *
 * Порядок: сначала отобранные вручную, затем остальные по близости старта.
 * Программы без будущей даты уходят в конец – показывать их можно, звать на
 * них нельзя.
 */
function renderTop5Data(template, programs) {
  const open = template.indexOf('top5: [');
  if (open < 0) throw new Error('в data-блоке шаблона не найдена структура top5: [');
  const close = template.indexOf(']', open);
  if (close < 0) throw new Error('data-блок top5 не закрыт скобкой ]');

  const byId = new Map(programs.map((p) => [String(p.id), p]));
  const picked = [];
  const taken = new Set();
  for (const id of TOP_CURATED) {
    const p = byId.get(id);
    if (p) {
      picked.push(p);
      taken.add(id);
    }
  }

  const rest = programs
    .filter((p) => !taken.has(String(p.id)))
    .sort((a, b) => {
      const ua = upcomingStartLabel(a) ? a.startDate || Infinity : Infinity;
      const ub = upcomingStartLabel(b) ? b.startDate || Infinity : Infinity;
      if (ua !== ub) return ua - ub;
      return String(a.title).localeCompare(String(b.title), 'ru');
    });
  for (const p of rest) {
    if (picked.length >= TOP_COUNT) break;
    picked.push(p);
  }

  const q = (s) => String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const priceOf = (p) => {
    const value = p.discountPrice != null ? p.discountPrice : p.educationPricing;
    if (value == null) return 'Цена по запросу';
    return value === 0 ? 'Бесплатно' : formatPrice(value);
  };

  const entries = picked.map((p, i) => {
    let image = null;
    if (p.image) {
      const thumb = `images/programs/thumbs/${p.id}.jpg`;
      image = fs.existsSync(path.join(ROOT, thumb)) ? thumb : p.image;
    }
    // Подводка: tagline, иначе первое предложение описания. Выдумывать нечего –
    // если нет ни того, ни другого, строка остаётся пустой.
    const source = String(p.tagline || p.about || '').trim();
    const tagline = enDash(source.split(/(?<=[.!?])\s+/)[0] || '');
    const fields = [
      image ? `image: '${q(image)}'` : null,
      `start: '${q(upcomingStartLabel(p) || '')}'`,
      `rank: '${i + 1}'`,
      `title: '${q(enDash(p.title))}'`,
      `tagline: '${q(tagline)}'`,
      `kind: '${q(kindLabel(p))}'`,
      `format: '${q((p.studyFormat && p.studyFormat.title) || '')}'`,
      `duration: '${q(p.duration || '')}'`,
      `price: '${q(priceOf(p))}'`,
      `href: '${q(programHref(p))}'`,
    ].filter(Boolean);
    return `        { ${fields.join(', ')} }`;
  });

  const body = 'top5: [\n' + entries.join(',\n') + '\n      ';
  return {
    template: template.slice(0, open) + body + template.slice(close),
    count: picked.length,
    curated: taken.size,
  };
}

/**
 * Полоса «Ближайшие старты» под героем (просьба заказчика 18.08.2026).
 * Три ближайших БУДУЩИХ старта: прошедшие и пустые даты отсеивает
 * upcomingStartLabel – та же логика, что у подписи «Старт: …» в витринах,
 * поэтому полоса не протухает при устаревшем каталоге. Если будущих
 * стартов нет вовсе, секция не выводится совсем (между маркерами пусто).
 */
function renderStarts(programs) {
  const upcoming = programs
    .filter((p) => upcomingStartLabel(p))
    .sort((a, b) => new Date(a.startDate) - new Date(b.startDate))
    .slice(0, 3);
  if (!upcoming.length) return { html: '', count: 0 };

  const items = upcoming
    .map(
      (p) => `      <a class="dpo-start" href="${escapeHtml(programHref(p))}">
        <span class="dpo-start-date">${escapeHtml(formatDate(p) || '')}</span>
        <span class="dpo-start-title">${escapeHtml(p.title)}</span>
      </a>`,
    )
    .join('\n');

  const html = `  <section data-screen-label="Upcoming starts" id="starts" style="padding: clamp(28px, 4vw, 48px) clamp(20px, 6vw, 64px); background: #F2ECE1; border-bottom: 1px solid rgba(33, 30, 27, 0.08);">
    <div class="dpo-starts">
      <span class="dpo-starts-label">Ближайшие старты</span>
${items}
      <a class="dpo-starts-all" href="Каталог программ.html?sort=start">Все даты стартов</a>
    </div>
  </section>`;
  return { html, count: upcoming.length };
}

/**
 * Секция «Отзывы выпускников» на лендинге. Отзывы настоящие – поле
 * feedback программ, которое fetch-program-descriptions.js забирает с
 * официальных страниц hse.ru. Правила отбора:
 *  - цитата приводится ДОСЛОВНО И ЦЕЛИКОМ, поэтому на лендинг попадают
 *    только отзывы средней длины (120–520 знаков): гигантские честно
 *    живут на странице программы, обрезать их нельзя;
 *  - по одному отзыву на программу (ближайший к 280 знакам) – подборка
 *    из шести программ разнообразнее, чем шесть голосов об одной;
 *  - порядок программ – порядок каталога, отбор детерминирован: пересборка
 *    без смены данных не перетасовывает карточки.
 */
function renderReviews(programs) {
  const picks = [];
  for (const p of programs) {
    if (!Array.isArray(p.feedback) || !p.feedback.length) continue;
    const fit = p.feedback
      .filter((f) => f.text && f.author && f.text.length >= 120 && f.text.length <= 520)
      .sort((a, b) => Math.abs(a.text.length - 280) - Math.abs(b.text.length - 280));
    if (!fit.length) continue;
    picks.push({ ...fit[0], program: p });
    if (picks.length === 6) break;
  }
  if (!picks.length) return { html: '', count: 0 };

  const cards = picks
    .map(
      (r) => `      <figure class="dpo-review">
        <blockquote class="dpo-review-text">${escapeHtml(fixTeacherText(r.text))}</blockquote>
        <figcaption class="dpo-review-foot">
          <p class="dpo-review-author">${escapeHtml(r.author)}</p>
          <a class="dpo-review-program" href="${escapeHtml(programHref(r.program))}">${escapeHtml(r.program.title)}</a>
        </figcaption>
      </figure>`,
    )
    .join('\n');

  const html = `  <section data-screen-label="Reviews" id="reviews" style="padding: clamp(64px, 9vw, 120px) clamp(20px, 6vw, 64px); background: #F2ECE1;">
    <div class="dpo-section-head">
      <span class="dpo-eyebrow">Слово выпускникам</span>
      <h2 class="dpo-h2">Отзывы выпускников</h2>
    </div>
    <div class="dpo-reviews-grid">
${cards}
    </div>
    <p class="dpo-marquee-note">Отзывы приводятся дословно с официальных страниц программ ДПО на hse.ru; полные подборки – на страницах программ.</p>
  </section>`;
  return { html, count: picks.length };
}

/** Меняет содержимое одной размеченной области шаблона. */
/**
 * Список программ для фолбэка <noscript>.
 *
 * Зачем. Разметка лендинга лежит JSON-строкой внутри
 * <script type="__bundler/template"> и собирается React-рантаймом уже в
 * браузере. В сыром ответе index.html оставалось около 780 знаков текста,
 * один заголовок и две внутренние ссылки – на каталог и на политику. Ссылок
 * на 26 страниц программ не было ни одной, то есть с главной к ним не вёл ни
 * один путь обхода. Google рендерит JS и увидит страницу второй волной,
 * Яндекс исполняет его выборочно и с задержкой – для него главная выглядела
 * заглушкой «Unpacking…».
 *
 * Здесь не подмена контента для робота: ровно то же видит человек с
 * отключённым JavaScript, и содержимое – подмножество настоящей страницы,
 * а не отдельный текст для поисковика.
 *
 * Полное решение – пререндер шаблона на этапе сборки; этот блок закрывает
 * главное: шесть заголовков направлений и путь обхода ко всем 26 страницам.
 */
function renderNoscriptPrograms(programs) {
  // groupBySphere отдаёт { spheres, unassigned }, а не массив.
  // unassigned здесь не теряется: программы вне сфер дописываются отдельным
  // списком ниже, иначе часть каталога осталась бы без пути обхода.
  const { spheres: groups, unassigned } = groupBySphere(programs);
  const parts = [];
  let links = 0;
  for (const sphere of groups) {
    if (!sphere.items.length) continue;
    const items = sphere.items
      .map((p) => {
        links += 1;
        return `          <li><a href="${escapeHtml(programHref(p))}">${escapeHtml(p.title)}</a></li>`;
      })
      .join('\n');
    parts.push(
      `        <h2>${escapeHtml(sphere.title)}</h2>\n` +
        `        <p>${escapeHtml(pluralPrograms(sphere.items.length))} повышения квалификации и переподготовки для юристов.</p>\n` +
        `        <ul>\n${items}\n        </ul>`,
    );
  }
  if (unassigned.length) {
    const items = unassigned
      .map((p) => {
        links += 1;
        return `          <li><a href="${escapeHtml(programHref(p))}">${escapeHtml(p.title)}</a></li>`;
      })
      .join('\n');
    parts.push(
      `        <h2>Другие программы</h2>\n        <ul>\n${items}\n        </ul>`,
    );
  }
  return { html: parts.join('\n'), links, spheres: parts.length };
}

/**
 * Снимает комментарии и лишние пробелы. Не минификатор: ужимает ровно то, что
 * раздувает вшитый в страницу код – блочные комментарии документации и отступы.
 * Строк в коде мешка нет, поэтому резать по кавычкам ничего не может.
 */
function squeeze(js) {
  return js
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/^[ \t]+/gm, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/**
 * Выбор девиза первого экрана: банк, алгоритм мешка и связка с разметкой,
 * вшитые в страницу одним куском.
 *
 * Почему вшито, а не отдельным файлом. Во-первых, банк – девять строк, ради
 * них лишний запрос не нужен. Во-вторых, выбор обязан произойти до первой
 * отрисовки девиза: отложенный файл выполнится позже, и посетитель успеет
 * увидеть дефолтную фразу, а потом её подмену. Разрешено CSP страницы
 * ('unsafe-inline' в script-src).
 *
 * Почему алгоритм не переписан здесь заново: он лежит в lib/slogan-bag.js,
 * покрыт юнит-тестами и вставляется тем же исходником. Вторая копия разошлась
 * бы с первой при первой же правке.
 *
 * Девиз живёт в ДВУХ местах: на экране загрузки (.spl-motto, статическая
 * часть) и в настоящей странице ([data-dpo-motto], собирается рантаймом).
 * Фраза выбирается один раз и проставляется в оба, иначе на переходе от
 * заставки к странице текст сменится на глазах.
 */
function renderSloganPicker() {
  const bank = JSON.parse(fs.readFileSync(SLOGANS_FILE, 'utf8'));
  const slogans = (bank.slogans || []).map((s) => ({ text: s.text, weight: s.weight }));
  if (!slogans.length) throw new Error('content/slogans.json: банк девизов пуст');
  const version = Number(bank.version) || 1;

  const algorithm = squeeze(
    fs.readFileSync(SLOGAN_LIB, 'utf8').replace(/if \(typeof module[\s\S]*$/, ''),
  );

  const glue = squeeze(`
    var KEY_BAG = 'dpo.slogan.bag.v${version}';
    var KEY_LAST = 'dpo.slogan.last.v${version}';
    var memory = {};
    function read(key) {
      try { return window.localStorage.getItem(key); } catch (e) { return memory[key] || null; }
    }
    function write(key, value) {
      memory[key] = value;
      try { window.localStorage.setItem(key, value); } catch (e) {}
    }
    var saved = null;
    try { saved = JSON.parse(read(KEY_BAG)); } catch (e) { saved = null; }
    var lastRaw = read(KEY_LAST);
    var state = { bag: saved, last: lastRaw === null ? null : Number(lastRaw) };
    var picked = next(SLOGANS, state);
    var DEFAULT_TEXT = SLOGANS[0].text;
    var text = picked.index >= 0 ? SLOGANS[picked.index].text : null;
    if (text) {
      write(KEY_BAG, JSON.stringify(picked.state.bag));
      write(KEY_LAST, String(picked.state.last));
    }
    function apply(root) {
      if (!text || !root || !root.querySelectorAll) return;
      var nodes = root.querySelectorAll('.spl-motto,[data-dpo-motto]');
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].textContent !== text) nodes[i].textContent = text;
      }
    }
    apply(document);
    // Настоящий девиз строит рантайм из шаблона, где захардкожена дефолтная
    // фраза. Если ждать и переписывать её после сборки, посетитель увидит
    // мелькание: сначала дефолт, потом выбранная. Поэтому правим САМ шаблон,
    // пока рантайм до него не добрался.
    //
    // Успеваем по порядку в документе: этот скрипт стоит выше распаковщика,
    // значит его обработчик DOMContentLoaded зарегистрирован первым и
    // сработает первым. Шаблон – JSON-строка, замена делается через
    // JSON.stringify, чтобы кавычки и обратные слэши в фразе не порвали её.
    function patchTemplate() {
      if (!text || text === DEFAULT_TEXT) return;
      var node = document.querySelector('script[type="__bundler/template"]');
      if (!node) return;
      var quoted = function (s) { return JSON.stringify(s).slice(1, -1); };
      var from = quoted(DEFAULT_TEXT);
      var body = node.textContent;
      if (body.indexOf(from) < 0) return;
      node.textContent = body.replace(from, quoted(text));
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', patchTemplate);
    } else {
      patchTemplate();
    }
    // Страховка на случай, если формат шаблона изменится и правка выше не
    // сработает: тогда девиз всё равно встанет на место, пусть и с мельканием.
    // Наблюдатель снимается, как только элемент найден, либо по таймауту.
    if (window.MutationObserver) {
      var seen = false;
      var observer = new MutationObserver(function () {
        apply(document);
        if (!seen && document.querySelector('[data-dpo-motto]')) {
          seen = true;
          observer.disconnect();
        }
      });
      observer.observe(document, { childList: true, subtree: true });
      window.setTimeout(function () { observer.disconnect(); }, 15000);
    }
  `);

  return (
    '      <script>\n(function(){\n' +
    'var SLOGANS=' + JSON.stringify(slogans) + ';\n' +
    algorithm + '\n' +
    glue + '\n' +
    '})();\n      <\/script>'
  );
}

/** Замена региона в произвольном файле по тем же маркерам, что и в шаблоне. */
function replaceRegionIn(source, region, html, where) {
  const from = source.indexOf(region.start);
  const to = source.indexOf(region.end);
  if (from < 0 || to < 0) {
    throw new Error(`в ${where} не найдены маркеры ${region.start} / ${region.end}`);
  }
  if (to < from) throw new Error(`маркеры ${region.start} в ${where} идут в обратном порядке`);
  return source.slice(0, from + region.start.length) + '\n' + html + '\n      ' + source.slice(to);
}

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
  const teachers = renderTeachers(programs, store.teacherPhotos || {}, store.teacherPages || {});
  template = replaceRegion(template, REGIONS.teachers, teachers.html);
  const spheresSection = renderSpheres(programs);
  template = replaceRegion(template, REGIONS.spheres, spheresSection.html);
  const starts = renderStarts(programs);
  template = replaceRegion(template, REGIONS.starts, starts.html);
  const reviews = renderReviews(programs);
  template = replaceRegion(template, REGIONS.reviews, reviews.html);
  const top = renderTop5Data(template, programs);
  template = top.template;

  fs.writeFileSync(WORK, template, 'utf8');
  inject(WORK);

  // ПОСЛЕ inject: список программ в <noscript> живёт в статической части
  // index.html, а inject переписывает файл целиком из шаблона.
  const noscript = renderNoscriptPrograms(programs);
  const picker = renderSloganPicker();
  let indexHtml = fs.readFileSync(INDEX, 'utf8');
  indexHtml = replaceRegionIn(indexHtml, NOSCRIPT_REGION, noscript.html, 'index.html');
  indexHtml = replaceRegionIn(indexHtml, SLOGAN_REGION, picker, 'index.html');
  fs.writeFileSync(INDEX, indexHtml, 'utf8');

  const byType = FORMATS.filter((f) => f.type)
    .map((f) => f.type + ' ' + programs.filter((p) => (p.type && (p.type.shortTitle || p.type.title)) === f.type).length)
    .join(', ');
  console.log(
    `Панель «Направления»: сфер ${spheres}, программ ${programs.length}` +
      (unassigned ? `, вне сфер ${unassigned}` : ''),
  );
  console.log(`Блок «Выберите свою траекторию развития»: форматов ${FORMATS.length}, из каталога ${byType}`);
  console.log(
    `Карусель преподавателей: ${teachers.people} человек` +
      (teachers.merged ? `, склеено повторов ${teachers.merged}` : '') +
      `, с фото ${teachers.withPhoto}`,
  );
  console.log(
    `Блок программ: ${top.count} карточек, из них отобрано вручную ${top.curated}`,
  );
  console.log(`Секция «По сферам»: сфер ${spheresSection.spheres}`);
  console.log(`Полоса «Ближайшие старты»: программ ${starts.count}`);
  console.log(`Секция «Отзывы выпускников»: цитат ${reviews.count}`);
  console.log(
    `Фолбэк <noscript>: направлений ${noscript.spheres}, ссылок на программы ${noscript.links}`,
  );
  console.log(
    `Девизы первого экрана: ${JSON.parse(fs.readFileSync(SLOGANS_FILE, 'utf8')).slogans.length} фраз, ` +
      `вшито ${Math.round(Buffer.byteLength(picker, 'utf8') / 102.4) / 10} КБ`,
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

module.exports = {
  build,
  buildPanel,
  renderFormats,
  renderSpheres,
  renderTeachers,
  renderTop5Data,
};
