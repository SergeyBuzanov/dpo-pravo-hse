/*
 * Сферы права на телефоне – аккордеон (решение владельца 03.09.2026).
 *
 * Шесть карточек со списками программ занимали на 390px около 5000px,
 * четверть страницы. На окне уже 700px заголовок каждой сферы становится
 * кнопкой, списки свёрнуты; на десктопе разметка возвращается к исходной,
 * чтобы заголовок не был бездействующей кнопкой. Без скрипта всё открыто.
 * Разметка сфер генерируется scripts/build-landing.js – здесь только
 * поведение.
 */
(function () {
  'use strict';

  var mq = window.matchMedia('(max-width: 699px)');

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
      // Без aria-controls намеренно: js/nav-menu.js считает триггером меню
      // любой [aria-controls][aria-expanded] и закрывал бы аккордеон по клику
      // в документе. Список идёт сразу за заголовком – связь по порядку.
      while (title.firstChild) btn.appendChild(title.firstChild);
      title.appendChild(btn);
      btn.addEventListener('click', function () {
        setOpen(sphere, btn.getAttribute('aria-expanded') !== 'true');
      });
      setOpen(sphere, false);
    });
  }

  function disable() {
    spheres().forEach(function (sphere) {
      var btn = sphere.querySelector('.dpo-sphere-toggle');
      if (btn) {
        var title = btn.parentNode;
        while (btn.firstChild) title.insertBefore(btn.firstChild, btn);
        title.removeChild(btn);
      }
      sphere.classList.remove('is-collapsed');
    });
  }

  function apply() {
    if (mq.matches) enable();
    else disable();
  }

  if (mq.addEventListener) mq.addEventListener('change', apply);
  else mq.addListener(apply);
  apply();
  // Рантайм сборщика может перерисовать разметку после загрузки – как и
  // остальные скрипты лендинга, проверяем ещё раз после первой отрисовки.
  window.addEventListener('load', apply);
})();
