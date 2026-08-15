#!/usr/bin/env node
/**
 * Подтягивает описания программ со страниц hse.ru в .catalog-data.json.
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
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');

/** Текст из куска разметки: снимаем теги, схлопываем пробелы. */
const textOf = (chunk) =>
  decodeEntities(String(chunk).replace(/<[^>]+>/g, ' '))
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

function extract(html) {
  const out = { tagline: null, about: null, audience: null, results: null };

  const audience = extractAudience(html);
  if (audience.items.length) out.audience = audience;
  const results = extractResults(html);
  if (results.length) out.results = results;

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
      const { tagline, about, audience, results } = extract(html);

      if (!tagline && !about && !audience && !results) {
        failed.push({ title: program.title, reason: 'описание не найдено на странице' });
      } else {
        if (tagline) program.tagline = tagline;
        if (about) program.about = about;
        if (audience) program.audience = audience;
        if (results) program.results = results;
        ok++;
      }
      process.stdout.write(`  [${i + 1}/${targets.length}] ${ok ? '' : ''}${program.title.slice(0, 60)}\n`);
    } catch (err) {
      failed.push({ title: program.title, reason: err.message });
    }

    if (i < targets.length - 1) await sleep(DELAY_MS);
  }

  fs.writeFileSync(STORE, JSON.stringify(store, null, 2) + '\n', 'utf8');

  const withAbout = programs.filter((p) => p.about).length;
  const withTagline = programs.filter((p) => p.tagline).length;
  console.log(
    `\nГотово. Описаний получено: ${ok}. ` +
      `Всего в каталоге с about: ${withAbout}/${programs.length}, с tagline: ${withTagline}/${programs.length}.`,
  );
  if (failed.length) {
    console.warn(`Не удалось (${failed.length}):`);
    for (const f of failed) console.warn(`  - ${f.title.slice(0, 60)}: ${f.reason}`);
  }
  console.log('Дальше: node update-catalog.js --from-store, чтобы пересобрать страницы.');
}

if (require.main === module) main();

module.exports = { extract, assertHseUrl };
