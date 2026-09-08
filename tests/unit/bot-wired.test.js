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
    assert.match(html, /<script src="(\.\.\/)?js\/bot-match\.js" defer><\/script>/, `нет bot-match.js: ${page}`);
    assert.match(html, /<script src="(\.\.\/)?js\/bot-reply\.js" defer><\/script>/, `нет bot-reply.js: ${page}`);
    assert.match(html, /<script src="(\.\.\/)?js\/support-bot\.js" defer><\/script>/, `нет support-bot.js: ${page}`);
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

test('на лендинге открытие бота подключено к угловой вороне, а не к форме заявки', () => {
  const html = read('index.html');
  assert.match(html, /crow-hit-btn[\s\S]{0,400}data-bot-open/, 'crow-hit-btn не открывает бота');
  assert.match(html, /crow-vi-btn[\s\S]{0,400}data-bot-open/, 'crow-vi-btn не открывает бота');
  assert.doesNotMatch(
    html.slice(html.indexOf('crow-launcher-addon')),
    /crow-hit-btn[\s\S]{0,200}data-application/,
    'crow-hit-btn всё ещё открывает форму заявки',
  );
});
