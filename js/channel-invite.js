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
    // На телефоне карточка сворачивается в одну строку (решение владельца
    // 21.08.2026). Развёрнутая занимала 181px из 844 и вместе с панелью
    // действий съедала 33% экрана, закрывая обе кнопки героя и всю секцию
    // «Ближайшие старты». Описание канала на телефоне не нужно: то же
    // самое написано в секции контактов.
    '@media (max-width: 899px){',
    '#channelInvite{padding:10px 52px 10px 12px;gap:10px;align-items:center;',
    'width:min(340px,calc(100vw - 24px))}',
    // Тело карточки на телефоне – та же строка, что иконка: название и
    // ссылка в ряд, а не столбиком.
    '#channelInvite > div{display:flex;align-items:center;gap:10px;flex:1;min-width:0}',
    '#channelInvite .ci-icon{width:32px;height:32px}',
    '#channelInvite .ci-title{font-size:14px;margin:0;flex:1;min-width:0;',
    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '#channelInvite .ci-desc{display:none}',
    // Ссылкой, а не пилюлей: в одной строке две заливки (она и кнопка
    // панели действий под ней) спорили бы за внимание.
    // Мишень остаётся 44px (WCAG 2.5.5) – меняется только вид: заливка
    // уходит, остаётся подчёркнутая ссылка. Две заливные кнопки в одной
    // полосе (эта и «Подать заявку» в панели под ней) спорили бы.
    '#channelInvite .ci-join{min-height:44px;padding:0 4px;background:none;color:rgb(var(--accent));',
    'text-decoration:underline;text-underline-offset:3px}',
    '#channelInvite .ci-join:hover{background:none}',
    '#channelInvite .ci-close{top:6px;right:6px;font-size:16px}',
    '}',
    'html.vi-mode #channelInvite{background:rgb(var(--surface))!important;border:2px solid #000!important}',
    'html.vi-mode #channelInvite .ci-close,html.vi-mode #channelInvite .ci-join{border:2px solid #000!important}',
    // Аватар канала – растр, и правило html.vi-mode *{background-image:none}
    // его не берёт: он остаётся единственным цветным пятном на чёрно-белой
    // странице (замер 21.08.2026: 3 768 цветных пикселей из 1,3 млн).
    'html.vi-mode #channelInvite .ci-icon img{filter:grayscale(1) contrast(1.2)!important}',
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
    keepAboveBottomBars(box);
  }

  /**
   * У нижнего края экрана живут три вещи: баннер cookies (#cookieBanner,
   * js/cookie-consent.js), мобильная панель действий (.dpo-mobile-cta,
   * js/smooth-ui.js) и это приглашение. Карточка приподнимается над самой
   * верхней из тех, что сейчас на экране.
   *
   * Баннер временный – после ответа он исчезает, и карточка опускается.
   * Панель действий постоянна и живёт на ширине до 1023px: она несёт
   * ЕДИНСТВЕННУЮ кнопку заявки на телефоне, и накрывать её нельзя
   * (аудит 21.08.2026: на 390×844 перекрытие было полным). Поэтому опрос
   * не останавливается, пока карточка на экране: панель появляется и
   * исчезает при смене ширины окна и в режиме для слабовидящих.
   */
  function keepAboveBottomBars(box) {
    var topOf = function (node) {
      if (!node || !node.offsetHeight) return null;
      var rect = node.getBoundingClientRect();
      // display:none даёт нулевой прямоугольник – такой сосед не мешает.
      if (!rect.height) return null;
      return rect.top;
    };
    var place = function () {
      var tops = [
        topOf(document.getElementById('cookieBanner')),
        topOf(document.querySelector('.dpo-mobile-cta')),
      ].filter(function (value) {
        return value != null;
      });
      if (!tops.length) {
        box.style.bottom = '16px';
        return false;
      }
      var overlap = window.innerHeight - Math.min.apply(null, tops);
      box.style.bottom = Math.max(16, overlap + 12) + 'px';
      return true;
    };
    place();
    var timer = setInterval(function () {
      if (!document.body.contains(box)) {
        clearInterval(timer);
        return;
      }
      place();
    }, 500);
    window.addEventListener('resize', place);
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
