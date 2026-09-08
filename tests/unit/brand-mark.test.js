'use strict';

/**
 * Знак центра «ворон на весах» слева на плашке шапки (решение владельца
 * 08.09.2026, вариант «круг 44px», на всех публичных страницах).
 *
 * Шапок в проекте пять разных: локап лендинга, «Право / Центр ДПО · НИУ ВШЭ»
 * у каталога и страниц программ, строчка «Право · Центр ДПО» у privacy и
 * рейтингов, и своя шапка у 404. Знак легко забыть в одной из них – ровно
 * так когда-то потерялась иконка вкладки. Тест держит все места разом.
 *
 * Админка сюда НЕ входит: внутренний инструмент, выведенный владельцем
 * из-под дизайн-проверки целиком.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { resolveSafe, isAllowedStatic } = require('../../lib/static-http');

const ROOT = path.resolve(__dirname, '..', '..');
const MARK = 'images/logo/brand-mark-96.webp';

/** Страницы, на плашке которых обязан стоять знак. */
const PAGES = [
  'index.html',
  '404.html',
  'privacy.html',
  'ratings.html',
  'Каталог программ.html',
  'programs/angliyskoe-kontraktnoe-pravo-856421092.html',
];

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('файл знака на месте и не пуст', () => {
  const stat = fs.statSync(path.join(ROOT, MARK));
  assert.ok(stat.size > 500, `${MARK} подозрительно мал: ${stat.size} байт`);
});

test('знак стоит на каждой публичной странице', () => {
  for (const page of PAGES) {
    // assert.ok, а не assert.match: на провале match печатает весь файл
    // целиком, а это сотни килобайт – сообщение тонет.
    assert.ok(/brand-mark-96\.webp/.test(read(page)), `нет знака в шапке: ${page}`);
  }
});

test('знак несут генераторы, а не только готовые файлы', () => {
  // 26 страниц программ пересобираются при каждом обновлении каталога:
  // правка в готовом файле без правки генератора живёт до первой сборки.
  assert.ok(
    /brand-mark-96\.webp/.test(read('scripts/build-program-pages.js')),
    'генератор страниц программ потеряет знак при пересборке',
  );
});

test('знак уходит в режиме для слабовидящих', () => {
  // Страница там ч/б; цветной знак остался бы единственным цветным пятном –
  // то же правило, что у круглой эмблемы ВШЭ.
  for (const page of ['index.html', 'Каталог программ.html', 'privacy.html', 'ratings.html']) {
    assert.ok(
      /vi-mode[^{]*\.brand-mark|vi-mode[^{]*\.dpo-brand-mark/.test(read(page)),
      `знак не спрятан в vi-режиме: ${page}`,
    );
  }
});

test('слова «Право» в плашке шапки больше нет', () => {
  // Решение владельца 08.09.2026 (вариант 3 из четырёх показанных): имя
  // центру даёт знак, словами плашка называет, ЧТО это. Возврат вероятнее
  // всего пришёл бы из генератора страниц программ – он тоже под проверкой.
  for (const page of [...PAGES, 'scripts/build-program-pages.js']) {
    const html = read(page);
    assert.ok(!/class="name">Право</.test(html), `слово «Право» вернулось в плашку: ${page}`);
    assert.ok(!/dpo-brand-word/.test(html), `остался локап со словом: ${page}`);
  }
});

test('белый список статики отдаёт знак наружу', () => {
  assert.equal(isAllowedStatic(resolveSafe('/' + MARK, ROOT)), true, MARK);
});
