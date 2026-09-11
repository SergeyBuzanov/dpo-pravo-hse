/**
 * Исход письма менеджеру должен ОСТАВАТЬСЯ в хранилище, а не только в
 * консоли контейнера.
 *
 * До 03.09.2026 deliver() отвечал `mail: 'queued'`, отправка жила своей
 * жизнью, и отказ SMTP (просроченный пароль, закрытый порт, переполненный
 * ящик) видел только тот, кто читает docker logs. Владелец узнавал о
 * недоставке никогда. Найдено линзой наблюдаемости прогона 03.09.2026.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dpo-deliver-'));
process.env.APPLICATIONS_DIR = DIR;

const store = require('../../lib/application-store');
const { deliver, mailStatus, sendTestMail, formatLetter } = require('../../lib/application-delivery');
const { parseApplication } = require('../../lib/application-form');

test.after(() => fs.rmSync(DIR, { recursive: true, force: true }));

/** Порт, на котором никто не слушает: соединение отклоняется мгновенно. */
async function closedPort() {
  const srv = net.createServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const { port } = srv.address();
  await new Promise((r) => srv.close(r));
  return port;
}

const make = (email) =>
  parseApplication({
    firstName: 'Анна',
    lastName: 'Петрова',
    phone: '+7 999 123-45-67',
    email,
    consent: true,
  }).application;

test('отказ SMTP записывается в хранилище и виден в списке и сводке', async () => {
  const env = {
    APPLICATION_MAIL_TO: 'manager@example.org',
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String(await closedPort()),
    SMTP_USER: 'site',
    SMTP_PASS: 'x',
    SMTP_TIMEOUT_MS: '2000',
  };
  const result = await deliver(make('fail@example.org'), { env, waitForMail: true });
  assert.equal(result.mail, 'failed');

  const item = (await store.list()).find((i) => i.id === result.id);
  assert.equal(item.mail, 'failed');
  assert.ok(item.mailError, 'причина отказа не сохранена');

  const stats = await store.stats();
  assert.equal(stats.mailFailed, 1);
});

test('mailStatus показывает, каких переменных не хватает', () => {
  const empty = mailStatus({});
  assert.equal(empty.configured, false);
  assert.ok(empty.missing.includes('SMTP_HOST'));
  assert.ok(empty.missing.includes('APPLICATION_MAIL_TO'));

  const ready = mailStatus({
    SMTP_HOST: 'mail.example.org',
    SMTP_PORT: '465',
    APPLICATION_MAIL_TO: 'office@example.org, second@example.org',
    SMTP_USER: 'site',
  });
  assert.equal(ready.configured, true);
  assert.equal(ready.host, 'mail.example.org');
  assert.equal(ready.to.length, 2);
});

test('пробное письмо без настроек не идёт на сервер', async () => {
  await assert.rejects(() => sendTestMail({}), (err) => {
    assert.equal(err.code, 'MAIL_NOT_CONFIGURED');
    assert.match(err.message, /SMTP_HOST/);
    return true;
  });
});

test('в письмо не попадает чужой URL программы', () => {
  const app = make('phish@example.org');
  app.program = { id: '1', title: 'Курс', url: 'https://evil.example/login' };
  const letter = formatLetter(app, 'id-phish');
  assert.equal(letter.includes('evil.example'), false);
  assert.equal(letter.includes('Страница программы:'), false);
});

test('смена статуса заявки не стирает исход письма', async () => {
  await store.setMail('id-1', { mail: 'failed', error: 'тест' });
  await store.setStatus('id-1', 'done');
  const statuses = JSON.parse(fs.readFileSync(path.join(DIR, 'status.json'), 'utf8'));
  assert.equal(statuses['id-1'].status, 'done');
  assert.equal(statuses['id-1'].mail, 'failed');
});
