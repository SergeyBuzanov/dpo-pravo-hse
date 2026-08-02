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
const crypto = require('node:crypto');
const { promisify } = require('node:util');

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
    return {
      username: raw.username,
      passwordHash: raw.passwordHash,
      passwordSalt: raw.passwordSalt,
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
    await fsp.writeFile(credentialsFile, JSON.stringify(migrated, null, 2), 'utf8');
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
  const creds = {
    username: 'admin',
    passwordHash: hash,
    passwordSalt: salt,
    algo: 'scrypt',
    note: 'Password is hashed with scrypt. To reset: delete this file and restart the server.',
  };
  await fsp.writeFile(credentialsFile, JSON.stringify(creds, null, 2), 'utf8');
  return {
    username: creds.username,
    passwordHash: hash,
    passwordSalt: salt,
    isNew: true,
    plainPassword: plain,
  };
}

module.exports = {
  hashPassword,
  verifyPassword,
  safeEqualStr,
  loadOrCreateCredentials,
};
