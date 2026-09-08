'use strict';

/**
 * Пустой результат фильтров. Проверяется не картинка, а то, что человек
 * не остаётся в тупике: есть объяснение и есть выход.
 *
 * Решение владельца (08.09.2026, по снимку): кнопок «Сбросить фильтры» было
 * две сразу – панельная (#resetFilters, тулбар) и своя внутри пустого
 * состояния (.empty-reset[data-reset-filters], под вороной). Убрали ту,
 * что под вороной, вместе со стилями и JS-обработчиком `[data-reset-filters]`
 * (кроме этой кнопки его никто не использовал) – выход из тупика остаётся,
 * им стала панельная кнопка тулбара, она всегда на экране рядом с фильтрами.
 * Это ИЗМЕНЕНИЕ КОНТРАКТА, а не ослабление теста: старое утверждение
 * «в пустом состоянии есть своя кнопка сброса» проверяло разметку, которой
 * владелец велел не быть – ниже оно заменено на обратное: такой разметки
 * быть не должно, а панельная кнопка остаётся единственным выходом.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const HTML = fs.readFileSync(path.join(ROOT, 'Каталог программ.html'), 'utf8');

test('в пустом состоянии есть маскот и объяснение; своей кнопки сброса больше нет – выход один, панельный', () => {
  const block = HTML.slice(HTML.indexOf('class="empty"'), HTML.indexOf('</main>'));
  assert.match(block, /data-crow-slot/, 'нет места под маскота');
  assert.match(block, /не найдено/, 'нет объяснения');
  assert.doesNotMatch(block, /data-reset-filters/, 'дубль кнопки сброса вернулся под ворону');
  assert.doesNotMatch(HTML, /empty-reset/, 'стили дубля кнопки не убраны целиком');
  assert.match(HTML, /id="resetFilters"/, 'нет панельной кнопки – единственного выхода из пустого результата');
});

test('маскот в пустом состоянии декоративен для читалок', () => {
  const block = HTML.slice(HTML.indexOf('class="empty"'), HTML.indexOf('</main>'));
  assert.match(block, /aria-hidden="true"/, 'слот маскота не спрятан от читалок');
});
