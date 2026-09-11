/**
 * Серверные сессии админки: случайный id в HttpOnly-cookie, CSRF на сессию.
 * Basic больше не является основным входом — браузер не должен слать
 * пароль с каждым запросом.
 */

'use strict';

const crypto = require('node:crypto');

const COOKIE = 'dpo_admin';
const TTL_MS = 8 * 60 * 60 * 1000;

function readCookie(req, name) {
  const raw = String(req.headers.cookie || '');
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

function createSessionStore() {
  const sessions = new Map();

  function gc() {
    const now = Date.now();
    for (const [id, s] of sessions) {
      if (now - s.lastSeen > TTL_MS) sessions.delete(id);
    }
  }

  function create() {
    gc();
    const id = crypto.randomBytes(32).toString('base64url');
    const csrf = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    sessions.set(id, { csrf, created: now, lastSeen: now });
    return { id, csrf };
  }

  function get(req) {
    const id = readCookie(req, COOKIE);
    if (!id) return null;
    const s = sessions.get(id);
    if (!s) return null;
    if (Date.now() - s.lastSeen > TTL_MS) {
      sessions.delete(id);
      return null;
    }
    s.lastSeen = Date.now();
    return { id, csrf: s.csrf };
  }

  function destroy(req) {
    const id = readCookie(req, COOKIE);
    if (id) sessions.delete(id);
  }

  function cookieHeader(id, { secure, maxAgeMs = TTL_MS } = {}) {
    const parts = [
      `${COOKIE}=${id}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Strict',
    ];
    if (secure) parts.push('Secure');
    if (maxAgeMs <= 0) {
      parts.push('Max-Age=0');
    } else {
      parts.push(`Max-Age=${Math.floor(maxAgeMs / 1000)}`);
    }
    return parts.join('; ');
  }

  function clearCookieHeader(secure) {
    return cookieHeader('deleted', { secure, maxAgeMs: 0 });
  }

  return { create, get, destroy, cookieHeader, clearCookieHeader, COOKIE, TTL_MS };
}

function wantSecureCookie(req) {
  if (process.env.COOKIE_SECURE === '1') return true;
  return String(req.headers['x-forwarded-proto'] || '') === 'https';
}

module.exports = { createSessionStore, readCookie, wantSecureCookie, COOKIE, TTL_MS };
