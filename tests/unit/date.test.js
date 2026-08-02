const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { isoDate, formatDate } = require('../../lib/hse-catalog');

// hse.ru отдаёт старт программы меткой времени, означающей полночь ПО МОСКВЕ.
// 1785704400000 = 3 августа 2026, 00:00 MSK (= 2 августа, 21:00 UTC).
// Именно на этом значении ломался прежний код: в контейнере с UTC он показывал
// «2 августа» — на сутки раньше настоящего старта, и так по всем 25 программам.
const MSK_MIDNIGHT_3_AUG_2026 = 1785704400000;

test('isoDate: московская полночь не откатывается на сутки назад', () => {
  assert.strictEqual(isoDate(MSK_MIDNIGHT_3_AUG_2026), '2026-08-03');
});

test('isoDate: однозначные месяц и день дополняются нулём', () => {
  // 5 января 2026, 00:00 MSK
  assert.strictEqual(isoDate(Date.UTC(2026, 0, 4, 21, 0, 0)), '2026-01-05');
});

test('isoDate: некорректная дата даёт null, а не исключение', () => {
  assert.strictEqual(isoDate('не дата'), null);
  assert.strictEqual(isoDate(null), null);
  assert.strictEqual(isoDate(undefined), null);
});

test('formatDate: корректная дата форматируется по-русски', () => {
  assert.match(formatDate({ startDate: MSK_MIDNIGHT_3_AUG_2026 }), /3 августа 2026/);
});

test('formatDate: без дня месяца — только месяц и год', () => {
  const item = { startDate: MSK_MIDNIGHT_3_AUG_2026, isStartDateWithoutDay: true };
  assert.match(formatDate(item), /август 2026/);
});

test('formatDate: битая дата даёт null, а не RangeError', () => {
  assert.strictEqual(formatDate({ startDate: 'мусор' }), null);
  assert.strictEqual(formatDate({ startDate: NaN }), null);
});

test('formatDate: даты нет — null', () => {
  assert.strictEqual(formatDate({}), null);
});

// Главная проверка: дата программы не должна зависеть от того, где крутится
// процесс. Часовой пояс задаётся при старте Node, поэтому проверяем дочерними
// процессами — внутри одного теста его уже не переключить.
test('дата одинакова в любом часовом поясе процесса', () => {
  const root = path.join(__dirname, '..', '..');
  const code =
    "const {isoDate, formatDate} = require('./lib/hse-catalog');" +
    `const t = ${MSK_MIDNIGHT_3_AUG_2026};` +
    "process.stdout.write(isoDate(t) + '|' + formatDate({startDate: t}));";

  for (const tz of ['UTC', 'America/New_York', 'Asia/Tokyo', 'Europe/Moscow']) {
    const out = execFileSync(process.execPath, ['-e', code], {
      cwd: root,
      env: { ...process.env, TZ: tz },
      encoding: 'utf8',
    });
    assert.strictEqual(out, '2026-08-03|3 августа 2026 г.', `часовой пояс ${tz}`);
  }
});
