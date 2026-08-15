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
    // У зацикленной ленты краёв нет: она перематывается по кругу, поэтому
    // гасить стрелки нечего и не за что.
    var looped = track.hasAttribute('data-dpo-loop');
    for (var i = 0; i < btns.length; i++) {
      if (looped) {
        btns[i].disabled = false;
        continue;
      }
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
    // Придерживаем автоход, пока доигрывает плавная прокрутка.
    if (track.hasAttribute('data-dpo-loop')) {
      track._dpoHold = (window.performance ? performance.now() : Date.now()) + 1200;
    }
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

  /**
   * Автопрокрутка зацикленной ленты.
   *
   * Раньше лента ехала CSS-анимацией transform, но такая анимация не
   * уживается со стрелками: они двигают scrollLeft, а анимация продолжает
   * тянуть свой transform, и содержимое разъезжается. Поэтому движение
   * переведено на scrollLeft, и ручное листание с автоходом говорят на
   * одном языке.
   *
   * Дорожка содержит два одинаковых набора карточек. Как только уехали на
   * половину, возвращаемся назад ровно на эту половину: кадр совпадает сам
   * с собой, шва не видно, а прокрутка формально бесконечна в обе стороны.
   */
  var SPEED_PX_PER_SEC = 26;

  function loopedTracks() {
    return document.querySelectorAll('[data-dpo-loop]');
  }

  function paused(track) {
    // Прокручиваемый контейнер он же и есть цель наведения, поэтому
    // отдельной обёртки искать не нужно.
    return track.matches(':hover') || track.contains(document.activeElement);
  }

  var last = null;
  function step(now) {
    var dt = last == null ? 0 : Math.min((now - last) / 1000, 0.05);
    last = now;
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches &&
        !document.documentElement.classList.contains('vi-mode') &&
        !document.hidden) {
      var tracks = loopedTracks();
      for (var i = 0; i < tracks.length; i++) {
        var t = tracks[i];
        if (paused(t)) continue;
        // Пока идёт плавная прокрутка от стрелки, не трогаем scrollLeft:
        // запись каждый кадр обрывала бы её, и нажатие двигало ленту на
        // пару пикселей вместо целого шага.
        if (t._dpoHold && now < t._dpoHold) continue;
        var half = t.scrollWidth / 2;
        if (half < 1) continue;

        // Позицию копим сами: прирост за кадр меньше пикселя, а scrollLeft
        // округляется, и дробные доли иначе теряются — лента почти стоит.
        if (t._dpoPos == null || Math.abs(t._dpoPos - t.scrollLeft) > 2) t._dpoPos = t.scrollLeft;
        t._dpoPos += SPEED_PX_PER_SEC * dt;
        if (t._dpoPos >= half) t._dpoPos -= half;
        t.scrollLeft = t._dpoPos;
      }
    }
    window.requestAnimationFrame(step);
  }
  window.requestAnimationFrame(step);

  // Ручное листание тоже должно перематываться по кругу, иначе стрелка
  // «назад» упрётся в ноль, а «вперёд» — в конец второго набора.
  document.addEventListener('scroll', function (e) {
    var t = e.target;
    if (!t || !t.hasAttribute || !t.hasAttribute('data-dpo-loop')) return;
    var half = t.scrollWidth / 2;
    if (half < 1) return;
    if (t.scrollLeft >= half) t.scrollLeft -= half;
    else if (t.scrollLeft < 0.5) t.scrollLeft += half;
  }, true);
})();
