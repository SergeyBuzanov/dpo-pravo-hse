#!/usr/bin/env node
/**
 * Публичный приём заявок и маяка аналитики.
 *
 * Отдельный процесс от админки: каталог можно пересобирать, не роняя форму.
 * Снаружи не публикуется — nginx проксирует POST /api/application и
 * /api/collect сюда по внутренней сети compose.
 *
 *   node intake-server.js
 *   PORT=5179 HOST=127.0.0.1 node intake-server.js
 */

'use strict';

const http = require('node:http');
const {
  collectOrigins,
  originAllowed,
  handleCollect,
  handleApplication,
  sendJson,
  COLLECT_REQS_PER_MIN,
  APPLICATION_REQS_PER_MIN,
  SECURITY_HEADERS,
} = require('./lib/public-intake');
const { attachShutdown } = require('./lib/http-shutdown');
const { dataDir } = require('./lib/data-dir');
const fs = require('node:fs');

const PORT = Number(process.env.PORT) || 5179;
const HOST = process.env.HOST || '127.0.0.1';
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const ORIGINS = collectOrigins(HOST, PORT, process.env.SITE_ORIGIN);

function clientIp(req) {
  if (TRUST_PROXY) {
    const forwarded = String(req.headers['x-real-ip'] || '').trim();
    if (forwarded && forwarded.length < 64 && /^[0-9a-fA-F.:]+$/.test(forwarded)) {
      return forwarded;
    }
  }
  return req.socket.remoteAddress || 'unknown';
}

const collectCounts = new Map();
const applicationCounts = new Map();

function isThrottled(ip, map, limit) {
  const now = Date.now();
  const rec = map.get(ip);
  if (!rec || now - rec.windowStart > 60_000) {
    map.set(ip, { windowStart: now, count: 1 });
    return false;
  }
  rec.count += 1;
  return rec.count > limit;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of collectCounts) {
    if (now - rec.windowStart > 60_000) collectCounts.delete(ip);
  }
  for (const [ip, rec] of applicationCounts) {
    if (now - rec.windowStart > 60_000) applicationCounts.delete(ip);
  }
}, 60 * 60 * 1000).unref();

const server = http.createServer(async (req, res) => {
  try {
    const method = req.method || 'GET';
    const pathname = decodeURIComponent((req.url || '/').split('?')[0]);
    const ip = clientIp(req);

    if (method === 'GET' && (pathname === '/api/health' || pathname === '/api/ready')) {
      let ready = true;
      try {
        fs.accessSync(dataDir(), fs.constants.W_OK);
      } catch {
        ready = pathname !== '/api/ready';
      }
      sendJson(res, ready ? 200 : 503, { ok: ready, role: 'intake' });
      return;
    }

    if (method === 'POST' && pathname === '/api/collect') {
      if (isThrottled(ip, collectCounts, COLLECT_REQS_PER_MIN)) {
        res.writeHead(429, { ...SECURITY_HEADERS, 'Retry-After': '60' });
        res.end();
        return;
      }
      if (!originAllowed(req, ORIGINS)) {
        sendJson(res, 403, { error: 'origin not allowed' });
        return;
      }
      await handleCollect(req, res);
      return;
    }

    if (method === 'POST' && pathname === '/api/application') {
      if (isThrottled(ip, applicationCounts, APPLICATION_REQS_PER_MIN)) {
        sendJson(res, 429, { error: 'too many applications' });
        return;
      }
      if (!originAllowed(req, ORIGINS)) {
        sendJson(res, 403, { error: 'origin not allowed' });
        return;
      }
      await handleApplication(req, res);
      return;
    }

    res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  } catch (err) {
    console.error('intake:', err.message);
    sendJson(res, 500, { error: 'internal' });
  }
});

attachShutdown(server, { name: 'intake' });
server.listen(PORT, HOST, () => {
  console.log(`Intake: http://${HOST}:${PORT} (application + collect)`);
});
