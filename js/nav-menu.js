/**
 * Раскрывающееся меню направлений в шапке лендинга.
 *
 * Как и carousel.js, всё построено на делегировании: лендинг собирает
 * React-рантайм, который целиком пересобирает разметку, и слушатель,
 * привязанный к конкретной кнопке, после первой же перерисовки указывал бы
 * на выброшенный узел.
 *
 * Панель позиционируется fixed под шапкой, поэтому её отступ сверху зависит
 * от фактической высоты шапки. Высота меняется от шрифтов, от ширины экрана
 * и от режима для слабовидящих (там zoom 1.25), поэтому она измеряется, а не
 * вписывается числом.
 */
(function () {
  'use strict';

  var TRIGGER = '[aria-controls][aria-expanded]';

  function panelOf(trigger) {
    var id = trigger.getAttribute('aria-controls');
    return id ? document.getElementById(id) : null;
  }

  function syncHeaderHeight() {
    var header = document.querySelector('header');
    if (!header) return;
    var h = Math.round(header.getBoundingClientRect().height);
    if (h > 0) document.documentElement.style.setProperty('--dpo-header-h', h + 'px');
  }

  function close(trigger, opts) {
    var panel = panelOf(trigger);
    if (!panel || trigger.getAttribute('aria-expanded') !== 'true') return;
    trigger.setAttribute('aria-expanded', 'false');
    panel.classList.remove('is-open');
    // Ждём конца перехода прозрачности, иначе панель исчезает рывком.
    // Через hidden, а не display: элемент должен уйти и из дерева доступности.
    window.setTimeout(function () {
      if (trigger.getAttribute('aria-expanded') !== 'true') panel.hidden = true;
    }, 170);
    if (opts && opts.restoreFocus) trigger.focus();
  }

  function closeAll(except, opts) {
    var triggers = document.querySelectorAll(TRIGGER);
    for (var i = 0; i < triggers.length; i++) {
      if (triggers[i] !== except) close(triggers[i], opts);
    }
  }

  function open(trigger) {
    var panel = panelOf(trigger);
    if (!panel) return;
    closeAll(trigger);
    syncHeaderHeight();
    panel.hidden = false;
    // Панель должна быть в потоке до снятия прозрачности, иначе перехода нет.
    window.requestAnimationFrame(function () {
      panel.classList.add('is-open');
    });
    trigger.setAttribute('aria-expanded', 'true');
  }

  document.addEventListener('click', function (e) {
    var trigger = e.target.closest ? e.target.closest(TRIGGER) : null;

    if (trigger && panelOf(trigger)) {
      e.preventDefault();
      if (trigger.getAttribute('aria-expanded') === 'true') close(trigger);
      else open(trigger);
      return;
    }

    // Клик вне панели закрывает меню. Клик по ссылке внутри панели ничего не
    // закрывает специально: страница и так уходит по ссылке.
    if (!e.target.closest || !e.target.closest('.dpo-menu-panel')) closeAll(null);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var open = document.querySelector(TRIGGER + '[aria-expanded="true"]');
    if (open) close(open, { restoreFocus: true });
  });

  // Уход фокуса за пределы шапки закрывает меню: иначе при табуляции
  // фокус уезжает в страницу, а раскрытая панель остаётся висеть.
  document.addEventListener('focusin', function (e) {
    var inHeader = e.target.closest && e.target.closest('header');
    var inPanel = e.target.closest && e.target.closest('.dpo-menu-panel');
    if (!inHeader && !inPanel) closeAll(null);
  });

  window.addEventListener('resize', syncHeaderHeight);

  // Рантайм дорисовывает шапку не сразу и может пересобрать её несколько раз.
  var n = 0;
  var timer = window.setInterval(function () {
    syncHeaderHeight();
    if (++n > 40) window.clearInterval(timer);
  }, 250);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(syncHeaderHeight);
})();
