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
    // Сжатая шапка ниже своей раскладки на --hdr-shift: сжатие сделано
    // transform'ом, и rect обёртки его не знает.
    var shift = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hdr-shift')) || 0;
    var h = Math.round(header.getBoundingClientRect().height - shift);
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
      if (triggers[i] === except) continue;
      // Вложенный триггер (аккордеон «Направления» внутри мобильного меню):
      // открытие ребёнка не должно захлопывать родительскую панель.
      if (except) {
        var p = panelOf(triggers[i]);
        if (p && p.contains(except)) continue;
      }
      close(triggers[i], opts);
    }
  }

  /**
   * Аккордеон «Направления» в мобильном меню наполняется клонами строк из
   * панели навигации при каждом открытии: содержимое панели генерируется
   * сборкой, а вторая генерируемая область разъехалась бы с первой.
   * Клонирование при каждом открытии переживает пересборку рантаймом.
   */
  function fillMobileDirs(panel) {
    var list = panel.querySelector('.dpo-mobile-dirs');
    if (!list) return;
    var rows = document.querySelectorAll(
      '#navProgramsPanel .dpo-menu-sphere-head, #navProgramsPanel .dpo-menu-all',
    );
    if (!rows.length) return;
    list.textContent = '';
    for (var i = 0; i < rows.length; i++) list.appendChild(rows[i].cloneNode(true));
  }

  function open(trigger) {
    var panel = panelOf(trigger);
    if (!panel) return;
    closeAll(trigger);
    syncHeaderHeight();
    if (panel.id === 'mobileMenuPanel') fillMobileDirs(panel);
    panel.hidden = false;
    // Панель должна оказаться в потоке раньше, чем снимется прозрачность,
    // иначе перехода не будет. Раньше следующий кадр ждали через
    // requestAnimationFrame, но в фоновой вкладке кадры не выдаются: панель
    // оставалась невидимой при aria-expanded="true", то есть меню считалось
    // раскрытым, а на экране не менялось ничего и ссылки не фокусировались.
    // Принудительный рефлоу даёт тот же эффект и не зависит от кадров.
    void panel.offsetWidth;
    // Жест мог оставить панель уехавшей вверх инлайновым transform –
    // штатное открытие обязано начинаться с чистого листа.
    panel.style.transform = '';
    panel.style.opacity = '';
    panel.style.transition = '';
    if (panel.id === 'mobileMenuPanel') setupSheetGesture(trigger, panel);
    panel.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');
  }

  /* ── Жест «смахнуть вверх – закрыть» у мобильного меню ──────────────────
     Пилот apple-design (02.09.2026, решение заказчика после пробы на
     модалке заявки). Та же физика, что в js/application-form.js: 1:1 за
     пальцем, rubber-band при тяге вниз (панель пришла сверху и уходит
     вверх – путь симметричен), скорость пальца передаётся рукописной
     пружине, решение «закрыть/вернуть» – проекцией импульса.

     Только тач и без reduced-motion. Жест включается лишь пока содержимое
     панели ПОМЕЩАЕТСЯ без прокрутки (touch-action: none душит нативный
     скролл, а на маленьком экране с раскрытым аккордеоном прокрутка
     нужнее жеста) – после каждого клика внутри панели гейт пересчитывается:
     раскрытие «Направлений» меняет высоту содержимого. */
  function setupSheetGesture(trigger, panel) {
    if (panel.dataset.dpoSheet) return;
    panel.dataset.dpoSheet = '1';
    if (!window.matchMedia('(pointer: coarse)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    var y = 0;
    var vel = 0;
    var raf = null;
    var engaged = false;
    var tracking = false;
    var startY = 0;
    var grab = 0;
    var history = [];

    function scrollable() {
      return panel.scrollHeight > panel.clientHeight + 4;
    }
    function syncTouchAction() {
      panel.style.touchAction = scrollable() ? '' : 'none';
    }
    syncTouchAction();
    panel.addEventListener('click', function () {
      window.requestAnimationFrame(syncTouchAction);
    });

    // Смахивание, начатое на ссылке, не должно превращаться в переход:
    // нативная прокрутка глушит click сама, у ручного жеста глушителя нет.
    var swallowClick = false;
    panel.addEventListener('click', function (e) {
      if (!swallowClick) return;
      swallowClick = false;
      e.preventDefault();
      e.stopPropagation();
    }, true);

    function setY(value) {
      y = value;
      var h = panel.offsetHeight || 400;
      panel.style.transform = value ? 'translateY(' + value.toFixed(2) + 'px)' : '';
      panel.style.opacity = value < 0 ? String(Math.max(0, 1 + value / (h * 0.9))) : '';
    }

    function rubber(overshoot) {
      var dim = 300, c = 0.55;
      return (overshoot * dim * c) / (dim + c * Math.abs(overshoot));
    }

    function spring(target, response, onSettle) {
      var k = Math.pow((2 * Math.PI) / response, 2);
      var c = 2 * Math.sqrt(k);
      var prev = performance.now();
      if (raf) cancelAnimationFrame(raf);
      function step(now) {
        var dt = Math.min(32, now - prev) / 1000;
        prev = now;
        var a = k * (target - y) - c * vel;
        vel += a * dt;
        setY(y + vel * dt);
        if (Math.abs(target - y) < 0.5 && Math.abs(vel) < 20) {
          setY(target);
          raf = null;
          if (onSettle) onSettle();
          return;
        }
        raf = requestAnimationFrame(step);
      }
      raf = requestAnimationFrame(step);
    }

    panel.addEventListener('pointerdown', function (e) {
      if (!e.isPrimary || scrollable()) return;
      tracking = true;
      engaged = false;
      startY = e.clientY;
      if (raf) { cancelAnimationFrame(raf); raf = null; } // перехват на лету
      history = [{ t: e.timeStamp, y: y }];
    });

    panel.addEventListener('pointermove', function (e) {
      if (!tracking || !e.isPrimary) return;
      var dy = e.clientY - startY;
      if (!engaged) {
        // Гистерезис ~10px: тап по ссылке остаётся тапом.
        if (Math.abs(dy) < 10) return;
        engaged = true;
        grab = e.clientY - y;
        panel.style.transition = 'none';
        panel.setPointerCapture(e.pointerId);
      }
      var raw = e.clientY - grab;
      setY(raw <= 0 ? raw : rubber(raw));
      history.push({ t: e.timeStamp, y: raw });
      while (history.length > 6 || e.timeStamp - history[0].t > 100) history.shift();
    });

    function release(e) {
      if (!tracking || !e.isPrimary) return;
      tracking = false;
      if (!engaged) return;
      engaged = false;
      swallowClick = true;
      // Если click так и не пришёл (палец уехал с элемента), не съедать
      // следующий честный тап.
      window.setTimeout(function () { swallowClick = false; }, 120);
      var last = history[history.length - 1];
      var first = history[0];
      vel = last && first && last.t > first.t
        ? ((last.y - first.y) / (last.t - first.t)) * 1000
        : 0;
      var h = panel.offsetHeight || 400;
      var projected = y + (vel / 1000) * 0.998 / (1 - 0.998);
      if (projected < -h * 0.35 && vel < 100) {
        spring(-(h + 60), 0.3, function () {
          panel.style.transition = '';
          // Закрытие жестом возвращает фокус на кнопку меню, как Esc: иначе
          // фокус оставался на body (прогон 03.09.2026).
          close(trigger, { restoreFocus: true });
          panel.style.opacity = '';
          // Уехавший transform снимет open() при следующем открытии.
        });
      } else {
        spring(0, 0.35, function () {
          panel.style.transition = '';
          panel.style.transform = '';
          panel.style.opacity = '';
        });
      }
    }
    panel.addEventListener('pointerup', release);
    panel.addEventListener('pointercancel', release);
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

    // Наведение открывает только выпадающие меню шапки (.dpo-nav-trigger):
    // бургер и аккордеон мобильного меню работают строго кликом, иначе
    // «мышиное» наведение на бургер распахивало бы полноэкранное меню.
    var trigger = e.target.closest(TRIGGER);
    var overTrigger =
      trigger && trigger.classList.contains('dpo-nav-trigger') && panelOf(trigger) ? trigger : null;
    var overPanel = triggerOfPanel(e.target.closest('.dpo-menu-panel'));
    if (overPanel && !overPanel.classList.contains('dpo-nav-trigger')) overPanel = null;
    var hovered = overTrigger || overPanel;

    // Курсор ушёл с кнопки – запрет, поставленный кликом, снимается.
    if (clickClosed && clickClosed !== overTrigger) clickClosed = null;

    if (!hovered) {
      // Курсор где угодно ещё: закрываем раскрытое НАВЕДЕНИЕМ меню с
      // отсрочкой. Открытые кликом бургер и аккордеон не трогаем – их
      // закрывает клик, Esc или уход фокуса.
      var openTrigger = document.querySelector('.dpo-nav-trigger[aria-expanded="true"]');
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

  /* ── Сжатая шапка при скролле (handoff 20.08.2026, блок 2d) ─────────────
     Порог 120px, чтение scrollY схлопнуто в один вызов на кадр через rAF.
     Класс ставится на <html> идемпотентно каждый кадр скролла: рантайм
     заменяет documentElement при загрузке, и одноразовая установка класса
     не пережила бы подмену. */
  var scrollFrame = 0;
  function syncScrolled() {
    var on = window.scrollY > 120;
    var root = document.documentElement;
    if (root.classList.contains('dpo-scrolled') !== on) {
      root.classList.toggle('dpo-scrolled', on);
      // Сдвиг шапки идёт переходом 180мс: панель меню, привязанная к
      // --dpo-header-h, перемеряется после его окончания.
      window.setTimeout(syncHeaderHeight, 200);
    }
  }
  window.addEventListener(
    'scroll',
    function () {
      if (scrollFrame) return;
      scrollFrame = window.requestAnimationFrame(function () {
        scrollFrame = 0;
        syncScrolled();
      });
    },
    { passive: true },
  );
  syncScrolled();

  // Рантайм дорисовывает шапку не сразу и может пересобрать её несколько раз.
  var n = 0;
  var timer = window.setInterval(function () {
    syncHeaderHeight();
    if (++n > 40) window.clearInterval(timer);
  }, 250);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(syncHeaderHeight);
})();
