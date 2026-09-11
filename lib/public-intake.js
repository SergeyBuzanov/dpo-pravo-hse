/**
 * Публичный приём: маяк аналитики и заявка. Вынесен из admin-server.js,
 * чтобы жить отдельным процессом: падение админки каталога не должно
 * ронять форму на сайте.
 */

'use strict';

const { readBody } = require('./static-http');
const { SECURITY_HEADERS } = require('./security-headers');

const COLLECT_REQS_PER_MIN = 600;
const APPLICATION_REQS_PER_MIN = 5;
const MAX_APPLICATION_BODY = 16 * 1024;
const LINGER_BYTES = 4 * 1024 * 1024;
const LINGER_MS = 2000;

function collectOrigins(host, port, siteOrigin) {
  const set = new Set(
    [
      `http://${host}:${port}`,
      `http://127.0.0.1:${port}`,
      `http://localhost:${port}`,
      ...String(siteOrigin || '')
        .split(',')
        .map((s) => s.trim().replace(/\/+$/, ''))
        .filter(Boolean),
    ].filter(Boolean),
  );
  return set;
}

function sendJson(res, code, obj) {
  const buf = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(code, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': buf.length,
  });
  res.end(buf);
}

function sendTooLarge(req, res) {
  let discarded = 0;
  let timer = null;
  const stop = (hard) => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    req.removeAllListeners('data');
    if (hard) req.destroy();
  };
  req.on('data', (chunk) => {
    discarded += chunk.length;
    if (discarded > LINGER_BYTES) stop(true);
  });
  req.on('end', () => stop(false));
  req.on('error', () => stop(false));
  timer = setTimeout(() => stop(true), LINGER_MS);
  req.resume();
  const buf = Buffer.from('Payload too large', 'utf8');
  res.writeHead(413, {
    ...SECURITY_HEADERS,
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': buf.length,
  });
  res.end(buf);
}

function originAllowed(req, origins) {
  const origin = req.headers.origin;
  if (origin && !origins.has(origin)) return false;
  return true;
}

async function handleCollect(req, res) {
  try {
    const raw = await readBody(req);
    let parsed;
    try {
      parsed = JSON.parse(raw || '{}');
    } catch {
      sendJson(res, 400, { error: 'invalid json' });
      return;
    }
    const events = Array.isArray(parsed) ? parsed : parsed.events;
    const { ingestBatch } = require('./analytics-store');
    ingestBatch(events);
    res.writeHead(204, { ...SECURITY_HEADERS });
    res.end();
  } catch (err) {
    if (err.code === 'BODY_TOO_LARGE') {
      sendTooLarge(req, res);
      return;
    }
    console.error('collect error:', err.message);
    sendJson(res, 500, { error: 'collect failed' });
  }
}

async function handleApplication(req, res) {
  try {
    const raw = await readBody(req, MAX_APPLICATION_BODY);
    let parsed;
    try {
      parsed = JSON.parse(raw || '{}');
    } catch {
      sendJson(res, 400, { error: 'invalid json' });
      return;
    }

    if (parsed && typeof parsed === 'object' && String(parsed.website || '').trim()) {
      sendJson(res, 200, { ok: true });
      return;
    }

    const { parseApplication } = require('./application-form');
    const result = parseApplication(parsed);
    if (!result.ok) {
      sendJson(res, 400, { error: 'validation', fields: result.errors });
      return;
    }

    const { deliver } = require('./application-delivery');
    const delivered = await deliver(result.application);
    console.log(`заявка ${delivered.id}: ${delivered.duplicate ? 'повтор' : 'принята'}`);
    sendJson(res, 200, { ok: true, id: delivered.id });
  } catch (err) {
    if (err.code === 'BODY_TOO_LARGE') {
      sendTooLarge(req, res);
      return;
    }
    if (err.code === 'QUOTA') {
      sendJson(res, 503, { error: 'save failed' });
      return;
    }
    console.error('application error:', err.message);
    sendJson(res, 500, { error: 'save failed' });
  }
}

module.exports = {
  collectOrigins,
  originAllowed,
  handleCollect,
  handleApplication,
  sendJson,
  sendTooLarge,
  COLLECT_REQS_PER_MIN,
  APPLICATION_REQS_PER_MIN,
  SECURITY_HEADERS,
};
