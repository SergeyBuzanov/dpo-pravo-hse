/**
 * Ось времени ближайших стартов каталога: карточка каждого старта стоит на
 * своей дате (24px на день), близкие даты разведены по дорожкам, полосы
 * месяцев со счётчиками, метка «сегодня», прошедшие даты не попадают.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildStartsBlock } = require('../../update-catalog');

const NOW = new Date('2026-09-03T12:00:00+03:00');
const program = (id, title, iso, price = 50000) => ({
  id, title, startDate: iso, type: { shortTitle: 'ПК' }, studyFormat: { title: 'Онлайн синхронный' }, educationPricing: price,
});

test('карточки стоят на своих датах, месяцы подписаны со счётчиками, есть «сегодня»', () => {
  const html = buildStartsBlock([
    program(1, 'Контрактное право Гонконга', '2026-09-14T00:00:00+03:00'),
    program(2, 'Морской арбитраж', '2026-11-09T00:00:00+03:00'),
    program(3, 'Прошедшее', '2026-08-01T00:00:00+03:00'),
  ], NOW);
  assert.doesNotMatch(html, /Прошедшее/);
  assert.match(html, /tl-month-label">Сентябрь <b>1<\/b>/);
  assert.match(html, /tl-month-label">Октябрь <b>0<\/b>/);
  assert.match(html, /tl-month-label">Ноябрь <b>1<\/b>/);
  // 14 сентября: 13 дней от начала оси × 28px + 14 = 378; карточка на 28px левее булавки
  assert.match(html, /class="tl-item tl-up1" style="left:350px;--tl-pin:28px"/);
  assert.match(html, /<span class="tl-when" aria-hidden="true">14 сентября</);
  assert.match(html, /tl-dot" data-sphere="corporate"/);
  assert.match(html, /class="tl-today" style="left:70px"/, 'сегодня 3 сентября – третий день оси');
  assert.match(html, /style="width:2548px"/, 'сентябрь–ноябрь = 91 день × 28px');
  assert.match(html, /с сентября по ноябрь/);
});

test('близкие даты разводятся по дорожкам, дальние возвращаются на первую', () => {
  const html = buildStartsBlock([
    program(1, 'А', '2026-10-01T00:00:00+03:00'),
    program(2, 'Б', '2026-10-02T00:00:00+03:00'),
    program(3, 'В', '2026-10-03T00:00:00+03:00'),
    program(4, 'Г', '2026-10-04T00:00:00+03:00'),
    program(5, 'Д', '2026-10-05T00:00:00+03:00'),
    program(6, 'Е', '2026-10-25T00:00:00+03:00'),
  ], NOW);
  const lanes = [...html.matchAll(/class="tl-item tl-(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(lanes.slice(0, 4), ['up1', 'down1', 'up2', 'down2']);
  assert.equal(lanes[5], 'up1', 'через три недели первая дорожка снова свободна');
});

test('без будущих стартов секции нет', () => {
  assert.equal(buildStartsBlock([program(1, 'Было', '2020-01-01T00:00:00+03:00')], NOW), '');
});
