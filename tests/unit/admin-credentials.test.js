'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { hashPassword, verifyPassword, safeEqualStr, loadOrCreateCredentials } = require('../../lib/admin-credentials');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dpo-creds-'));
test.after(() => fs.rmSync(DIR, { recursive: true, force: true }));

test('хеш проверяется только своим паролем', async () => {
  const { salt, hash } = await hashPassword('correct horse');
  assert.equal(await verifyPassword('correct horse', salt, hash), true);
  assert.equal(await verifyPassword('correct horsf', salt, hash), false);
  assert.notEqual(hash, (await hashPassword('correct horse')).hash, 'соль должна быть случайной');
});

test('safeEqualStr сравнивает строки разной длины без исключения', () => {
  assert.equal(safeEqualStr('abc', 'abc'), true);
  assert.equal(safeEqualStr('abc', 'abcd'), false);
});

test('первый запуск создаёт файл 0600 с одноразовым паролем, второй – читает его', async () => {
  const file = path.join(DIR, '.admin-credentials.json');
  const first = await loadOrCreateCredentials(file);
  assert.equal(first.isNew, true);
  assert.equal(typeof first.plainPassword, 'string');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600, 'креды админки должны быть читаемы только владельцу');
  const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal('password' in stored, false, 'пароль открытым текстом храниться не должен');
  assert.equal(await verifyPassword(first.plainPassword, stored.passwordSalt, stored.passwordHash), true);

  const second = await loadOrCreateCredentials(file);
  assert.equal(second.isNew, false);
  assert.equal(second.plainPassword, null);
  assert.equal(second.username, first.username);
});
