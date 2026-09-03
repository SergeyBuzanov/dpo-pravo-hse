/**
 * Табло ближайших стартов каталога: колонка на месяц, строка с днём, метой,
 * точкой сферы и кнопкой заявки; лишние строки за «Ещё N»; прошедшие даты
 * не попадают. Пришло на смену стреле времени 03.09.2026.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildStartsBlock } = require('../../update-catalog');

const NOW = new Date('2026-09-03T12:00:00+03:00');
const program = (id, title, iso, price = 50000) => ({
  id, title, startDate: iso, type: { shortTitle: 'ПК' }, studyFormat: { title: 'Онлайн синхронный' }, educationPricing: price,
});

test('колонки по месяцам со счётчиками, строки с днём, метой, точкой сферы и заявкой', () => {
  const html = buildStartsBlock([
    program(1, 'Контрактное право Гонконга', '2026-09-14T00:00:00+03:00'),
    program(2, 'Морской арбитраж', '2026-11-09T00:00:00+03:00'),
    program(3, 'Нейроправо', '2026-11-29T00:00:00+03:00'),
    program(4, 'Прошедшее', '2026-08-01T00:00:00+03:00'),
  ], NOW);
  assert.match(html, /Сентябрь <span class="starts-month-count">1 старт</);
  assert.match(html, /Ноябрь <span class="starts-month-count">2 старта</);
  assert.doesNotMatch(html, /Прошедшее/);
  assert.match(html, /<span class="starts-day" aria-hidden="true">14</);
  assert.match(html, /<i class="starts-dot" data-sphere="corporate"/);
  assert.match(html, /class="card-apply" data-application/);
  assert.match(html, /ПК · Онлайн синхронный · /);
  assert.doesNotMatch(html, /starts-more/, 'при трёх стартах раскрывать нечего');
});

test('шестая и дальше строки месяца свёрнуты за «Ещё N программ»', () => {
  const list = Array.from({ length: 7 }, (_, i) => program(10 + i, `Программа ${i + 1}`, `2026-10-${String(i + 1).padStart(2, '0')}T00:00:00+03:00`));
  const html = buildStartsBlock(list, NOW);
  assert.equal(html.split('starts-slot is-extra').length - 1, 2);
  assert.match(html, /class="starts-more"[^>]*>Ещё 2 программы</);
});

test('без будущих стартов секции нет', () => {
  assert.equal(buildStartsBlock([program(1, 'Было', '2020-01-01T00:00:00+03:00')], NOW), '');
});
