/**
 * Всплывающее окно «подпишитесь на канал факультета» (по образцу сайта
 * Минэкономразвития): логотип, название, короткое описание, кнопка
 * «Подписаться», крестик.
 *
 * TODO: адреса канала пока нет – заполните CHANNEL ниже (по аналогии с
 * METRIKA_ID в js/cookie-consent.js). Пока url равен null, окно не
 * показывается вовсе. icon – необязательный путь к ЛОКАЛЬНОЙ картинке
 * (например 'images/channel-logo.png'); внешние адреса запрещены CSP и
 * 152-ФЗ, без картинки рисуется встроенный глиф-самолётик, как в контактах.
 *
 * Правила показа (указание заказчика, август 2026):
 *  - окно появляется только ПОСЛЕ того, как посетитель ответил на баннер
 *    согласия на cookies, а не одновременно с ним;
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
    /** @type {string|null} TODO: адрес канала, например 'https://t.me/…' */
    url: null,
    /** TODO: название канала, как в мессенджере */
    title: 'Канал факультета права',
    /** TODO: короткое описание канала (одна-две строки) */
    description: 'Новости и анонсы факультета права НИУ ВШЭ.',
    /** @type {string|null} TODO: локальный путь к логотипу канала */
    icon: null,
  };

  var CONSENT_KEY = 'cookie-consent'; // ставит js/cookie-consent.js
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
    'background:#fff;color:#211E1B;border:1px solid rgba(33,30,27,.14);border-radius:16px;',
    'box-shadow:0 12px 40px rgba(33,30,27,.18);padding:18px;display:flex;gap:14px;align-items:flex-start;',
    "font-family:'HSE Sans','IBM Plex Sans',system-ui,sans-serif;",
    'opacity:0;transform:translateY(10px);transition:opacity .32s cubic-bezier(.22,1,.36,1),transform .32s cubic-bezier(.22,1,.36,1)}',
    '#channelInvite.is-open{opacity:1;transform:none}',
    '#channelInvite .ci-icon{width:44px;height:44px;flex:none;border-radius:50%;background:#F2ECE1;color:#1658DA;',
    'display:flex;align-items:center;justify-content:center;overflow:hidden}',
    '#channelInvite .ci-icon img{width:100%;height:100%;object-fit:cover}',
    '#channelInvite .ci-title{font:600 15px/1.35 inherit;margin:2px 24px 4px 0;font-family:inherit}',
    '#channelInvite .ci-desc{font-size:13.5px;line-height:1.5;color:#55503E;margin:0 0 12px}',
    '#channelInvite .ci-join{display:inline-block;font-size:13.5px;font-weight:600;color:#fff;background:#1658DA;',
    'border-radius:999px;padding:9px 18px;text-decoration:none}',
    '#channelInvite .ci-join:hover{background:#1145AA}',
    '#channelInvite .ci-close{position:absolute;top:10px;right:10px;width:32px;height:32px;border-radius:50%;',
    'border:1px solid rgba(33,30,27,.12);background:#fff;color:#211E1B;font-size:17px;line-height:1;cursor:pointer}',
    '#channelInvite .ci-close:hover{background:#F2ECE1}',
    '@media (prefers-reduced-motion:reduce){#channelInvite{transition:none;transform:none}}',
    'html.vi-mode #channelInvite{background:#fff!important;border:2px solid #000!important}',
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
  }

  // Ждём ответа на баннер cookies: пока выбора нет, окно не показывается.
  // Опрос дешёвый и конечный: на баннер отвечают в первые секунды либо
  // никогда за визит – через 10 минут перестаём ждать.
  var tries = 0;
  var timer = setInterval(function () {
    var consent = read(CONSENT_KEY);
    if (consent === 'accepted' || consent === 'declined') {
      clearInterval(timer);
      // Небольшая пауза, чтобы окно не выпрыгивало в момент клика по баннеру.
      setTimeout(show, 1200);
      return;
    }
    if (++tries > 600) clearInterval(timer);
  }, 1000);
})();
