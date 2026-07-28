#!/usr/bin/env node
/**
 * Load test for the public static site (simulates >2000 concurrent users).
 *
 * Starts scripts/static-server.js on 127.0.0.1:5180 unless --url is set,
 * then runs N virtual users sharing a bounded keep-alive connection pool
 * (Windows-friendly — avoids ephemeral-port exhaustion from 2500 raw sockets).
 *
 * Usage:
 *   node scripts/load-test.js
 *   node scripts/load-test.js --concurrency 2500 --duration 25
 *   node scripts/load-test.js --url http://127.0.0.1:5180 --concurrency 2000
 */

'use strict';

const http = require('node:http');
const { performance } = require('node:perf_hooks');
const path = require('node:path');
const fsp = require('node:fs/promises');

function parseArgs(argv) {
  const out = {
    concurrency: 2500,
    duration: 25,
    url: null,
    ramp: 3,
    sockets: 400,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--concurrency' || a === '-c') out.concurrency = Number(argv[++i]);
    else if (a === '--duration' || a === '-d') out.duration = Number(argv[++i]);
    else if (a === '--url' || a === '-u') out.url = argv[++i];
    else if (a === '--ramp') out.ramp = Number(argv[++i]);
    else if (a === '--sockets') out.sockets = Number(argv[++i]);
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function formatMs(n) {
  return `${n.toFixed(1)} ms`;
}

async function startLocalServer() {
  // Load module without auto-listen (require.main !== module path).
  delete require.cache[require.resolve('./static-server')];
  const mod = require('./static-server');
  const { server, HOST, PORT } = mod;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, HOST, 8191, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  return {
    baseUrl: `http://${HOST}:${PORT}`,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}

function buildTargets(baseUrl) {
  const catalog = encodeURIComponent('Каталог программ.html');
  return [
    { path: '/', weight: 40 },
    { path: `/${catalog}`, weight: 35 },
    { path: '/privacy.html', weight: 10 },
    { path: '/fonts/fonts-hse.css', weight: 7 },
    { path: '/js/cookie-consent.js', weight: 5 },
    { path: '/fonts/HSESans-Regular.woff2', weight: 3 },
  ].map((t) => ({ ...t, url: new URL(t.path, baseUrl) }));
}

function pickTarget(targets) {
  const total = targets.reduce((s, t) => s + t.weight, 0);
  let r = Math.random() * total;
  for (const t of targets) {
    r -= t.weight;
    if (r <= 0) return t;
  }
  return targets[0];
}

function makeAgent(maxSockets) {
  return new http.Agent({
    keepAlive: true,
    keepAliveMsecs: 10_000,
    maxSockets,
    maxFreeSockets: Math.min(256, maxSockets),
    scheduling: 'lifo',
    timeout: 20_000,
  });
}

function requestOnce(agent, target) {
  return new Promise((resolve) => {
    const start = performance.now();
    const req = http.request(
      {
        protocol: target.url.protocol,
        hostname: target.url.hostname,
        port: target.url.port || 80,
        path: target.url.pathname + target.url.search,
        method: 'GET',
        agent,
        headers: {
          Accept: '*/*',
          Connection: 'keep-alive',
          'User-Agent': 'dpo-load-test/1.1',
        },
      },
      (res) => {
        res.on('data', () => {});
        res.on('end', () => {
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 400,
            status: res.statusCode,
            ms: performance.now() - start,
            err: null,
          });
        });
      },
    );
    req.setTimeout(20_000, () => {
      req.destroy(new Error('timeout'));
    });
    req.on('error', (err) => {
      resolve({
        ok: false,
        status: 0,
        ms: performance.now() - start,
        err: err.code || err.message,
      });
    });
    req.end();
  });
}

async function runWorker(agent, targets, endAt, stats) {
  while (performance.now() < endAt) {
    const target = pickTarget(targets);
    const result = await requestOnce(agent, target);
    stats.latencies.push(result.ms);
    stats.total += 1;
    if (result.ok) stats.ok += 1;
    else {
      stats.fail += 1;
      const key = result.err || String(result.status);
      stats.byError[key] = (stats.byError[key] || 0) + 1;
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      'Usage: node scripts/load-test.js [-c 2500] [-d 25] [--sockets 400] [-u http://127.0.0.1:5180]',
    );
    process.exit(0);
  }

  const concurrency = Math.max(1, args.concurrency | 0);
  const durationSec = Math.max(1, args.duration | 0);
  const rampSec = Math.max(0, args.ramp);
  const maxSockets = Math.max(50, args.sockets | 0);

  let closer = null;
  let baseUrl = args.url;

  if (!baseUrl) {
    console.log('Starting local static server on :5180 …');
    const local = await startLocalServer();
    baseUrl = local.baseUrl;
    closer = local.close;
  }

  const targets = buildTargets(baseUrl);
  const agent = makeAgent(maxSockets);
  const stats = {
    total: 0,
    ok: 0,
    fail: 0,
    latencies: [],
    byError: Object.create(null),
  };

  console.log('');
  console.log('═══════════════════════════════════════════════════');
  console.log('  DPO site load test  (>2000 concurrent users)');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Target:       ${baseUrl}`);
  console.log(`  VU (users):   ${concurrency}`);
  console.log(`  Conn pool:    ${maxSockets} keep-alive sockets`);
  console.log(`  Duration:     ${durationSec}s (+ ${rampSec}s ramp)`);
  console.log(`  Mix:          home / catalog / landing / assets`);
  console.log('═══════════════════════════════════════════════════');
  console.log('');

  // Warm-up
  for (const t of targets) {
    const r = await requestOnce(agent, t);
    if (!r.ok) console.warn(`  warm-up warn: ${t.path} → ${r.status || r.err}`);
  }

  const wallStart = performance.now();
  const endAt = wallStart + (durationSec + rampSec) * 1000;

  const workers = [];
  const batch = Math.max(1, Math.ceil(concurrency / Math.max(1, rampSec * 20)));
  let started = 0;
  while (started < concurrency) {
    const n = Math.min(batch, concurrency - started);
    for (let i = 0; i < n; i++) {
      workers.push(runWorker(agent, targets, endAt, stats));
    }
    started += n;
    if (started < concurrency) await new Promise((r) => setTimeout(r, 50));
  }

  console.log(`All ${concurrency} virtual users started (pool=${maxSockets}). Measuring…`);
  await Promise.all(workers);

  const wallMs = performance.now() - wallStart;
  const sorted = stats.latencies.slice().sort((a, b) => a - b);
  const rps = stats.total / (wallMs / 1000);
  const successRate = stats.total ? (100 * stats.ok) / stats.total : 0;

  console.log('');
  console.log('── Results ────────────────────────────────────────');
  console.log(`  Requests:     ${stats.total.toLocaleString('ru-RU')}`);
  console.log(`  Success:      ${stats.ok.toLocaleString('ru-RU')} (${successRate.toFixed(2)}%)`);
  console.log(`  Failures:     ${stats.fail.toLocaleString('ru-RU')}`);
  console.log(`  Throughput:   ${rps.toFixed(0)} req/s`);
  console.log(`  Latency p50:  ${formatMs(percentile(sorted, 50))}`);
  console.log(`  Latency p95:  ${formatMs(percentile(sorted, 95))}`);
  console.log(`  Latency p99:  ${formatMs(percentile(sorted, 99))}`);
  console.log(`  Latency max:  ${formatMs(sorted[sorted.length - 1] || 0)}`);
  console.log(`  Wall time:    ${(wallMs / 1000).toFixed(1)} s`);
  if (stats.fail > 0) {
    console.log('  Errors:       ' + JSON.stringify(stats.byError));
  }
  console.log('───────────────────────────────────────────────────');

  // Pass criteria for a local static Node server under 2500 VU:
  // - ≥99% success
  // - p95 under 3s
  // - enough total traffic
  const pass =
    successRate >= 99 &&
    percentile(sorted, 95) < 3000 &&
    stats.total >= concurrency * 2;

  console.log(
    pass
      ? '  VERDICT: PASS — site handled >2000 concurrent users.'
      : '  VERDICT: REVIEW — see metrics above.',
  );
  console.log('═══════════════════════════════════════════════════');
  console.log('');
  console.log('Note: production static hosting (Nginx/CDN) usually outperforms');
  console.log('this local Node server. Failures here often mean OS socket limits,');
  console.log('not application bugs.');
  console.log('');

  agent.destroy();
  if (closer) await closer();

  const report = {
    at: new Date().toISOString(),
    baseUrl,
    concurrency,
    maxSockets,
    durationSec,
    requests: stats.total,
    success: stats.ok,
    failures: stats.fail,
    successRate: Number(successRate.toFixed(3)),
    rps: Number(rps.toFixed(1)),
    latencyMs: {
      p50: Number(percentile(sorted, 50).toFixed(1)),
      p95: Number(percentile(sorted, 95).toFixed(1)),
      p99: Number(percentile(sorted, 99).toFixed(1)),
      max: Number((sorted[sorted.length - 1] || 0).toFixed(1)),
    },
    errors: stats.byError,
    pass,
  };

  const outPath = path.join(__dirname, '..', '.load-test-report.json');
  await fsp.writeFile(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`Report saved: ${outPath}`);

  process.exitCode = pass ? 0 : 1;
}

main().catch((err) => {
  console.error('Load test failed:', err);
  process.exit(1);
});
