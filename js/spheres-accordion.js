/*
 * Плитки сфер права под героем (решение владельца 03.09.2026).
 *
 * Два поведения:
 *  - раскрытие: заголовок каждой плитки становится кнопкой (aria-expanded),
 *    в свёрнутом виде видны имя, число программ, цена «от» и три названия
 *    анонсом; по клику – полный список программ с кнопками заявки. На любой
 *    ширине. Без скрипта всё открыто. Кнопка без aria-controls намеренно:
 *    js/nav-menu.js считает триггером меню любой [aria-controls][aria-expanded];
 *  - вылет: класс dpo-fly включает начальное состояние, is-in – анимацию,
 *    когда сетка попадает в кадр (один раз). Без JS плитки видны сразу.
 * Разметка плиток генерируется scripts/build-landing.js – здесь только поведение.
 */
(function () {
  'use strict';

  function spheres() {
    return Array.prototype.slice.call(document.querySelectorAll('.dpo-sphere'));
  }

  function setOpen(sphere, open) {
    var btn = sphere.querySelector('.dpo-sphere-toggle');
    if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    sphere.classList.toggle('is-collapsed', !open);
  }

  function enable() {
    spheres().forEach(function (sphere) {
      var title = sphere.querySelector('.dpo-sphere-title');
      var list = sphere.querySelector('.dpo-sphere-list');
      if (!title || !list || title.querySelector('.dpo-sphere-toggle')) return;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dpo-sphere-toggle';
      while (title.firstChild) btn.appendChild(title.firstChild);
      title.appendChild(btn);
      setOpen(sphere, false);
    });
  }

  // Клик – делегированием по документу: рантайм сборщика клонирует узлы при
  // перерисовке, классы и атрибуты переживают её, слушатели на кнопках – нет.
  document.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.dpo-sphere-toggle') : null;
    if (!btn) return;
    setOpen(btn.closest('.dpo-sphere'), btn.getAttribute('aria-expanded') !== 'true');
  });

  var observed = null;
  function fly() {
    var grid = document.querySelector('.dpo-spheres');
    if (!grid || grid.classList.contains('is-in') || grid === observed) return;
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !('IntersectionObserver' in window)) return;
    // Сетка после перерисовки – новый узел с теми же классами: наблюдатель
    // перевешивается, иначе плитки остались бы невидимыми.
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

  function apply() {
    enable();
    fly();
  }

  // Рантайм сборщика рисует разметку асинхронно и подменяет documentElement
  // уже после load: одного вызова мало – плиток ещё нет. Повторяем, пока они
  // не появятся, и следим за перерисовками документа.
  apply();
  var tries = 0;
  var timer = window.setInterval(function () {
    apply();
    if (document.querySelector('.dpo-sphere-toggle') || ++tries > 60) window.clearInterval(timer);
  }, 200);
  if ('MutationObserver' in window) {
    new MutationObserver(function () {
      var grid = document.querySelector('.dpo-spheres');
      if (grid && (!document.querySelector('.dpo-sphere-toggle') || grid !== observed)) apply();
    }).observe(document, { childList: true, subtree: true });
  }
})();
