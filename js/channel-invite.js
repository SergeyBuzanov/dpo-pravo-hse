/**
 * Всплывающее окно «подпишитесь на канал факультета» (по образцу сайта
 * Минэкономразвития): логотип, название, короткое описание, кнопка
 * «Подписаться», крестик.
 *
 * Канал заполнен 18.08.2026 по ссылке от владельца: «ДПО: искусство
 * права» в мессенджере MAX. Пока url равен null, окно не показывается
 * вовсе. icon – путь к ЛОКАЛЬНОЙ картинке (аватар канала скачан в
 * images/channel-logo.jpg); внешние адреса запрещены CSP и 152-ФЗ,
 * без картинки рисуется встроенный глиф-самолётик, как в контактах.
 *
 * Правила показа (указание заказчика, август 2026; 19.08 возвращено):
 *  - окно появляется только ПОСЛЕ ответа на баннер cookies (решение
 *    заказчика 19.08.2026 по итогам аудита: на телефоне 375×812 два окна
 *    разом закрывали 53% первого экрана вместе с обоими призывами к
 *    действию; правило «сразу при заходе» от 18.08 отменено);
 *  - закрытие (крестиком или кнопкой «Подписаться») запоминается, повторно
 *    окно не показывается как минимум месяц;
 *  - запоминание – localStorage, строго необходимое хранение настройки
 *    интерфейса: отдельного согласия не требует и персональных данных не
 *    содержит (как выбор версии для слабовидящих);
 *  - на мобильных окно не перекрывает экран: узкая карточка у нижнего края.
 */
(function () {
  'use strict';

  var CHANNEL = {
    /** @type {string|null} адрес канала */
    url: 'https://max.ru/id7714030726_gos72',
    /** название канала, как в мессенджере */
    title: 'ДПО: искусство права',
    /** короткое описание (по описанию самого канала в MAX) */
    description: 'Канал Центра ДПО факультета права НИУ ВШЭ в мессенджере MAX: новости и анонсы программ.',
    /** @type {string|null} локальный путь к логотипу канала */
    icon: 'images/channel-logo.jpg',
  };

  var DISMISS_KEY = 'channel-invite-closed';
  var DISMISS_DAYS = 30;

  if (!CHANNEL.url) return;

  var read = function (key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  };

  var dismissedAt = Number(read(DISMISS_KEY) || 0);
  if (dismissedAt && Date.now() - dismissedAt < DISMISS_DAYS * 24 * 3600 * 1000) return;

  var CSS = [
    '#channelInvite{position:fixed;right:16px;bottom:16px;z-index:900;width:min(340px,calc(100vw - 32px));',
    'background:rgb(var(--surface));color:rgb(var(--ink));border:1px solid rgb(var(--ink) / .14);border-radius:16px;',
    'box-shadow:0 12px 40px rgb(var(--ink) / .18);padding:18px;display:flex;gap:14px;align-items:flex-start;',
    "font-family:'HSE Sans','IBM Plex Sans',system-ui,sans-serif;",
    'opacity:0;transform:translateY(10px);transition:opacity .32s cubic-bezier(.22,1,.36,1),transform .32s cubic-bezier(.22,1,.36,1)}',
    '#channelInvite.is-open{opacity:1;transform:none}',
    '#channelInvite .ci-icon{width:44px;height:44px;flex:none;border-radius:999px;background:var(--bg-tint);color:rgb(var(--accent));',
    'display:flex;align-items:center;justify-content:center;overflow:hidden}',
    '#channelInvite .ci-icon img{width:100%;height:100%;object-fit:cover}',
    '#channelInvite .ci-title{font:600 15px/1.35 inherit;margin:2px 44px 4px 0;font-family:inherit}',
    '#channelInvite .ci-desc{font-size:13px;line-height:1.5;color:#48423A;margin:0 0 12px}',
    // Мишени 44px (WCAG 2.5.5): кнопка-действие и крестик.
    '#channelInvite .ci-join{display:inline-flex;align-items:center;min-height:44px;font-size:13px;font-weight:600;color:rgb(var(--surface));background:rgb(var(--accent));',
    'border-radius:999px;padding:0 18px;text-decoration:none}',
    '#channelInvite .ci-join:hover{background:#1145AA}',
    // font:inherit обязателен: кнопки не наследуют шрифт сами, и крестик
    // рисовался системным Arial (замер аудита 18.08).
    '#channelInvite .ci-close{position:absolute;top:4px;right:4px;width:44px;height:44px;border-radius:999px;',
    'border:1px solid rgb(var(--ink) / .12);background:rgb(var(--surface));color:rgb(var(--ink));font:inherit;font-size:17px;line-height:1;cursor:pointer}',
    '#channelInvite .ci-close:hover{background:var(--bg-tint)}',
    '@media (prefers-reduced-motion:reduce){#channelInvite{transition:none;transform:none}}',
    'html.vi-mode #channelInvite{background:rgb(var(--surface))!important;border:2px solid #000!important}',
    'html.vi-mode #channelInvite .ci-close,html.vi-mode #channelInvite .ci-join{border:2px solid #000!important}',
  ].join('');

  function remember() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch (e) {
      /* приватный режим */
    }
  }

  function show() {
    if (document.getElementById('channelInvite')) return;

    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    var box = document.createElement('div');
    box.id = 'channelInvite';
    // region, а не dialog: окно не перекрывает страницу, фокус в него не
    // уводится – та же логика, что у баннера cookies.
    box.setAttribute('role', 'region');
    box.setAttribute('aria-label', 'Приглашение подписаться на канал факультета');
    box.style.position = 'fixed';

    var icon = document.createElement('span');
    icon.className = 'ci-icon';
    icon.setAttribute('aria-hidden', 'true');
    if (CHANNEL.icon) {
      var img = document.createElement('img');
      img.src = CHANNEL.icon;
      img.alt = '';
      icon.appendChild(img);
    } else {
      // Тот же самолётик в круге, что у контакта «Telegram» на лендинге.
      icon.innerHTML =
        '<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 3 2.8 9l4.6 1.8L15 5.5l-5.4 6.4 5.9 4.1z"/></svg>';
    }

    var body = document.createElement('div');
    var title = document.createElement('p');
    title.className = 'ci-title';
    title.textContent = CHANNEL.title;
    var desc = document.createElement('p');
    desc.className = 'ci-desc';
    desc.textContent = CHANNEL.description;
    var join = document.createElement('a');
    join.className = 'ci-join';
    join.href = CHANNEL.url;
    join.target = '_blank';
    join.rel = 'noopener noreferrer';
    join.textContent = 'Подписаться';
    join.addEventListener('click', function () {
      remember();
      box.remove();
    });
    body.append(title, desc, join);

    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'ci-close';
    close.setAttribute('aria-label', 'Закрыть приглашение');
    close.innerHTML = '&times;';
    close.addEventListener('click', function () {
      remember();
      box.remove();
    });

    box.append(icon, body, close);
    document.body.append(box);
    requestAnimationFrame(function () {
      box.classList.add('is-open');
    });
    keepAboveCookieBanner(box);
  }

  /**
   * Окно показывается с первой секунды, одновременно с баннером cookies
   * (#cookieBanner, js/cookie-consent.js). На узком экране оба живут у
   * нижнего края, и баннер накрывал карточку целиком. Пока баннер на
   * экране, карточка приподнимается над ним; после ответа на баннер
   * опускается на место. Опрос раз в полсекунды и конечный: баннер
   * исчезает после первого же ответа.
   */
  function keepAboveCookieBanner(box) {
    var place = function () {
      var banner = document.getElementById('cookieBanner');
      if (banner && banner.offsetHeight) {
        var overlap = window.innerHeight - banner.getBoundingClientRect().top;
        box.style.bottom = Math.max(16, overlap + 12) + 'px';
        return true;
      }
      box.style.bottom = '16px';
      return false;
    };
    place();
    var n = 0;
    var timer = setInterval(function () {
      if (!document.body.contains(box)) {
        clearInterval(timer);
        return;
      }
      if (!place() && n > 2) clearInterval(timer);
      n++;
    }, 500);
  }

  /**
   * Окно показывается только после ответа на баннер cookies (решение
   * заказчика 19.08.2026). Два признака ответа:
   *  - в localStorage лежит 'cookie-consent' (обычный случай; покрывает и
   *    повторный визит, когда баннер уже не появляется);
   *  - баннер был на странице и исчез (приватный режим: localStorage не
   *    пишется, но ответ по клику баннер убирает).
   * Пока человек не ответил, приглашение не появляется вовсе. Секундная
   * пауза после ответа – чтобы карточка не выпрыгивала встык за баннером.
   */
  function waitForConsentAnswer() {
    var sawBanner = false;
    var timer = setInterval(function () {
      if (document.getElementById('cookieBanner')) {
        sawBanner = true;
        return;
      }
      if (read('cookie-consent') || sawBanner) {
        clearInterval(timer);
        setTimeout(show, 1000);
      }
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitForConsentAnswer);
  } else {
    waitForConsentAnswer();
  }
})();
