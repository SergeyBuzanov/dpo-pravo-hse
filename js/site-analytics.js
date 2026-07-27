/**
 * First-party site analytics (manager dashboard).
 * Starts only after cookie consent is accepted (152-FZ).
 * Sends pageviews, dwell time, navigation, program interest, filters, scroll.
 * No third-party; POST /api/collect on same origin (or data-endpoint).
 */
(() => {
  'use strict';

  const ENDPOINT =
    (document.currentScript && document.currentScript.dataset.endpoint) ||
    '/api/collect';
  const HEARTBEAT_MS = 15_000;
  const FLUSH_MS = 8_000;
  const MAX_QUEUE = 30;

  const sidKey = 'dpo_sid';
  const consentKey = 'cookie-consent';

  let started = false;
  let queue = [];
  let pageEntered = Date.now();
  let maxScroll = 0;
  let scrollMarks = new Set();
  let flushTimer = null;
  let heartbeatTimer = null;

  const hasConsent = () => {
    try {
      return localStorage.getItem(consentKey) === 'accepted';
    } catch {
      return false;
    }
  };

  const getSid = () => {
    try {
      let sid = sessionStorage.getItem(sidKey);
      if (!sid) {
        sid =
          (crypto.randomUUID && crypto.randomUUID().replace(/-/g, '')) ||
          `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
        sessionStorage.setItem(sidKey, sid);
      }
      return sid;
    } catch {
      return `tmp_${Date.now().toString(36)}`;
    }
  };

  const deviceType = () => {
    const w = Math.min(screen.width || 0, window.innerWidth || 0);
    if (w && w < 768) return 'mobile';
    if (w && w < 1024) return 'tablet';
    return 'desktop';
  };

  const pathName = () => {
    try {
      return location.pathname + location.search;
    } catch {
      return '/';
    }
  };

  const referrerHost = () => {
    try {
      if (!document.referrer) return '';
      const u = new URL(document.referrer);
      if (u.host === location.host) return '';
      return u.hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  };

  const enqueue = (partial) => {
    if (!started) return;
    const ev = {
      t: Date.now(),
      sid: getSid(),
      path: pathName(),
      title: document.title || '',
      ref: '',
      target: '',
      label: '',
      ms: 0,
      device: deviceType(),
      lang: (navigator.language || '').slice(0, 16),
      scroll: maxScroll,
      ...partial,
    };
    queue.push(ev);
    if (queue.length >= MAX_QUEUE) flush(true);
  };

  const flush = (useBeacon = false) => {
    if (!queue.length) return;
    const batch = queue.splice(0, MAX_QUEUE);
    const body = JSON.stringify({ events: batch });
    try {
      if (useBeacon && navigator.sendBeacon) {
        const ok = navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
        if (ok) return;
      }
      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
        credentials: 'omit',
      }).catch(() => {
        // re-queue a bit on failure (avoid infinite growth)
        if (queue.length < MAX_QUEUE) queue.unshift(...batch.slice(0, 10));
      });
    } catch {
      /* ignore */
    }
  };

  const dwellMs = () => Math.max(0, Date.now() - pageEntered);

  const trackPageview = () => {
    pageEntered = Date.now();
    maxScroll = 0;
    scrollMarks = new Set();
    enqueue({ type: 'pageview', ref: referrerHost() });
  };

  const trackScroll = () => {
    const doc = document.documentElement;
    const body = document.body;
    const height = Math.max(doc.scrollHeight, body ? body.scrollHeight : 0) - window.innerHeight;
    if (height <= 0) return;
    const pct = Math.min(100, Math.round((window.scrollY / height) * 100));
    if (pct > maxScroll) maxScroll = pct;
    for (const mark of [25, 50, 75, 100]) {
      if (pct >= mark && !scrollMarks.has(mark)) {
        scrollMarks.add(mark);
        enqueue({ type: 'scroll', scroll: mark, ms: dwellMs() });
      }
    }
  };

  const isProgramLink = (href) => {
    try {
      const u = new URL(href, location.href);
      return /\.hse\.ru$/i.test(u.hostname) || u.hostname === 'hse.ru'
        ? /\/edu\/dpo\//i.test(u.pathname)
        : false;
    } catch {
      return false;
    }
  };

  const onClick = (e) => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (a) {
      const href = a.href;
      const label =
        (a.querySelector('h3') && a.querySelector('h3').textContent.trim()) ||
        a.getAttribute('aria-label') ||
        a.textContent.trim().slice(0, 120);
      if (isProgramLink(href) || a.classList.contains('card')) {
        enqueue({
          type: 'program',
          target: href,
          label: label || a.getAttribute('data-type') || '',
          title: label,
        });
      } else {
        try {
          const u = new URL(href, location.href);
          if (u.origin !== location.origin) {
            enqueue({ type: 'outbound', target: href, label });
          } else {
            enqueue({ type: 'click', target: u.pathname + u.search, label });
          }
        } catch {
          enqueue({ type: 'click', target: href, label });
        }
      }
      return;
    }

    const chip = e.target.closest && e.target.closest('.chip, [data-value]');
    if (chip && chip.dataset && chip.dataset.value) {
      enqueue({
        type: 'filter',
        label: `${chip.closest('[data-group]')?.dataset.group || 'filter'}:${chip.dataset.value}`,
        target: chip.dataset.value,
      });
    }
  };

  const onExit = () => {
    enqueue({ type: 'exit', ms: dwellMs(), scroll: maxScroll });
    flush(true);
  };

  const start = () => {
    if (started || !hasConsent()) return;
    if (location.protocol === 'file:') return;
    started = true;

    trackPageview();

    document.addEventListener('click', onClick, { capture: true, passive: true });
    window.addEventListener('scroll', trackScroll, { passive: true });
    window.addEventListener('pagehide', onExit);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        enqueue({ type: 'heartbeat', ms: dwellMs(), scroll: maxScroll });
        flush(true);
      }
    });

    heartbeatTimer = setInterval(() => {
      enqueue({ type: 'heartbeat', ms: dwellMs(), scroll: maxScroll });
    }, HEARTBEAT_MS);

    flushTimer = setInterval(() => flush(false), FLUSH_MS);

    // SPA / soft navigation (index React shell)
    let lastPath = pathName();
    setInterval(() => {
      const p = pathName();
      if (p !== lastPath) {
        enqueue({ type: 'exit', ms: dwellMs(), path: lastPath, scroll: maxScroll });
        lastPath = p;
        trackPageview();
      }
    }, 1000);
  };

  // Public hooks
  window.__dpoAnalyticsStart = start;
  window.__dpoAnalyticsEvent = (type, payload = {}) => {
    if (!started) return;
    enqueue({ type, ...payload });
  };

  if (hasConsent()) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
      start();
    }
  }

  // If consent happens later (banner), cookie-consent will call __dpoAnalyticsStart
})();
