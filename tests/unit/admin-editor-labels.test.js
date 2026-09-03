/**
 * У каждого поля редактора каталога в админке должна быть подпись для
 * читалки экрана. Заголовки колонок таблицы её не дают: 26 строк × 7
 * одинаковых input без имени – читалка объявляет «поле ввода, поле ввода».
 * Найдено прогоном web-design-guidelines 03.09.2026.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'admin.html'), 'utf8');

test('каждый mkInput редактора получает label, а mkInput ставит aria-label', () => {
  const calls = [...src.matchAll(/mkInput\('(\w+)'(?:,\s*\{([^}]*)\})?\)/g)];
  assert.ok(calls.length >= 7, `ожидалось не меньше 7 полей, найдено ${calls.length}`);
  const unlabeled = calls.filter((m) => !/\blabel:/.test(m[2] || '')).map((m) => m[1]);
  assert.deepEqual(unlabeled, []);
  assert.match(src, /mkInput = [\s\S]{0,600}aria-label/, 'mkInput не выставляет aria-label');
});
