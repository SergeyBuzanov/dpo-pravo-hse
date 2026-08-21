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
const { formatPrice, formatDate, isoDate } = require('../lib/hse-catalog');
const { canonicalTeacherName } = require('../lib/teacher-names');

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

/**
 * Справочник программ для формы заявки (`content/programs-index.json`).
 *
 * Форма (`js/application-form.js`) читает его при первом открытии окна и
 * строит из него список «Программа». До 21.08.2026 списка не было вовсе:
 * человек, открывший форму из шапки или мобильной панели, не мог назвать
 * программу иначе как пересказом в свободном комментарии, и в учебный офис
 * уходила заявка без предмета.
 *
 * Файл намеренно узкий – id, название, адрес и сфера, ничего больше:
 * его тянет браузер, и лишние поля здесь оплачивает посетитель. Порядок –
 * по сферам, внутри сферы как в каталоге: в выпадающем списке это даёт
 * готовые группы <optgroup>.
 */
function writeProgramIndex(programs, spheres) {
  const sphereOfId = new Map();
  for (const s of spheres) for (const p of s.items) sphereOfId.set(String(p.id), s.title);

  const ordered = [];
  for (const s of spheres) {
    for (const p of s.items) ordered.push(p);
  }
  // Программа без сферы всё равно должна быть в списке: иначе заявку на
  // неё нельзя подать из общей формы.
  const seen = new Set(ordered.map((p) => String(p.id)));
  for (const p of programs) if (!seen.has(String(p.id))) ordered.push(p);

  const items = ordered.map((p) => ({
    id: String(p.id || ''),
    title: String(p.title || ''),
    url: programHref(p),
    sphere: sphereOfId.get(String(p.id)) || 'Другие программы',
  }));

  fs.mkdirSync(path.join(ROOT, 'content'), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, 'content', 'programs-index.json'),
    JSON.stringify({ programs: items }, null, 2) + '\n',
    'utf8',
  );
  return items.length;
}

const ESCAPE_MAP = Object.freeze({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
});
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch]);

/**
 * Чистка текстов, пришедших со скрапа hse.ru. В хранилище встречаются
 * дважды экранированные сущности: на странице источника стояло
 * «&amp;rarr;», fetch-скрипт снял один слой и оставил «&rarr;» буквально,
 * а esc() при вёрстке превращал его в видимый текст. Поэтому декодируем
 * ДВАЖДЫ, а после – убираем декоративные стрелки той же логикой, что в
 * textOf у scripts/fetch-program-descriptions.js. Данные хранилища при
 * этом не переписываются: трансляция происходит только при генерации.
 */
const NAMED_ENTITIES = Object.freeze({
  laquo: '«', raquo: '»', ndash: '–', mdash: '–', quot: '"', apos: "'",
  lt: '<', gt: '>', nbsp: ' ', amp: '&', hellip: '…',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  rarr: '→', larr: '←', harr: '↔', uarr: '↑', darr: '↓',
  // Латиница с диакритикой: французские программы каталога.
  eacute: 'é', Eacute: 'É', egrave: 'è', Egrave: 'È', ecirc: 'ê', Ecirc: 'Ê',
  euml: 'ë', agrave: 'à', Agrave: 'À', acirc: 'â', Acirc: 'Â',
  ccedil: 'ç', Ccedil: 'Ç', icirc: 'î', Icirc: 'Î', iuml: 'ï',
  ocirc: 'ô', Ocirc: 'Ô', ouml: 'ö', oelig: 'œ', OElig: 'Œ',
  ucirc: 'û', Ucirc: 'Û', ugrave: 'ù', uuml: 'ü', aelig: 'æ', AElig: 'Æ',
});

const decodeOnce = (s) =>
  String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED_ENTITIES[name] ?? m);

function cleanText(s) {
  if (s == null) return s;
  return decodeOnce(decodeOnce(s))
    // Декоративные стрелки скрапа – тот же диапазон, что в textOf.
    .replace(/[←-⇿➔-➿⬀-⯿]/g, ' ')
    // Em dash в видимых текстах запрещён типографикой проекта.
    .replace(/—/g, '–')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Программа с очищенными текстовыми полями. Заголовок не трогаем: из него
 * считается имя файла страницы, и чистка разъехалась бы со ссылками.
 */
function normalizeProgram(p) {
  const out = { ...p };
  if (p.tagline) out.tagline = cleanText(p.tagline);
  if (p.about) out.about = cleanText(p.about);
  if (p.audience) {
    out.audience = {
      intro: p.audience.intro ? cleanText(p.audience.intro) : null,
      items: (p.audience.items || []).map(cleanText).filter(Boolean),
    };
  }
  if (p.results) out.results = p.results.map(cleanText).filter(Boolean);
  if (p.modules) {
    out.modules = p.modules.map((m) => ({
      ...m,
      title: cleanText(m.title),
      hours: m.hours ? cleanText(m.hours) : m.hours,
    }));
  }
  if (p.teachers) {
    out.teachers = p.teachers.map((t) => ({
      ...t,
      // Канон написания имени – lib/teacher-names.js: источник пишет одного
      // человека двояко, и подписи плавали между страницами программ.
      name: canonicalTeacherName(cleanText(t.name)),
      about: t.about ? cleanText(t.about) : t.about,
    }));
  }
  if (p.feedback) {
    out.feedback = p.feedback
      .map((f) => ({ text: cleanText(f.text), author: cleanText(f.author) }))
      .filter((f) => f.text && f.author);
  }
  return out;
}

/**
 * Разбивка склеенного about на пункты. Часть описаний на hse.ru свёрстана
 * списком <li>, а в хранилище попала одной строкой без разделителей.
 * Признак склейки: в длинном тексте нет ни одного конца предложения, зато
 * есть стыки «слово Слово» (строчная/скобка перед заглавной кириллицей) –
 * места, где сходились соседние пункты. Порог в три стыка защищает
 * обычные фразы с именами собственными («по праву Гонконга») от разбивки.
 * Сами слова источника не меняются – только точки разреза.
 */
function splitGluedAbout(text) {
  if (!text || text.length < 150) return null;
  if (/[.!?](\s|$)/.test(text)) return null; // есть нормальные предложения
  const junctions = text.match(/[а-яё)»"%](?=\s+[А-ЯЁ])/g);
  if (!junctions || junctions.length < 3) return null;
  return text
    .split(/(?<=[а-яё)»"%])\s+(?=[А-ЯЁ])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

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

/**
 * Персональная ссылка оплаты на маркетплейсе hse.ru. Это ровно та ссылка,
 * которую маркетплейс сам ставит на «В корзину» для неавторизованных
 * (снята с живой страницы программы): вход в ЛК, затем шлюз ЕЛК
 * возвращает человека на страницу программы с action=cart. Звёздочка
 * перед base64 обязательна – так закодирован адрес возврата у самого
 * маркетплейса. Ссылка ВЫЧИСЛЯЕТСЯ из id при каждой сборке и в хранилище
 * не кладётся: хранить производное значило бы дать ему разойтись с формулой.
 */
function buildPayUrl(id) {
  const cart = `https://www.hse.ru/edu/dpo/${id}?action=cart`;
  const gateway =
    'https://www.hse.ru/mirror/co-auth/elk/gateway.html?ext=marketplace&i=*' +
    Buffer.from(cart).toString('base64');
  return 'https://lk.hse.ru/signin?redirecturl=' + encodeURIComponent(gateway) + '&systemid=27';
}

/**
 * Путь обложки: только наши локальные файлы (та же строгая маска, что в
 * lib/catalog-store.js) и только реально лежащие на диске – битый фон
 * хуже, чем его отсутствие.
 */
/**
 * Размеры картинки из заголовка файла, без сторонних библиотек.
 *
 * Нужны, чтобы поставить width/height обложке героя: без них браузер не знает
 * пропорций до загрузки, верстает по нулевой высоте и дёргает страницу вниз,
 * когда фото приходит (это и есть CLS – сдвиг макета, который меряет Google).
 *
 * PNG: ширина и высота лежат фиксированно в чанке IHDR.
 * JPEG: идём по маркерам сегментов до первого SOF (0xC0–0xCF, кроме 0xC4/C8/CC
 * – это таблицы Хаффмана и расширения, а не кадр).
 * Не разобрали – возвращаем null: лучше без атрибутов, чем с выдуманными.
 */
function imageSize(file) {
  let buf;
  try {
    buf = fs.readFileSync(file);
  } catch {
    return null;
  }
  if (buf.length > 24 && buf.toString('ascii', 12, 16) === 'IHDR') {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

function safeImagePath(p) {
  const image = typeof p.image === 'string' ? p.image.trim() : '';
  if (!/^images\/programs\/[a-z0-9_.-]+$/i.test(image)) return null;
  return fs.existsSync(path.join(ROOT, image)) ? image : null;
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
  // og:description на hse.ru – это обрезанное начало того же about (иногда
  // прямо на полуслове: «…а юрист – без понимани»). Показывать его жирным
  // лидом над полным текстом значит дублировать абзац и выставлять обрыв.
  // Лид выводится только когда он самостоятельный, а не префикс about.
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const taglineIsPrefix =
    p.tagline && p.about && norm(p.about).startsWith(norm(p.tagline).slice(0, 60));
  const lead =
    p.tagline && !taglineIsPrefix
      ? `        <p class="about-lead">${esc(p.tagline)}</p>\n`
      : '';
  // Склеенный из <li> источника текст возвращаем к виду списка;
  // связный абзац остаётся абзацем.
  const items = splitGluedAbout(p.about);
  const body = items
    ? `        <ul class="about-list">\n${items
        .map((x) => `          <li>${esc(x)}</li>`)
        .join('\n')}\n        </ul>\n`
    : p.about
      ? `        <p class="about-body">${esc(p.about)}</p>\n`
      : '';
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
        <h2>Кому подойдёт программа</h2>
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
    return slot('Преподаватели-практики', 'Состав преподавателей пока не заполнен. Заполняется полем teachers у программы – его подтягивает scripts/fetch-program-descriptions.js.');
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
        <h2>${p.teachers.length === 1 ? 'Преподаватель-практик' : 'Преподаватели-практики'}</h2>
        <ul class="teachers">
${items}
        </ul>
      </section>`;
}

function renderResults(p) {
  if (!p.results || !p.results.length) return '';
  const items = p.results.map((x) => `          <li>${esc(x)}</li>`).join('\n');
  return `      <section class="block">
        <h2>Чему вы научитесь</h2>
        <ul class="results">
${items}
        </ul>
      </section>`;
}

/**
 * Отзывы выпускников – настоящие цитаты с официальной страницы программы
 * на hse.ru (собирает scripts/fetch-program-descriptions.js, поле feedback).
 * Приводится дословно и целиком: усечённая или «улучшенная» цитата – уже
 * не цитата. Без отзывов секции нет вовсе – пустой блок или заглушка
 * читались бы как «выпускников нет», а не как «данные не собраны».
 */
function renderFeedback(p) {
  if (!p.feedback || !p.feedback.length) return '';
  const items = p.feedback
    .map(
      (f) =>
        `          <li>
            <blockquote>${esc(f.text)}</blockquote>
            <p class="review-author">${esc(f.author)}</p>
          </li>`,
    )
    .join('\n');
  return `      <section class="block">
        <h2>Отзывы выпускников</h2>
        <p class="block-sub">С официальной страницы программы на hse.ru</p>
        <ul class="reviews">
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
        <h2>Другие программы направления «${esc(sphere.title)}»</h2>
        <p class="block-sub">${esc(pluralPrograms(sphere.items.length))} в направлении</p>
        <ul class="siblings">
${links}
        </ul>
      </section>`;
}

/**
 * Короткое имя программы для <title>.
 *
 * Полное название плюс суффикс « · Центр ДПО факультета права НИУ ВШЭ»
 * (37 знаков) давало 22 заголовка из 26 длиннее 60 знаков, а самый длинный –
 * 168. Поисковик обрезает такой заголовок многоточием, и обрезается как раз
 * хвост с брендом: посетитель видит название без «НИУ ВШЭ», то есть теряется
 * ровно то, ради чего суффикс и ставился.
 *
 * Режем по первому двоеточию, слэшу или скобке: у названий с hse.ru до них
 * стоит суть, после – уточнение или перевод («Право на английском / Legal
 * English», «Нейроправо», «Правовые вопросы банкротства: теории и практики»).
 * Если сути одной не хватило и вышло короче 12 знаков, оставляем как было –
 * лучше длинный заголовок, чем бессмысленный огрызок.
 */
const TITLE_SUFFIX_LEN = ' · ДПО НИУ ВШЭ'.length; // 14
const TITLE_BUDGET = 64 - TITLE_SUFFIX_LEN;        // 50 знаков на имя

/**
 * Короткие имена для программ, которые машинно не сокращаются.
 *
 * Алгоритм ниже режет по границе слова, и для большинства названий этого
 * достаточно. Но у четырёх программ смысл стоит в конце названия либо в
 * скобках, и любой автоматический рез даёт бессмыслицу: «Актуальные вопросы
 * налогового ·», «Правовые механизмы и стратегии эффективного ·». Поэтому
 * для них имя задано руками.
 *
 * Ключ – id программы. Если программы в карте нет, работает алгоритм; если
 * программа исчезнет из каталога, лишняя строка здесь ничего не сломает.
 */
const TITLE_OVERRIDE = Object.freeze({
  // «…налогового администрирования и современные подходы в налоговой оптимизации бизнеса»
  '1129129055': 'Налоговое администрирование и оптимизация',
  // «Правовые механизмы и стратегии эффективного взаимодействия фармацевтических
  //  компаний с органами государственной власти (GR в фарме)» – суть в скобках
  '1163275658': 'GR в фарме: работа с органами власти',
  // «Техники эффективного анализа юридических документов»
  '820703080': 'Анализ юридических документов',
  // «Безопасное внедрение цифровых инструментов в кадровую работу: юридические требования»
  '1129129056': 'Цифровые инструменты в кадровой работе',
});

/**
 * Окончания прилагательных. Заголовок, оборванный на прилагательном, читается
 * как оборванный сильнее, чем оборванный на существительном: по-русски
 * определение стоит перед определяемым словом, и без него фраза повисает.
 */
const TITLE_ADJ_TAIL = /(ого|его|ых|их|ый|ий|ой|ая|яя|ое|ее|ые|ому|ему|ыми|ими|ую|юю|ов|ев)$/i;

/** Служебные слова: заголовок, оборванный на них, читается как недописанный. */
const TITLE_STOP_TAIL = new Set([
  'и', 'а', 'но', 'или', 'в', 'во', 'на', 'с', 'со', 'к', 'ко', 'по', 'о', 'об', 'от',
  'для', 'при', 'из', 'у', 'за', 'до', 'под', 'над', 'про', 'без', 'через',
]);

function titleCore(p) {
  const override = TITLE_OVERRIDE[String(p.id || '')];
  if (override) return override;

  const full = String(p.title || '').trim();

  // Шаг 1. Режем по первому двоеточию, слэшу или скобке: у названий с hse.ru
  // до них стоит суть, после – уточнение или перевод.
  let cut = full.split(/\s*[:\/(]/)[0].trim();
  if (cut.length < 12) cut = full;
  if (cut.length <= TITLE_BUDGET) return cut;

  // Шаг 2. Двоеточия не было (или суть сама длинная) – режем по границе слова.
  // Обрыв на предлоге или союзе выглядит как обрезанный текст, поэтому такие
  // хвосты снимаем: «Актуальные вопросы налогового администрирования и» ->
  // «Актуальные вопросы налогового администрирования».
  const words = cut.split(/\s+/);
  const kept = [];
  for (const w of words) {
    if (kept.length && [...kept, w].join(' ').length > TITLE_BUDGET) break;
    kept.push(w);
  }
  const bare = (w) => w.toLowerCase().replace(/[^а-яёa-z]/gi, '');
  // Снимаем служебные слова и висящие прилагательные с хвоста.
  while (kept.length > 1) {
    const last = bare(kept[kept.length - 1]);
    if (TITLE_STOP_TAIL.has(last) || (TITLE_ADJ_TAIL.test(last) && last.length > 4)) kept.pop();
    else break;
  }
  // Хвостовая пунктуация: рез по словам оставляет одинокие «/», «-», запятые.
  const short = kept.join(' ').replace(/[\s,;:.\/–-]+$/, '');
  // Меньше трёх слов – огрызок теряет смысл, лучше длинный честный заголовок.
  return kept.length >= 3 ? short : cut;
}

const DOC_SHORT = Object.freeze({
  'ПК': 'Удостоверение НИУ ВШЭ',
  'ПП': 'Диплом о профессиональной переподготовке НИУ ВШЭ',
});

/**
 * Описание для сниппета – из фактов программы, а не по общему шаблону.
 *
 * Было: «<Название> – <тип> в Центре ДПО факультета права НИУ ВШЭ.» –
 * одинаково у всех 26 страниц, ни одного факта, и 19 описаний короче 120
 * знаков. Поисковик такое описание игнорирует и собирает сниппет сам.
 *
 * Стало: тип, формат, дата старта, цена, документ. Это ровно те четыре
 * вопроса, с которыми человек приходит из выдачи. Порядок не случаен: то,
 * что важнее, стоит раньше, потому что хвост обрезается.
 *
 * Обрезка – по границе слова до 158 знаков (Google показывает ~160,
 * Яндекс меньше; обрыв на середине слова выглядит как ошибка).
 */
function metaDescription(p) {
  const short = p.type?.shortTitle || p.type?.title || '';
  const kind = short === 'ПК' ? 'повышение квалификации'
    : short === 'ПП' ? 'профессиональная переподготовка'
    : 'программа ДПО';

  const tail = [];
  if (p.studyFormat?.title) tail.push(p.studyFormat.title);
  const date = formatDate(p);
  if (date) tail.push(`старт ${date}`);
  const price = p.discountPrice ?? p.educationPricing;
  if (price != null && price > 0) tail.push(formatPrice(p));

  let out = `${p.title} – ${kind} в НИУ ВШЭ.`;
  if (tail.length) out += ` ${tail.join(', ')}.`;
  const doc = DOC_SHORT[short];
  if (doc) out += ` ${doc}.`;

  if (out.length <= 158) return out;
  const clipped = out.slice(0, 158);
  const lastSpace = clipped.lastIndexOf(' ');
  return (lastSpace > 100 ? clipped.slice(0, lastSpace) : clipped).replace(/[\s,.–-]+$/, '') + '…';
}

const COURSE_MODE_BY_FORMAT = Object.freeze({
  'Онлайн': 'online',
  'Онлайн синхронный': 'online',
  'Онлайн асинхронный': 'online',
  'Очный': 'onsite',
  'Смешанный': 'blended',
  'Гибридный': 'blended',
});

/**
 * Микроразметка страницы программы: Course + BreadcrumbList.
 *
 * До этого на 26 страницах программ не было ld+json вообще, а единственный
 * Course лежал в каталоге и указывал url на hse.ru – то есть сайт описывал
 * курсы и тут же сообщал поисковику, что настоящая страница курса на чужом
 * домене. Здесь url – свой, а ссылка на маркетплейс уходит в sameAs, для
 * чего это поле и предназначено.
 *
 * Пустые поля не выдумываем: нет цены – нет offers, нет даты – нет
 * hasCourseInstance. Разметка с придуманными данными хуже отсутствующей:
 * за расхождение с видимым текстом страницы Google снимает сниппет целиком.
 *
 * Экранируем «<» как < – тем же приёмом, что update-catalog.js: внутри
 * <script> опасна только последовательность «</script».
 */
function structuredData(p, sphere, official) {
  const short = p.type?.shortTitle || p.type?.title || '';
  const href = programHref(p);

  const course = {
    '@context': 'https://schema.org',
    '@type': 'Course',
    name: p.title,
    description: metaDescription(p),
    url: `${SITE}/${href}`,
    inLanguage: 'ru',
    provider: {
      '@type': 'CollegeOrUniversity',
      name: 'НИУ ВШЭ, факультет права',
      sameAs: 'https://pravo.hse.ru/',
    },
  };
  if (official) course.sameAs = official;

  const credential = DOC_BY_TYPE[short];
  if (credential) {
    course.educationalCredentialAwarded = credential.name;
  }

  const instance = { '@type': 'CourseInstance' };
  const mode = COURSE_MODE_BY_FORMAT[String(p.studyFormat?.title || '').trim()];
  if (mode) instance.courseMode = mode;
  const iso = isoDate(p.startDate);
  if (iso) instance.startDate = iso;
  if (instance.courseMode || instance.startDate) course.hasCourseInstance = instance;

  const price = p.discountPrice ?? p.educationPricing;
  if (price != null) {
    course.offers = {
      '@type': 'Offer',
      price: String(price),
      priceCurrency: 'RUB',
      category: price === 0 ? 'Free' : 'Paid',
      url: `${SITE}/${href}`,
    };
  }

  const crumbs = [
    { '@type': 'ListItem', position: 1, name: 'Каталог программ', item: `${SITE}/catalog` },
  ];
  if (sphere) {
    crumbs.push({
      '@type': 'ListItem', position: 2, name: sphere.title,
      item: `${SITE}/catalog?sphere=${sphere.id}`,
    });
  }
  crumbs.push({ '@type': 'ListItem', position: crumbs.length + 1, name: p.title });

  const breadcrumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs,
  };

  const json = (o) => JSON.stringify(o).replace(/</g, '\\u003c');
  return `<script type="application/ld+json">${json(course)}</script>\n` +
    `<script type="application/ld+json">${json(breadcrumbs)}</script>`;
}

function renderPage(rawProgram, sphere) {
  // Тексты чистятся здесь, при генерации; хранилище остаётся как есть.
  const p = normalizeProgram(rawProgram);
  const official = safeUrl(p.url);
  const short = p.type?.shortTitle || '';
  const doc = DOC_BY_TYPE[short];
  const metaBits = [typeLabel(p), p.studyFormat?.title, p.duration]
    .filter(Boolean)
    .map((s) => `<span>${esc(s)}</span>`)
    .join('');

  // Обложка программы (см. fetch-program-media.js) под синей вуалью по
  // «правилу вуали» DESIGN.md: текст поверх фото лежит только под слоями
  // darken(accent). Без loading="lazy": это первый экран.
  //
  // Обложка – <img>, а не CSS-фон, как было раньше. Причина: фоновое
  // изображение не индексируется поиском по картинкам и не может иметь alt,
  // то есть 25 обложек программ были невидимы и для Яндекс.Картинок, и для
  // скринридера. Визуально ничего не меняется: object-fit: cover повторяет
  // background-size: cover, object-position – background-position.
  //
  // srcset вместо image-set: миниатюра для 1x, полная обложка для 2x. Явные
  // width/height берутся у файла и нужны против сдвига макета (CLS).
  //
  // ВАЖНО: режим для слабовидящих гасил фон правилом background-image: none,
  // на <img> оно не действует. Поэтому в programs/program.css добавлено
  // отдельное правило html.vi-mode .hero-bg{display:none}.
  const image = safeImagePath(p);
  let heroMedia = '';
  if (image) {
    const thumbRel = `images/programs/thumbs/${String(p.id)}.jpg`;
    const hasThumb = fs.existsSync(path.join(ROOT, thumbRel));
    const srcRel = hasThumb ? thumbRel : image;
    const srcset = hasThumb
      ? ` srcset="../${esc(thumbRel)} 1x, ../${esc(image)} 2x"`
      : '';
    const size = imageSize(path.join(ROOT, srcRel));
    const dims = size ? ` width="${size.w}" height="${size.h}"` : '';
    // alt описывает картинку, а не запрос: набивать сюда ключи нельзя –
    // незрячий человек услышит рекламу вместо подписи, а поисковик получит
    // сигнал переспама на странице, где ключ и так есть в h1 и в title.
    const alt = `Обложка программы «${p.title}»`;
    heroMedia =
      `  <img class="hero-bg" src="../${esc(srcRel)}"${srcset}${dims} alt="${esc(alt)}" decoding="async">\n` +
      '  <div class="hero-veil" aria-hidden="true"></div>';
  }

  // Заявка подаётся ЗДЕСЬ, а не на маркетплейсе: человек, дочитавший
  // страницу программы, уже решился, и увод на чужой сайт в этот момент —
  // самая дорогая потеря на всём пути. Второй, вторичной кнопкой стоит
  // оплата на hse.ru: у программ маркетплейса (числовой id) она ведёт по
  // персональной корзинной ссылке ЛК – осознанный внешний переход.
  // Для программ без числового id (ручные записи админки) корзины на
  // маркетплейсе нет – остаётся прежняя ссылка на официальную страницу.
  const description = metaDescription(p);
  const ogImage = image ? `\n<meta property="og:image" content="${esc(SITE)}/${esc(image)}">` : '';
  const twImage = image ? `\n<meta name="twitter:image" content="${esc(SITE)}/${esc(image)}">` : '';

  const payUrl = /^\d+$/.test(String(p.id || '')) ? buildPayUrl(String(p.id)) : null;
  const secondary = payUrl
    ? `
        <a class="cta-pay" href="${esc(payUrl)}" target="_blank" rel="noopener">Оплатить на hse.ru</a>
        <p class="cta-pay-note">Запись и оплата – в личном кабинете hse.ru</p>`
    : official
      ? `
        <a class="cta-alt" href="${esc(official)}" target="_blank" rel="noopener noreferrer">Записаться через личный кабинет на hse.ru</a>`
      : '';
  const cta = `        <button type="button" class="cta" data-application
          data-program-id="${esc(String(p.id || ''))}"
          data-program-title="${esc(p.title)}"
          data-program-url="${esc(SITE)}/${esc(programHref(p))}">Подать заявку</button>
        <p class="cta-note">Заявку принимает учебный офис Центра ДПО. Мы свяжемся с вами по телефону или почте.</p>${secondary}`;

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titleCore(p))} · ДПО НИУ ВШЭ</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="${esc(SITE)}/${esc(programHref(p))}">
<meta property="og:type" content="website">
<meta property="og:locale" content="ru_RU">
<meta property="og:site_name" content="Центр ДПО · Факультет права НИУ ВШЭ">
<meta property="og:title" content="${esc(p.title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(SITE)}/${esc(programHref(p))}">${ogImage}
<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${esc(p.title)}">
<meta name="twitter:description" content="${esc(description)}">${twImage}
${structuredData(p, sphere, official)}
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
    <nav class="header-nav" aria-label="Разделы сайта">
      <a class="nav-link" href="../Каталог программ.html">Программы</a>
    </nav>
    <button id="viToggle" class="vi-btn" type="button" aria-pressed="false" title="Версия для слабовидящих">Версия для слабовидящих</button>
  </span>
</header>

${heroMedia ? `<section class="hero hero--photo">
${heroMedia}` : '<section class="hero">'}
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
${renderFeedback(p)}
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

<!-- Липкая полоса с ценой (аудит 18.08: цена и кнопка лежали в медиане на
     4,6 экрана вглубь при 375px – карточка цены на телефоне стоит ПОД всем
     содержимым). Видна только при одноколоночной раскладке (<=900px); кнопка –
     дубль той же формы через data-application, без правок JS. -->
<div class="buy-bar" role="region" aria-label="Цена и заявка">
  <span class="buy-bar-price">${esc(formatPrice(p))}</span>
  <button type="button" class="cta buy-bar-cta" data-application
    data-program-id="${esc(String(p.id || ''))}"
    data-program-title="${esc(p.title)}"
    data-program-url="${esc(SITE)}/${esc(programHref(p))}">Подать заявку</button>
</div>

<footer>
  <span>Центр дополнительного профессионального образования · Факультет права НИУ ВШЭ</span>
  <span class="footer-links">
    <a href="../privacy.html">Политика обработки персональных данных</a>
    <a href="https://www.hse.ru/sveden/" rel="noopener">Сведения об образовательной организации</a>
  </span>
</footer>

<script src="../js/application-form.js" defer></script>
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
  const indexed = writeProgramIndex(programs, spheres);

  console.log(
    `Страниц программ: ${programs.length}, удалено устаревших: ${removed}, ` +
      `карта сайта: ${mapped ? 'обновлена' : 'маркеры не найдены'}, ` +
      `справочник для формы: ${indexed} записей`,
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
:root {
  /* Цветовые токены: единый словарь всех страниц, описан в DESIGN.md.
     --surface, --ink и --accent заданы каналами, поэтому одна переменная
     закрывает и сплошной цвет rgb(var(--ink)), и любую прозрачность
     rgb(var(--ink) / .1). Новый цвет вводится только новым токеном. */
  --bg:       #FBF9F5;      /* фон страницы */
  --bg-tint:  #F2ECE1;      /* секции, плашки */
  --surface:  255 255 255;  /* карточки, шапка, текст на тёмном */
  --ink:      33 30 27;     /* основной текст, линии, тени */
  --ink-soft: #48423A;      /* навигация, факты */
  --ink-mute: #6B6459;      /* подписи, мета */
  --accent:   22 88 218;    /* синий ВШЭ: кнопки, ссылки, фокус */
  --accent-dark: #1145AA;   /* ховер кнопок, = darken(accent, 0.22) */
  --gold-light:  #FFD982;   /* тёплый выделитель поверх синей заливки */
  --line:     rgb(var(--ink) / .1);
  --gutter:clamp(20px,5vw,56px);
  --ease:cubic-bezier(.22,1,.36,1);
}
*{box-sizing:border-box}
@media (prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}}
body{margin:0;background:var(--bg);color:rgb(var(--ink));
  font-family:'HSE Sans','IBM Plex Sans',-apple-system,sans-serif}
a{color:inherit;text-decoration:none}
h1,h2{font-family:'HSE Slab','Source Serif 4',Georgia,serif;margin:0}

/* Фокус: тонкий контур для контраста плюс мягкое кольцо системы. */
a:focus-visible,button:focus-visible{outline:2px solid rgb(var(--accent));outline-offset:1px;
  box-shadow:0 0 0 3px rgb(var(--accent) / .18)}

.skip-link{position:absolute;left:-9999px;top:0;z-index:10001;background:rgb(var(--surface));color:rgb(var(--accent));
  font:600 15px/1.4 'HSE Sans','IBM Plex Sans',sans-serif;padding:12px 20px;border-radius:0 0 10px 0;
  box-shadow:0 4px 18px rgba(0,0,0,.22);text-decoration:underline}
.skip-link:focus{left:0}

header{position:sticky;top:0;z-index:20;display:flex;align-items:center;justify-content:space-between;
  gap:16px;padding:16px var(--gutter);background:rgba(251,249,245,0.9);backdrop-filter:blur(10px);
  border-bottom:1px solid var(--line)}
.logo{display:flex;flex-direction:column;gap:1px}
.logo .name{font-weight:700;font-size:15px;color:rgb(var(--accent))}
.logo .sub{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-mute)}
.header-side{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.header-nav{display:flex;align-items:center;gap:14px}
.nav-link{font-size:14px;font-weight:600;color:rgb(var(--accent))}
.nav-link:hover{text-decoration:underline}
.vi-btn{font:inherit;font-size:13px;font-weight:600;cursor:pointer;color:var(--ink-soft);
  background:transparent;border:1px solid rgb(var(--ink) / .25);border-radius:999px;padding:8px 14px;
  min-height:44px; /* мишень касания, WCAG 2.5.5 */
  white-space:nowrap;transition:color .28s var(--ease),border-color .28s var(--ease)}
.vi-btn:hover{border-color:rgb(var(--accent));color:rgb(var(--accent))}

.hero{background:linear-gradient(160deg,rgb(var(--accent)) 0%,var(--accent-dark) 100%);color:rgb(var(--surface));
  padding:clamp(32px,5vw,56px) var(--gutter) clamp(36px,6vw,64px)}
/* Герой с обложкой программы. Стопка: градиент героя (фолбэк) -> фото ->
   вуаль -> текст. isolation держит отрицательные z-index внутри секции.
   Вуаль – по «правилу вуали» DESIGN.md: те же тона darken(accent), что у
   героя лендинга, но плотнее (0.80/0.84/0.90 против 0.72/0.80/0.93):
   белый h1 здесь идёт по всей ширине кадра, включая самые светлые участки
   обложек. Замер по пикселям (см. отчёт сборки): самый светлый пиксель под
   заголовком даёт контраст с rgb(var(--surface)) не ниже 4.5:1. */
.hero--photo{position:relative;isolation:isolate}
.hero-bg{position:absolute;inset:0;z-index:-2;width:100%;height:100%;
  object-fit:cover;object-position:center 30%}
.hero-veil{position:absolute;inset:0;z-index:-1;background:linear-gradient(180deg,
  rgba(11,42,105,.80) 0%,rgba(8,33,83,.84) 55%,rgba(6,23,57,.90) 100%)}
.crumbs{font-size:13px;color:rgb(var(--surface) / .88);display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px}
.crumbs a{text-decoration:underline}
.hero h1{font-weight:600;font-size:clamp(28px,3.2vw,42px);line-height:1.15;max-width:20ch;
  max-width:900px;text-wrap:balance}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:20px}
.chips span{font-size:13px;background:rgb(var(--surface) / .14);border-radius:999px;padding:8px 16px}

.layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,340px);
  gap:clamp(28px,4vw,56px);padding:clamp(32px,5vw,64px) var(--gutter) clamp(56px,8vw,96px);
  align-items:start}
@media (max-width:900px){.layout{grid-template-columns:minmax(0,1fr)}}

.block{margin-bottom:clamp(28px,4vw,48px)}
.block h2{font-size:clamp(21px,2.2vw,28px);font-weight:600;margin-bottom:12px}
.block-sub{font-size:13.5px;color:var(--ink-mute);margin:0 0 16px}
.about-lead{font-size:17px;line-height:1.6;font-weight:600;color:rgb(var(--ink));margin:0 0 14px}
.about-body{font-size:15.5px;line-height:1.7;color:var(--ink-soft);margin:0 0 14px}
/* about, склеенный источником из <li>, возвращаем к виду списка. */
.about-list{list-style:none;margin:0 0 14px;padding:0}
.about-list li{position:relative;font-size:15.5px;line-height:1.6;color:var(--ink-soft);
  padding:10px 0 10px 22px;border-top:1px solid var(--line)}
/* Точка нарисована бордером, а не фоном: в режиме для слабовидящих фоны
   обнуляются, и маркер на background там бы исчез. */
.about-list li::before{content:"";position:absolute;left:2px;top:19px;width:0;height:0;
  border:3px solid rgb(var(--accent));border-radius:999px}
.about-source{font-size:13px;color:var(--ink-mute);margin:0}
/* Мера строки: длинные текстовые блоки держим около 72ch, сетка колонок
   при этом не меняется – ограничивается только ширина самого текста. */
.about-lead,.about-body,.about-list li,.block-sub,.block-note,.slot,
.results li,.modules li,.teachers li,.siblings a{max-width:72ch}
.slot{font-size:15.5px;line-height:1.6;color:var(--ink-mute);background:var(--bg-tint);
  border:1px dashed rgb(var(--ink) / .25);border-radius:16px;padding:20px;margin:0}
.pills{list-style:none;display:flex;flex-wrap:wrap;gap:10px;margin:0;padding:0}
.pills li{font-size:14.5px;line-height:1.4;color:var(--ink-soft);background:var(--bg-tint);
  border-radius:999px;padding:10px 18px}
.results{list-style:none;margin:0;padding:0;display:grid;gap:2px}
.results li{position:relative;font-size:15.5px;line-height:1.6;color:var(--ink-soft);
  padding:14px 0 14px 34px;border-top:1px solid var(--line)}
/* Галочка нарисована фоном, а не символом: в режиме для слабовидящих
   svg скрывается, а псевдоэлемент с текстом остаётся читаемым. */
.results li::before{content:"";position:absolute;left:8px;top:19px;width:7px;height:12px;
  border-right:2px solid rgb(var(--accent));border-bottom:2px solid rgb(var(--accent));
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
.reviews{list-style:none;margin:0;padding:0;display:grid;gap:14px}
.reviews li{background:rgb(var(--surface));border:1px solid var(--line);border-radius:16px;
  padding:20px 22px;max-width:72ch}
.reviews blockquote{margin:0;font-size:15px;line-height:1.65;color:var(--ink-soft)}
.reviews blockquote::before{content:"« "}
.reviews blockquote::after{content:" »"}
.review-author{margin:12px 0 0;font-size:13.5px;font-weight:600;color:rgb(var(--ink))}
.teacher-name{font-size:16px;font-weight:600;margin:0 0 4px;color:rgb(var(--ink))}
.teacher-about{font-size:14.5px;line-height:1.55;color:var(--ink-soft);margin:0}

@media (max-width:520px){
  .modules li{grid-template-columns:22px minmax(0,1fr);gap:2px 10px}
  .module-hours{grid-column:2}
}

.siblings{list-style:none;margin:0;padding:0}
.siblings li{border-top:1px solid var(--line)}
/* Ссылки на соседние программы выглядят ссылками: цвет акцента и
   проявляющееся подчёркивание по системной кривой. */
.siblings a{display:block;padding:14px 0;font-size:14.5px;line-height:1.5;color:rgb(var(--accent));
  text-decoration:underline;text-decoration-color:transparent;text-underline-offset:3px;
  transition:color .28s var(--ease),text-decoration-color .28s var(--ease)}
.siblings a:hover{color:var(--accent-dark);text-decoration-color:currentColor}

.side{position:sticky;top:96px;display:flex;flex-direction:column;gap:16px}
@media (max-width:900px){.side{position:static}}
.card{background:rgb(var(--surface));border:1px solid var(--line);border-radius:24px;padding:26px}
.price{font-size:clamp(22px,2vw,30px);font-weight:700;font-family:'HSE Slab','Source Serif 4',serif;
  margin-bottom:18px}
.facts{margin:0 0 20px}
.fact{display:flex;justify-content:space-between;gap:12px;padding:10px 0;
  border-top:1px solid var(--line)}
.fact dt{font-size:13px;color:var(--ink-mute);margin:0}
.fact dd{font-size:14.5px;font-weight:600;margin:0;text-align:right}
.cta{display:block;width:100%;font:inherit;border:0;cursor:pointer;text-align:center;font-size:15px;font-weight:600;color:rgb(var(--surface));
  background:rgb(var(--accent));border-radius:999px;padding:15px 24px;
  transition:background .28s var(--ease),transform 140ms ease}
.cta:hover{background:var(--accent-dark)}
.cta:active{transform:scale(.97)}
.cta-note{font-size:13px;line-height:1.5;color:var(--ink-mute);margin:12px 0 0;text-align:center}
.cta-alt{display:block;text-align:center;font-size:14px;color:var(--ink-mute);margin:14px 0 0;
  text-decoration:underline;text-underline-offset:3px}
.cta-alt:hover{color:rgb(var(--accent))}
/* Вторичная кнопка оплаты: контур в акцент, не спорит с primary.
   Hover только у настоящего курсора – на тач-экране :hover залипает. */
.cta-pay{display:block;text-align:center;font-size:15px;font-weight:600;color:rgb(var(--accent));
  background:transparent;border:1.5px solid rgb(var(--accent));border-radius:999px;
  padding:13px 24px;margin:12px 0 0;transition:background .28s var(--ease),color .28s var(--ease)}
@media (hover:hover) and (pointer:fine){.cta-pay:hover{background:rgb(var(--accent));color:rgb(var(--surface))}}
.cta-pay-note{font-size:13px;line-height:1.5;color:var(--ink-mute);margin:8px 0 0;text-align:center}
/* Липкая полоса с ценой: только при одноколоночной раскладке (<=900px),
   на десктопе цену показывает липкая боковая карточка. Словарь полосы – тот
   же, что у мобильной панели лендинга (js/smooth-ui.js). */
.buy-bar{display:none}
@media (max-width:900px){
  .buy-bar{position:fixed;left:12px;right:12px;bottom:12px;z-index:60;
    display:flex;align-items:center;gap:12px;padding:10px 12px 10px 18px;
    background:rgba(251,249,245,.94);backdrop-filter:blur(12px);
    border:1px solid rgb(var(--ink) / .1);border-radius:18px;
    box-shadow:0 12px 40px rgb(var(--ink) / .16)}
  .buy-bar-price{font-family:'HSE Slab','Source Serif 4',serif;font-weight:700;
    font-size:17px;white-space:nowrap}
  .buy-bar .cta{flex:1;min-height:44px;padding:12px 18px}
  body{padding-bottom:84px}
}
/* В режиме для слабовидящих фиксированные панели скрываются – как на лендинге. */
html.vi-mode .buy-bar{display:none !important}
.doc{background:var(--bg-tint)}
.doc-tag{display:inline-block;font-size:12.5px;font-weight:700;color:rgb(var(--surface));background:rgb(var(--accent));
  border-radius:999px;padding:4px 11px;margin-bottom:12px}
.doc h2{font-size:19px;font-weight:600;margin-bottom:8px}
.doc p{font-size:14.5px;line-height:1.55;color:var(--ink-soft);margin:0}
.doc-note{font-size:13px;color:var(--ink-mute);margin-top:10px}

footer{padding:28px var(--gutter);border-top:1px solid var(--line);display:flex;flex-wrap:wrap;
  align-items:center;justify-content:space-between;gap:12px;font-size:13px;color:var(--ink-mute)}
.footer-links{display:flex;gap:18px;flex-wrap:wrap}
.footer-links a{color:rgb(var(--accent))}

/* Версия для слабовидящих (ГОСТ Р 52872-2019) */
html.vi-mode body{zoom:1.25;background:rgb(var(--surface)) !important}
html.vi-mode *{background:transparent !important;background-image:none !important;color:#000 !important;
  box-shadow:none !important;text-shadow:none !important;animation:none !important;transition:none !important}
/* Обложка героя – <img>, а не фон, поэтому общее правило выше
   (background-image:none) её не гасит. Без этой строки в режиме для
   слабовидящих фото осталось бы на месте, а текст поверх него стал бы
   чёрным по фотографии – ровно та нечитаемость, ради устранения которой
   режим и включают. */
html.vi-mode .hero-bg{display:none !important}
html.vi-mode a{text-decoration:underline !important}
html.vi-mode .card,html.vi-mode .slot,html.vi-mode .cta,html.vi-mode .cta-pay,html.vi-mode .vi-btn{border:2px solid #000 !important}
/* Правило * выше гасит box-shadow обычного фокуса – возвращаем индикатор
   (ГОСТ Р 52872-2019, WCAG 2.4.7); правило из каталога, дословно. */
html.vi-mode :focus-visible{outline:3px solid #000 !important;outline-offset:2px}
`;

if (require.main === module) build();

module.exports = { build, renderPage, safeUrl, slugifyHref: programHref, buildPayUrl };
