/**
 * Учётные данные админки: scrypt-хеширование, безопасные сравнения,
 * загрузка/миграция/генерация .admin-credentials.json.
 *
 * Файл на диске: { username, passwordHash, passwordSalt, algo: 'scrypt' }.
 * Легаси-формат { username, password } (plaintext) мигрируется на первом
 * чтении; при отсутствии файла создаётся пара admin/<случайный пароль>,
 * который показывается один раз (poле plainPassword результата).
 */

'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { generateSecret, otpauthUrl } = require('./totp');

const scryptAsync = promisify(crypto.scrypt);

const SCRYPT_PARAMS = Object.freeze({ N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
const KEYLEN = 64;

async function hashPassword(password, salt = crypto.randomBytes(16)) {
  const derived = await scryptAsync(String(password), salt, KEYLEN, SCRYPT_PARAMS);
  return {
    salt: salt.toString('base64'),
    hash: derived.toString('base64'),
    algo: 'scrypt',
  };
}

async function verifyPassword(password, saltB64, hashB64) {
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');
  const derived = await scryptAsync(String(password), salt, expected.length, SCRYPT_PARAMS);
  return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
}

function safeEqualStr(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) {
    // Still do a dummy compare to reduce length-oracle timing differences.
    crypto.timingSafeEqual(ba, ba);
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

async function loadOrCreateCredentials(credentialsFile) {
  let raw = null;
  try {
    raw = JSON.parse(await fsp.readFile(credentialsFile, 'utf8'));
  } catch {
    raw = null;
  }

  // Already hashed
  if (raw?.username && raw?.passwordHash && raw?.passwordSalt) {
    let totpSecret = raw.totpSecret;
    let totpEnrolled = Boolean(totpSecret);
    if (!totpSecret) {
      totpSecret = generateSecret();
      const next = { ...raw, totpSecret, totpEnrolled: false };
      await fsp.writeFile(credentialsFile, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 });
      totpEnrolled = false;
    } else {
      totpEnrolled = raw.totpEnrolled !== false;
    }
    return {
      username: raw.username,
      passwordHash: raw.passwordHash,
      passwordSalt: raw.passwordSalt,
      totpSecret,
      totpEnrolled,
      isNew: false,
      plainPassword: null,
    };
  }

  // Legacy plaintext → migrate
  if (raw?.username && raw?.password) {
    const { salt, hash } = await hashPassword(raw.password);
    const migrated = {
      username: raw.username,
      passwordHash: hash,
      passwordSalt: salt,
      algo: 'scrypt',
      // keep a note for humans; do not store plain password
      note: 'Password is hashed with scrypt. To reset: delete this file and restart the server.',
    };
    await fsp.writeFile(credentialsFile, JSON.stringify(migrated, null, 2), { encoding: 'utf8', mode: 0o600 });
    console.log('Пароль перенесён в scrypt-хеш (.admin-credentials.json).');
    return {
      username: migrated.username,
      passwordHash: hash,
      passwordSalt: salt,
      isNew: false,
      plainPassword: null,
    };
  }

  // Fresh install
  const plain = crypto.randomBytes(12).toString('base64url');
  const { salt, hash } = await hashPassword(plain);
  const totpSecret = generateSecret();
  const creds = {
    username: 'admin',
    passwordHash: hash,
    passwordSalt: salt,
    algo: 'scrypt',
    totpSecret,
    totpEnrolled: false,
    note: 'Password is hashed with scrypt. TOTP secret is stored; require it by setting totpEnrolled true. To reset: delete this file and restart the server.',
  };
  await fsp.writeFile(credentialsFile, JSON.stringify(creds, null, 2), { encoding: 'utf8', mode: 0o600 });
  const onceFile = path.join(path.dirname(credentialsFile), '.admin-password.txt');
  const otpauth = otpauthUrl(totpSecret, creds.username);
  await fsp.writeFile(
    onceFile,
    `${creds.username}\n${plain}\n${totpSecret}\n${otpauth}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );
  await fsp.chmod(onceFile, 0o600).catch(() => {});
  return {
    username: creds.username,
    passwordHash: hash,
    passwordSalt: salt,
    totpSecret,
    totpEnrolled: false,
    isNew: true,
    plainPassword: plain,
    passwordFile: onceFile,
    otpauth,
  };
}

module.exports = {
  hashPassword,
  verifyPassword,
  safeEqualStr,
  loadOrCreateCredentials,
};
