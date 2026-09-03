/*
 * Табло ближайших стартов в каталоге: чипы месяцев на телефоне и «Ещё N
 * программ» в колонке. Разметку даёт buildStartsBlock (update-catalog.js);
 * без скрипта видны все колонки и все строки. Слушатели – делегированием
 * по документу, начальное состояние (is-tabbed, активный первый месяц)
 * выставляется, как только табло есть в документе.
 */
(function () {
  'use strict';

  function activate(board, key) {
    board.querySelectorAll('.starts-month').forEach(function (m) {
      m.classList.toggle('is-active', m.getAttribute('data-month') === key);
    });
    board.querySelectorAll('.starts-chip').forEach(function (c) {
      c.setAttribute('aria-pressed', c.getAttribute('data-month') === key ? 'true' : 'false');
    });
  }

  function init() {
    var board = document.querySelector('.starts-board');
    if (!board || board.classList.contains('is-tabbed')) return;
    board.classList.add('is-tabbed');
    var first = board.querySelector('.starts-month');
    if (first) activate(board, first.getAttribute('data-month'));
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var chip = t.closest('.starts-chip');
    if (chip) {
      activate(chip.closest('.starts-board'), chip.getAttribute('data-month'));
      return;
    }
    var more = t.closest('.starts-more');
    if (more) {
      var month = more.closest('.starts-month');
      var open = !month.classList.contains('is-expanded');
      month.classList.toggle('is-expanded', open);
      more.setAttribute('aria-expanded', open ? 'true' : 'false');
      more.textContent = open ? more.getAttribute('data-less') : more.getAttribute('data-more');
    }
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
