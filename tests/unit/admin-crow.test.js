'use strict';

/**
 * Админка живёт в том же визуальном словаре, что витрина, и держит
 * ворону Шерлок на дежурстве. Тест читает исходники: CSP должна пускать
 * js/crow-mascot.js, шапка несёт знак центра, а реплика say() есть в API.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const admin = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
const server = fs.readFileSync(path.join(ROOT, 'admin-server.js'), 'utf8');
const headers = fs.readFileSync(path.join(ROOT, 'lib/security-headers.js'), 'utf8');
const mascot = fs.readFileSync(path.join(ROOT, 'js/crow-mascot.js'), 'utf8');
const duty = fs.readFileSync(path.join(ROOT, 'js/admin-crow.js'), 'utf8');

test('CSP админки пускает свои скрипты – иначе ворона не загрузится', () => {
  assert.match(admin, /script-src 'self' 'unsafe-inline'/);
  assert.match(headers, /script-src 'self' 'unsafe-inline'/);
  assert.match(server, /ADMIN_CSP/);
  assert.match(admin, /<script src="js\/crow-mascot\.js">/);
  assert.match(admin, /<script src="js\/admin-crow\.js">/);
});

test('шапка админки – знак центра и пилюля «Админка», как на витрине', () => {
  assert.match(admin, /images\/logo\/brand-mark-96\.webp/);
  assert.match(admin, /class="admin-pill"/);
  assert.match(admin, /class="hero"/);
  assert.match(admin, /class="eyebrow"/);
});

test('у маскота есть say() с произвольным текстом', () => {
  assert.match(mascot, /CrowMascot\.prototype\.say = function/);
  assert.match(duty, /function boot\(/);
  assert.match(duty, /На дежурстве/);
  assert.match(admin, /AdminCrow\.boot\(\)/);
});
