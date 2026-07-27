#!/usr/bin/env node
/**
 * Public static file server for local preview, load testing, and analytics collect.
 * No auth — simulates production static hosting + first-party /api/collect.
 *
 * Usage:  node scripts/static-server.js
 *         PORT=5180 node scripts/static-server.js
 */

'use strict';

const http = require('node:http');
const fsp = require('node:fs/promises');
const path = require('node:path');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT) || 5180;
const ROOT = path.resolve(__dirname, '..');
const MAX_BODY = 64 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.ico': 'image/x-icon',
};

const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

function resolveSafe(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }
  if (decoded === '/' || decoded === '') decoded = '/index.html';
  const rel = path.normalize(decoded.replace(/^[/\\]+/, '')).replace(/^(\.\.([/\\]|$))+/, '');
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const abs = path.resolve(ROOT, rel);
  const rootWithSep = ROOT + path.sep;
  if (abs !== ROOT && !abs.startsWith(rootWithSep)) return null;
  return abs;
}

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

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const method = req.method || 'GET';
  let pathname = '/';
  try {
    pathname = decodeURIComponent((req.url || '/').split('?')[0]);
  } catch {
    res.writeHead(400, { ...SECURITY, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad request');
    return;
  }

  // First-party analytics beacon (public)
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
    } catch {
      res.writeHead(500, { ...SECURITY, 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('collect failed');
    }
    return;
  }

  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405, { ...SECURITY, Allow: 'GET, HEAD, POST' });
    res.end('Method Not Allowed');
    return;
  }

  const abs = resolveSafe(req.url || '/');
  if (!abs) {
    res.writeHead(400, { ...SECURITY, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad path');
    return;
  }

  try {
    let filePath = abs;
    let st = await fsp.stat(filePath).catch(() => null);
    if (st?.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      st = await fsp.stat(filePath);
    }
    if (!st?.isFile()) {
      res.writeHead(404, { ...SECURITY, 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const file = await readCached(filePath);
    const headers = {
      ...SECURITY,
      'Content-Type': file.type,
      'Content-Length': file.size,
      'Cache-Control': path.extname(filePath).toLowerCase() === '.html' ? 'no-cache' : 'public, max-age=60',
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
  server.listen(PORT, HOST, 8191, () => {
    console.log(`Static site: http://${HOST}:${PORT}/`);
    console.log(`Catalog:     http://${HOST}:${PORT}/${encodeURIComponent('Каталог программ.html')}`);
    console.log(`Analytics:   POST http://${HOST}:${PORT}/api/collect`);
  });
}

module.exports = { server, HOST, PORT, ROOT };
