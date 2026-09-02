/**
 * Жест «потянуть вниз – закрыть» для модальных окон. Общий модуль трёх
 * диалогов: заявка (application-form), опрос (quiz), карточка
 * преподавателя (team-modal) – похожие окна обязаны вести себя одинаково
 * (apple-design, принцип familiarity; решение заказчика 03.09.2026).
 *
 * Физика по скиллу apple-design: окно идёт 1:1 за пальцем с уважением
 * точки хвата, вверх сопротивляется rubber-band'ом, на отпускании
 * скорость пальца передаётся рукописной пружине (rAF, полузакрытый
 * Эйлер, критическое затухание, response 0.3–0.35с), решение
 * «закрыть/вернуть» принимается проекцией импульса (затухание 0.998).
 * Библиотек нет – CSP и вес.
 *
 * Хват – шапка окна и видимая ручка-подсказка (горизонтальная полоска,
 * apple-design разд. 8: жест должен быть обнаружим). Ручка и жест
 * существуют только на тач-устройствах без reduced-motion.
 *
 * Использование:
 *   var sheet = window.dpoSheet && window.dpoSheet.attach({
 *     root: backdrop,          // подложка (её прозрачность следует за пальцем)
 *     sheet: dialogEl,         // само окно
 *     grip: 'h2, .dpo-x-head', // селекторы зон хвата ВНУТРИ окна
 *     onClose: closeFn,        // штатное закрытие диалога
 *   });
 *   // при повторном использовании того же DOM: sheet && sheet.reset()
 */
(function () {
  'use strict';

  var STYLES_ID = 'dpo-sheet-gesture-styles';

  function injectStyles() {
    if (document.getElementById(STYLES_ID)) return;
    var style = document.createElement('style');
    style.id = STYLES_ID;
    style.textContent = [
      '.dpo-sheet-handle{display:none}',
      '@media (pointer:coarse){',
      // Ручка-подсказка: полоска по центру у верхнего края окна.
      '.dpo-sheet-handle{display:block;width:36px;height:4px;border-radius:999px;',
      'background:rgb(33 30 27 / .18);margin:-6px auto 12px;touch-action:none}',
      'html.vi-mode .dpo-sheet-handle{background:#000 !important}',
      '}',
      '@media (prefers-reduced-motion:reduce){.dpo-sheet-handle{display:none !important}}',
    ].join('');
    document.head.appendChild(style);
  }

  function attach(opts) {
    if (!window.matchMedia('(pointer: coarse)').matches) return null;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
    var root = opts.root;
    var sheet = opts.sheet;
    if (!root || !sheet) return null;

    injectStyles();
    var handle = document.createElement('span');
    handle.className = 'dpo-sheet-handle';
    handle.setAttribute('aria-hidden', 'true');
    sheet.insertBefore(handle, sheet.firstChild);
    // Зоны хвата не должны отдавать жест прокрутке (touch-action), иначе
    // первый же pointermove кончается pointercancel.
    var grips = opts.grip ? sheet.querySelectorAll(opts.grip) : [];
    for (var i = 0; i < grips.length; i++) grips[i].style.touchAction = 'none';

    var y = 0;      // презентационное значение – с него стартует любой перехват
    var vel = 0;    // px/s
    var raf = null;
    var dragging = false;
    var history = [];
    var grab = 0;

    function setY(value) {
      y = value;
      sheet.style.transform = value ? 'translateY(' + value.toFixed(2) + 'px)' : '';
      var fade = Math.max(0, 1 - value / (sheet.offsetHeight || 480));
      root.style.opacity = value > 0 ? String(0.35 + 0.65 * fade) : '';
    }

    function reset() {
      if (raf) { cancelAnimationFrame(raf); raf = null; }
      dragging = false;
      vel = 0;
      sheet.style.transition = '';
      root.style.transition = '';
      setY(0);
      sheet.style.transform = '';
      root.style.opacity = '';
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

    root.addEventListener('pointerdown', function (e) {
      if (!e.isPrimary) return;
      var inGrip = e.target === handle ||
        (opts.grip && e.target.closest && e.target.closest(opts.grip));
      if (!inGrip) return;
      dragging = true;
      if (raf) { cancelAnimationFrame(raf); raf = null; } // перехват на лету
      grab = e.clientY - y;
      history = [{ t: e.timeStamp, y: y }];
      sheet.style.transition = 'none';
      root.style.transition = 'none';
      sheet.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    root.addEventListener('pointermove', function (e) {
      if (!dragging || !e.isPrimary) return;
      var raw = e.clientY - grab;
      setY(raw >= 0 ? raw : -rubber(-raw));
      history.push({ t: e.timeStamp, y: raw });
      while (history.length > 6 || e.timeStamp - history[0].t > 100) history.shift();
    });

    function release(e) {
      if (!dragging || !e.isPrimary) return;
      dragging = false;
      var last = history[history.length - 1];
      var first = history[0];
      vel = last && first && last.t > first.t
        ? ((last.y - first.y) / (last.t - first.t)) * 1000
        : 0;
      var projected = y + (vel / 1000) * 0.998 / (1 - 0.998);
      var dismissAt = Math.max(140, (sheet.offsetHeight || 480) * 0.4);
      if (projected > dismissAt && vel > -100) {
        var exit = window.innerHeight - sheet.getBoundingClientRect().top + 40;
        spring(exit, 0.3, function () {
          // Вуаль догорает штатным переходом: transition вернуть ДО
          // закрытия, инлайновую прозрачность снять сразу после. Уехавший
          // transform остаётся до конца затухания – его снимет reset()
          // при повторном использовании узла.
          root.style.transition = '';
          opts.onClose();
          root.style.opacity = '';
        });
      } else {
        spring(0, 0.35, function () {
          sheet.style.transition = '';
          root.style.transition = '';
          sheet.style.transform = '';
          root.style.opacity = '';
        });
      }
    }
    root.addEventListener('pointerup', release);
    root.addEventListener('pointercancel', release);

    return { reset: reset };
  }

  window.dpoSheet = { attach: attach };
})();
