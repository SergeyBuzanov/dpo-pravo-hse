// Баннер согласия на cookies + Яндекс.Метрика (152-ФЗ: метрика и её cookies
// включаются ТОЛЬКО после явного «Принять»; «Отклонить» запоминается и
// повторно баннер не показывается).
//
// ═══════════════════════════════════════════════════════════════════════
//  ВПИШИТЕ НОМЕР СЧЁТЧИКА Яндекс.Метрики (число из кабинета metrika.yandex.ru),
//  например: var METRIKA_ID = 12345678;
//  Пока METRIKA_ID = null, баннер работает, но счётчик не загружается
//  и cookies фактически не ставятся.
// ═══════════════════════════════════════════════════════════════════════
(function () {
  var METRIKA_ID = null;

  var KEY = 'cookie-consent'; // 'accepted' | 'declined'

  function getState() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function setState(v) {
    try { localStorage.setItem(KEY, v); } catch (e) {}
  }

  function loadMetrika() {
    if (!METRIKA_ID) return;
    if (window.ym && window.ym.a) return; // уже загружена
    (function (m, e, t, r, i, k, a) {
      m[i] = m[i] || function () { (m[i].a = m[i].a || []).push(arguments); };
      m[i].l = 1 * new Date();
      k = e.createElement(t); a = e.getElementsByTagName(t)[0];
      k.async = 1; k.src = r; a.parentNode.insertBefore(k, a);
    })(window, document, 'script', 'https://mc.yandex.ru/metrika/tag.js', 'ym');
    // Вебвизор отключён сознательно: запись действий посетителей — избыточный
    // сбор данных для витрины программ.
    window.ym(METRIKA_ID, 'init', {
      clickmap: true,
      trackLinks: true,
      accurateTrackBounce: true,
      webvisor: false,
    });
  }

  // Публичная точка для страницы политики: сбросить выбор и показать баннер заново.
  window.resetCookieConsent = function () {
    try { localStorage.removeItem(KEY); } catch (e) {}
    window.location.reload();
  };

  var state = getState();
  if (state === 'accepted') { loadMetrika(); return; }
  if (state === 'declined') { return; }

  var CSS = [
    '#cookieBanner{ position: fixed; left: 16px; right: 16px; bottom: 16px; z-index: 1000;',
    '  max-width: 720px; margin: 0 auto; background: #fff; color: #211E1B;',
    '  border: 1px solid rgba(33,30,27,0.14); border-radius: 16px;',
    '  box-shadow: 0 12px 40px rgba(33,30,27,0.18); padding: 18px 20px;',
    '  display: flex; flex-wrap: wrap; align-items: center; gap: 14px;',
    "  font-family: 'HSE Sans', 'IBM Plex Sans', -apple-system, sans-serif; font-size: 14px; line-height: 1.55; }",
    '#cookieBanner p{ margin: 0; flex: 1 1 320px; }',
    '#cookieBanner a{ color: #1658DA; text-decoration: underline; }',
    '#cookieBanner .cb-actions{ display: flex; gap: 10px; flex: 0 0 auto; }',
    '#cookieBanner button{ font: inherit; font-weight: 600; font-size: 14px; cursor: pointer;',
    '  border-radius: 999px; padding: 10px 20px; border: 1px solid transparent; }',
    '#cookieBanner .cb-accept{ color: #fff; background: #1658DA; }',
    '#cookieBanner .cb-accept:hover{ background: #123F9E; }',
    '#cookieBanner .cb-decline{ color: #48423A; background: transparent; border-color: rgba(33,30,27,0.3); }',
    '#cookieBanner .cb-decline:hover{ border-color: #211E1B; }',
    'html.vi-mode #cookieBanner{ background: #fff !important; border: 2px solid #000 !important; }',
    'html.vi-mode #cookieBanner button{ border: 2px solid #000 !important; }',
  ].join('\n');

  function showBanner() {
    if (document.getElementById('cookieBanner')) return;

    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    var banner = document.createElement('div');
    banner.id = 'cookieBanner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Согласие на использование cookies');

    var text = document.createElement('p');
    text.innerHTML = 'Мы используем файлы cookie сервиса Яндекс.Метрика для сбора статистики посещений. '
      + 'Вы можете принять их использование или отказаться. '
      + 'Подробнее — в <a href="privacy.html">Политике обработки персональных данных</a>.';

    var actions = document.createElement('div');
    actions.className = 'cb-actions';

    var accept = document.createElement('button');
    accept.className = 'cb-accept';
    accept.type = 'button';
    accept.textContent = 'Принять';
    accept.addEventListener('click', function () {
      setState('accepted');
      banner.remove();
      loadMetrika();
    });

    var decline = document.createElement('button');
    decline.className = 'cb-decline';
    decline.type = 'button';
    decline.textContent = 'Отклонить';
    decline.addEventListener('click', function () {
      setState('declined');
      banner.remove();
    });

    actions.appendChild(accept);
    actions.appendChild(decline);
    banner.appendChild(text);
    banner.appendChild(actions);
    document.body.appendChild(banner);
  }

  // На главной (React-бандл) содержимое страницы дорисовывается рантаймом —
  // ждём появления шапки, чтобы баннер не был затёрт при загрузке.
  var tries = 0;
  var timer = setInterval(function () {
    if (!document.body || !document.querySelector('header')) {
      if (++tries > 100) clearInterval(timer);
      return;
    }
    clearInterval(timer);
    showBanner();
  }, 150);
})();
