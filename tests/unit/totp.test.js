'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { generateSecret, totpAt, verifyTotp, decodeBase32, otpauthUrl } = require('../../lib/totp');

test('секрет кодируется в base32 и даёт 6-значный код', () => {
  const secret = generateSecret();
  assert.match(secret, /^[A-Z2-7]+$/);
  const code = totpAt(decodeBase32(secret), Date.parse('2026-09-11T12:00:00Z'));
  assert.match(code, /^\d{6}$/);
});

test('verifyTotp принимает текущий шаг и соседние', () => {
  const secret = generateSecret();
  const at = Date.parse('2026-09-11T12:00:00Z');
  const code = totpAt(decodeBase32(secret), at);
  assert.equal(verifyTotp(secret, code, at), true);
  assert.equal(verifyTotp(secret, code, at + 25_000), true);
  assert.equal(verifyTotp(secret, '000000', at), false);
  assert.equal(verifyTotp(secret, 'abcdef', at), false);
});

test('otpauth URL пригоден для Google Authenticator', () => {
  const url = otpauthUrl('JBSWY3DPEHPK3PXP', 'admin');
  assert.match(url, /^otpauth:\/\/totp\/DPO-Admin%3Aadmin\?/);
  assert.match(url, /secret=JBSWY3DPEHPK3PXP/);
  assert.match(url, /digits=6/);
});
