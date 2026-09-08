'use strict';

/**
 * Пустой результат фильтров. Проверяется не картинка, а то, что человек
 * не остаётся в тупике: есть объяснение и есть выход.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const HTML = fs.readFileSync(path.join(ROOT, 'Каталог программ.html'), 'utf8');

test('в пустом состоянии есть маскот, объяснение и выход', () => {
  const block = HTML.slice(HTML.indexOf('class="empty"'), HTML.indexOf('</main>'));
  assert.match(block, /data-crow-slot/, 'нет места под маскота');
  assert.match(block, /не найдено/, 'нет объяснения');
  assert.match(block, /data-reset-filters/, 'нет кнопки сброса фильтров');
});

test('маскот в пустом состоянии декоративен для читалок', () => {
  const block = HTML.slice(HTML.indexOf('class="empty"'), HTML.indexOf('</main>'));
  assert.match(block, /aria-hidden="true"/, 'слот маскота не спрятан от читалок');
});
