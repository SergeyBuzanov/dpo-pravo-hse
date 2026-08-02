/**
 * First-party analytics store (JSONL on disk) + manager aggregations.
 * No IPs, no raw User-Agent, no names — only session ids and paths.
 *
 * Layout:
 *   .analytics/events/YYYY-MM-DD.jsonl
 *   .analytics/meta.json  (optional write stats)
 */

'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
// Сутки и часы в отчётах — московские. Сервер живёт в UTC, и без этого
// «сегодня» в админке начиналось в 03:00 по Москве, а пик посещаемости в
// полдень отображался на графике как 9 утра (см. lib/moscow-time.js).
const { moscowDayKey, moscowParts } = require('./moscow-time');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, '.analytics');
const EVENTS_DIR = path.join(DIR, 'events');

const MAX_BODY_EVENTS = 40;
const MAX_PATH_LEN = 300;
const MAX_TITLE_LEN = 200;
const MAX_TARGET_LEN = 500;
const RETENTION_DAYS = 90;

const ALLOWED_TYPES = new Set([
  'pageview',
  'heartbeat',
  'click',
  'outbound',
  'program',
  'filter',
  'scroll',
  'exit',
]);

let writeQueue = Promise.resolve();
let summaryCache = { at: 0, data: null };
const SUMMARY_TTL_MS = 15_000;

// Имя файла событий = московские сутки. Файлы, накопленные до перехода с UTC,
// остаются на месте: формат имени тот же (YYYY-MM-DD), сортировка и чистка по
// сроку хранения работают как раньше, разъезжается только граница одних суток.
function dayKey(ts = Date.now()) {
  return moscowDayKey(ts) || new Date(ts).toISOString().slice(0, 10);
}

async function ensureDirs() {
  await fsp.mkdir(EVENTS_DIR, { recursive: true });
}

function clampStr(v, max) {
  const s = String(v == null ? '' : v).trim();
  return s.length > max ? s.slice(0, max) : s;
}

function sanitizeEvent(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object') return null;
  const type = String(raw.type || '').toLowerCase();
  if (!ALLOWED_TYPES.has(type)) return null;

  const sid = clampStr(raw.sid, 64).replace(/[^a-zA-Z0-9_-]/g, '');
  if (sid.length < 8) return null;

  let t = Number(raw.t);
  if (!Number.isFinite(t) || Math.abs(t - now) > 48 * 3600 * 1000) t = now;

  const pathName = clampStr(raw.path || '/', MAX_PATH_LEN);
  if (!pathName.startsWith('/')) return null;

  const device = ['mobile', 'tablet', 'desktop'].includes(raw.device) ? raw.device : 'desktop';
  const ms = Math.max(0, Math.min(Number(raw.ms) || 0, 24 * 3600 * 1000));

  return {
    t,
    sid,
    type,
    path: pathName,
    title: clampStr(raw.title, MAX_TITLE_LEN),
    ref: clampStr(raw.ref, 200),
    target: clampStr(raw.target, MAX_TARGET_LEN),
    label: clampStr(raw.label, 120),
    ms,
    device,
    lang: clampStr(raw.lang, 16),
    scroll: Math.max(0, Math.min(100, Number(raw.scroll) || 0)),
  };
}

function ingestBatch(rawEvents) {
  if (!Array.isArray(rawEvents)) return { accepted: 0, rejected: 0 };
  const now = Date.now();
  const accepted = [];
  let rejected = 0;
  const list = rawEvents.slice(0, MAX_BODY_EVENTS);
  for (const raw of list) {
    const ev = sanitizeEvent(raw, now);
    if (ev) accepted.push(ev);
    else rejected += 1;
  }
  if (accepted.length) {
    writeQueue = writeQueue.then(() => appendEvents(accepted)).catch((err) => {
      console.error('analytics write error:', err.message);
    });
  }
  return { accepted: accepted.length, rejected };
}

async function appendEvents(events) {
  await ensureDirs();
  // Group by day for correct file
  const byDay = new Map();
  for (const ev of events) {
    const k = dayKey(ev.t);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(ev);
  }
  for (const [day, list] of byDay) {
    const file = path.join(EVENTS_DIR, `${day}.jsonl`);
    const lines = list.map((e) => JSON.stringify(e)).join('\n') + '\n';
    await fsp.appendFile(file, lines, 'utf8');
  }
  summaryCache = { at: 0, data: null };
}

async function listEventFiles() {
  try {
    const names = await fsp.readdir(EVENTS_DIR);
    return names.filter((n) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n)).sort();
  } catch {
    return [];
  }
}

async function readDayEvents(day) {
  const file = path.join(EVENTS_DIR, `${day}.jsonl`);
  try {
    const text = await fsp.readFile(file, 'utf8');
    const out = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line));
      } catch {
        /* skip bad line */
      }
    }
    return out;
  } catch {
    return [];
  }
}

async function loadEventsSince(days) {
  await ensureDirs();
  const files = await listEventFiles();
  const cutoff = Date.now() - days * 24 * 3600 * 1000;
  const cutoffDay = dayKey(cutoff);
  const events = [];
  for (const name of files) {
    const day = name.replace('.jsonl', '');
    if (day < cutoffDay) continue;
    const dayEvents = await readDayEvents(day);
    for (const ev of dayEvents) {
      if (ev.t >= cutoff) events.push(ev);
    }
  }
  return events;
}

function prettyPath(p) {
  if (!p || p === '/' || p === '/index.html') return 'Главная';
  try {
    const dec = decodeURIComponent(p);
    return dec
      .replace(/^\//, '')
      .replace(/\.html$/i, '')
      .replace(/\(standalone\)/gi, '')
      .trim() || p;
  } catch {
    return p;
  }
}

function isHseHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === 'hse.ru' || host === 'www.hse.ru' || host.endsWith('.hse.ru');
}

function isProgramUrl(url) {
  try {
    const u = new URL(url, 'https://www.hse.ru');
    return isHseHost(u.hostname) && /\/edu\/dpo\//i.test(u.pathname);
  } catch {
    return false;
  }
}

function programTitleFromEvent(ev) {
  if (ev.label) return ev.label;
  if (ev.title && ev.type === 'program') return ev.title;
  try {
    const u = new URL(ev.target, 'https://www.hse.ru');
    return u.pathname.replace(/\/$/, '').split('/').pop() || ev.target;
  } catch {
    return ev.target || 'программа';
  }
}

function buildSummary(events, rangeDays) {
  const now = Date.now();
  const start = now - rangeDays * 24 * 3600 * 1000;
  const todayKey = dayKey(now);

  const sessions = new Map(); // sid -> { pages:Set, first, last, device, paths:[], ms }
  const pageviews = [];
  const pageCounts = new Map();
  const programClicks = new Map();
  const filterUse = new Map();
  const referrers = new Map();
  const devices = { mobile: 0, tablet: 0, desktop: 0 };
  const hours = Array.from({ length: 24 }, () => 0);
  const days = new Map();
  const transitions = new Map(); // "A → B"
  const scrollMax = new Map(); // path -> max scroll sum / count
  const interest = new Map(); // composite score by page/program

  for (const ev of events) {
    if (ev.t < start) continue;

    if (!sessions.has(ev.sid)) {
      sessions.set(ev.sid, {
        sid: ev.sid,
        pages: new Set(),
        paths: [],
        first: ev.t,
        last: ev.t,
        device: ev.device,
        dwell: 0,
        programs: [],
      });
    }
    const s = sessions.get(ev.sid);
    s.first = Math.min(s.first, ev.t);
    s.last = Math.max(s.last, ev.t);
    s.device = ev.device || s.device;

    if (ev.type === 'pageview') {
      pageviews.push(ev);
      s.pages.add(ev.path);
      if (s.paths[s.paths.length - 1] !== ev.path) {
        if (s.paths.length) {
          const prev = s.paths[s.paths.length - 1];
          const key = `${prettyPath(prev)} → ${prettyPath(ev.path)}`;
          transitions.set(key, (transitions.get(key) || 0) + 1);
        }
        s.paths.push(ev.path);
      }
      pageCounts.set(ev.path, (pageCounts.get(ev.path) || 0) + 1);
      interest.set(ev.path, (interest.get(ev.path) || 0) + 1);

      const d = dayKey(ev.t);
      days.set(d, (days.get(d) || 0) + 1);
      const mp = moscowParts(ev.t);
      if (mp) hours[mp.hour] += 1;

      if (ev.ref) referrers.set(ev.ref, (referrers.get(ev.ref) || 0) + 1);
    }

    if (ev.type === 'heartbeat' || ev.type === 'exit') {
      s.dwell = Math.max(s.dwell, ev.ms || 0);
      if (ev.path) interest.set(ev.path, (interest.get(ev.path) || 0) + (ev.ms || 0) / 60_000);
    }

    if (ev.type === 'scroll' && ev.path) {
      const cur = scrollMax.get(ev.path) || { sum: 0, n: 0, max: 0 };
      cur.sum += ev.scroll;
      cur.n += 1;
      cur.max = Math.max(cur.max, ev.scroll);
      scrollMax.set(ev.path, cur);
    }

    if (ev.type === 'program' || (ev.type === 'outbound' && isProgramUrl(ev.target))) {
      const name = programTitleFromEvent(ev);
      programClicks.set(name, (programClicks.get(name) || 0) + 1);
      s.programs.push(name);
      interest.set(`program:${name}`, (interest.get(`program:${name}`) || 0) + 5);
    }

    if (ev.type === 'filter' && ev.label) {
      filterUse.set(ev.label, (filterUse.get(ev.label) || 0) + 1);
    }

    if (ev.type === 'click' && ev.target) {
      interest.set(ev.path || 'click', (interest.get(ev.path || 'click') || 0) + 0.5);
    }
  }

  // Device per session (unique visitors)
  for (const s of sessions.values()) {
    devices[s.device] = (devices[s.device] || 0) + 1;
  }

  const sessionList = [...sessions.values()];
  const visitors = sessionList.length;
  const pv = pageviews.length;
  const bounce = sessionList.filter((s) => s.pages.size <= 1).length;
  const bounceRate = visitors ? Math.round((1000 * bounce) / visitors) / 10 : 0;
  const avgPages = visitors ? Math.round((10 * sessionList.reduce((a, s) => a + s.pages.size, 0)) / visitors) / 10 : 0;
  const durations = sessionList.map((s) => Math.max(s.dwell, Math.max(0, s.last - s.first)));
  const avgDurationMs = visitors
    ? Math.round(durations.reduce((a, b) => a + b, 0) / visitors)
    : 0;

  const visitorsToday = sessionList.filter((s) => dayKey(s.first) === todayKey).length;
  const pvToday = pageviews.filter((e) => dayKey(e.t) === todayKey).length;

  const top = (map, n = 10, labelFn = (k) => k) =>
    [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([key, count]) => ({ name: labelFn(key), count, key }));

  const topPages = top(pageCounts, 12, prettyPath);
  const topPrograms = top(programClicks, 15);
  const topFilters = top(filterUse, 10);
  const topReferrers = top(referrers, 10, (k) => k || '(прямой заход)');
  const topPaths = top(transitions, 12);
  const topInterest = top(interest, 12, (k) =>
    k.startsWith('program:') ? `📘 ${k.slice(8)}` : prettyPath(k),
  );

  const scrollDepth = [...scrollMax.entries()]
    .map(([p, v]) => ({
      name: prettyPath(p),
      avg: v.n ? Math.round(v.sum / v.n) : 0,
      max: v.max,
    }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 10);

  // Recent sessions (last 20)
  const recentSessions = sessionList
    .sort((a, b) => b.last - a.last)
    .slice(0, 20)
    .map((s) => ({
      sid: s.sid.slice(0, 8),
      device: s.device,
      pages: s.pages.size,
      durationMs: Math.max(s.dwell, Math.max(0, s.last - s.first)),
      path: s.paths.map(prettyPath),
      programs: s.programs.slice(0, 5),
      startedAt: new Date(s.first).toISOString(),
    }));

  // Daily series for chart
  const daily = [];
  for (let i = rangeDays - 1; i >= 0; i--) {
    const d = dayKey(now - i * 24 * 3600 * 1000);
    daily.push({ day: d, pageviews: days.get(d) || 0 });
  }

  // Insights (manager-friendly bullets)
  const insights = [];
  if (topPrograms[0]) {
    insights.push(`Самая интересная программа: «${topPrograms[0].name}» (${topPrograms[0].count} кликов).`);
  }
  if (topPages[0]) {
    insights.push(`Самая посещаемая страница: «${topPages[0].name}» (${topPages[0].count} просмотров).`);
  }
  if (bounceRate >= 60) {
    insights.push(`Высокий показатель отказов ${bounceRate}% — проверьте первый экран и навигацию.`);
  } else if (visitors) {
    insights.push(`Отказы ${bounceRate}% — в пределах нормы для витрины ДПО.`);
  }
  if (avgDurationMs > 0) {
    const sec = Math.round(avgDurationMs / 1000);
    insights.push(`Среднее время на сайте: ${sec < 60 ? sec + ' с' : Math.round(sec / 60) + ' мин'}.`);
  }
  const peakHour = hours.indexOf(Math.max(...hours, 0));
  if (Math.max(...hours) > 0) {
    insights.push(`Пик активности: ${String(peakHour).padStart(2, '0')}:00–${String(peakHour).padStart(2, '0')}:59.`);
  }
  const mobileShare = visitors ? Math.round((100 * (devices.mobile || 0)) / visitors) : 0;
  if (visitors) {
    insights.push(`С мобильных: ${mobileShare}% посетителей.`);
  }
  if (!visitors) {
    insights.push('Пока нет данных. Откройте сайт через сервер (npm run serve) и примите cookies — события начнут копиться.');
  }

  return {
    rangeDays,
    generatedAt: new Date().toISOString(),
    kpis: {
      visitors,
      visitorsToday,
      pageviews: pv,
      pageviewsToday: pvToday,
      sessions: visitors,
      avgDurationMs,
      avgPages,
      bounceRate,
      programClicks: [...programClicks.values()].reduce((a, b) => a + b, 0),
    },
    devices,
    hours,
    daily,
    topPages,
    topPrograms,
    topFilters,
    topReferrers,
    topPaths,
    topInterest,
    scrollDepth,
    recentSessions,
    insights,
  };
}

async function getSummary(rangeDays = 30) {
  const days = Math.max(1, Math.min(RETENTION_DAYS, Number(rangeDays) || 30));
  const cacheKey = days;
  if (summaryCache.data && summaryCache.days === cacheKey && Date.now() - summaryCache.at < SUMMARY_TTL_MS) {
    return summaryCache.data;
  }
  const events = await loadEventsSince(days);
  const data = buildSummary(events, days);
  summaryCache = { at: Date.now(), days: cacheKey, data };
  return data;
}

async function purgeOld(retentionDays = RETENTION_DAYS) {
  const files = await listEventFiles();
  const cutoff = dayKey(Date.now() - retentionDays * 24 * 3600 * 1000);
  for (const name of files) {
    const day = name.replace('.jsonl', '');
    if (day < cutoff) {
      await fsp.unlink(path.join(EVENTS_DIR, name)).catch(() => {});
    }
  }
}

/** Seed a few realistic demo events for empty dashboards (dev only). */
async function seedDemo(count = 80) {
  const now = Date.now();
  const paths = [
    '/',
    '/Каталог программ.html',
    '/privacy.html',
  ];
  const programs = [
    'Актуальные вопросы гражданского права',
    'Корпоративное право: основные проблемы',
    'Цифровое право для бизнеса',
    'Нейроправо',
    'Legal English Mastery',
  ];
  const events = [];
  for (let i = 0; i < count; i++) {
    const sid = crypto.randomBytes(8).toString('hex');
    const device = i % 5 === 0 ? 'mobile' : i % 7 === 0 ? 'tablet' : 'desktop';
    const t0 = now - Math.floor(Math.random() * 14 * 24 * 3600 * 1000);
    const p1 = paths[Math.floor(Math.random() * 3)];
    events.push({
      t: t0,
      sid,
      type: 'pageview',
      path: p1,
      title: prettyPath(p1),
      ref: i % 3 === 0 ? 'www.google.com' : i % 4 === 0 ? 'pravo.hse.ru' : '',
      target: '',
      label: '',
      ms: 0,
      device,
      lang: 'ru',
      scroll: 0,
    });
    if (Math.random() > 0.35) {
      const p2 = paths[1];
      events.push({
        t: t0 + 20_000,
        sid,
        type: 'pageview',
        path: p2,
        title: prettyPath(p2),
        ref: '',
        target: '',
        label: '',
        ms: 0,
        device,
        lang: 'ru',
        scroll: 0,
      });
      events.push({
        t: t0 + 45_000,
        sid,
        type: 'program',
        path: p2,
        title: programs[i % programs.length],
        ref: '',
        target: `https://www.hse.ru/edu/dpo/${1000 + i}`,
        label: programs[i % programs.length],
        ms: 0,
        device,
        lang: 'ru',
        scroll: 60,
      });
    }
    events.push({
      t: t0 + 90_000,
      sid,
      type: 'exit',
      path: p1,
      title: '',
      ref: '',
      target: '',
      label: '',
      ms: 30_000 + Math.floor(Math.random() * 180_000),
      device,
      lang: 'ru',
      scroll: 40 + Math.floor(Math.random() * 50),
    });
  }
  await appendEvents(events);
  await writeQueue;
  return { seeded: events.length };
}

module.exports = {
  ingestBatch,
  getSummary,
  purgeOld,
  seedDemo,
  sanitizeEvent,
  DIR,
};
