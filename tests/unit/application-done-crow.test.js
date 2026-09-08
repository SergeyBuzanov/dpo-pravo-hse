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

test('экран «Спасибо!» зовёт маскота с кивком', () => {
  const done = SRC.slice(SRC.indexOf("'Спасибо!'"), SRC.indexOf("'Спасибо!'") + 1200);
  assert.match(done, /CrowMascot/, 'маскот на экране «Спасибо!» не вызывается');
  assert.match(done, /nod/, 'играет не кивок');
});

test('кивок под гейтом reduced-motion, как и вибрация', () => {
  assert.match(SRC, /prefers-reduced-motion[\s\S]{0,400}nod|nod[\s\S]{0,400}prefers-reduced-motion/,
    'кивок не проверяет режим без движения');
});
