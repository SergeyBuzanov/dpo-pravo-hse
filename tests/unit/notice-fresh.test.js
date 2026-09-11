'use strict';

/**
 * Блок «Важно» с датой полугодовой давности читается как заброшенный сайт.
 * Показ режет isNoticeFresh: старше 90 московских суток скрываем, без даты
 * оставляем (бессрочная акция / чек-лист).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { isNoticeFresh, parseNoticeDate, NOTICE_MAX_AGE_DAYS } = require('../../lib/catalog-store');

const NOW = Date.parse('2026-09-10T12:00:00+03:00');

test('порог свежести – 90 дней', () => {
  assert.equal(NOTICE_MAX_AGE_DAYS, 90);
});

test('дата DD.MM.YYYY разбирается, 31 февраля отбрасывается', () => {
  assert.deepEqual(parseNoticeDate('12.06.2026'), { year: 2026, month: 6, day: 12 });
  assert.equal(parseNoticeDate('31.02.2026'), null);
  assert.equal(parseNoticeDate('весна 2026'), null);
  assert.equal(parseNoticeDate(''), null);
});

test('объявление без даты остаётся – это бессрочная акция', () => {
  assert.equal(isNoticeFresh({ text: 'Чек-лист по брачному договору' }, NOW), true);
});

test('ровно 90 дней ещё показываем, 91 – уже нет', () => {
  assert.equal(isNoticeFresh({ text: 'x', date: '12.06.2026' }, NOW), true);
  assert.equal(isNoticeFresh({ text: 'x', date: '11.06.2026' }, NOW), false);
});

test('мартовские и майские объявления 2026 скрыты на 10 сентября', () => {
  assert.equal(isNoticeFresh({ text: 'x', date: '22.05.2026' }, NOW), false);
  assert.equal(isNoticeFresh({ text: 'x', date: '19.03.2026' }, NOW), false);
  assert.equal(isNoticeFresh({ text: 'x', date: '16.03.2026' }, NOW), false);
});

test('будущая дата и пустой объект не ломают проверку', () => {
  assert.equal(isNoticeFresh({ text: 'x', date: '01.01.2027' }, NOW), true);
  assert.equal(isNoticeFresh(null, NOW), false);
  assert.equal(isNoticeFresh({ date: '10.09.2026' }, NOW), false);
});
