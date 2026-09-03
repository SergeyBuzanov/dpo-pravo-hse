/**
 * Живая подсказка формы (телефон, почта) обязана совпадать с сервером:
 * иначе клиент ругается на то, что сервер примет, или молчит о том, что
 * сервер отвергнет. Сравниваются сами литералы регулярных выражений и тексты.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const client = fs.readFileSync(path.join(ROOT, 'js', 'application-form.js'), 'utf8');
const server = fs.readFileSync(path.join(ROOT, 'lib', 'application-form.js'), 'utf8');

const literal = (src, name) => {
  const m = src.match(new RegExp(`${name}\\s*=\\s*(/[^\\n]+?/)[;\\n]`));
  assert.ok(m, `${name} не найден на сервере`);
  return m[1];
};

test('регулярные выражения почты и телефона на клиенте те же, что на сервере', () => {
  for (const name of ['EMAIL_SHAPE', 'PHONE_ALLOWED']) {
    const re = literal(server, name);
    assert.ok(client.includes(re), `${name} ${re} отсутствует в js/application-form.js`);
  }
  assert.match(server, /PHONE_MIN_DIGITS = 10/);
  assert.match(server, /PHONE_MAX_DIGITS = 15/);
  assert.match(client, /digits < 10 \|\| digits > 15/);
});

test('тексты подсказок совпадают дословно', () => {
  for (const msg of [
    'В телефоне допустимы только цифры, пробелы и знаки + ( ) -',
    'Проверьте телефон: нужен номер с кодом страны или города.',
    'Проверьте адрес почты: похоже, в нём опечатка.',
  ]) {
    assert.ok(server.includes(msg), `сервер потерял текст: ${msg}`);
    assert.ok(client.includes(msg), `клиент потерял текст: ${msg}`);
  }
});
