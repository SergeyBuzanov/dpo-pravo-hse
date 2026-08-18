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

const decodeEntities = (s) =>
  String(s)
    .replace(/&laquo;/g, '«')
    .replace(/&raquo;/g, '»')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '–')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');

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
  for (const m of sec.matchAll(/<li[^>]*class="[^"]*dpo-program__li[^"]*"[^>]*>([\s\S]*?)<\/li>/g)) {
    const card = m[1];
    const title = card.match(/class="[^"]*dpo-program__caption-title[^"]*"[^>]*>([\s\S]*?)<\/[a-z0-9]+>/i);
    const badge = card.match(/class="[^"]*dpo-program__badge[^"]*"[^>]*>([\s\S]*?)<\/[a-z0-9]+>/i);
    const name = title ? textOf(title[1]).replace(/^\d+[.)]\s*/, '') : '';
    if (!name) continue;
    out.push({ title: name, hours: badge ? textOf(badge[1]) : null });
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

function extract(html) {
  const out = { tagline: null, about: null, audience: null, results: null, modules: null, teachers: null, feedback: null };

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

async function main() {
  const onlyMissing = !process.argv.includes('--all');
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
      const { tagline, about, audience, results, modules, teachers, feedback } = extract(html);

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

module.exports = { extract, assertHseUrl };
