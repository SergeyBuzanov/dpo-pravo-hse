'use strict';

/**
 * Виджет бота подключён на всех трёх типах страниц. Пропустить одну легко:
 * лендинг, каталог и страницы программ собираются по-разному (шаблон
 * визуального сборщика, скрипт каталога и генератор страниц программ
 * соответственно).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const PAGES = [
  'index.html',
  'Каталог программ.html',
  'programs/angliyskoe-kontraktnoe-pravo-856421092.html',
];

test('js/bot-match.js, js/bot-reply.js и js/support-bot.js подключены на всех страницах', () => {
  for (const page of PAGES) {
    const html = read(page);
    const tag = (name) => new RegExp(`<script src="(\\.\\./)?js/${name}\\.js" defer(?: integrity="sha384-[^"]+")?></script>`);
    assert.match(html, tag('bot-match'), `нет bot-match.js: ${page}`);
    assert.match(html, tag('bot-reply'), `нет bot-reply.js: ${page}`);
    assert.match(html, tag('support-bot'), `нет support-bot.js: ${page}`);
  }
});

test('порядок обязателен: ядро поиска -> логика ответа -> виджет', () => {
  for (const page of PAGES) {
    const html = read(page);
    const iMatch = html.indexOf('bot-match.js');
    const iReply = html.indexOf('bot-reply.js');
    const iBot = html.indexOf('support-bot.js');
    assert.ok(iMatch < iReply && iReply < iBot, page);
  }
});

test('угловая ворона открывает бота и подключена на каждой странице', () => {
  // 08.09.2026 код угловой вороны переехал из хвоста index.html в общий
  // js/crow-launcher.js: маскот нужен НЕ ТОЛЬКО на лендинге (владелец: «в
  // углу, не пропадать оттуда»), а в каталоге и на страницах программ его
  // не было вовсе.
  const launcher = read('js/crow-launcher.js');
  assert.match(launcher, /crow-hit-btn[\s\S]{0,400}data-bot-open/, 'crow-hit-btn не открывает бота');
  assert.match(launcher, /crow-vi-btn[\s\S]{0,400}data-bot-open/, 'crow-vi-btn не открывает бота');
  assert.doesNotMatch(launcher, /data-application/, 'угловая ворона снова открывает форму заявки, а не бота');

  for (const page of ['index.html', 'Каталог программ.html',
                      'programs/angliyskoe-kontraktnoe-pravo-856421092.html']) {
    assert.match(read(page), /crow-launcher\.js/, `ворона в углу не подключена: ${page}`);
    assert.match(read(page), /crow-mascot\.js/, `маскот не подключён: ${page}`);
  }
});
