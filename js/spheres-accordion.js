/*
 * Появление сеток лендинга: плитки сфер под героем вылетают с боков
 * (владелец 03.09.2026), ступени траектории поднимаются снизу по очереди
 * (владелец 04.09.2026). Механика одна на обе сетки, само движение задано
 * в CSS каждой из них – это разные моменты, а не один повторённый.
 *
 * Класс dpo-fly включает начальное состояние, is-in – анимацию, когда сетка
 * попадает в кадр, один раз. Без JS и при reduced-motion всё видно сразу.
 * Рантайм сборщика рисует разметку асинхронно и клонирует узлы при
 * перерисовке: наблюдатель перевешивается на новую сетку, попытки повторяются
 * до её появления. Имя файла историческое – когда-то здесь был аккордеон.
 */
(function () {
  'use strict';

  var GRIDS = ['.dpo-spheres', '.dpo-formats'];
  var observed = {};

  function watch(selector) {
    var grid = document.querySelector(selector);
    if (!grid || grid.classList.contains('is-in') || grid === observed[selector]) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!('IntersectionObserver' in window)) return;
    grid.classList.add('dpo-fly');
    observed[selector] = grid;
    var io = new IntersectionObserver(
      function (entries) {
        if (!entries.some(function (en) { return en.isIntersecting; })) return;
        grid.classList.add('is-in');
        io.disconnect();
      },
      { threshold: 0.1 },
    );
    io.observe(grid);
  }

  function fly() {
    for (var i = 0; i < GRIDS.length; i++) watch(GRIDS[i]);
  }

  function allFound() {
    for (var i = 0; i < GRIDS.length; i++) if (!observed[GRIDS[i]]) return false;
    return true;
  }

  fly();
  var tries = 0;
  var timer = window.setInterval(function () {
    fly();
    if (allFound() || ++tries > 60) window.clearInterval(timer);
  }, 200);
  if ('MutationObserver' in window) {
    new MutationObserver(function () {
      for (var i = 0; i < GRIDS.length; i++) {
        var grid = document.querySelector(GRIDS[i]);
        if (grid && grid !== observed[GRIDS[i]]) watch(GRIDS[i]);
      }
    }).observe(document, { childList: true, subtree: true });
  }
})();
