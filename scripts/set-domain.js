#!/usr/bin/env node
/**
 * Подставляет реальный домен вместо заглушки во всех публичных файлах.
 *
 *   node scripts/set-domain.js dpo.pravo.hse.ru          # показать, что изменится
 *   node scripts/set-domain.js dpo.pravo.hse.ru --apply  # записать
 *   node scripts/set-domain.js --from https://старый.ru новый.ru --apply
 *
 * Зачем отдельный скрипт
 * ----------------------
 * Домен зашит в 107 местах: canonical и og:url на каждой из 26 страниц
 * программ, sitemap, robots, превью для соцсетей. Менять руками – значит
 * гарантированно что-то пропустить, а пропущенный canonical указывает
 * поисковику на несуществующий сайт.
 *
 * Три места, которые легко забыть, и поэтому обрабатываются здесь же:
 *   - `SITE` в scripts/build-program-pages.js. Без него первая же пересборка
 *     каталога вернёт заглушку обратно во все 26 страниц.
 *   - `Sitemap:` в robots.txt.
 *   - index.html целиком. Домен встречается там дважды: в статической шапке
 *     файла (её читают роботы, не исполняющие JS) и внутри закодированного
 *     шаблона бандла. Обе копии обязаны совпадать, поэтому файл правится как
 *     обычный текст: внутри JSON-строки шаблона адрес лежит без экранирования,
 *     и подстановка не ломает кодировку. Проверено извлечением после замены.
 *
 * По умолчанию скрипт НИЧЕГО не пишет: сначала показывает список правок.
 * Запись включается флагом --apply.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { bounds } = require('./landing-template');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_FROM = 'https://example.com';

/** Файлы вне programs/, где встречается домен. */
const FILES = [
  'index.html',
  'privacy.html',
  'Каталог программ.html',
  '404.html',
  'robots.txt',
  'sitemap.xml',
  'scripts/build-program-pages.js',
];

/**
 * Приводит ввод к виду `https://host`. Схема принудительно https: сайт
 * отдаётся по TLS, а http в canonical увёл бы поисковик на редирект.
 */
function normalizeDomain(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('домен не указан');
  const withScheme = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error('не похоже на домен: ' + raw);
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('нужен только домен, без пути и параметров: ' + raw);
  }
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname)) {
    throw new Error('подозрительное имя хоста: ' + url.hostname);
  }
  if (url.hostname === 'example.com') {
    throw new Error('example.com – это и есть заглушка, которую нужно заменить');
  }
  return 'https://' + url.hostname;
}

function listProgramPages() {
  const dir = path.join(ROOT, 'programs');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.html'))
    .map((f) => path.join('programs', f));
}

/** Считает вхождения и, если разрешено, переписывает файл. */
function processFile(rel, from, to, apply) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return { rel, hits: 0, missing: true };
  const src = fs.readFileSync(abs, 'utf8');
  const hits = src.split(from).length - 1;
  if (hits && apply) fs.writeFileSync(abs, src.split(from).join(to), 'utf8');
  return { rel, hits };
}

/**
 * Страховка: после правки index.html закодированный шаблон обязан
 * по-прежнему разбираться. Если подстановка его сломает, лендинг превратится
 * в белый экран, и узнать об этом лучше здесь, а не в браузере.
 */
function assertLandingIntact() {
  const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const { start, end } = bounds(src);
  JSON.parse(src.slice(start, end));
}

function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const fromIdx = argv.indexOf('--from');
  const from = fromIdx >= 0 ? argv[fromIdx + 1] : DEFAULT_FROM;
  // Позиционным считается всё, кроме флагов и значения при --from.
  // Проверка fromIdx >= 0 обязательна: без неё при отсутствии --from
  // индекс -1 + 1 = 0 отбрасывал бы сам домен.
  const skip = fromIdx >= 0 ? fromIdx + 1 : -1;
  const positional = argv.filter((a, i) => !a.startsWith('--') && i !== skip);

  let to;
  try {
    to = normalizeDomain(positional[0]);
  } catch (err) {
    console.error('Ошибка: ' + err.message);
    console.error('\nИспользование: node scripts/set-domain.js <домен> [--apply] [--from <старый>]');
    console.error('Пример:        node scripts/set-domain.js dpo.pravo.hse.ru --apply');
    process.exitCode = 1;
    return;
  }

  const results = [];
  try {
    for (const rel of [...FILES, ...listProgramPages()]) {
      results.push(processFile(rel, from, to, apply));
    }
    if (apply) assertLandingIntact();
  } catch (err) {
    console.error('Ошибка: ' + err.message);
    process.exitCode = 1;
    return;
  }

  const touched = results.filter((r) => r.hits > 0);
  const total = touched.reduce((s, r) => s + r.hits, 0);
  const pages = touched.filter((r) => r.rel.startsWith('programs/'));
  const rest = touched.filter((r) => !r.rel.startsWith('programs/'));

  console.log(`${from}  ->  ${to}\n`);
  for (const r of rest) console.log(`  ${String(r.hits).padStart(3)}  ${r.rel}`);
  if (pages.length) {
    const sum = pages.reduce((s, r) => s + r.hits, 0);
    console.log(`  ${String(sum).padStart(3)}  programs/*.html (${pages.length} страниц)`);
  }
  const missing = results.filter((r) => r.missing);
  for (const r of missing) console.log(`    –  ${r.rel} (файла нет)`);

  console.log(`\nВсего вхождений: ${total}`);
  if (!total) {
    console.log('Менять нечего. Возможно, домен уже подставлен – тогда укажите --from со старым.');
    return;
  }
  if (apply) {
    console.log('Записано. Проверьте: npm run check-deploy');
  } else {
    console.log('Это предпросмотр, ничего не записано. Повторите с --apply.');
  }
}

if (require.main === module) main();

module.exports = { normalizeDomain };
