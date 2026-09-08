'use strict';

/**
 * Данные бота. Бот не считает ни цену, ни дату старта – он показывает то,
 * что посчитали общие функции каталога. Тест сводит файл с хранилищем:
 * разойдутся – бот начнёт называть цену, которой нет на сайте.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { formatPrice, upcomingStartLabel } = require('../../lib/hse-catalog');
const { formatBucket } = require('../../lib/program-labels');
const { resolveSafe, isAllowedStatic } = require('../../lib/static-http');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));

test('файл собран и содержит все программы каталога', () => {
  const bot = read('content/bot-catalog.json');
  const store = read('.catalog-data.json');
  assert.ok(Array.isArray(bot.programs));
  assert.equal(bot.programs.length, store.programs.length);
});

test('цена и старт совпадают с общими функциями каталога', () => {
  const bot = read('content/bot-catalog.json');
  const byId = new Map(read('.catalog-data.json').programs.map((p) => [String(p.id), p]));
  for (const item of bot.programs) {
    const source = byId.get(item.id);
    assert.ok(source, `программы ${item.id} нет в хранилище`);
    assert.equal(item.priceLabel, formatPrice(source));
    assert.equal(item.start, upcomingStartLabel(source) || null);
    assert.equal(item.format, formatBucket(source.studyFormat && source.studyFormat.title).value);
  }
});

test('адреса относительные – сайт живёт и в подкаталоге зеркала', () => {
  for (const item of read('content/bot-catalog.json').programs) {
    assert.ok(!/^https?:/.test(item.url), `абсолютный адрес: ${item.url}`);
  }
});

test('у каждой программы есть слова для поиска', () => {
  for (const item of read('content/bot-catalog.json').programs) {
    assert.ok(item.keywords.length > 0, `пустые keywords у ${item.title}`);
  }
});

test('белый список статики пускает файл наружу', () => {
  // isAllowedStatic принимает результат resolveSafe, а не голый путь –
  // тот же контракт, что в tests/unit/program-index.test.js.
  assert.equal(isAllowedStatic(resolveSafe('/content/bot-catalog.json', ROOT)), true);
  assert.equal(isAllowedStatic(resolveSafe('/.catalog-data.json', ROOT)), false);
});

test('коды форматов совпадают с чипами фильтров каталога', () => {
  // Разойдутся – переход «показать в каталоге» приведёт в пустой список.
  // data-group и data-value живут в разных тегах (контейнер и кнопки
  // внутри него), поэтому сперва вырезаем блок фильтра, потом ищем в нём.
  const catalog = fs.readFileSync(path.join(ROOT, 'Каталог программ.html'), 'utf8');
  const formatBlock = catalog.match(/<div[^>]*data-group="format"[^>]*>[\s\S]*?<\/div>/);
  const chips = new Set(
    [...(formatBlock ? formatBlock[0] : '').matchAll(/data-value="([^"]*)"/g)].map((m) => m[1]),
  );
  for (const item of read('content/bot-catalog.json').programs) {
    if (item.format === 'other') continue;
    assert.ok(chips.has(item.format), `код ${item.format} не встречается среди чипов каталога`);
  }
});

test('em dash в текстовые поля не просачивается', () => {
  // Типографика проекта запрещает «—» полностью (только en dash «–»).
  // keywords тащат сырой tagline/audience/modules из хранилища – проверяем
  // именно те поля, что могут нести свободный текст.
  const FIELDS = ['title', 'formatLabel', 'priceLabel', 'duration', 'start', 'sphere'];
  for (const item of read('content/bot-catalog.json').programs) {
    for (const field of FIELDS) {
      assert.ok(
        !String(item[field] ?? '').includes('—'),
        `em dash в поле ${field} у ${item.id}: ${item[field]}`,
      );
    }
    for (const keyword of item.keywords) {
      assert.ok(!keyword.includes('—'), `em dash в keywords у ${item.id}: ${keyword}`);
    }
  }
});
