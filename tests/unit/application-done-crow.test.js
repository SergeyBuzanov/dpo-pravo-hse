'use strict';

/**
 * Экран «Спасибо!» строится в браузере, поэтому проверяется контракт:
 * маскот вызывается там же, где заголовок «Спасибо!», и только один раз.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'js', 'application-form.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ');

test('экран «Спасибо!» зовёт маскота с прыжком', () => {
  // Кивок сменён прыжком по решению владельца 09.09.2026: отправленная
  // заявка – единственное на сайте место, где уместна радость, а кивок
  // остался языком ответов в окне поддержки.
  const done = SRC.slice(SRC.indexOf("'Спасибо!'"), SRC.indexOf("'Спасибо!'") + 1200);
  assert.match(done, /CrowMascot/, 'маскот на экране «Спасибо!» не вызывается');
  assert.match(done, /jump/, 'играет не прыжок');
});

test('прыжок под гейтом reduced-motion, как и вибрация', () => {
  assert.match(SRC, /prefers-reduced-motion[\s\S]{0,400}jump|jump[\s\S]{0,400}prefers-reduced-motion/,
    'прыжок не проверяет режим без движения');
});
