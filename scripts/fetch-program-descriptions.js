#!/usr/bin/env node
/**
 * Подтягивает данные программ со страниц hse.ru в .catalog-data.json.
 *
 *   node scripts/fetch-program-descriptions.js            # только пустые
 *   node scripts/fetch-program-descriptions.js --all      # перезаписать все
 *
 * Источник описаний: сама страница программы. В выдаче каталога hse.ru их
 * нет, поэтому приходится обходить страницы поштучно.
 *
 * Берём два поля:
 *   tagline — из og:description, одна короткая строка («Научитесь …»);
 *   about   — из микроразметки JSON-LD Course, развёрнутый текст.
 * Микроразметка предпочтительнее вытаскивания текста из вёрстки: она
 * структурная и не поедет от смены шаблона hse.ru.
 *
 * Запросы идут последовательно с паузой: это чужой сайт, и обходить его
 * двадцатью шестью параллельными запросами невежливо.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const STORE = path.join(__dirname, '..', '.catalog-data.json');
const DELAY_MS = 700;
const TIMEOUT_MS = 15000;
const UA = 'Mozilla/5.0 (compatible; dpo-pravo-hse/1.0; +https://pravo.hse.ru/dpo)';

/** Ходим только на hse.ru: тот же контракт, что у остальных загрузчиков. */
function assertHseUrl(url) {
  const u = new URL(String(url));
  if (u.protocol !== 'https:') throw new Error('только https');
  if (u.hostname !== 'hse.ru' && !u.hostname.endsWith('.hse.ru')) {
    throw new Error('только hse.ru: ' + u.hostname);
  }
  return u.toString();
}

/**
 * Сущности HTML в текстах hse.ru. Таблица длиннее очевидного набора: на
 * французских и китайских программах приходят диакритика и типографские
 * кавычки (&eacute;, &agrave;, &rsquo;, &oelig; – 32, 16, 5 и 1 раз в
 * каталоге). Не декодированная сущность потом экранируется при выводе и
 * попадает на страницу видимым «&eacute;» – это ловил тест
 * program-pages-clean 09.09.2026.
 *
 * Числовые формы (&#233; и &#xE9;) декодируются общим правилом: перечислять
 * их бессмысленно, а источник смешивает обе записи.
 */
const NAMED_ENTITIES = Object.freeze({
  laquo: '«', raquo: '»', ndash: '–', mdash: '–', quot: '"', apos: "'",
  lt: '<', gt: '>', nbsp: ' ', amp: '&', hellip: '…', middot: '·',
  rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', rarr: '→', larr: '←',
  eacute: 'é', Eacute: 'É', egrave: 'è', Egrave: 'È', ecirc: 'ê', Ecirc: 'Ê',
  agrave: 'à', Agrave: 'À', acirc: 'â', ccedil: 'ç', Ccedil: 'Ç',
  icirc: 'î', iuml: 'ï', ocirc: 'ô', ugrave: 'ù', ucirc: 'û', uuml: 'ü',
  oelig: 'œ', OElig: 'Œ', deg: '°', euro: '€', copy: '©', reg: '®', trade: '™',
});

const decodeEntities = (s) =>
  String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    // Именованные – одним проходом и в конце: иначе «&amp;eacute;» из
    // источника превратился бы в «é» вместо видимого «&eacute;».
    .replace(/&([a-zA-Z]+);/g, (whole, name) =>
      Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : whole);

/**
 * Текст из куска разметки: снимаем теги, схлопываем пробелы.
 * Кавычки и скобки чистим отдельно: снятие тегов оставляет пробел на месте
 * каждого тега, и «<b>Право</b>» превращается в «« Право »» с дырами внутри.
 */
const textOf = (chunk) =>
  decodeEntities(String(chunk).replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .replace(/«\s+/g, '«')
    .replace(/\s+»/g, '»')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/\s+([,.;:!?])/g, '$1')
    // Декоративные стрелки. На hse.ru ими помечены ссылки «подробнее», и в
    // вырезанном тексте они остаются висеть в конце фразы без назначения.
    .replace(/[\u2190-\u21FF\u2794-\u27BF\u2B00-\u2BFF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Вырезает <section> с указанным классом целиком. */
function sectionByClass(html, cls) {
  const at = html.indexOf('dpo-section ' + cls);
  if (at < 0) return null;
  const from = html.lastIndexOf('<section', at);
  const to = html.indexOf('</section>', at);
  if (from < 0 || to < 0) return null;
  return html.slice(from, to);
}

/**
 * «Для кого»: подзаголовок плюс список аудиторий.
 * Разбор идёт по классам разметки, а не по тексту заголовка: класс переживёт
 * смену формулировки, а «Для кого» встречается ещё и в оглавлении страницы.
 */
function extractAudience(html) {
  const sec = sectionByClass(html, 'dpo-target');
  if (!sec) return { intro: null, items: [] };
  const introRaw = sec.match(/class="[^"]*dpo-target__subtitle[^"]*"[^>]*>([\s\S]*?)<\/p>/);
  const items = [...sec.matchAll(/class="[^"]*dpo-target__feature[^"]*"[^>]*>([\s\S]*?)<\/p>/g)]
    .map((m) => textOf(m[1]))
    .filter(Boolean);
  return { intro: introRaw ? textOf(introRaw[1]) || null : null, items };
}

/**
 * «Результаты»: карточки вида «Изучите» + «цифровые платформы бизнеса».
 * Последняя карточка на странице оформлена так же, но содержит кнопки
 * «Подать заявку» и дублирует og:description, поэтому отбрасывается.
 */
function extractResults(html) {
  const sec = sectionByClass(html, 'dpo-result');
  if (!sec) return [];
  const out = [];
  for (const m of sec.matchAll(/<li[^>]*class="[^"]*dpo-cards__item[^"]*"[^>]*>([\s\S]*?)<\/li>/g)) {
    const card = m[1];
    if (/dpo-cards__buttons|dpo-cards__item_large|_large/.test(m[0])) continue;
    const title = card.match(/class="[^"]*dpo-cards__title[^"]*"[^>]*>([\s\S]*?)<\/[a-z0-9]+>/i);
    const body = card.match(/class="[^"]*dpo-cards__text[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const text = [title ? textOf(title[1]) : '', body ? textOf(body[1]) : ''].filter(Boolean).join(' ');
    if (text) out.push(text);
  }
  return out;
}

/**
 * Учебный план из секции «Программа обучения» (`dpo-program`).
 * Модуль – заголовок плюс объём часов, лежащие соседними узлами карточки.
 * Номер («1. ») из заголовка снимаем: порядок несёт сам список, а
 * дублировать его цифрой в тексте значило бы получить «1. 1. Профессия».
 */
function extractModules(html) {
  const sec = sectionByClass(html, 'dpo-program');
  if (!sec) return [];
  const out = [];
  // Карточки режем ПО ГРАНИЦАМ, а не до первого </li>: внутри карточки
  // лежит список подтем, и его первый же </li> обрывал бы разбор на
  // середине модуля (поймано тестом на живой странице).
  const cards = sec.split(/<li[^>]*class="[^"]*dpo-program__li[^"]*"[^>]*>/).slice(1);
  for (const card of cards) {
    const title = card.match(/class="[^"]*dpo-program__caption-title[^"]*"[^>]*>([\s\S]*?)<\/[a-z0-9]+>/i);
    const badge = card.match(/class="[^"]*dpo-program__badge[^"]*"[^>]*>([\s\S]*?)<\/[a-z0-9]+>/i);
    const name = title ? textOf(title[1]).replace(/^\d+[.)]\s*/, '') : '';
    if (!name) continue;
    out.push({ title: name, hours: badge ? textOf(badge[1]) : null, topics: moduleTopics(card) });
  }
  return out;
}

/**
 * Подтемы модуля: раскрывающийся список внутри карточки
 * (`dpo-program__content`). Их 880 на 19 программах из 26, и до 09.09.2026
 * мы их не забирали вовсе – учебный план на наших страницах был вдвое
 * беднее оригинала.
 *
 * Тем же аккордеоном на трёх страницах свёрстаны вопросы и ответы
 * («В каком формате организованы занятия?»). Разбор их не отличает и не
 * должен: для страницы это такой же пункт плана, каким его сделал центр.
 */
function moduleTopics(card) {
  const box = card.match(/class="[^"]*dpo-program__content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  if (!box) return [];
  return [...box[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => textOf(m[1])).filter(Boolean);
}

/**
 * Блок «Формат обучения» – таблица свойств: объём в академических часах,
 * язык обучения, график занятий. Формат и документ оттуда НЕ берём: они
 * уже приходят из выдачи каталога, и второй источник тех же значений
 * неминуемо разошёлся бы с первым.
 *
 * Свойства читаются парами «имя → значение» по классам карточки: у части
 * программ блока нет вовсе (4 из 26), и тогда полей просто не будет.
 */
function extractFormatFacts(html) {
  const out = { hours: null, language: null, schedule: null };
  const at = html.indexOf('id="format"');
  if (at < 0) return out;
  const sec = html.slice(at, at + 6000);
  // Блок «Формат обучения» свёрстан парами dpo-format__term / __value.
  // Такие же пары есть в карточке программы наверху страницы
  // (dpo-program-card__property-*), но там нет ни часов, ни языка –
  // читаем оба вида, значения берём по имени свойства.
  const pairs = [...sec.matchAll(
    /dpo-(?:format__term|program-card__property-name)[^>]*>([\s\S]*?)<\/[a-z0-9]+>[\s\S]{0,300}?dpo-(?:format__value|program-card__property-value)[^>]*>([\s\S]*?)<\/[a-z0-9]+>/g,
  )];
  for (const [, rawName, rawValue] of pairs) {
    const name = textOf(rawName).toLowerCase();
    const value = textOf(rawValue);
    if (!value) continue;
    if (name.includes('часах')) out.hours = value;
    else if (name.includes('язык')) out.language = value;
    else if (name.includes('график')) out.schedule = value;
  }
  return out;
}

/**
 * Стоимость и условия: сумма налогового вычета и скидки.
 *
 * Скидка на странице свёрстана карточкой, внутри которой лежат кнопки
 * «Подать заявку» и «Задать вопрос». Берём только заголовок карточки:
 * иначе в текст скидки затекают названия кнопок и в каталоге появляется
 * «Скидки 5-10% студентам … Подать заявку Задать вопрос».
 */
function extractPriceTerms(html) {
  const out = { taxRefund: null, discounts: [] };
  const at = html.indexOf('id="price"');
  if (at < 0) return out;
  const sec = html.slice(at, at + 6000);
  const refund = sec.match(/([\d\u00A0\u202F\s]{3,12})рублей[\s\S]{0,80}?налогов/i);
  if (refund) out.taxRefund = textOf(refund[1]) + ' рублей';
  for (const m of sec.matchAll(/class="[^"]*dpo-price__(?:discount-title|discount|text)[^"]*"[^>]*>([\s\S]*?)<\/[a-z0-9]+>/g)) {
    const text = textOf(m[1]);
    if (text && /скидк/i.test(text)) out.discounts.push(text);
  }
  if (!out.discounts.length) {
    // Фолбэк по тексту: у части программ у карточки скидки свой класс.
    for (const m of sec.matchAll(/>\s*(Скидк[^<]{10,300})</g)) {
      const text = textOf(m[1]);
      if (text && !out.discounts.includes(text)) out.discounts.push(text);
    }
  }
  return out;
}

/**
 * «Документы для приёма на обучение» – список того, что просят у слушателя
 * (паспорт, диплом, СНИЛС). Есть у 25 программ из 26. Заголовок блока
 * пишется по-разному («Документы для приёма на обучение:», «Документы для
 * обучения»), поэтому ищем по обоим вариантам, а список берём первый после
 * заголовка.
 */
function extractAdmissionDocs(html) {
  // Заголовок встречается на странице не один раз, а список под ним бывает
  // и <ol>, и <ul> (на 22 программах из 25 – именно <ol>, поэтому поиск
  // только по <ul> приносил соседний блок контактов: адрес центра и почту).
  // Берём первую пару «заголовок → список» и требуем, чтобы список шёл
  // сразу за ним.
  for (const m of html.matchAll(/Документы для (?:приёма|обучения)/g)) {
    const at = m.index;
    const open = html.slice(at, at + 1500).search(/<(?:ol|ul)[\s>]/);
    if (open < 0) continue;
    const from = at + open;
    const to = html.indexOf(html[from + 1] === 'o' ? '</ol>' : '</ul>', from);
    if (to < 0) continue;
    const items = [...html.slice(from, to).matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)]
      .map((x) => textOf(x[1]))
      .filter((t) => t && t.length > 3)
      // Контакты центра лежат таким же списком ниже по странице: если
      // разбор промахнулся мимо блока, это видно по ним.
      .filter((t) => !/@|телефон|адрес|переулок/i.test(t));
    if (items.length >= 2) return items.slice(0, 10);
  }
  return [];
}

/**
 * «Преимущества программы» – нумерованные пункты 01/02/03. Номер живёт
 * отдельным узлом и в текст не идёт: список у нас нумеруется сам.
 */
function extractAdvantages(html) {
  // Якорь #advantages, а НЕ первое слово «Преимущества» в тексте: этим
  // словом называется пункт оглавления страницы, и разбор по тексту
  // приносил из шапки «Преподаватели» и «Старт курса» (поймано на живом
  // каталоге, тест на урезанной странице этого не видел).
  const at = html.indexOf('id="advantages"');
  if (at < 0) return [];
  const sec = html.slice(at, at + 6000);
  const items = [...sec.matchAll(/class="[^"]*dpo-features__text[^"]*"[^>]*>([\s\S]*?)<\/[a-z0-9]+>/g)]
    .map((m) => textOf(m[1]))
    .filter(Boolean);
  return items.slice(0, 8);
}

/**
 * Блок «Важно» – срочное объявление центра над карточкой программы
 * (10 страниц из 26): запись вебинара, перенос старта, новый набор.
 * У блока есть дата, текст и ссылка «Просмотреть».
 *
 * Ссылка ведёт на ЧУЖОЙ домен: записи вебинаров лежат на площадках вроде
 * mts-link.ru, и требовать hse.ru тут значило бы выбросить сам смысл
 * объявления. Поэтому проверка мягче, но не отсутствует: только https и
 * только http(s)-схема; хост показывается человеку на странице, чтобы
 * переход не был вслепую.
 */
function extractNotice(html) {
  const at = html.indexOf('dpo-notice');
  if (at < 0) return null;
  const sec = html.slice(at, at + 4000);
  const text = sec.match(/class="[^"]*dpo-notice__text[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
  if (!text) return null;
  const body = textOf(text[1]);
  if (!body) return null;
  const date = sec.match(/class="[^"]*dpo-notice__date[^"]*"[^>]*>([\s\S]*?)<\/[a-z0-9]+>/i);
  const more = sec.match(/class="[^"]*dpo-notice__more[^"]*"[^>]*href="([^"]+)"/i)
    || sec.match(/href="([^"]+)"[^>]*class="[^"]*dpo-notice__more[^"]*"/i);
  let url = null;
  if (more) {
    try {
      const u = new URL(more[1]);
      if (u.protocol === 'https:') url = u.toString();
    } catch {
      url = null;
    }
  }
  return { date: date ? textOf(date[1]) : null, text: body, url };
}

/**
 * «Вопросы и ответы» – та же вёрстка аккордеона, что у учебного плана, но
 * с модификатором `dpo-program_faq`. Есть у трёх программ из 26, и среди
 * ответов лежит именно то, чего боту не хватало: формат занятий, срок
 * доступа к материалам, справка для налогового вычета.
 *
 * Разбор идёт по модификатору, а не по заголовку: секций `dpo-program` на
 * странице две, и без модификатора вопросы попали бы в модули.
 */
function extractFaq(html) {
  const at = html.indexOf('dpo-program_faq');
  if (at < 0) return [];
  const from = html.lastIndexOf('<section', at);
  const sec = html.slice(from < 0 ? at : from, html.indexOf('</section>', at));
  const out = [];
  const cards = sec.split(/<li[^>]*class="[^"]*dpo-program__li[^"]*"[^>]*>/).slice(1);
  for (const card of cards) {
    const q = card.match(/class="[^"]*dpo-program__caption-title[^"]*"[^>]*>([\s\S]*?)<\/[a-z0-9]+>/i);
    const box = card.match(/class="[^"]*dpo-program__content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const question = q ? textOf(q[1]) : '';
    const answer = box ? textOf(box[1]) : '';
    if (!question || !answer) continue;
    out.push({ q: question, a: answer });
  }
  return out;
}

/**
 * Файлы программы: учебный план (есть у всех 26) и расписание (у 12).
 * Размер идёт в тексте ссылки («Учебный план 90,7 Кб») – отделяем его от
 * названия, чтобы показать у себя тем же способом.
 *
 * Два руководства пользователя личного кабинета лежат в подвале КАЖДОЙ
 * страницы сайта и к программе отношения не имеют – отбрасываются по
 * адресу. Ходим только на hse.ru: тот же контракт, что у остальных
 * загрузчиков.
 */
const SITE_WIDE_PDF = ['1107177138.pdf', '1107177832.pdf'];

function extractFiles(html) {
  const out = [];
  for (const m of html.matchAll(/class="[^"]*dpo-file__name[^"]*"[^>]*>([\s\S]*?)<\/p>/g)) {
    // Ссылка – ближайший <a> ВЫШЕ имени: внутри неё лежит svg-иконка на
    // сотни строк, поэтому искать имя внутри ссылки регуляркой нельзя.
    const start = html.lastIndexOf('<a ', m.index);
    if (start < 0) continue;
    const href = html.slice(start, m.index).match(/href="([^"]+\.pdf)"/i);
    if (!href) continue;
    if (SITE_WIDE_PDF.some((f) => href[1].includes(f))) continue;
    let url = null;
    try { url = assertHseUrl(href[1]); } catch { continue; }
    const sizeTag = m[1].match(/class="[^"]*dpo-file__size[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    const size = sizeTag ? textOf(sizeTag[1]) : null;
    const title = textOf(m[1].replace(/<span[\s\S]*?<\/span>/g, ''));
    if (!title) continue;
    // ЛОВУШКА: \w в JavaScript не покрывает кириллицу, поэтому
    // /учебн\w*\s+план/ не находил «Учебный план» вовсе. Проверяем два
    // корня по отдельности.
    const kind = /учебн/i.test(title) && /план/i.test(title) ? 'plan'
      : /расписан/i.test(title) ? 'schedule' : null;
    if (!kind) continue;
    if (out.some((f) => f.kind === kind)) continue;
    out.push({ kind, title, size, url });
  }
  return out;
}

/**
 * Преподаватели. Блок свёрстан как слайдер (`dpo-slider`) с карточками
 * `dpo-sponsor__card`, и такой же слайдер на странице используют партнёры,
 * поэтому берём только тот, что содержит карточки с классом
 * `dpo-sponsor__img_person` – это и есть люди.
 *
 * Фото не забираем: снимки лежат на hse.ru, а наша CSP запрещает внешние
 * картинки. Тянуть их к себе – отдельное решение, а не побочный эффект
 * обновления каталога.
 */
function extractTeachers(html) {
  const out = [];
  for (const sec of html.matchAll(/<section[^>]*dpo-slider[\s\S]*?<\/section>/g)) {
    const block = sec[0];
    if (!block.includes('dpo-sponsor__img_person')) continue;
    for (const c of block.matchAll(/<li[^>]*class="[^"]*dpo-sponsor__card[^"]*"[^>]*>([\s\S]*?)<\/li>/g)) {
      const card = c[1];
      const name = card.match(/class="[^"]*dpo-caption[^"]*"[^>]*>([\s\S]*?)<\/[a-z0-9]+>/i);
      const about = card.match(/class="[^"]*dpo-sponsor__text[^"]*"[^>]*>([\s\S]*?)<\/[a-z0-9]+>/i);
      const nm = name ? textOf(name[1]) : '';
      if (!nm) continue;
      out.push({ name: nm, about: about ? textOf(about[1]) : null });
    }
  }
  return out;
}

/**
 * Отзывы выпускников: слайдер с карточками `dpo-feedback` (текст в
 * `dpo-feedback__text`, автор в `dpo-feedback__author`; автор бывает
 * завёрнут в <a>, бывает голым текстом – textOf снимает разницу).
 * Отзыв без автора отбрасывается: безымянная цитата на сайте выглядела бы
 * выдуманной, а весь смысл блока – в реальных людях. Тексты забираются
 * целиком, без усечения: как показывать длинную цитату, решает витрина.
 */
function extractFeedback(html) {
  const out = [];
  for (const m of html.matchAll(/<li[^>]*class="[^"]*dpo-feedback[^"]*"[^>]*>([\s\S]*?)<\/li>/g)) {
    const card = m[1];
    const text = card.match(/class="[^"]*dpo-feedback__text[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const author = card.match(/class="[^"]*dpo-feedback__author[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
    const t = text ? textOf(text[1]) : '';
    const a = author ? textOf(author[1]) : '';
    if (t && a) out.push({ text: t, author: a });
  }
  return out;
}

/**
 * Запасной источник описания: сама секция «О программе» на странице.
 * У части программ нет ни og:description, ни микроразметки Course – тогда
 * страница осталась бы без описания вовсе, хотя текст на ней есть.
 * Видеоблок из секции выбрасывается: его подпись не про программу.
 */
function extractAboutFromSection(html) {
  const sec = sectionByClass(html, 'dpo-about');
  if (!sec) return null;
  const content = sec.match(/class="[^"]*dpo-about__content[^"]*"[^>]*>([\s\S]*?)$/i);
  let body = content ? content[1] : sec;
  body = body.replace(/<div[^>]*class="[^"]*dpo-video[^"]*"[\s\S]*$/i, ' ');
  const text = textOf(body);
  return text.length > 40 ? text : null;
}

/**
 * Всё, что добавилось 09.09.2026 по разведке страниц маркетплейса:
 * подтемы модулей, факты формата, условия оплаты, документы для приёма,
 * преимущества и приложенные файлы. Вынесено отдельной функцией, чтобы
 * тест мог разбирать урезанную копию страницы, не трогая сеть.
 */
function extractDetails(html) {
  const facts = extractFormatFacts(html);
  const price = extractPriceTerms(html);
  return {
    modules: extractModules(html),
    hours: facts.hours,
    language: facts.language,
    schedule: facts.schedule,
    taxRefund: price.taxRefund,
    discounts: price.discounts,
    admissionDocs: extractAdmissionDocs(html),
    advantages: extractAdvantages(html),
    files: extractFiles(html),
    notice: extractNotice(html),
    faq: extractFaq(html),
  };
}

function extract(html) {
  const out = { tagline: null, about: null, audience: null, results: null, modules: null, teachers: null, feedback: null };
  Object.assign(out, extractDetails(html));

  const audience = extractAudience(html);
  if (audience.items.length) out.audience = audience;
  const results = extractResults(html);
  if (results.length) out.results = results;
  const modules = extractModules(html);
  if (modules.length) out.modules = modules;
  const teachers = extractTeachers(html);
  if (teachers.length) out.teachers = teachers;
  const feedback = extractFeedback(html);
  if (feedback.length) out.feedback = feedback;

  const og = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i);
  if (og) out.tagline = decodeEntities(og[1]).trim() || null;

  // Микроразметка Course: у страницы программы блок ld+json один.
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1]);
      const nodes = Array.isArray(data) ? data : [data];
      for (const node of nodes) {
        if (node && node.description) {
          out.about = decodeEntities(String(node.description)).replace(/\s+/g, ' ').trim() || null;
          break;
        }
      }
    } catch {
      // Битый JSON-LD не повод падать: остаётся og:description.
    }
    if (out.about) break;
  }

  // Микроразметка предпочтительнее, но когда её нет – берём текст секции.
  if (!out.about) out.about = extractAboutFromSection(html);

  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main({ all = process.argv.includes('--all') } = {}) {
  // Параметр, а не только argv: update-catalog.js зовёт этот загрузчик
  // в своём процессе (решение владельца 09.09.2026 «тянуть автоматически»),
  // и argv там принадлежит другой команде.
  const onlyMissing = !all;
  if (!fs.existsSync(STORE)) {
    console.error('Нет .catalog-data.json — сначала запустите node update-catalog.js');
    process.exitCode = 1;
    return;
  }

  const store = JSON.parse(fs.readFileSync(STORE, 'utf8'));
  const programs = store.programs || [];
  const targets = programs.filter((p) => p.url && (!onlyMissing || !p.about));

  console.log(
    `Программ в каталоге: ${programs.length}, к обходу: ${targets.length}` +
      (onlyMissing ? ' (только без описания)' : ' (перезапись всех)'),
  );

  let ok = 0;
  const failed = [];

  for (const [i, program] of targets.entries()) {
    let url;
    try {
      url = assertHseUrl(program.url);
    } catch (err) {
      failed.push({ title: program.title, reason: err.message });
      continue;
    }

    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'text/html' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const html = await res.text();
      const data = extract(html);
      const { tagline, about, audience, results, modules, teachers, feedback } = data;

      if (!tagline && !about && !audience && !results && !modules && !teachers && !feedback) {
        failed.push({ title: program.title, reason: 'описание не найдено на странице' });
      } else {
        if (tagline) program.tagline = tagline;
        if (about) program.about = about;
        if (audience) program.audience = audience;
        if (results) program.results = results;
        if (modules) program.modules = modules;
        if (teachers) program.teachers = teachers;
        if (feedback) program.feedback = feedback;
        // Поля разведки 09.09.2026. Пустое не затирает прежнее значение:
        // блок «Формат обучения» есть не у всех программ, и отсутствие
        // блока не повод стереть уже собранное.
        if (data.hours) program.hours = data.hours;
        if (data.language) program.language = data.language;
        if (data.schedule) program.schedule = data.schedule;
        if (data.taxRefund) program.taxRefund = data.taxRefund;
        if (data.discounts && data.discounts.length) program.discounts = data.discounts;
        if (data.admissionDocs && data.admissionDocs.length) program.admissionDocs = data.admissionDocs;
        if (data.advantages && data.advantages.length) program.advantages = data.advantages;
        // «Важно» СНИМАЕТСЯ, когда исчезло со страницы: это срочное
        // объявление с датой, и протухшее хуже отсутствующего.
        program.notice = data.notice || null;
        if (data.faq && data.faq.length) program.faq = data.faq;
        // Файлы: ссылки на оригиналы. Скачивает их к себе и проставляет
        // path уже scripts/fetch-program-media.js – разделение то же, что
        // у обложек: этот скрипт разбирает разметку, тот носит байты.
        if (data.files && data.files.length) {
          const was = new Map((program.files || []).map((f) => [f.kind, f]));
          program.files = data.files.map((f) => ({ ...f, path: (was.get(f.kind) || {}).path || null }));
        }
        ok++;
      }
      process.stdout.write(`  [${i + 1}/${targets.length}] ${ok ? '' : ''}${program.title.slice(0, 60)}\n`);
    } catch (err) {
      failed.push({ title: program.title, reason: err.message });
    }

    if (i < targets.length - 1) await sleep(DELAY_MS);
  }

  fs.writeFileSync(STORE, JSON.stringify(store, null, 2) + '\n', 'utf8');

  const count = (field) => programs.filter((p) => p[field]).length;
  console.log(
    `\nГотово. Страниц обработано: ${ok}. Всего в каталоге: ` +
      `описание ${count('about')}/${programs.length}, ` +
      `для кого ${count('audience')}/${programs.length}, ` +
      `результаты ${count('results')}/${programs.length}, ` +
      `учебный план ${count('modules')}/${programs.length}, ` +
      `часы ${count('hours')}/${programs.length}, ` +
      `график ${count('schedule')}/${programs.length}, ` +
      `условия оплаты ${count('discounts')}/${programs.length}, ` +
      `документы для приёма ${count('admissionDocs')}/${programs.length}, ` +
      `преимущества ${count('advantages')}/${programs.length}, ` +
      `файлы ${count('files')}/${programs.length}, ` +
      `преподаватели ${count('teachers')}/${programs.length}, ` +
      `отзывы ${count('feedback')}/${programs.length}.`,
  );
  if (failed.length) {
    console.warn(`Не удалось (${failed.length}):`);
    for (const f of failed) console.warn(`  - ${f.title.slice(0, 60)}: ${f.reason}`);
  }
  console.log('Дальше: node update-catalog.js --from-store, чтобы пересобрать страницы.');
}

if (require.main === module) main();

module.exports = { extract, extractDetails, assertHseUrl, main };
