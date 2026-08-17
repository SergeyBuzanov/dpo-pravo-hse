const test = require('node:test');
const assert = require('node:assert');
const { upcomingStartLabel } = require('../../lib/hse-catalog');

// hse.ru отдаёт старт меткой московской полуночи: 00:00 МСК = 21:00 UTC
// предыдущего дня. Собираем метки так же, как их присылает источник.
const mskMidnight = (y, m, d) => Date.UTC(y, m - 1, d) - 3 * 3600 * 1000;

// «Сегодня» во всех проверках задано явно: тест не должен зависеть от того,
// в какой день его запустили.
const NOW = new Date(mskMidnight(2026, 9, 15) + 12 * 3600 * 1000); // 15.09.2026, полдень МСК

test('будущая дата выводится подписью «Старт: …»', () => {
  const label = upcomingStartLabel({ startDate: mskMidnight(2026, 9, 22) }, NOW);
  assert.match(label, /^Старт: 22 сентября 2026/);
});

test('прошедшая дата не выводится вовсе', () => {
  assert.equal(upcomingStartLabel({ startDate: mskMidnight(2026, 9, 1) }, NOW), null);
});

test('старт сегодня ещё показывается', () => {
  assert.match(upcomingStartLabel({ startDate: mskMidnight(2026, 9, 15) }, NOW), /^Старт: 15 сентября 2026/);
});

test('дата с точностью до месяца жива, пока месяц не кончился', () => {
  const item = { startDate: mskMidnight(2026, 9, 1), isStartDateWithoutDay: true };
  assert.match(upcomingStartLabel(item, NOW), /^Старт: сентябрь 2026/);
  const october = new Date(mskMidnight(2026, 10, 2));
  assert.equal(upcomingStartLabel(item, october), null);
});

test('без даты строки нет и «уточняется» не подставляется', () => {
  assert.equal(upcomingStartLabel({}, NOW), null);
  assert.equal(upcomingStartLabel({ startDate: 'мусор' }, NOW), null);
});

// Сравнение идёт по московскому календарю: метка полуночи МСК в UTC-процессе
// не должна съезжать на сутки назад и «протухать» раньше времени.
test('московская полночь не съезжает на сутки в чужом поясе', () => {
  const justBefore = new Date(mskMidnight(2026, 9, 22) - 60 * 1000); // 23:59 МСК 21.09
  assert.match(upcomingStartLabel({ startDate: mskMidnight(2026, 9, 22) }, justBefore), /^Старт: 22 сентября/);
});
