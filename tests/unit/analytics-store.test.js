'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Только чистые функции: ingestBatch с принятыми событиями пишет в .analytics/
// рядом с настоящими данными, поэтому здесь проверяется лишь отсев.
const { sanitizeEvent, ingestBatch } = require('../../lib/analytics-store');

const NOW = Date.parse('2026-09-03T12:00:00Z');
const base = () => ({ type: 'pageview', sid: 'abcdefgh12', path: '/', t: NOW });

test('событие принимается и приводится к схеме', () => {
  const ev = sanitizeEvent({ ...base(), title: 'x'.repeat(500), device: 'phone', scroll: 250, ms: -5 }, NOW);
  assert.equal(ev.type, 'pageview');
  assert.ok(ev.title.length < 500, 'заголовок обрезается');
  assert.equal(ev.device, 'desktop', 'неизвестное устройство – desktop');
  assert.equal(ev.scroll, 100);
  assert.equal(ev.ms, 0);
});

test('неизвестный тип, короткий sid и путь без «/» отбрасываются', () => {
  assert.equal(sanitizeEvent({ ...base(), type: 'evil' }, NOW), null);
  assert.equal(sanitizeEvent({ ...base(), sid: 'short' }, NOW), null);
  assert.equal(sanitizeEvent({ ...base(), path: 'javascript:alert(1)' }, NOW), null);
  assert.equal(sanitizeEvent(null, NOW), null);
});

test('время из будущего или далёкого прошлого заменяется текущим', () => {
  assert.equal(sanitizeEvent({ ...base(), t: NOW - 10 * 24 * 3600 * 1000 }, NOW).t, NOW);
  assert.equal(sanitizeEvent({ ...base(), t: 'вчера' }, NOW).t, NOW);
});

test('ошибка формы – допустимый тип, метка сохраняется', () => {
  const ev = sanitizeEvent({ ...base(), type: 'form_error', label: 'http 500' }, NOW);
  assert.equal(ev.type, 'form_error');
  assert.equal(ev.label, 'http 500');
});

test('ingestBatch считает отсев и не падает на мусоре', () => {
  assert.deepEqual(ingestBatch('не массив'), { accepted: 0, rejected: 0 });
  assert.deepEqual(ingestBatch([{ type: 'evil' }, null, 42]), { accepted: 0, rejected: 3 });
});
