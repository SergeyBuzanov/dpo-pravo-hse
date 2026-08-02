const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { moscowParts, moscowDayKey, moscowMinutesOfDay } = require('../../lib/moscow-time');

// 2 августа 2026, 21:00 UTC = 3 августа 2026, 00:00 по Москве.
// Момент выбран специально: это ровно та граница, на которой ломалось всё —
// даты программ уезжали на сутки назад, а «уже запускались сегодня» считалось
// по UTC-суткам.
const MSK_MIDNIGHT = Date.UTC(2026, 7, 2, 21, 0, 0);

test('moscowParts: московская полночь разбирается как 3 августа, 00:00', () => {
  const p = moscowParts(new Date(MSK_MIDNIGHT));
  assert.deepStrictEqual(
    { y: p.year, m: p.month, d: p.day, h: p.hour, min: p.minute },
    { y: 2026, m: 8, d: 3, h: 0, min: 0 },
  );
});

test('moscowDayKey: московская полночь — уже следующие сутки', () => {
  assert.strictEqual(moscowDayKey(new Date(MSK_MIDNIGHT)), '2026-08-03');
  // За минуту до неё — ещё предыдущие
  assert.strictEqual(moscowDayKey(new Date(MSK_MIDNIGHT - 60_000)), '2026-08-02');
});

test('moscowMinutesOfDay: полночь — 0, а не 24 часа', () => {
  assert.strictEqual(moscowMinutesOfDay(new Date(MSK_MIDNIGHT)), 0);
  assert.strictEqual(moscowMinutesOfDay(new Date(MSK_MIDNIGHT + 3 * 3600_000)), 180);
});

test('битые значения дают null, а не исключение', () => {
  assert.strictEqual(moscowParts('не дата'), null);
  assert.strictEqual(moscowDayKey(NaN), null);
  assert.strictEqual(moscowMinutesOfDay(new Date('мусор')), null);
});

test('результат не зависит от часового пояса процесса', () => {
  const root = path.join(__dirname, '..', '..');
  const code =
    "const m = require('./lib/moscow-time');" +
    `const t = new Date(${MSK_MIDNIGHT});` +
    "process.stdout.write(m.moscowDayKey(t) + '|' + m.moscowMinutesOfDay(t));";

  for (const tz of ['UTC', 'America/New_York', 'Asia/Tokyo', 'Europe/Moscow']) {
    const out = execFileSync(process.execPath, ['-e', code], {
      cwd: root,
      env: { ...process.env, TZ: tz },
      encoding: 'utf8',
    });
    assert.strictEqual(out, '2026-08-03|0', `часовой пояс ${tz}`);
  }
});
