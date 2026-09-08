/**
 * Ворона Шерлок в правом нижнем углу – НА КАЖДОЙ СТРАНИЦЕ САЙТА.
 *
 * Раньше этот код жил только в хвосте index.html, поэтому в каталоге и на
 * страницах программ угловой вороны не было вовсе (владелец 08.09.2026:
 * «ворона должна оставаться всегда в углу, не пропадать оттуда – сейчас её
 * вообще там нет»). Здесь он вынесен в общий файл: одно место вместо трёх
 * копий, лендинг зовёт его тем же вызовом, что каталог и страницы программ.
 *
 * Угол принадлежит вороне (решение владельца): бейдж канала MAX
 * (js/channel-invite.js) и мобильная полоса-CTA (js/smooth-ui.js) подвинуты
 * в своих файлах. Слои: модальные окна 9000 > баннер cookies 1000 >
 * полоса-CTA 940 > окно бота 930 > прозрачная кнопка-хит 921 > ворона 920 >
 * бейдж канала 900.
 *
 * Кнопкой является САМА ВОРОНА, а не видимая пилюля рядом: .crow-hit-btn –
 * прозрачная кнопка ровно поверх маскота, надпись только для читалок.
 * ЛОВУШКА: в html.vi-mode маскот скрыт целиком (он декоративен), и вход в
 * бота исчез бы вместе с ним – поэтому там показывается обычная видимая
 * кнопка #crow-vi-btn. Обе лежат в DOM всегда, видна одна, переключение
 * чистым CSS.
 *
 * Стили вставляются СКРИПТОМ, а не статичным <style>: на лендинге рантайм
 * сборщика делает document.documentElement.replaceWith(...) и уносит любую
 * статическую разметку хвоста. По той же причине монтирование отложено до
 * window.load – заодно 11 картинок маскота не спорят за полосу с ресурсами
 * первого экрана.
 */
(function (global) {
  'use strict';

  /** Страницы программ лежат уровнем ниже – тот же приём, что в js/application-form.js. */
  function assetBase() {
    return /\/programs\//.test(location.pathname) ? '../images/crow/' : 'images/crow/';
  }

  function injectStyle(edge, width, height) {
    if (document.getElementById('crow-launcher-style')) return;
    var style = document.createElement('style');
    style.id = 'crow-launcher-style';
    style.textContent =
      // Уточнение `body>` обязательно: класс .crow-mascot есть и у маскота в
      // блоке отказа формы, и у вороны в пустом результате каталога, и у
      // вороны в содержимом – сдвиг right их бы разъехал. Угловой маскот
      // единственный монтируется прямым потомком body.
      // pointer-events:none у самого маскота – клики ловит только
      // прозрачная кнопка поверх него (z-index на единицу выше).
      // Без этого div маскота 200×209 в углу перехватывал нажатия по
      // тому, что оказалось под ним при прокрутке: замер поймал
      // стрелки ленты «Топ-5».
      //
      // bottom:0 здесь – ОПОРА, а не украшение (дефект 09.09.2026: «ворона
      // пропала с угла»). js/support-bot.js уводит ворону от баннера
      // cookies через style.bottom, а когда уворачиваться не от чего, пишет
      // туда пустую строку – та не возвращает прежнее значение, а СТИРАЕТ
      // объявление. Инлайновый bottom:0 из build() исчезал вместе с ним, и
      // фиксированный элемент без top/bottom вставал в статическую позицию:
      // замер показал bottom:-209px, ворона целиком под кромкой окна.
      // В правиле опора переживает стирание инлайна; инлайн по-прежнему
      // перекрывает её, когда от баннера уворачиваться НАДО.
      'body>.crow-mascot{right:' + edge + 'px!important;bottom:0;pointer-events:none}' +
      '.crow-hit-btn{position:fixed;right:' + edge + 'px;bottom:0;width:' + width + 'px;height:' + height + 'px;' +
      'z-index:921;background:transparent;border:0;padding:0;margin:0;cursor:pointer;border-radius:16px}' +
      '.crow-hit-btn:focus-visible{outline:none;box-shadow:0 0 0 2px #FBF9F5,0 0 0 4px rgb(var(--accent, 22 88 218))}' +
      '.crow-hit-btn .visually-hidden{position:absolute;width:1px;height:1px;margin:-1px;padding:0;' +
      'overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}' +
      // Пока ворона стоит в содержимом (метка ставится в mountWalkIn,
      // js/crow-mascot.js), угловая видна, но кликов не ловит: её
      // прозрачная кнопка накрывала стрелки ленты «Топ-5».
      'html.crow-inline-live .crow-hit-btn{pointer-events:none}' +
      'html.vi-mode .crow-hit-btn{display:none}' +
      '#crow-vi-btn{display:none}' +
      'html.vi-mode #crow-vi-btn{display:inline-flex;align-items:center;justify-content:center;' +
      'position:fixed;right:' + edge + 'px;bottom:calc(16px + env(safe-area-inset-bottom, 0px));' +
      'z-index:920;min-height:44px;padding:0 16px;border-radius:999px;cursor:pointer;' +
      "font:600 0.8125rem/1 'HSE Sans','IBM Plex Sans',system-ui,sans-serif;" +
      'background:#fff!important;color:#000!important;border:2px solid #000!important}';
    (document.head || document.documentElement).appendChild(style);
  }

  function mount() {
    if (!global.CrowMascot || global.crowMascot) return;
    if (document.querySelector('.crow-hit-btn')) return;

    // Порог 1023px – тот же, что у мобильной панели js/smooth-ui.js и у
    // отступов бейджа канала: три места подстроены под одну ширину маскота.
    var narrow = window.matchMedia('(max-width: 1023px)').matches;
    // 200px на широком экране (владелец 08.09.2026, было 260); мобильные 96
    // не трогаем – там ворона и так небольшая.
    var width = narrow ? 96 : 200;
    var height = Math.round(width * 1465 / 1400);
    var edge = narrow ? 8 : 24;

    injectStyle(edge, width, height);

    var hit = document.createElement('button');
    hit.type = 'button';
    hit.className = 'crow-hit-btn';
    hit.setAttribute('data-bot-open', '');
    var hitLabel = document.createElement('span');
    hitLabel.className = 'visually-hidden';
    hitLabel.textContent = 'Открыть поддержку';
    hit.appendChild(hitLabel);
    document.body.appendChild(hit);

    var viBtn = document.createElement('button');
    viBtn.type = 'button';
    viBtn.id = 'crow-vi-btn';
    viBtn.setAttribute('data-bot-open', '');
    viBtn.textContent = 'Поддержка';
    document.body.appendChild(viBtn);

    global.crowMascot = global.CrowMascot.mount({
      assetPath: assetBase(),
      anchor: 'bottom-right',
      width: width,
      zIndex: 920,
      idleSeconds: 14,
      // В каталоге ворона предлагает помощь («Чем помочь?»), на остальных
      // страницах спрашивает («Есть вопросы?») – решение владельца
      // 09.09.2026. Каталог узнаётся по якорю ряда фильтров: он есть
      // только там (в лендинге и на страницах программ фильтров нет).
      idleAnim: document.getElementById('filters') ? 'helpQ' : 'askQ'
    });
  }

  function boot() {
    if (document.readyState === 'complete') mount();
    else window.addEventListener('load', mount);
  }

  global.CrowLauncher = { mount: mount, boot: boot };
  boot();
})(window);
