#!/usr/bin/env node
/**
 * Public static file server for local preview, load testing, and analytics collect.
 * No auth — simulates production static hosting + first-party /api/collect.
 *
 * Security: allowlisted HTML/assets only (same model as admin-server.js);
 * dotfiles and repo secrets are never served. Binds to 127.0.0.1 only unless
 * ALLOW_NON_LOOPBACK=1 is set explicitly.
 *
 * Usage:  node scripts/static-server.js
 *         PORT=5180 node scripts/static-server.js
 */

'use strict';

const http = require('node:http');
const fsp = require('node:fs/promises');
const path = require('node:path');
const {
  MIME,
  resolveSafe: resolveSafeShared,
  isAllowedStatic,
  readBody,
} = require('../lib/static-http');

const PORT = Number(process.env.PORT) || 5180;
const ROOT = path.resolve(__dirname, '..');
const MAX_URL_LEN = 2048;

/** Loopback only by default — refuse LAN exposure of a preview server. */
function resolveHost() {
  const raw = (process.env.HOST || '127.0.0.1').trim() || '127.0.0.1';
  const loopback = new Set(['127.0.0.1', '::1', 'localhost']);
  if (loopback.has(raw.toLowerCase())) return raw === 'localhost' ? '127.0.0.1' : raw;
  if (process.env.ALLOW_NON_LOOPBACK === '1') {
    console.warn(
      `WARNING: HOST=${raw} with ALLOW_NON_LOOPBACK=1 — preview server is reachable beyond this machine.`,
    );
    return raw;
  }
  console.error(
    `Refusing non-loopback HOST=${raw}. Use HOST=127.0.0.1 (default) or set ALLOW_NON_LOOPBACK=1 if you really mean it.`,
  );
  process.exit(1);
}

const HOST = resolveHost();

const SECURITY = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Resource-Policy': 'same-origin',
});

// Обёртки над общим слоем (lib/static-http): исторический экспорт этого
// модуля принимал сырой URL и раскодировал его сам.
function resolveSafe(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(String(urlPath).split('?')[0]);
  } catch {
    return null;
  }
  return resolveSafeShared(decoded, ROOT);
}

const isAllowed = isAllowedStatic;

const fileCache = new Map();
const CACHE_MAX = 64;

async function readCached(filePath) {
  const st = await fsp.stat(filePath);
  if (!st.isFile()) throw new Error('not a file');
  const hit = fileCache.get(filePath);
  if (hit && hit.mtimeMs === st.mtimeMs) return hit;
  const buf = await fsp.readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const entry = {
    buf,
    mtimeMs: st.mtimeMs,
    type: MIME[ext] || 'application/octet-stream',
    size: st.size,
  };
  if (fileCache.size >= CACHE_MAX) {
    const first = fileCache.keys().next().value;
    fileCache.delete(first);
  }
  fileCache.set(filePath, entry);
  return entry;
}

const server = http.createServer(async (req, res) => {
  const method = req.method || 'GET';
  const rawUrl = req.url || '/';

  if (rawUrl.length > MAX_URL_LEN) {
    res.writeHead(414, { ...SECURITY, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('URI too long');
    return;
  }

  let pathname = '/';
  try {
    pathname = decodeURIComponent(rawUrl.split('?')[0]);
  } catch {
    res.writeHead(400, { ...SECURITY, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad request');
    return;
  }

  // First-party analytics beacon (public, same-origin only — no CORS headers)
  if (method === 'POST' && pathname === '/api/collect') {
    try {
      const raw = await readBody(req);
      let parsed = {};
      try {
        parsed = JSON.parse(raw || '{}');
      } catch {
        res.writeHead(400, { ...SECURITY, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid json' }));
        return;
      }
      const events = Array.isArray(parsed) ? parsed : parsed.events;
      const { ingestBatch } = require(path.join(ROOT, 'lib', 'analytics-store'));
      ingestBatch(events);
      res.writeHead(204, { ...SECURITY });
      res.end();
    } catch (err) {
      res.writeHead(500, { ...SECURITY, 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('collect failed');
      // Превью-сервер не дочитывает переполненное тело (в отличие от админки
      // с её lingering-логикой) — просто рвём соединение, как и раньше.
      if (err && err.code === 'BODY_TOO_LARGE') req.destroy();
    }
    return;
  }

  /**
   * Приём заявки. На проде этот адрес nginx проксирует в admin-сервис, а
   * здесь обрабатывается на месте — иначе форму нельзя было бы проверить
   * локально, не поднимая docker compose целиком.
   *
   * Троттлинга здесь нет намеренно: превью-сервер слушает только петлю, а
   * на проде частоту ограничивает nginx (zone=dpo_application) и сам
   * admin-сервис. Дублировать лимит в третьем месте значит завести третье
   * место, где его придётся править.
   */
  if (method === 'POST' && pathname === '/api/application') {
    try {
      const raw = await readBody(req, 16 * 1024);
      let parsed = {};
      try {
        parsed = JSON.parse(raw || '{}');
      } catch {
        res.writeHead(400, { ...SECURITY, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid json' }));
        return;
      }

      // Ловушка для роботов: отвечаем как при успехе, ничего не сохраняя.
      if (parsed && typeof parsed === 'object' && String(parsed.website || '').trim()) {
        res.writeHead(200, { ...SECURITY, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      const { parseApplication } = require(path.join(ROOT, 'lib', 'application-form'));
      const result = parseApplication(parsed);
      if (!result.ok) {
        res.writeHead(400, { ...SECURITY, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'validation', fields: result.errors }));
        return;
      }

      const { deliver } = require(path.join(ROOT, 'lib', 'application-delivery'));
      const delivered = await deliver(result.application);
      console.log(`заявка ${delivered.id}: ${delivered.duplicate ? 'повтор' : 'принята'}`);
      res.writeHead(200, { ...SECURITY, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, id: delivered.id }));
    } catch (err) {
      res.writeHead(500, { ...SECURITY, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'save failed' }));
      if (err && err.code === 'BODY_TOO_LARGE') req.destroy();
    }
    return;
  }

  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405, { ...SECURITY, Allow: 'GET, HEAD, POST' });
    res.end('Method Not Allowed');
    return;
  }

  const safe = resolveSafe(rawUrl);
  if (!safe || !isAllowed(safe)) {
    res.writeHead(safe ? 404 : 400, {
      ...SECURITY,
      'Content-Type': 'text/plain; charset=utf-8',
    });
    res.end(safe ? 'Not found' : 'Bad path');
    return;
  }

  try {
    const st = await fsp.stat(safe.abs).catch(() => null);
    if (!st?.isFile()) {
      res.writeHead(404, { ...SECURITY, 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const file = await readCached(safe.abs);
    const headers = {
      ...SECURITY,
      'Content-Type': file.type,
      'Content-Length': file.size,
      'Cache-Control': path.extname(safe.abs).toLowerCase() === '.html' ? 'no-cache' : 'public, max-age=60',
    };

    if (method === 'HEAD') {
      res.writeHead(200, headers);
      res.end();
      return;
    }

    res.writeHead(200, headers);
    res.end(file.buf);
  } catch {
    if (!res.headersSent) {
      res.writeHead(404, { ...SECURITY, 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    }
  }
});

server.keepAliveTimeout = 60_000;
server.headersTimeout = 65_000;
server.requestTimeout = 0;
server.maxHeadersCount = 100;

if (require.main === module) {
  // Retention for first-party analytics (same as admin-server)
  try {
    const { purgeOld } = require(path.join(ROOT, 'lib', 'analytics-store'));
    purgeOld().catch((err) => console.warn('analytics purge:', err.message));
    setInterval(() => {
      purgeOld().catch((err) => console.warn('analytics purge:', err.message));
    }, 24 * 60 * 60 * 1000).unref();
  } catch (err) {
    /* analytics optional for pure static serve */
    if (err.code !== 'MODULE_NOT_FOUND') throw err;
  }

  // Срок хранения заявок. Этот сервер тоже принимает POST /api/application,
  // значит и уничтожать записи через год обязан он же: обещание в
  // privacy.html дано посетителю, а не конкретному процессу.
  try {
    const { purgeOld } = require(path.join(ROOT, 'lib', 'application-store'));
    purgeOld().catch((err) => console.warn('applications purge:', err.message));
    setInterval(() => {
      purgeOld().catch((err) => console.warn('applications purge:', err.message));
    }, 24 * 60 * 60 * 1000).unref();
  } catch (err) {
    /* приём заявок необязателен для чистой статики */
    if (err.code !== 'MODULE_NOT_FOUND') throw err;
  }

  server.listen(PORT, HOST, 8191, () => {
    console.log(`Static site: http://${HOST}:${PORT}/`);
    console.log(`Catalog:     http://${HOST}:${PORT}/${encodeURIComponent('Каталог программ.html')}`);
    console.log(`Analytics:   POST http://${HOST}:${PORT}/api/collect`);
  });
}

module.exports = { server, HOST, PORT, ROOT, resolveSafe, isAllowed };
