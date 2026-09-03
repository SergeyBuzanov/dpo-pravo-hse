/*
 * Табло ближайших стартов: чипы месяцев на телефоне и «Ещё N программ»
 * в колонке. Разметку даёт scripts/build-landing.js; без скрипта видны все
 * колонки и все строки.
 *
 * Слушатели – делегированием по документу: рантайм сборщика клонирует
 * узлы при перерисовке (классы и атрибуты живут, слушатели – нет).
 * Начальное состояние (is-tabbed, активный первый месяц) выставляется
 * повторно, пока табло не появится, и после каждой перерисовки.
 */
(function () {
  'use strict';

  function activate(board, key) {
    board.querySelectorAll('.dpo-month').forEach(function (m) {
      m.classList.toggle('is-active', m.getAttribute('data-month') === key);
    });
    board.querySelectorAll('.dpo-month-chip').forEach(function (c) {
      c.setAttribute('aria-pressed', c.getAttribute('data-month') === key ? 'true' : 'false');
    });
  }

  function init() {
    var board = document.querySelector('.dpo-schedule');
    if (!board || board.classList.contains('is-tabbed')) return false;
    board.classList.add('is-tabbed');
    var first = board.querySelector('.dpo-month');
    if (first) activate(board, first.getAttribute('data-month'));
    return true;
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var chip = t.closest('.dpo-month-chip');
    if (chip) {
      activate(chip.closest('.dpo-schedule'), chip.getAttribute('data-month'));
      return;
    }
    var more = t.closest('.dpo-month-more');
    if (more) {
      var month = more.closest('.dpo-month');
      var open = !month.classList.contains('is-expanded');
      month.classList.toggle('is-expanded', open);
      more.setAttribute('aria-expanded', open ? 'true' : 'false');
      more.textContent = open ? more.getAttribute('data-less') : more.getAttribute('data-more');
    }
  });

  init();
  var tries = 0;
  var timer = window.setInterval(function () {
    if (init() || ++tries > 60) window.clearInterval(timer);
  }, 200);
  if ('MutationObserver' in window) {
    new MutationObserver(function () { init(); }).observe(document, { childList: true, subtree: true });
  }
})();
