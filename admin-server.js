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
  const user = decoded.slice(0, sep);
  const pass = decoded.slice(sep + 1);
  // Constant-time comparison so response timing can't leak the password.
  const a = Buffer.from(pass);
  const b = Buffer.from(credentials.password);
  const passOk = a.length === b.length && crypto.timingSafeEqual(a, b);
  return user === credentials.username && passOk;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
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
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    // admin.html falls back to this origin when opened directly as a file:// page
    // (double-clicked instead of navigated to via the server) — that request has
    // a null/opaque origin, so the API must allow it explicitly.
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  // A single malformed request (bad %-escape from a browser prefetch, a bot probe,
  // etc.) throwing here would otherwise be an uncaught exception that kills the
  // whole Node process — taking the admin panel down until manually restarted.
  try {
    if (!checkAuth(req)) {
      res.writeHead(401, {
        // HTTP header values must be Latin-1/ASCII — Node throws on Cyrillic here,
        // which turned every unauthenticated request into a 500 instead of a 401.
        'WWW-Authenticate': 'Basic realm="DPO Admin"',
        'Content-Type': 'text/plain; charset=utf-8',
      });
      res.end('Требуется авторизация');
      return;
    }

    let url;
    try {
      url = decodeURIComponent(req.url.split('?')[0]);
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
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
      serveFile(res, path.join(ROOT, 'admin.html'));
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

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  } catch (err) {
    console.error('Request handler error:', err.message);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
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
