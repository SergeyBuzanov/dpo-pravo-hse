/**
 * Ворона Шерлок на дежурстве в админке.
 *
 * Та же нарезка, что на витрине (js/crow-mascot.js). Здесь она не открывает
 * бота, а комментирует работу менеджера: синк каталога, заявки, почту.
 * Клик по вороне циклит короткие реплики из текущего состояния панели.
 */
(function (global) {
  'use strict';

  var crow = null;
  var clickI = 0;
  var reduced =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function boot() {
    if (!global.CrowMascot || crow) return;
    var narrow = typeof matchMedia === 'function' && matchMedia('(max-width: 700px)').matches;
    crow = CrowMascot.mount({
      assetPath: 'images/crow/',
      width: narrow ? 112 : 168,
      zIndex: 40,
      followCursor: !reduced,
      idleSeconds: 0,
      onClick: onClick,
    });
    if (crow.host) {
      crow.host.setAttribute('role', 'button');
      crow.host.setAttribute('tabindex', '0');
      crow.host.setAttribute('aria-label', 'Ворона Шерлок: спросить про заявки и каталог');
      crow.host.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      });
    }
    if (reduced) {
      say('На дежурстве');
      return;
    }
    setTimeout(function () {
      say('На дежурстве');
    }, 2400);
  }

  function say(text) {
    if (!crow) return;
    if (typeof crow.say === 'function') crow.say(text);
    else crow.play('helpQ');
  }

  function play(name) {
    if (!crow || !name) return;
    crow.play(name);
  }

  function onClick() {
    var lines = remarks();
    if (!lines.length) return;
    say(lines[clickI++ % lines.length]);
  }

  function textOf(id) {
    var el = document.getElementById(id);
    return el ? String(el.textContent || '').trim() : '';
  }

  function remarks() {
    var lines = [];
    var badge = document.getElementById('appBadge');
    var n = 0;
    if (badge && !badge.classList.contains('hidden')) n = Number(badge.textContent) || 0;
    if (n > 0) lines.push(n === 1 ? 'Одна новая заявка' : 'Новых заявок: ' + n);
    else lines.push('Новых заявок нет');

    var count = textOf('programCount');
    if (count && count !== '–') lines.push('В каталоге ' + count + ' программ');

    var updated = textOf('lastUpdated');
    if (updated && updated !== '–') lines.push('Обновляли ' + updated);

    var mail = document.getElementById('mailBanner');
    if (mail && mail.classList.contains('visible')) lines.push('Письма менеджеру не уходят');

    var status = textOf('status');
    if (/ошиб/i.test(status)) lines.push('Что-то пошло не так');
    else if (/актуаль/i.test(status)) lines.push('Каталог свежий');

    lines.push('Синк с hse.ru — синяя кнопка');
    return lines;
  }

  global.AdminCrow = { boot: boot, say: say, play: play, remarks: remarks };
})(window);
