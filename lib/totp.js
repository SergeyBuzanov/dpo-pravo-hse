/**
 * TOTP (RFC 6238) без зависимостей: HMAC-SHA1, 6 цифр, шаг 30 с.
 * Совместимо с Google Authenticator / Яндекс Ключ / Aegis.
 */

'use strict';

const crypto = require('node:crypto');

function safeEqualStr(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) {
    crypto.timingSafeEqual(ba, ba);
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

const ALPH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_S = 30;
const DIGITS = 6;
const WINDOW = 1;

function encodeBase32(buf) {
  const bytes = Buffer.from(buf);
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPH[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPH[(value << (5 - bits)) & 31];
  return out;
}

function decodeBase32(str) {
  const s = String(str)
    .toUpperCase()
    .replace(/=+$/g, '')
    .replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of s) {
    const i = ALPH.indexOf(ch);
    if (i < 0) throw new Error('неверный секрет TOTP');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function hotp(secret, counter) {
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = crypto.createHmac('sha1', secret).update(buf).digest();
  const off = hmac[hmac.length - 1] & 0xf;
  const bin = hmac.readUInt32BE(off) & 0x7fffffff;
  return String(bin % 10 ** DIGITS).padStart(DIGITS, '0');
}

function totpAt(secret, atMs = Date.now()) {
  return hotp(secret, Math.floor(atMs / 1000 / STEP_S));
}

function verifyTotp(secretB32, code, atMs = Date.now()) {
  let secret;
  try {
    secret = decodeBase32(secretB32);
  } catch {
    return false;
  }
  const c = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(c)) return false;
  const step = Math.floor(atMs / 1000 / STEP_S);
  for (let d = -WINDOW; d <= WINDOW; d++) {
    if (safeEqualStr(hotp(secret, step + d), c)) return true;
  }
  return false;
}

function generateSecret() {
  return encodeBase32(crypto.randomBytes(20));
}

function otpauthUrl(secretB32, account = 'admin', issuer = 'DPO-Admin') {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const iss = encodeURIComponent(issuer);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${iss}&digits=${DIGITS}&period=${STEP_S}`;
}

module.exports = {
  encodeBase32,
  decodeBase32,
  totpAt,
  verifyTotp,
  generateSecret,
  otpauthUrl,
  STEP_S,
};
