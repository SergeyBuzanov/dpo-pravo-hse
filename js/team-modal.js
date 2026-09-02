/**
 * Окно «подробнее о преподавателе» для карусели «Наша команда».
 *
 * Открывается ПО КЛИКУ по карточке или по кнопке «N программ» в ней —
 * не по наведению: hover не существует на тач-экранах, и подробности там
 * были бы недоступны. Наведение остаётся только визуальной подсветкой.
 *
 * Данные лежат в data-атрибуте карточки (data-dpo-teacher, JSON), который
 * пишет scripts/build-landing.js. Собирать содержимое окна из вёрстки
 * карточки нельзя: там должность обрезана клампом, а в окне она обязана
 * быть целиком.
 *
 * Все слушатели повешены на document: лендинг пересобирает React-рантайм,
 * и слушатель на конкретном узле после первой перерисовки указывал бы на
 * выброшенный элемент (тот же приём, что в carousel.js и nav-menu.js).
 *
 * Доступность — по образцу js/application-form.js: ловушка фокуса, Esc,
 * закрытие по клику мимо окна, возврат фокуса на карточку, aria-modal.
 */
(function () {
  'use strict';

  var CSS = [
    '.dpo-team-backdrop{position:fixed;inset:0;z-index:9000;display:flex;align-items:flex-start;',
    "font-family:'HSE Sans','IBM Plex Sans',system-ui,sans-serif;",
    'justify-content:center;padding:max(16px,6vh) 16px;overflow-y:auto;',
    'background:rgb(var(--ink) / .55);opacity:0;transition:opacity .22s cubic-bezier(.22,1,.36,1)}',
    '.dpo-team-backdrop.is-open{opacity:1}',
    '.dpo-team{position:relative;width:100%;max-width:560px;background:var(--bg);color:rgb(var(--ink));',
    'border-radius:18px;box-shadow:0 24px 60px rgb(var(--ink) / .28);padding:clamp(22px,4vw,34px);',
    'transform:translateY(12px) scale(.985);transition:transform .22s cubic-bezier(.22,1,.36,1)}',
    '.dpo-team-backdrop.is-open .dpo-team{transform:none}',
    '.dpo-team h2{font-family:"HSE Slab","Source Serif 4",Georgia,serif;font-size: clamp(1.3125rem,3.2vw,1.625rem);',
    'line-height:1.2;margin:0 44px 6px 0;font-weight:600}',
    '.dpo-team-close{position:absolute;top:14px;right:14px;width:38px;height:38px;border-radius:999px;',
    'border:1px solid rgb(var(--ink) / .12);background:rgb(var(--surface));color:rgb(var(--ink));font-size:1.25rem;line-height:1;',
    'cursor:pointer;transition:background .15s,border-color .15s}',
    '.dpo-team-close:hover{background:var(--bg-tint)}',
    '.dpo-team-about{font-size:0.9375rem;line-height:1.6;color:var(--ink-soft);margin:0 0 18px}',
    '.dpo-team-label{font-size:0.8125rem;font-weight:600;letter-spacing:.12em;text-transform:uppercase;',
    'color:rgb(var(--accent));margin:0 0 8px}',
    '.dpo-team-programs{list-style:none;margin:0 0 6px;padding:0}',
    '.dpo-team-programs li{border-top:1px solid rgb(var(--ink) / .1)}',
    '.dpo-team-programs a{display:block;padding:10px 2px;font-size:0.9375rem;line-height:1.45;',
    'color:rgb(var(--accent));text-decoration:underline;text-decoration-color:rgb(var(--accent) / .35);',
    'text-underline-offset:3px}',
    '.dpo-team-programs a:hover{text-decoration-color:currentColor}',
    '.dpo-team-hse{display:inline-block;margin-top:14px;font-size:0.9375rem;font-weight:600;color:rgb(var(--accent));',
    'text-decoration:underline;text-underline-offset:3px}',
    '@media (prefers-reduced-motion:reduce){.dpo-team-backdrop,.dpo-team{transition:none}}',
    // !important обязателен: глобальное html.vi-mode *{background:transparent
    // !important} перебивает обычное объявление, и окно было прозрачным –
    // текст карточки ложился на страницу под ней (найдено 21.08.2026 на
    // форме заявки, здесь та же болезнь).
    'html.vi-mode .dpo-team{background:#fff !important;border:2px solid #000 !important}',
    'html.vi-mode .dpo-team-backdrop{background:rgba(0,0,0,.8) !important}',
  ].join('');

  var FOCUSABLE =
    'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select,[tabindex]:not([tabindex="-1"])';

  var backdrop = null;
  var lastTrigger = null;

  function injectStyles() {
    if (document.getElementById('dpo-team-styles')) return;
    var style = document.createElement('style');
    style.id = 'dpo-team-styles';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        if (key === 'text') node.textContent = attrs[key];
        else if (attrs[key] != null) node.setAttribute(key, attrs[key]);
      });
    }
    (children || []).forEach(function (child) {
      if (child) node.appendChild(child);
    });
    return node;
  }

  function onKeydown(event) {
    if (!backdrop) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDialog();
      return;
    }
    if (event.key !== 'Tab') return;
    var items = Array.prototype.filter.call(backdrop.querySelectorAll(FOCUSABLE), function (node) {
      return node.offsetParent !== null || node === document.activeElement;
    });
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function closeDialog() {
    if (!backdrop) return;
    var node = backdrop;
    backdrop = null;
    node.classList.remove('is-open');
    document.removeEventListener('keydown', onKeydown, true);
    document.documentElement.style.overflow = '';
    window.setTimeout(function () {
      if (node.parentNode) node.parentNode.removeChild(node);
    }, 220);
    // Фокус возвращается на кнопку карточки, с которой окно открыли: иначе
    // человек с клавиатуры теряет место в карусели.
    if (lastTrigger && document.contains(lastTrigger)) lastTrigger.focus();
  }

  function openDialog(card, trigger) {
    var data;
    try {
      data = JSON.parse(card.getAttribute('data-dpo-teacher') || '{}');
    } catch (e) {
      return;
    }
    if (!data || !data.name) return;

    injectStyles();
    lastTrigger = trigger;

    var close = el('button', {
      type: 'button',
      class: 'dpo-team-close',
      'aria-label': 'Закрыть окно',
      text: '×',
    });

    var children = [close, el('h2', { id: 'dpo-team-title', text: data.name })];
    if (data.about) children.push(el('p', { class: 'dpo-team-about', text: data.about }));

    var programs = Array.isArray(data.programs) ? data.programs : [];
    if (programs.length) {
      children.push(el('p', { class: 'dpo-team-label', text: 'Ведёт программы' }));
      children.push(
        el(
          'ul',
          { class: 'dpo-team-programs' },
          programs.map(function (p) {
            return el('li', null, [el('a', { href: p.h, text: p.t })]);
          }),
        ),
      );
    }

    // Ссылка на личную страницу выводится только когда адрес задан в данных
    // (справочник teacherPages в .catalog-data.json). Автоматически адреса
    // не ищутся — однофамильцы дали бы ссылку на чужого человека.
    if (data.url && /^https:\/\/([a-z0-9-]+\.)*hse\.ru\//i.test(data.url)) {
      children.push(
        el('a', {
          class: 'dpo-team-hse',
          href: data.url,
          target: '_blank',
          rel: 'noopener noreferrer',
          text: 'Личная страница на hse.ru',
        }),
      );
    }

    var dialog = el(
      'div',
      { class: 'dpo-team', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dpo-team-title' },
      children,
    );
    var wrap = el('div', { class: 'dpo-team-backdrop' }, [dialog]);

    close.addEventListener('click', closeDialog);
    wrap.addEventListener('mousedown', function (event) {
      // Закрытие по клику мимо окна — только если нажатие и началось, и
      // закончилось на подложке (см. пояснение в application-form.js).
      if (event.target === wrap) wrap.dataset.outside = '1';
    });
    wrap.addEventListener('click', function (event) {
      if (event.target === wrap && wrap.dataset.outside === '1') closeDialog();
      delete wrap.dataset.outside;
    });

    if (backdrop && backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    backdrop = wrap;
    document.body.appendChild(wrap);
    // Жест «потянуть вниз – закрыть», общий с формой заявки и опросом
    // (js/sheet-gesture.js). Окно строится заново при каждом открытии,
    // поэтому reset() не нужен.
    if (window.dpoSheet) {
      window.dpoSheet.attach({
        root: wrap,
        sheet: wrap.querySelector('.dpo-team'),
        grip: '.dpo-team h2, .dpo-team-label',
        onClose: closeDialog,
      });
    }
    document.addEventListener('keydown', onKeydown, true);
    document.documentElement.style.overflow = 'hidden';
    requestAnimationFrame(function () {
      wrap.classList.add('is-open');
    });
    close.focus();
  }

  document.addEventListener('click', function (event) {
    var target = event.target;
    if (!target || !target.closest) return;
    var card = target.closest('[data-dpo-teacher]');
    if (!card) return;
    // Клик по ссылке внутри будущих карточек не перехватываем.
    if (target.closest('a')) return;
    event.preventDefault();
    var btn = target.closest('.dpo-teacher-more') || card.querySelector('.dpo-teacher-more');
    openDialog(card, btn || card);
  });
})();
