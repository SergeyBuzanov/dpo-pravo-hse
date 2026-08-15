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
      var live = panelOf(trigger);
      if (live && trigger.getAttribute('aria-expanded') !== 'true') live.hidden = true;
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
    // Панель должна оказаться в потоке раньше, чем снимется прозрачность,
    // иначе перехода не будет. Раньше следующий кадр ждали через
    // requestAnimationFrame, но в фоновой вкладке кадры не выдаются: панель
    // оставалась невидимой при aria-expanded="true", то есть меню считалось
    // раскрытым, а на экране не менялось ничего и ссылки не фокусировались.
    // Принудительный рефлоу даёт тот же эффект и не зависит от кадров.
    void panel.offsetWidth;
    panel.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');
  }

  /* ── Раскрытие по наведению ─────────────────────────────────────────────
     Наведение ДОБАВЛЯЕТСЯ к клику, а не заменяет его: клик остаётся
     единственным способом открыть меню с клавиатуры и там, где мыши нет.

     Гейт двойной. matchMedia отсекает устройства без настоящего курсора,
     а pointerType – касание на гибридном ноутбуке с сенсорным экраном, где
     matchMedia честно отвечает «курсор есть». Без второй проверки тап по
     триггеру раскрывал бы меню «наведением» и оно залипало бы.

     Задержка на закрытие обязательна: панель начинается по нижней кромке
     шапки, и путь курсора от кнопки вниз идёт через отступ шапки, где нет
     ни триггера, ни панели. Без задержки меню мигало бы на этом участке. */
  var HOVER_CLOSE_MS = 220;
  var hoverTimer = null;
  /* Триггер, которому наведение временно запрещено: пользователь только что
     закрыл меню кликом, курсор ещё на кнопке, и без этого меню мгновенно
     раскрылось бы обратно, проигнорировав клик. */
  var clickClosed = null;

  function canHover() {
    return !!(window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches);
  }

  function cancelHoverClose() {
    if (hoverTimer) {
      window.clearTimeout(hoverTimer);
      hoverTimer = null;
    }
  }

  /** Триггер, которому принадлежит панель под курсором. */
  function triggerOfPanel(panel) {
    if (!panel || !panel.id) return null;
    var triggers = document.querySelectorAll(TRIGGER);
    for (var i = 0; i < triggers.length; i++) {
      if (triggers[i].getAttribute('aria-controls') === panel.id) return triggers[i];
    }
    return null;
  }

  document.addEventListener('pointerover', function (e) {
    if (e.pointerType !== 'mouse' || !canHover() || !e.target.closest) return;

    var trigger = e.target.closest(TRIGGER);
    var overTrigger = trigger && panelOf(trigger) ? trigger : null;
    var overPanel = triggerOfPanel(e.target.closest('.dpo-menu-panel'));
    var hovered = overTrigger || overPanel;

    // Курсор ушёл с кнопки – запрет, поставленный кликом, снимается.
    if (clickClosed && clickClosed !== overTrigger) clickClosed = null;

    if (!hovered) {
      // Курсор где угодно ещё: закрываем то, что раскрыто, но с отсрочкой.
      var openTrigger = document.querySelector(TRIGGER + '[aria-expanded="true"]');
      if (openTrigger && !hoverTimer) {
        hoverTimer = window.setTimeout(function () {
          hoverTimer = null;
          close(openTrigger);
        }, HOVER_CLOSE_MS);
      }
      return;
    }

    cancelHoverClose();
    if (hovered !== clickClosed && hovered.getAttribute('aria-expanded') !== 'true') open(hovered);
  });

  // Курсор вышел за пределы окна: pointerover больше не придёт, и без этого
  // меню осталось бы раскрытым, пока пользователь ходит по вкладкам браузера.
  document.addEventListener('pointerleave', function (e) {
    if (e.pointerType !== 'mouse') return;
    cancelHoverClose();
    closeAll(null);
  });

  document.addEventListener('click', function (e) {
    var trigger = e.target.closest ? e.target.closest(TRIGGER) : null;

    if (trigger && panelOf(trigger)) {
      e.preventDefault();
      cancelHoverClose();
      if (trigger.getAttribute('aria-expanded') === 'true') {
        close(trigger);
        clickClosed = trigger;
      } else {
        open(trigger);
        clickClosed = null;
      }
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
