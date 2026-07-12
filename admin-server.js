#!/usr/bin/env node
// Minimal local admin panel: click a button to refresh "Каталог программ.html"
// (the standalone programs showcase) from the live hse.ru catalog, without
// touching a terminal. No dependencies — plain Node http + fs.
//
// Usage:   node admin-server.js
// Then open http://127.0.0.1:5178/admin.html — the browser will ask for the
// username/password printed in the terminal on first run (also saved to
// .admin-credentials.json, which you can edit to set your own password).
//
// Binds to 127.0.0.1 only (not 0.0.0.0) — this is a local dev tool, it must
// not be reachable from the network even though it now requires a login.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 5178;
const HOST = '127.0.0.1';
const ROOT = __dirname;
const STATUS_FILE = path.join(ROOT, '.admin-status.json');
const CREDENTIALS_FILE = path.join(ROOT, '.admin-credentials.json');

function loadOrCreateCredentials() {
  try {
    const creds = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
    if (creds.username && creds.password) return creds;
  } catch {
    // fall through to generate new credentials below
  }
  const creds = { username: 'admin', password: crypto.randomBytes(6).toString('base64url') };
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(creds, null, 2), 'utf8');
  return creds;
}

const credentials = loadOrCreateCredentials();

// Constant-time string comparison so response timing can't leak credentials.
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function checkAuth(req) {
  const header = req.headers['authorization'] || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme !== 'Basic' || !encoded) return false;
  let decoded;
  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf8');
  } catch {
    return false;
  }
  const sep = decoded.indexOf(':');
  if (sep === -1) return false;
  return safeEqual(decoded.slice(0, sep), credentials.username)
    && safeEqual(decoded.slice(sep + 1), credentials.password);
}

// Brute-force protection: after MAX_FAILS wrong passwords from one address,
// reject with 429 for LOCKOUT_MS. In-memory — resets on server restart.
const MAX_FAILS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const authFails = new Map(); // ip -> { count, lockedUntil }

function isLockedOut(ip) {
  const rec = authFails.get(ip);
  return !!rec && rec.lockedUntil > Date.now();
}

function recordAuthFail(ip) {
  const rec = authFails.get(ip) || { count: 0, lockedUntil: 0 };
  rec.count += 1;
  if (rec.count >= MAX_FAILS) {
    rec.lockedUntil = Date.now() + LOCKOUT_MS;
    rec.count = 0;
  }
  authFails.set(ip, rec);
}

// Anti-bot throttle: an automated client hammering the server gets 429 well
// before it can cause load; a human clicking the admin panel never hits this.
const REQS_PER_MIN = 120;
const reqCounts = new Map(); // ip -> { windowStart, count }

function isThrottled(ip) {
  const now = Date.now();
  const rec = reqCounts.get(ip);
  if (!rec || now - rec.windowStart > 60_000) {
    reqCounts.set(ip, { windowStart: now, count: 1 });
    return false;
  }
  rec.count += 1;
  return rec.count > REQS_PER_MIN;
}

// Both maps are keyed by IP and only ever grow — purge stale entries hourly.
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of reqCounts) if (now - rec.windowStart > 60_000) reqCounts.delete(ip);
  for (const [ip, rec] of authFails) if (!rec.lockedUntil || rec.lockedUntil < now) authFails.delete(ip);
}, 60 * 60 * 1000).unref();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

// Applied to every response: no MIME sniffing, no framing, no referrer leakage,
// and no caching of an authenticated admin session's pages/data.
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};

function readStatus() {
  try {
    return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
  } catch {
    return { updated: null, count: null, error: null };
  }
}

function writeStatus(status) {
  fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2), 'utf8');
}

function captureConsole(fn) {
  const lines = [];
  const orig = { log: console.log, error: console.error };
  console.log = (...args) => { lines.push(args.join(' ')); orig.log(...args); };
  console.error = (...args) => { lines.push(args.join(' ')); orig.error(...args); };
  return fn().finally(() => {
    console.log = orig.log;
    console.error = orig.error;
  }).then(
    (result) => ({ result, log: lines.join('\n') }),
    (err) => { throw Object.assign(err, { log: lines.join('\n') }); }
  );
}

async function handleUpdate(res) {
  try {
    const { main } = require('./update-catalog');
    const { result, log } = await captureConsole(() => main());
    const status = { updated: result.updated, count: result.count, error: null, log };
    writeStatus(status);
    respondJson(res, 200, status);
  } catch (err) {
    const status = { ...readStatus(), error: err.message, log: err.log || err.message };
    writeStatus(status);
    respondJson(res, 500, status);
  }
}

function respondJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function serveFile(res, filePath, extraHeaders = {}) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      ...extraHeaders,
      'Content-Type': MIME[ext] || 'application/octet-stream',
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  // A single malformed request (bad %-escape from a browser prefetch, a bot probe,
  // etc.) throwing here would otherwise be an uncaught exception that kills the
  // whole Node process — taking the admin panel down until manually restarted.
  try {
    const ip = req.socket.remoteAddress || 'unknown';

    // Отсекаем ботовые/фаззинговые запросы со сверхдлинными URL.
    if (req.url.length > 2048) {
      res.writeHead(414, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('URI too long');
      return;
    }

    if (isThrottled(ip)) {
      res.writeHead(429, {
        ...SECURITY_HEADERS,
        'Retry-After': '60',
        'Content-Type': 'text/plain; charset=utf-8',
      });
      res.end('Слишком много запросов. Попробуйте позже.');
      return;
    }

    if (isLockedOut(ip)) {
      res.writeHead(429, {
        ...SECURITY_HEADERS,
        'Retry-After': String(Math.ceil(LOCKOUT_MS / 1000)),
        'Content-Type': 'text/plain; charset=utf-8',
      });
      res.end('Слишком много неудачных попыток входа. Попробуйте позже.');
      return;
    }

    if (!checkAuth(req)) {
      // Count only actual wrong credentials, not the browser's first
      // credential-less request that triggers the login dialog.
      if (req.headers['authorization']) recordAuthFail(ip);
      res.writeHead(401, {
        ...SECURITY_HEADERS,
        // HTTP header values must be Latin-1/ASCII — Node throws on Cyrillic here,
        // which turned every unauthenticated request into a 500 instead of a 401.
        'WWW-Authenticate': 'Basic realm="DPO Admin"',
        'Content-Type': 'text/plain; charset=utf-8',
      });
      res.end('Требуется авторизация');
      return;
    }
    authFails.delete(ip);

    let url;
    try {
      url = decodeURIComponent(req.url.split('?')[0]);
    } catch {
      res.writeHead(400, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bad request');
      return;
    }

    if (req.method === 'GET' && url === '/api/status') {
      respondJson(res, 200, readStatus());
      return;
    }
    if (req.method === 'POST' && url === '/api/update') {
      handleUpdate(res);
      return;
    }
    if (req.method === 'GET' && (url === '/' || url === '/admin.html')) {
      serveFile(res, path.join(ROOT, 'admin.html'), {
        'Content-Security-Policy':
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
          "font-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'",
      });
      return;
    }
    if (req.method === 'GET' && (url === '/index.html' || url === '/index')) {
      serveFile(res, path.join(ROOT, 'index.html'));
      return;
    }
    if (req.method === 'GET' && url === '/Каталог программ.html') {
      serveFile(res, path.join(ROOT, 'Каталог программ.html'));
      return;
    }
    if (req.method === 'GET' && url === '/privacy.html') {
      serveFile(res, path.join(ROOT, 'privacy.html'));
      return;
    }
    if (req.method === 'GET' && url.startsWith('/fonts/')) {
      // Locked to the fonts dir and css/woff2 extensions; path.normalize
      // collapses any ../ so traversal outside fonts/ fails the prefix check.
      const safe = path.normalize(url).replace(/^[/\\]+/, '');
      if (safe.startsWith('fonts' + path.sep) && /\.(css|woff2)$/.test(safe)) {
        serveFile(res, path.join(ROOT, safe));
        return;
      }
    }

    res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  } catch (err) {
    console.error('Request handler error:', err.message);
    if (!res.headersSent) {
      res.writeHead(500, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Internal error');
    }
  }
});

process.on('uncaughtException', (err) => {
  // Last-resort net: log and keep the server alive rather than let Node exit
  // and silently take the whole admin panel offline.
  console.error('Uncaught exception (server kept alive):', err.stack || err.message);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use — is admin-server.js already running elsewhere?`);
    console.error(`Either stop that process, or run with a different port: PORT=5179 node admin-server.js`);
  } else {
    console.error('Server failed to start:', err.message);
  }
  process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
  console.log(`Admin panel: http://${HOST}:${PORT}/admin.html`);
  console.log(`Логин: ${credentials.username}  Пароль: ${credentials.password}`);
  console.log(`(хранится в .admin-credentials.json — поменяйте пароль, отредактировав этот файл)`);
});
