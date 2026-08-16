'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Каталог хранилища выбирается при загрузке модуля — переменную окружения
// надо выставить ДО require. Настоящие заявки при этом остаются в стороне:
// тест пишет во временный каталог и удаляет его за собой.
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dpo-apps-'));
process.env.APPLICATIONS_DIR = DIR;

const store = require('../../lib/application-store');
const { parseApplication } = require('../../lib/application-form');

test.after(() => fs.rmSync(DIR, { recursive: true, force: true }));

const make = (over = {}) =>
  parseApplication({
    firstName: 'Анна',
    lastName: 'Петрова',
    phone: '+7 999 123-45-67',
    email: 'anna@example.org',
    consent: true,
    ...over,
  }).application;

test('заявка сохраняется и читается обратно', async () => {
  const { id, duplicate } = await store.save(make());
  assert.equal(duplicate, false);
  assert.ok(id);

  const items = await store.list();
  const found = items.find((i) => i.id === id);
  assert.equal(found.email, 'anna@example.org');
  assert.equal(found.status, 'new');
});

test('файл месяца доступен только владельцу', async () => {
  await store.save(make({ email: 'b@example.org' }));
  const month = `${new Date().toISOString().slice(0, 7)}.jsonl`;
  const mode = fs.statSync(path.join(DIR, month)).mode & 0o777;
  assert.equal(mode, 0o600, `права ${mode.toString(8)} вместо 600`);
  assert.equal(fs.statSync(DIR).mode & 0o777, 0o700);
});

test('повторная отправка той же заявки не создаёт вторую', async () => {
  const app = make({ email: 'twin@example.org', programId: '123' });
  const first = await store.save(app);
  const second = await store.save({ ...app, noAnnouncements: true });
  assert.equal(second.duplicate, true);
  assert.equal(second.id, first.id);
});

test('заявка на другую программу повтором не считается', async () => {
  const a = await store.save(make({ email: 'multi@example.org', programId: '1' }));
  const b = await store.save(make({ email: 'multi@example.org', programId: '2' }));
  assert.equal(b.duplicate, false);
  assert.notEqual(a.id, b.id);
});

test('старая заявка того же человека повтором не считается', async () => {
  const old = make({ email: 'later@example.org', programId: '7' });
  old.receivedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  await store.save(old);
  const now = await store.save(make({ email: 'later@example.org', programId: '7' }));
  assert.equal(now.duplicate, false);
});

test('одновременные отправки не перемешиваются в файле', async () => {
  const many = Array.from({ length: 12 }, (_, i) => make({ email: `p${i}@example.org` }));
  await Promise.all(many.map((a) => store.save(a)));

  const month = `${new Date().toISOString().slice(0, 7)}.jsonl`;
  const lines = fs.readFileSync(path.join(DIR, month), 'utf8').split('\n').filter(Boolean);
  for (const line of lines) assert.doesNotThrow(() => JSON.parse(line), `битая строка: ${line.slice(0, 60)}`);
});

test('статус меняется, журнал заявок при этом не переписывается', async () => {
  const { id } = await store.save(make({ email: 'status@example.org' }));
  const month = path.join(DIR, `${new Date().toISOString().slice(0, 7)}.jsonl`);
  const before = fs.readFileSync(month, 'utf8');

  await store.setStatus(id, 'done');

  assert.equal(fs.readFileSync(month, 'utf8'), before);
  const item = (await store.list()).find((i) => i.id === id);
  assert.equal(item.status, 'done');
});

test('неизвестный статус отвергается', async () => {
  const { id } = await store.save(make({ email: 'bad-status@example.org' }));
  await assert.rejects(() => store.setStatus(id, 'удалить-всё'), /неизвестный статус/);
});

test('файл статусов тоже закрыт от посторонних', async () => {
  const mode = fs.statSync(path.join(DIR, 'status.json')).mode & 0o777;
  assert.equal(mode, 0o600, `права ${mode.toString(8)} вместо 600`);
});

test('срок хранения: старые месяцы удаляются целиком, свежие остаются', async () => {
  const older = path.join(DIR, '2020-01.jsonl');
  const fresh = path.join(DIR, `${new Date().toISOString().slice(0, 7)}.jsonl`);
  fs.writeFileSync(older, `${JSON.stringify({ id: 'old', receivedAt: '2020-01-05T00:00:00.000Z' })}\n`);

  const removed = await store.purgeOld(365);
  assert.ok(removed.includes('2020-01'));
  assert.equal(fs.existsSync(older), false);
  assert.equal(fs.existsSync(fresh), true);
});

test('битая строка не делает нечитаемым весь месяц', async () => {
  const month = path.join(DIR, `${new Date().toISOString().slice(0, 7)}.jsonl`);
  fs.appendFileSync(month, '{"id":"обрыв записи при пад\n');
  const { id } = await store.save(make({ email: 'after-broken@example.org' }));
  const items = await store.list();
  assert.ok(items.find((i) => i.id === id));
});

test('сводка считает новые заявки', async () => {
  const s = await store.stats();
  assert.ok(s.total >= s.new);
  assert.equal(s.retentionDays, 365);
});
