const test = require('node:test');
const assert = require('node:assert');
const { isoDate } = require('../../lib/hse-catalog');

test('дата берётся по локальным компонентам, без сдвига в UTC', () => {
  // Полночь 3 августа 2026 в местной зоне. При toISOString() в любой зоне
  // восточнее Гринвича это превратилось бы во 2 августа.
  const local = new Date(2026, 7, 3, 0, 0, 0);
  assert.strictEqual(isoDate(local), '2026-08-03');
});

test('однозначные месяц и день дополняются нулём', () => {
  assert.strictEqual(isoDate(new Date(2026, 0, 5, 12, 0, 0)), '2026-01-05');
});

test('некорректная дата даёт null, а не исключение', () => {
  assert.strictEqual(isoDate('не дата'), null);
  assert.strictEqual(isoDate(null), null);
  assert.strictEqual(isoDate(undefined), null);
});

const { formatDate } = require('../../lib/hse-catalog');

test('formatDate: корректная дата форматируется по-русски', () => {
  const item = { startDate: new Date(2026, 7, 3).getTime() };
  assert.match(formatDate(item), /3 августа 2026/);
});

test('formatDate: без дня месяца — только месяц и год', () => {
  const item = { startDate: new Date(2026, 7, 3).getTime(), isStartDateWithoutDay: true };
  assert.match(formatDate(item), /август 2026/);
});

test('formatDate: битая дата даёт null, а не RangeError', () => {
  assert.strictEqual(formatDate({ startDate: 'мусор' }), null);
  assert.strictEqual(formatDate({ startDate: NaN }), null);
});

test('formatDate: даты нет — null', () => {
  assert.strictEqual(formatDate({}), null);
});
