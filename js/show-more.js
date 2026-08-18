/**
 * «Показать ещё» для блока программ на узком экране.
 *
 * Зачем. В блоке пятнадцать карточек. На широком экране они лежат сеткой в
 * пять колонок – три ряда, не мешают. На телефоне колонка одна, и блок
 * вырастает до 7,2 экрана: до следующего раздела приходится листать долго.
 * Первые шесть остаются видны, остальные прячутся за кнопкой.
 *
 * Почему сворачивает скрипт, а не CSS по умолчанию. Если спрятать карточки
 * правилом, то без JavaScript кнопка ничего не сделает и девять программ
 * станут недостижимы совсем. В разметке блок развёрнут; скрипт добавляет
 * сетке класс is-collapsed, и только он включает и свёртку, и кнопку. Без
 * JavaScript посетитель видит все пятнадцать – длинно, но ничего не потеряно.
 *
 * Всё состояние – один класс на сетке. Кнопка показывается правилом
 * `.dpo-top5-grid.is-collapsed ~ .dpo-top5-more`, а не атрибутом hidden:
 * рантайм сборщика срезает hidden при сборке страницы, и кнопка вылезала бы
 * развёрнутой ещё до того, как скрипт до неё доберётся.
 *
 * Ширину проверяем один раз. Следить за поворотом экрана не нужно: правила
 * живут в медиазапросе, и на широком экране класс просто ничего не значит.
 */

(function () {
  'use strict';

  // Защита от повторной инициализации. Рантайм сборщика заменяет документ
  // целиком, и скрипт может отработать дважды – тогда на document висят два
  // обработчика клика, один клик вызывает переключение дважды, и состояние
  // возвращается туда, откуда ушло. Замечено по трассировке: за одно нажатие
  // aria-expanded менялся четыре раза.
  if (window.__dpoShowMore) return;
  window.__dpoShowMore = true;

  // ОСТОРОЖНО с aria-controls на этой кнопке. js/nav-menu.js ищет триггеры
  // выпадающих меню селектором '[aria-controls][aria-expanded]' – без привязки
  // к самому меню. Кнопка с обоими атрибутами попадает под него, и меню
  // «закрывает» её, сбрасывая aria-expanded в false при первом же клике мимо.
  // Поймано трассировкой: за одно нажатие атрибут менялся четыре раза.
  // Связь кнопки с сеткой и без того очевидна – она стоит сразу за ней.
  var VISIBLE = 6;
  var NARROW = 559; // ниже 560px сетка становится одноколоночной
  var GRID = '.dpo-top5-grid';
  var BUTTON = '.dpo-top5-more';
  var LABEL_MORE = 'Показать ещё';
  var LABEL_LESS = 'Свернуть';

  /**
   * Возвращает true, если состояние выставлено окончательно и ждать больше
   * нечего. Флаг готовности ставится ТОЛЬКО здесь и только после проверок:
   * рантайм собирает страницу по частям, и вызов на полупустой сетке не
   * должен закрывать дорогу следующему.
   */
  function collapse() {
    var grid = document.querySelector(GRID);
    if (!grid) return false;
    if (grid.getAttribute('data-more-ready')) return true;
    if (window.innerWidth > NARROW) return true; // на широком экране прятать нечего
    if (grid.children.length <= VISIBLE) return false; // сетка ещё достраивается

    grid.classList.add('is-collapsed');
    grid.setAttribute('data-more-ready', '1');
    var button = document.querySelector(BUTTON);
    if (button) button.setAttribute('aria-expanded', 'false');
    return true;
  }

  /**
   * Кнопка – переключатель, а не одноразовая. Исчезающий после нажатия орган
   * управления оставляет фокус в пустоте и не даёт свернуть обратно, если
   * человек передумал; поэтому она остаётся на месте и меняет подпись.
   */
  function toggle(button) {
    var grid = document.querySelector(GRID);
    if (!grid) return;
    var collapsed = !grid.classList.contains('is-collapsed');
    grid.classList[collapsed ? 'add' : 'remove']('is-collapsed');
    button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    button.textContent = collapsed ? LABEL_MORE : LABEL_LESS;
    if (collapsed) {
      // Свернули – список уехал вверх, возвращаем к началу блока, иначе
      // страница прыгает в место, которого больше нет.
      if (grid.scrollIntoView) grid.scrollIntoView({ block: 'start' });
      return;
    }
    // Раскрыли – фокус на первую открывшуюся карточку, чтобы человек с
    // клавиатуры продолжил с того места, где список продолжился.
    var revealed = grid.children[VISIBLE];
    if (revealed && revealed.focus) {
      if (!revealed.hasAttribute('tabindex')) revealed.setAttribute('tabindex', '-1');
      revealed.focus();
    }
  }

  // Делегирование на document: кнопка появляется вместе со всей страницей,
  // а document переживает подмену корневого элемента рантаймом.
  document.addEventListener('click', function (e) {
    var button = e.target && e.target.closest && e.target.closest(BUTTON);
    if (button) toggle(button);
  });

  if (collapse()) return;

  if (window.MutationObserver) {
    // Следим за document, а НЕ за document.documentElement: рантайм заменяет
    // корневой элемент целиком, и наблюдатель, привязанный к нему, остался бы
    // висеть на отсоединённом узле.
    var observer = new MutationObserver(function () {
      if (collapse()) observer.disconnect();
    });
    observer.observe(document, { childList: true, subtree: true });
    window.setTimeout(function () {
      observer.disconnect();
    }, 15000);
  }
})();
