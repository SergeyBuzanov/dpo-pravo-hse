'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('nginx отдаёт COOP, CORP и object-src', () => {
  const conf = read('docker/nginx.conf');
  assert.match(conf, /Cross-Origin-Opener-Policy.*same-origin/);
  assert.match(conf, /Cross-Origin-Resource-Policy.*same-origin/);
  assert.match(conf, /object-src 'none'/);
  assert.match(conf, /http:\/\/intake:5179/);
});

test('TLS-конфиг включает HSTS и TLS 1.3', () => {
  const conf = read('docker/nginx-tls.conf');
  assert.match(conf, /listen 443 ssl/);
  assert.match(conf, /ssl_protocols\s+TLSv1\.2 TLSv1\.3/);
  assert.match(conf, /Strict-Transport-Security/);
});

test('compose ограничивает память контейнеров', () => {
  const compose = read('docker-compose.yml');
  assert.match(compose, /mem_limit:\s*128m/);
  assert.match(compose, /mem_limit:\s*256m/);
  assert.match(compose, /mem_limit:\s*512m/);
});

test('приём заявок — отдельный процесс', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'intake-server.js')), true);
  const compose = read('docker-compose.yml');
  assert.match(compose, /container_name: dpo-intake/);
  assert.match(compose, /DISABLE_PUBLIC_INTAKE:\s*"1"/);
  assert.match(compose, /DPO_DATA_DIR:\s*"\/data"/);
  assert.match(compose, /\.\/\.data:\/data/);
  assert.match(compose, /ADMIN_ALLOW_BASIC:\s*"0"/);
});

test('серверы закрывают соединения по SIGTERM', () => {
  assert.match(read('intake-server.js'), /attachShutdown/);
  assert.match(read('admin-server.js'), /attachShutdown/);
  assert.match(read('lib/http-shutdown.js'), /SIGTERM/);
});

test('админка больше не требует Basic, чтобы отдать HTML', () => {
  const server = read('admin-server.js');
  assert.match(server, /POST.*\/api\/login/);
  assert.match(server, /createSessionStore/);
  assert.match(server, /verifyTotp/);
  const html = read('admin.html');
  assert.match(html, /id="loginGate"/);
  assert.match(html, /\/api\/login/);
});

test('страницы программ несут SRI на скриптах', () => {
  const page = read('programs/angliyskoe-kontraktnoe-pravo-856421092.html');
  assert.match(page, /integrity="sha384-/);
  const { integrityFor } = require('../../lib/sri');
  const expected = integrityFor('js/support-bot.js');
  assert.ok(page.includes(expected), 'хеш support-bot.js не совпал с файлом');
});
