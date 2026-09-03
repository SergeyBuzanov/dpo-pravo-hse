/**
 * Клиент и сервер формы заявки должны говорить об одних и тех же полях.
 *
 * Ровно так жил дефект: в разметке формы есть «Комментарий или вопрос»
 * (name="comment"), сервер его читает и кладёт в письмо – а `collect()`
 * на клиенте поле не отправлял. Три темы из четырёх (идея курса, стать
 * преподавателем, отзыв) уходили пустыми. Найдено прогоном 03.09.2026.
 *
 * Тест смотрит в исходники, а не поднимает браузер: важно само множество
 * ключей, которое клиент собирает, против того, что сервер ждёт в `raw`.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

function clientKeys() {
  const src = read('js/application-form.js');
  const start = src.indexOf('function collect(form)');
  assert.ok(start > 0, 'в js/application-form.js нет collect(form)');
  const body = src.slice(start, src.indexOf('\n  }\n', start));
  return new Set([...body.matchAll(/^\s{6}(\w+):/gm)].map((m) => m[1]));
}

function serverKeys() {
  const src = read('lib/application-form.js');
  return new Set([...src.matchAll(/\braw\.(\w+)/g)].map((m) => m[1]));
}

test('collect() на клиенте отправляет всё, что parseApplication читает из raw', () => {
  const client = clientKeys();
  const server = serverKeys();
  // `website` – ловушка для ботов: клиент шлёт, сервер-обработчик смотрит
  // до разбора, в parseApplication поля нет. Единственное законное исключение.
  client.delete('website');
  assert.deepEqual([...client].sort(), [...server].sort());
});

test('поле comment есть и в разметке формы', () => {
  assert.match(read('js/application-form.js'), /name:\s*'comment'/);
});
