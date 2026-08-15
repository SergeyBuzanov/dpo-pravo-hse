/**
 * Cookie consent banner + optional Yandex.Metrika (152-FZ).
 * Metrika loads only after explicit «Принять»; «Отклонить» is remembered.
 *
 * Set METRIKA_ID to your counter number from metrika.yandex.ru.
 * While null, the banner works but no counter/cookies are loaded.
 * Webvisor is intentionally off (excessive collection for a program showcase).
 */
(() => {
  'use strict';

  /** @type {number|null} */
  const METRIKA_ID = null;
  const STORAGE_KEY = 'cookie-consent'; // 'accepted' | 'declined'

  const getState = () => {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  };

  const setState = (value) => {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      /* private mode / quota */
    }
  };

  const loadMetrika = () => {
    if (!METRIKA_ID) return;
    if (typeof window.ym === 'function' && window.ym.a) return;

    (function (m, e, t, r, i) {
      m[i] =
        m[i] ||
        function (...args) {
          (m[i].a = m[i].a || []).push(args);
        };
      m[i].l = Date.now();
      const k = e.createElement(t);
      const a = e.getElementsByTagName(t)[0];
      k.async = true;
      k.src = r;
      a.parentNode.insertBefore(k, a);
    })(window, document, 'script', 'https://mc.yandex.ru/metrika/tag.js', 'ym');

    window.ym(METRIKA_ID, 'init', {
      clickmap: true,
      trackLinks: true,
      accurateTrackBounce: true,
      webvisor: false,
    });
  };

  /** First-party manager analytics (same-origin /api/collect). */
  const startSiteAnalytics = () => {
    try {
      if (typeof window.__dpoAnalyticsStart === 'function') {
        window.__dpoAnalyticsStart();
      }
    } catch {
      /* ignore */
    }
  };

  window.resetCookieConsent = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    window.location.reload();
  };

  const existing = getState();
  if (existing === 'accepted') {
    loadMetrika();
    startSiteAnalytics();
    return;
  }
  if (existing === 'declined') return;

  const CSS = `
#cookieBanner{position:fixed;left:16px;right:16px;bottom:16px;z-index:1000;max-width:720px;margin:0 auto;background:#fff;color:#211E1B;border:1px solid rgba(33,30,27,.14);border-radius:16px;box-shadow:0 12px 40px rgba(33,30,27,.18);padding:18px 20px;display:flex;flex-wrap:wrap;align-items:center;gap:14px;font-family:'HSE Sans','IBM Plex Sans',system-ui,sans-serif;font-size:14px;line-height:1.55}
#cookieBanner p{margin:0;flex:1 1 320px}
#cookieBanner a{color:#1658DA;text-decoration:underline}
#cookieBanner .cb-actions{display:flex;gap:10px;flex:0 0 auto}
#cookieBanner button{font:inherit;font-weight:600;font-size:14px;cursor:pointer;border-radius:999px;padding:10px 20px;border:1px solid transparent}
#cookieBanner .cb-accept{color:#fff;background:#1658DA}
#cookieBanner .cb-accept:hover{background:#123F9E}
#cookieBanner .cb-decline{color:#48423A;background:transparent;border-color:rgba(33,30,27,.3)}
#cookieBanner .cb-decline:hover{border-color:#211E1B}
html.vi-mode #cookieBanner{background:#fff!important;border:2px solid #000!important}
html.vi-mode #cookieBanner button{border:2px solid #000!important}
`.trim();

  const showBanner = () => {
    if (document.getElementById('cookieBanner')) return;

    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const banner = document.createElement('div');
    banner.id = 'cookieBanner';
    // role="region", а не "dialog". Диалог подразумевает, что в него переводят
    // фокус и оттуда его не выпускают; здесь ни того ни другого нет — баннер
    // не перекрывает страницу и не требует немедленного ответа. Незакрытый
    // «диалог», в который не увели фокус, часть скринридеров не объявляет
    // вовсе, и незрячий посетитель просто не узнаёт о выборе. Ориентир
    // (region с названием) виден в списке областей страницы и достижим
    // обычной навигацией.
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', 'Согласие на использование cookies');

    const text = document.createElement('p');
    text.append(
      document.createTextNode(
        'Мы используем cookies и локальную аналитику посещений (страницы, время, интерес к программам) для улучшения сайта. Яндекс.Метрика – только при настроенном счётчике. Вы можете принять или отказаться. Подробнее – в ',
      ),
    );
    const link = document.createElement('a');
    link.href = 'privacy.html';
    link.textContent = 'Политике обработки персональных данных';
    text.append(link, document.createTextNode('.'));

    const actions = document.createElement('div');
    actions.className = 'cb-actions';

    const accept = document.createElement('button');
    accept.type = 'button';
    accept.className = 'cb-accept';
    accept.textContent = 'Принять';
    accept.addEventListener('click', () => {
      setState('accepted');
      banner.remove();
      loadMetrika();
      startSiteAnalytics();
    });

    const decline = document.createElement('button');
    decline.type = 'button';
    decline.className = 'cb-decline';
    decline.textContent = 'Отклонить';
    decline.addEventListener('click', () => {
      setState('declined');
      banner.remove();
    });

    actions.append(accept, decline);
    banner.append(text, actions);
    document.body.append(banner);
  };

  // Main React landing mounts header asynchronously — wait for it.
  let tries = 0;
  const timer = setInterval(() => {
    if (!document.body || !document.querySelector('header')) {
      if (++tries > 100) clearInterval(timer);
      return;
    }
    clearInterval(timer);
    showBanner();
  }, 150);
})();
