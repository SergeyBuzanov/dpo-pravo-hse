/**
 * Табло ближайших стартов: колонка на месяц, в строке день, название, мета
 * с точкой сферы и кнопка заявки; лишние строки за «Ещё N»; прошедшие даты
 * не попадают. Пришло на смену ленте-билетам 03.09.2026.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { renderStarts } = require('../../scripts/build-landing');

const NEXT_YEAR = new Date().getFullYear() + 1;
const program = (id, title, day, month, price = 50000) => ({
  id, title, startDate: `${NEXT_YEAR}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00`,
  type: { shortTitle: 'ПК' }, studyFormat: { title: 'Онлайн синхронный' }, educationPricing: price,
});

test('колонка на месяц со счётчиком, строки с днём, метой и заявкой', () => {
  const { html, count, months } = renderStarts([
    program(1, 'Контрактное право Гонконга', 14, 9),
    program(2, 'Морской арбитраж', 9, 11),
    program(3, 'Нейроправо', 29, 11),
  ]);
  assert.equal(count, 3);
  assert.equal(months, 2);
  assert.match(html, /<h3 class="dpo-month-title"[^>]*>Сентябрь <span class="dpo-month-count">1 старт<\/span>/);
  assert.match(html, /Ноябрь <span class="dpo-month-count">2 старта<\/span>/);
  assert.match(html, /<span class="dpo-slot-day" aria-hidden="true">14<\/span>/);
  assert.match(html, /<i class="dpo-slot-dot" data-sphere="corporate"/);
  assert.match(html, /ПК · Онлайн синхронный · 50&nbsp;000&nbsp;₽|ПК · Онлайн синхронный · 50\u00A0000\u00A0₽/);
  assert.match(html, /class="dpo-slot-apply" data-application/);
  assert.doesNotMatch(html, /dpo-month-more/, 'при трёх стартах раскрывать нечего');
});

test('шестая и дальше строки месяца свёрнуты за «Ещё N программ»', () => {
  const list = Array.from({ length: 7 }, (_, i) => program(10 + i, `Программа ${i + 1}`, i + 1, 10));
  const { html } = renderStarts(list);
  assert.equal(html.split('dpo-slot is-extra').length - 1, 2);
  assert.match(html, /class="dpo-month-more"[^>]*>Ещё 2 программы</);
});

test('прошедшие старты не попадают, пустой список – пустая секция', () => {
  assert.equal(renderStarts([{ id: 1, title: 'Было', startDate: '2020-01-01T00:00:00' }]).html, '');
});
