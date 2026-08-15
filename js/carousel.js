/**
 * Стрелки для горизонтальных каруселей (.dpo-track).
 *
 * Сама прокрутка — нативная: CSS scroll-snap работает и без этого файла,
 * пальцем, колесом и с клавиатуры. Здесь только кнопки и их состояние.
 *
 * Все слушатели повешены на document, ни одного — на конкретный узел.
 * Это принципиально: лендинг собирает React-рантайм, который целиком
 * пересобирает разметку, и любой слушатель, привязанный к элементу,
 * после первой же перерисовки указывал бы на выброшенный узел.
 * Тот же приём используют vi-mode и smooth-ui.
 */
(function () {
  'use strict';

  var STEP_RATIO = 0.86; // чуть меньше экрана дорожки, чтобы край карточки оставался виден

  function trackFor(btn) {
    var id = btn.getAttribute('aria-controls');
    return id ? document.getElementById(id) : null;
  }

  function atStart(track) {
    return track.scrollLeft <= 1;
  }

  function atEnd(track) {
    // scrollLeft дробный при масштабировании страницы, отсюда допуск.
    return track.scrollLeft + track.clientWidth >= track.scrollWidth - 1;
  }

  function syncButtons(track) {
    if (!track.id) return;
    var btns = document.querySelectorAll('[aria-controls="' + track.id + '"][data-dpo-scroll]');
    for (var i = 0; i < btns.length; i++) {
      var dir = btns[i].getAttribute('data-dpo-scroll');
      var spent = dir === 'prev' ? atStart(track) : atEnd(track);
      // Дорожка короче экрана — листать нечего, гасим обе кнопки.
      btns[i].disabled = spent || track.scrollWidth <= track.clientWidth + 1;
    }
  }

  document.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('[data-dpo-scroll]') : null;
    if (!btn) return;
    var track = trackFor(btn);
    if (!track) return;
    e.preventDefault();
    var delta = Math.max(240, Math.round(track.clientWidth * STEP_RATIO));
    track.scrollBy({
      left: btn.getAttribute('data-dpo-scroll') === 'prev' ? -delta : delta,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    });
  });

  // Событие scroll не всплывает, но в фазе перехвата до document доходит.
  document.addEventListener('scroll', function (e) {
    var t = e.target;
    if (t && t.classList && t.classList.contains('dpo-track')) syncButtons(t);
  }, true);

  window.addEventListener('resize', function () {
    var tracks = document.querySelectorAll('.dpo-track');
    for (var i = 0; i < tracks.length; i++) syncButtons(tracks[i]);
  });

  // Рантайм дорисовывает страницу не сразу и может пересобрать её несколько
  // раз, поэтому состояние кнопок пересчитывается по таймеру ~10 секунд.
  var n = 0;
  var timer = setInterval(function () {
    var tracks = document.querySelectorAll('.dpo-track');
    for (var i = 0; i < tracks.length; i++) syncButtons(tracks[i]);
    if (++n > 40) clearInterval(timer);
  }, 250);
})();
