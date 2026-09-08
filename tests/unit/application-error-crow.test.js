'use strict';

/**
 * Мягкий отказ отправки заявки. Форма строится в браузере, поэтому
 * проверяется контракт исходника – по образцу
 * tests/unit/application-done-crow.test.js: маскот качает головой и когда
 * сервер вернул ошибки полей, и когда отправка не удалась вовсе (сеть,
 * 429, 500), реплики при этом нет – только движение.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'js', 'application-form.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ');

test('в форме есть декоративный слот под маскота ошибки', () => {
  assert.match(SRC, /dpo-app-error-crow/, 'нет слота под маскота ошибки');
});

test('shake играет и на ошибках полей, и на неудачной отправке, и в catch', () => {
  const submit = SRC.slice(SRC.indexOf('function onSubmit'));
  const occurrences = submit.match(/crowShake\(/g) || [];
  assert.ok(occurrences.length >= 3, 'crowShake должен вызываться в трёх местах onSubmit – 400 с полями, прочий отказ и catch');
});

test('shake без реплики: реплика вороны в отказе не участвует', () => {
  const shakeFn = SRC.slice(SRC.indexOf('function crowShake'), SRC.indexOf('function crowShake') + 800);
  assert.match(shakeFn, /play\('shake'\)/, 'нет вызова play(\'shake\')');
  assert.doesNotMatch(shakeFn, /askQ|helpQ|bubbleText/, 'у отказа не должно быть реплики – только движение');
});

test('shake под гейтом reduced-motion, как вибрация и кивок рядом', () => {
  const shakeFn = SRC.slice(SRC.indexOf('function crowShake'), SRC.indexOf('function crowShake') + 800);
  assert.match(shakeFn, /prefers-reduced-motion/, 'shake не проверяет режим без движения');
});

test('маскот вызывается после показа ошибок полей, не до – фокус на поле не перехватывается', () => {
  const idxShowErrors = SRC.indexOf('showErrors(form');
  const idxShake = SRC.indexOf('crowShake(form', idxShowErrors);
  assert.ok(idxShowErrors !== -1, 'showErrors(form не найден');
  assert.ok(idxShake !== -1 && idxShake > idxShowErrors, 'crowShake должен звучать после showErrors, чтобы не мешать переводу фокуса на невалидное поле');
});
