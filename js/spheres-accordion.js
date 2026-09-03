/*
 * Плитки сфер права под героем – вылет при появлении в кадре (владелец
 * 03.09.2026, вариант «выразительный»). Сами плитки – ссылки в каталог с
 * фильтром сферы, раскрытия больше нет (владелец: «сразу к списку программ»).
 *
 * Класс dpo-fly включает начальное состояние, is-in – анимацию, когда сетка
 * попадает в кадр, один раз. Без JS и при reduced-motion плитки видны сразу.
 * Рантайм сборщика рисует разметку асинхронно и клонирует узлы при
 * перерисовке: наблюдатель перевешивается на новую сетку, попытки повторяются
 * до её появления. Имя файла историческое – когда-то здесь был аккордеон.
 */
(function () {
  'use strict';

  var observed = null;

  function fly() {
    var grid = document.querySelector('.dpo-spheres');
    if (!grid || grid.classList.contains('is-in') || grid === observed) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!('IntersectionObserver' in window)) return;
    grid.classList.add('dpo-fly');
    observed = grid;
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

  fly();
  var tries = 0;
  var timer = window.setInterval(function () {
    fly();
    if (observed || ++tries > 60) window.clearInterval(timer);
  }, 200);
  if ('MutationObserver' in window) {
    new MutationObserver(function () {
      var grid = document.querySelector('.dpo-spheres');
      if (grid && grid !== observed) fly();
    }).observe(document, { childList: true, subtree: true });
  }
})();
