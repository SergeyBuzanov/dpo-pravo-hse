/**
 * Окно бота поддержки: подбор программ и готовые ответы с сайта.
 *
 * Самодостаточный виджет по образцу js/application-form.js и js/quiz.js –
 * разметка и стили живут ЗДЕСЬ, а не в HTML страниц: лендинг собирается
 * визуальным сборщиком, каталог и страницы программ – своими генераторами,
 * и виджет, разложенный по источникам, разъехался бы при первой же
 * пересборке любого из них.
 *
 * Логика подбора ответа (что показать на запрос) вынесена в
 * js/bot-reply.js (window.DpoBotReply) – чистые функции без DOM,
 * проверенные тестами на настоящих данных (независимое ревью 08.09.2026
 * нашло три сломанные кнопки-подсказки и необработанное исключение именно
 * потому, что эта логика раньше не была отделена от разметки и не
 * читалась тестом). Здесь остаётся только DOM: разметка, стили, открытие/
 * закрытие, фокус, очередь действий до прихода данных.
 *
 * Открытие – по клику на элемент с атрибутом [data-bot-open]. На лендинге
 * это угловая ворона (.crow-hit-btn поверх маскота и #crow-vi-btn в
 * html.vi-mode – см. crow-launcher-addon в хвосте index.html): рантайм
 * лендинга клонирует разметку после загрузки, поэтому слушатель СТРОГО
 * делегирован на document, а не повешен на конкретный узел напрямую.
 *
 * Данные (content/bot-catalog.json, content/bot-faq.json) тянутся ПРИ
 * ПЕРВОМ открытии окна, а не при загрузке страницы: первый экран сайта за
 * бота не платит.
 *
 * Порядок подключения тегами <script>: js/bot-match.js, затем
 * js/bot-reply.js, затем этот файл.
 */
(function () {
  'use strict';

  var CATALOG_URL = 'content/bot-catalog.json';
  var FAQ_URL = 'content/bot-faq.json';

  var GREETING = 'Спрашивайте про программы: тему, формат, цену или ближайший старт.';
  var HINTS = ['Подобрать программу', 'Онлайн', 'Какой документ выдают', 'Ближайшие старты', 'Сколько стоит'];
  var TYPE_LABELS = [['ПК', 'Повышение квалификации'], ['ПП', 'Переподготовка']];
  // Уважение к prefers-reduced-motion – тем же способом, что в
  // js/crow-mascot.js: пауза «печатает…» и точки для этих посетителей не
  // проигрываются, ответ приходит сразу.
  var REDUCED_MOTION = typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var GAP_TEXT = 'Об этом на сайте не написано, а придумывать я не стану. Оставьте заявку – ответит учебный офис.';
  var FAIL_TEXT = 'Не получилось загрузить программы. Напишите нам – ответим.';
  var WAIT_TEXT = 'Секунду, гружу программы…';

  var CSS = [
    // Окно растёт от САМОГО НИЗА экрана (владелец 09.09.2026) – раньше оно
    // висело на 92px выше, оставляя под собой полосу пустоты. Нижние углы
    // спрямлены: окно «приросло» к кромке, как шторка на телефоне.
    // Подъём над баннером cookies остался – его ставит keepAboveBanners()
    // инлайном и снимает, когда баннера нет (пустая строка возвращает
    // управление ЭТОМУ правилу; на том же месте, где у вороны опоры не
    // было, она и потерялась – см. js/crow-launcher.js).
    '#dpoBotPanel{position:fixed;right:16px;bottom:env(safe-area-inset-bottom,0px);',
    "font-family:'HSE Sans','IBM Plex Sans',system-ui,sans-serif;",
    'z-index:930;width:min(380px,calc(100vw - 32px));max-height:min(70vh,560px);',
    'display:flex;flex-direction:column;background:var(--bg);color:rgb(var(--ink));',
    'border:1px solid rgb(var(--ink) / .12);border-radius:18px 18px 0 0;overflow:hidden;',
    'box-shadow:0 24px 60px rgb(var(--ink) / .28);opacity:0;transform:translateY(28px);',
    'transition:opacity .22s cubic-bezier(.22,1,.36,1),transform .22s cubic-bezier(.22,1,.36,1)}',
    '#dpoBotPanel.is-open{opacity:1;transform:none}',
    // Открытое окно не перекрывает соседей вслепую – карточка/бейдж
    // приглашения в канал (js/channel-invite.js, right:300px/112px) не
    // накрыты панелью целиком (панель у́же) и торчали рядом на снимке.
    // Само окно бота, в отличие от формы заявки и опроса, НЕ полноэкранная
    // подложка – прятать соседа приходится явно. :has() безопасен именно
    // потому, что правило вставлено СКРИПТОМ (см. .dpo-tag:has(...) в
    // js/smooth-ui.js – тот же приём и то же обоснование).
    'body:has(#dpoBotPanel) #channelInvite,body:has(#dpoBotPanel) #channelInviteBadge{display:none!important}',
    // Нижняя полоса с кнопками на телефоне уступает место окну: пока оно
    // открыто, полоса не нужна (у окна свои действия), а её присутствие
    // поднимало шторку на 94px над кромкой – под ней оставалась щель с
    // куском страницы. Полосы три разных, см. BOTTOM_BARS ниже.
    'body:has(#dpoBotPanel) .dpo-mobile-cta,body:has(#dpoBotPanel) .mobile-cta,',
    'body:has(#dpoBotPanel) .buy-bar{display:none!important}',
    '#dpoBotHead{display:flex;align-items:center;justify-content:space-between;gap:8px;',
    'padding:10px 14px 8px 14px;border-bottom:1px solid rgb(var(--ink) / .1);flex:none}',
    // Ворона в шапке окна (владелец 09.09.2026: «должно быть понятно, что
    // отвечает ворона»). Это ЖИВОЙ маскот тем же рантаймом, что в углу, –
    // он моргает, следит за курсором и кивает, когда приходит ответ.
    '.dpo-bot-brand{display:flex;align-items:center;gap:10px;min-width:0}',
    '.dpo-bot-crow{width:56px;flex:none}',
    'html.vi-mode .dpo-bot-crow{display:none}',
    // «Печатает…»: три точки перед каждым ответом – пауза, за которую видно,
    // что отвечают, а не мгновенная выдача готового текста.
    '.dpo-bot-typing{display:inline-flex;align-items:center;gap:5px;align-self:flex-start;',
    'padding:12px 14px;border-radius:14px;background:var(--bg-tint)}',
    '.dpo-bot-typing i{width:7px;height:7px;border-radius:50%;background:rgb(var(--ink) / .45);',
    'animation:dpoBotDot 1.05s infinite ease-in-out}',
    '.dpo-bot-typing i:nth-child(2){animation-delay:.15s}',
    '.dpo-bot-typing i:nth-child(3){animation-delay:.3s}',
    '@keyframes dpoBotDot{0%,60%,100%{transform:translateY(0);opacity:.45}30%{transform:translateY(-4px);opacity:1}}',
    '@media (prefers-reduced-motion:reduce){.dpo-bot-typing i{animation:none}}',
    // Кегль – ступень «title» шкалы DESIGN.md (1.1875rem/600/1.3, «заголовки карточек»).
    '#dpoBotHead h2{margin:0;font-family:"HSE Slab","Source Serif 4",Georgia,serif;',
    'font-size:1.1875rem;font-weight:600;line-height:1.3}',
    // Мишень 44px (IMPORTANT 7, независимое ревью 08.09.2026): было 36×36.
    '.dpo-bot-close{width:44px;height:44px;flex:none;border-radius:999px;border:0;',
    'display:inline-flex;align-items:center;justify-content:center;',
    'background:transparent;color:rgb(var(--ink));font-size:1.25rem;line-height:1;cursor:pointer;',
    'transition:background .15s}',
    '.dpo-bot-close:hover{background:var(--bg-tint)}',
    '.dpo-bot-log{flex:1 1 auto;overflow-y:auto;padding:14px 18px;display:flex;flex-direction:column;gap:10px}',
    // Радиус 16px – ступень «cards» шкалы DESIGN.md (Shapes: прямоугольник
    // 16px), а не самостоятельная мессенджерная форма с хвостиком: у
    // виджета на сайте нет прецедента такой формы, а заводить новую ступень
    // ради одного места – накладнее, чем взять готовую.
    '.dpo-bot-say{margin:0;font-size:0.9375rem;line-height:1.5;background:var(--bg-tint);',
    'border-radius:16px;padding:10px 14px;align-self:flex-start;max-width:92%}',
    '.dpo-bot-mine{margin:0;font-size:0.9375rem;line-height:1.5;background:rgb(var(--accent));',
    'color:rgb(var(--surface));border-radius:16px;padding:10px 14px;',
    'align-self:flex-end;max-width:92%}',
    '.dpo-bot-hints{display:flex;flex-wrap:wrap;gap:8px}',
    '.dpo-bot-hints button{font:inherit;font-size:0.8125rem;font-weight:600;min-height:44px;',
    'padding:0 14px;border-radius:999px;border:1px solid rgb(var(--accent) / .35);',
    'background:rgb(var(--surface));color:rgb(var(--accent));cursor:pointer;transition:background .15s}',
    '.dpo-bot-hints button:hover{background:var(--bg-tint)}',
    // Мишень 44px (IMPORTANT 7): было 21px высотой – основной выход на
    // сайт под каждой цитатой.
    '.dpo-bot-more{align-self:flex-start;display:inline-flex;align-items:center;min-height:44px;',
    'font-size:0.9375rem;font-weight:600;color:rgb(var(--accent));',
    'text-decoration:underline;text-underline-offset:3px}',
    '.dpo-bot-apply{align-self:flex-start;font:inherit;font-size:0.9375rem;font-weight:600;min-height:44px;',
    'padding:0 18px;border-radius:999px;border:0;background:rgb(var(--accent));color:rgb(var(--surface));',
    'cursor:pointer}',
    '.dpo-bot-card{border:1px solid rgb(var(--ink) / .12);border-radius:16px;padding:10px 12px;',
    'display:flex;flex-direction:column;gap:2px}',
    '.dpo-bot-card a{font-size:0.9375rem;font-weight:600;color:rgb(var(--ink));text-decoration:none}',
    '.dpo-bot-card a:hover{text-decoration:underline}',
    '.dpo-bot-card p{margin:0;font-size:0.8125rem;color:var(--ink-mute)}',
    '#dpoBotForm{display:flex;gap:8px;padding:12px 14px;border-top:1px solid rgb(var(--ink) / .1);flex:none}',
    '#dpoBotInput{flex:1;font:inherit;font-size:0.9375rem;min-height:44px;padding:0 14px;',
    'border-radius:999px;border:1px solid rgb(var(--ink) / .3);background:rgb(var(--surface));',
    'color:rgb(var(--ink))}',
    '#dpoBotInput:focus-visible{outline:none;border-color:rgb(var(--accent));',
    'box-shadow:0 0 0 3px rgb(var(--accent) / .18)}',
    '#dpoBotForm button{font:inherit;font-size:0.9375rem;font-weight:600;min-width:44px;min-height:44px;',
    'padding:0 16px;border-radius:999px;border:0;background:rgb(var(--accent));color:rgb(var(--surface));',
    'cursor:pointer}',
    // Ручка жеста «смахнуть вниз» (js/sheet-gesture.js) на телефоне.
    '@media (max-width:700px){#dpoBotPanel{left:0;right:0;bottom:0;width:100%;',
    'max-height:82vh;border-radius:18px 18px 0 0}}',
    '@media (prefers-reduced-motion:reduce){#dpoBotPanel{transition:none}}',
    // Версия для слабовидящих: та же ловушка, что уже стоила окну заявки и
    // опросу прозрачности до 21.08.2026 – глобальное html.vi-mode *
    // снимает фон, поэтому !important здесь ОБЯЗАТЕЛЕН.
    'html.vi-mode #dpoBotPanel{background:#fff !important;border:2px solid #000 !important}',
    'html.vi-mode .dpo-bot-say{background:#fff !important;border:1px solid #000 !important}',
    'html.vi-mode .dpo-bot-mine{background:#fff !important;color:#000 !important;border:1px solid #000 !important}',
    'html.vi-mode .dpo-bot-card{border:2px solid #000 !important}',
    'html.vi-mode .dpo-bot-hints button,html.vi-mode #dpoBotInput,html.vi-mode #dpoBotForm button,',
    'html.vi-mode .dpo-bot-apply{border:2px solid #000 !important}',
    'html.vi-mode #dpoBotPanel :focus-visible{outline:3px solid #000 !important;outline-offset:2px}',
  ].join('');

  var data = null;
  var loading = false;
  var loadCallbacks = [];
  var queue = window.DpoBotReply.createActionQueue();
  var panel = null;
  var log = null;
  var lastFocused = null;
  var sheetCtl = null;

  /** Страницы программ лежат уровнем ниже – тот же приём, что в форме заявки. */
  function href(file) {
    return /\/programs\//.test(location.pathname) ? '../' + file : file;
  }

  function injectStyles() {
    if (document.getElementById('dpo-bot-styles')) return;
    var style = document.createElement('style');
    style.id = 'dpo-bot-styles';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        if (key === 'text') node.textContent = attrs[key];
        else if (attrs[key] != null) node.setAttribute(key, attrs[key]);
      });
    }
    (children || []).forEach(function (child) {
      if (child) node.appendChild(child);
    });
    return node;
  }

  // ---- Разметка ---------------------------------------------------------

  function programCard(p) {
    var link = el('a', { href: href(p.url), text: p.title });
    var meta = [p.formatLabel, p.priceLabel, p.start].filter(Boolean).join(' · ');
    return el('article', { class: 'dpo-bot-card' }, [link, el('p', { text: meta })]);
  }

  /** Реплика бота отдельным блоком – её и читает aria-live контейнера лога. */
  function say(text) {
    log.appendChild(el('p', { class: 'dpo-bot-say', text: text }));
  }

  /** Реплика посетителя (клик по подсказке или свой текст) – отдельным пузырём. */
  function mine(text) {
    log.appendChild(el('p', { class: 'dpo-bot-mine', text: text }));
  }

  function moreLink(anchor, label) {
    log.appendChild(el('a', { class: 'dpo-bot-more', href: href(anchor), text: label || 'Подробнее на сайте' }));
  }

  function applyButton() {
    log.appendChild(el('button', { type: 'button', class: 'dpo-bot-apply', 'data-application': '', text: 'Подать заявку' }));
  }

  function scrollDown() {
    log.scrollTop = log.scrollHeight;
  }

  function renderExtra(extra) {
    if (!extra || !extra.length) return;
    say('Ещё нашла программы по теме:');
    extra.forEach(function (p) { log.appendChild(programCard(p)); });
  }

  function renderReply(out) {
    if (out.kind === 'programs') {
      say(out.intro);
      out.programs.forEach(function (p) { log.appendChild(programCard(p)); });
      return;
    }
    if (out.kind === 'programs-weak') {
      say('Точного совпадения нет, вот близкое по теме:');
      out.programs.forEach(function (p) { log.appendChild(programCard(p)); });
      return;
    }
    if (out.kind === 'duration') {
      out.text.split('\n').forEach(say);
      moreLink(out.anchor);
      renderExtra(out.extra);
      return;
    }
    if (out.kind === 'answer') {
      out.answer.text.split('\n').forEach(say);
      moreLink(out.answer.anchor);
      renderExtra(out.extra);
      return;
    }
    if (out.kind === 'gap') {
      say(GAP_TEXT);
      applyButton();
      return;
    }
    say('Такого не нашла. Вот что стартует ближе всего:');
    out.programs.forEach(function (p) { log.appendChild(programCard(p)); });
    applyButton();
  }

  /**
   * Честная строка неудачи – ОДИН раз за открытое окно, а не при каждом
   * накопленном действии (несколько вопросов, заданных подряд до провала
   * загрузки, не должны дать несколько одинаковых сообщений с кнопкой
   * заявки). Флаг сбрасывается в open().
   */
  var failureShown = false;
  function showFailure() {
    if (failureShown) return;
    failureShown = true;
    respond(function () {
      say(FAIL_TEXT);
      applyButton();
    });
  }

  /**
   * Действие ставится в очередь, пока данные не пришли (CRITICAL 2 –
   * reply() читает data.programs, вызывать его раньше нельзя). Очередь –
   * в js/bot-reply.js (createActionQueue), проверено тестами там же:
   * onFail вызывается и при провале ПОСЛЕ постановки в очередь (reject
   * находит уже накопленные действия), и при вопросе, заданном ПОСЛЕ
   * того, как загрузка уже провалилась (run сразу отвечает 'failed') –
   * раньше первый случай терял вопрос молча (независимое ревью, второй
   * заход, IMPORTANT).
   */
  function runWhenReady(action) {
    var wasEmpty = queue.isEmpty();
    var status = queue.run(function (loaded) {
      respond(function () { action(loaded); });
    }, showFailure, data);
    if (status === 'queued' && wasEmpty) say(WAIT_TEXT);
    scrollDown();
  }

  /**
   * Запрос от посетителя (строка ввода или клик по подсказке): своя
   * реплика, затем ответ бота. Три темы с прямым смыслом («Подобрать
   * программу», «Ближайшие старты», «Сколько стоит») распознаются и по
   * кнопке, и по тексту, набранному руками, – detectIntent в
   * js/bot-reply.js (независимое ревью, второй заход: собственное
   * приглашение бота отвечало само себе «Такого не нашла»). Остальное
   * идёт обычным путём через reply().
   */
  function ask(query) {
    var text = String(query || '').trim();
    if (!text) return;
    mine(text);
    var intent = window.DpoBotReply.detectIntent(text);
    if (intent === 'pickProgram') { runWhenReady(renderPickProgram); return; }
    if (intent === 'upcomingStarts') { runWhenReady(renderUpcomingStarts); return; }
    if (intent === 'priceRange') { runWhenReady(renderPriceRange); return; }
    runWhenReady(function (loadedData) {
      renderReply(window.DpoBotReply.reply(text, loadedData));
      scrollDown();
    });
  }

  // ---- Прямые встречные ответы трёх кнопок-подсказок ---------------------
  //
  // CRITICAL 1 (независимое ревью 08.09.2026): у этих трёх кнопок есть
  // прямой смысл и готовые данные – гонять их через нечёткий поиск по
  // словам (как раньше) означало отдавать «Такого не нашла» на собственные
  // подсказки бота. Онлайн и «какой документ выдают» такого прямого смысла
  // не имеют (это ФОРМАТ и ФАКТ соответственно, оба уже разбираются
  // reply()) и остаются на общем пути через ask().

  function renderPickProgram(loadedData) {
    say('Выберите сферу или тип программы:');
    var row = el('div', { class: 'dpo-bot-hints' });
    window.DpoBotReply.sphereList(loadedData.programs).forEach(function (sphere) {
      var button = el('button', { type: 'button', text: sphere });
      button.addEventListener('click', function () { pickBy('sphere', sphere, sphere); });
      row.appendChild(button);
    });
    TYPE_LABELS.forEach(function (pair) {
      var button = el('button', { type: 'button', text: pair[1] });
      button.addEventListener('click', function () { pickBy('type', pair[0], pair[1]); });
      row.appendChild(button);
    });
    log.appendChild(row);
    scrollDown();
  }

  /** Клик по сфере/типу из renderPickProgram – данные уже загружены к этому моменту. */
  function pickBy(field, value, label) {
    mine(label);
    var matched = window.DpoBotReply.pickBy(data.programs, field, value);
    respond(function () {
      if (!matched.length) {
        say('Такого не нашла. Вот что стартует ближе всего:');
        window.DpoBotReply.upcoming(data.programs, 3).forEach(function (p) { log.appendChild(programCard(p)); });
        applyButton();
      } else {
        say(window.DpoBotReply.introFor('filter', matched.length));
        matched.slice(0, 5).forEach(function (p) { log.appendChild(programCard(p)); });
      }
    });
  }

  function renderUpcomingStarts(loadedData) {
    var list = window.DpoBotReply.upcoming(loadedData.programs, 5).filter(function (p) { return p.startIso || p.start; });
    if (!list.length) {
      say('Дат старта в каталоге сейчас нет.');
      scrollDown();
      return;
    }
    say(list.length === 1 ? 'Ближайший старт:' : 'Вот ближайшие старты:');
    list.forEach(function (p) { log.appendChild(programCard(p)); });
    scrollDown();
  }

  function renderPriceRange(loadedData) {
    var range = window.DpoBotReply.priceRange(loadedData.programs);
    if (!range) {
      say('Цены сейчас не в каталоге – загляните в разделы программ.');
      scrollDown();
      return;
    }
    say('Программы стоят от ' + window.DpoBotReply.formatPrice(range.min) + ' до ' + window.DpoBotReply.formatPrice(range.max) + '.');
    say('Могу отобрать по цене – напишите, например, «до 30000» или «от 50000».');
    moreLink('Каталог программ.html', 'Открыть каталог');
    scrollDown();
  }

  /**
   * Все пять кнопок идут через ask() – ровно тот же путь, что у текста,
   * набранного руками (detectIntent внутри ask() отличает три темы с
   * прямым ответом от «Онлайн»/«Какой документ выдают», которые остаются
   * на пути через reply()). Раньше кнопки и текст расходились: кнопка
   * «Подобрать программу» отвечала прямо, а тот же текст, напечатанный
   * руками, уходил в «Такого не нашла» (независимое ревью, второй заход).
   */
  function hintsRow() {
    var row = el('div', { class: 'dpo-bot-hints' });
    HINTS.forEach(function (text) {
      var button = el('button', { type: 'button', text: text });
      button.addEventListener('click', function () { ask(text); });
      row.appendChild(button);
    });
    return row;
  }

  /**
   * Первый экран окна показывается СРАЗУ по открытию, не дожидаясь сети
   * (CRITICAL 2/IMPORTANT 4): приветствие и кнопки-подсказки работают, а
   * ответ на любое действие ждёт данные через runWhenReady. Лог никогда
   * не очищается заново – только дополняется.
   */
  function renderShell() {
    say(GREETING);
    log.appendChild(hintsRow());
  }

  // ---- Доступность и открытие/закрытие ----------------------------------

  function trapFocus(event) {
    if (event.key !== 'Tab' || !panel) return;
    var items = panel.querySelectorAll('a[href],button:not([disabled]),input,[tabindex]:not([tabindex="-1"])');
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function onKeydown(event) {
    if (event.key === 'Escape') {
      // IMPORTANT 5 (независимое ревью 08.09.2026): форма заявки может
      // быть открыта ПОВЕРХ окна бота (кнопка «Подать заявку» в честном
      // ответе, z-index формы 9000 против 930 у окна бота) – Esc обязан
      // закрыть верхний слой первым. У формы свой обработчик Escape
      // (js/application-form.js); пока её backdrop на экране, окно бота
      // Escape не трогает вовсе – иначе оба слушателя на document реагируют
      // на одно нажатие и закрывают оба окна разом, а форма при закрытии
      // ищет свой lastTrigger (кнопку внутри уже удалённого лога бота) и
      // не находит – фокус терялся на BODY.
      if (document.querySelector('.dpo-app-backdrop')) return;
      event.preventDefault();
      close();
      return;
    }
    trapFocus(event);
  }

  /**
   * Отмечает открыто/закрыто на обоих возможных пусковых элементах разом:
   * на лендинге их два (.crow-hit-btn и #crow-vi-btn в html.vi-mode),
   * видим в любой момент только один, но состояние держим у обоих.
   */
  function setLaunchersExpanded(expanded) {
    var nodes = document.querySelectorAll('[data-bot-open]');
    for (var i = 0; i < nodes.length; i++) nodes[i].setAttribute('aria-expanded', String(expanded));
  }

  /**
   * Ворона и открытое окно бота приподнимаются над баннером cookies
   * (js/cookie-consent.js, z-index 1000 – выше и панели 930, и вороны
   * 920: согласие важнее, слои не переставляем) и, пока он на экране, –
   * ещё и над мобильной CTA-полосой (js/smooth-ui.js, видна <=1023px).
   * Тот же приём измерения занятости нижнего края, что у
   * keepAboveBottomBars в js/channel-invite.js.
   *
   * Независимое ревью, второй заход: это раньше работало ТОЛЬКО для окна
   * и ТОЛЬКО на <=700px – на десктопе баннер лез на левый край поля
   * ввода (в vi-режиме перекрывал его настолько, что клик не проходил
   * вовсе), а на телефоне до ответа на баннер перекрывал саму ворону.
   * Теперь функция работает на любой ширине и трогает саму ворону тоже –
   * запускается независимо от того, открыто ли окно бота.
   */
  function topOf(node) {
    if (!node) return null;
    var rect = node.getBoundingClientRect();
    return rect.height ? rect.top : null;
  }

  /**
   * Полосы у нижней кромки, от которых ворона и окно уворачиваются. Их ТРИ
   * РАЗНЫХ, и это не дублирование, а история страниц: `.dpo-mobile-cta`
   * ставит скриптом js/smooth-ui.js на лендинге, `.mobile-cta` лежит в
   * разметке каталога, `.buy-bar` рисует генератор страниц программ.
   * Живой дефект 09.09.2026 (проверка на телефоне): знали только про
   * первую – и на каталоге со страницей программы ворона садилась ПОВЕРХ
   * кнопок «Фильтры» и «Подать заявку», закрывая их собой.
   */
  var BOTTOM_BARS = ['.dpo-mobile-cta', '.mobile-cta', '.buy-bar'];

  function keepAboveBanners() {
    var tops = [topOf(document.getElementById('cookieBanner'))]
      .concat(BOTTOM_BARS.map(function (sel) { return topOf(document.querySelector(sel)); }))
      .filter(function (v) { return v != null; });
    var value = '';
    if (tops.length) {
      var overlap = window.innerHeight - Math.min.apply(null, tops);
      value = 'calc(' + Math.max(0, overlap + 12) + 'px + env(safe-area-inset-bottom, 0px))';
    }
    // 'body>.crow-mascot' – тот же селектор, что уже отличает угловой маскот
    // от вложенных в потоке (index.html: mountCrow()). Задача 13 добавила
    // ВТОРОЙ маскот того же класса .crow-mascot – в потоке слота выхода в
    // содержимое (Каталог программ.html/.landing-template.html), не прямой
    // потомок body. Без уточнения querySelector('.crow-mascot') на каталоге
    // (там нет углового маскота вовсе) находил именно ЕГО и сдвигал transform
    // bottom, рассчитанный под угол экрана, – маскот в содержимом уезжал
    // вверх и на несколько кадров вылезал за пределы своего слота.
    ['body>.crow-mascot', '.crow-hit-btn', '#crow-vi-btn'].forEach(function (selector) {
      var node = document.querySelector(selector);
      if (node) node.style.bottom = value;
    });
    if (panel) panel.style.bottom = value;
  }

  /**
   * Ворона на время открытого окна (правка владельца по снимку 08.09.2026:
   * половина головы торчала из-за нижней кромки панели – читалось как сбой).
   * Переиспользуем готовую механику «маскот на экране один» (hide()/show()
   * у самого инстанса – то же, чем в js/crow-mascot.js пользуются
   * suppressExisting/restoreSuppressed), а не заводим второй способ
   * прятать: гейт reduced-motion, кадры вхолостую не считаются
   * (IntersectionObserver внутри hide() сам гасит цикл) – всё уже там.
   * window.crowMascot существует только на лендинге (задача 9) – на
   * каталоге и страницах программ переменной нет, проверка обязательна.
   *
   * M9 (независимое ревью 08.09.2026): прозрачная кнопка-хит поверх
   * маскота (.crow-hit-btn) сама по себе НЕ прячется вместе с вороной –
   * это отдельный элемент точно того же размера/положения (js/crow-
   * mascot.js её не знает). Пока ворона спрятана, часть кнопки-хита,
   * которую не перекрывает панель (полоса ~200×92 внизу угла), ловила
   * клик и закрывала окно. pointer-events:none снимает клик ровно на то
   * время, что ворона скрыта – #crow-vi-btn (версия для слабовидящих) не
   * трогаем: там маскота вообще нет, это обычная видимая кнопка.
   */
  /**
   * Ворона в шапке окна – ЖИВОЙ маскот, а не картинка: тот же рантайм, что
   * в углу (js/crow-mascot.js уже подключён на всех страницах, где есть
   * это окно). solo:false обязателен – иначе новый инстанс по правилу
   * «маскот на экране один» спрятал бы... сам себя вернувшуюся угловую
   * ворону при закрытии окна, а угловую и так прячет hideCrow().
   * idleSeconds:0 гасит собственную реплику «Есть вопросы?»: в окне на 56px
   * её пузырь был бы шире самого окна.
   */
  var headCrow = null;
  function mountHeadCrow(slot) {
    if (!window.CrowMascot) return;
    try {
      headCrow = window.CrowMascot.mount({
        assetPath: href('images/crow/'),
        anchor: slot,
        width: 56,
        zIndex: 1,
        solo: false,
        idleSeconds: 0,
      });
      // Приветствие: ворона машет, когда окно открылось. В reduced motion
      // рантайм и так стоит в позе покоя – играть нечего.
      if (!REDUCED_MOTION) headCrow.play('wave');
    } catch (e) { headCrow = null; }
  }
  /** Ответ появился: кивок, а если в ответе кнопка заявки – указание на неё. */
  function reactHeadCrow(pointsAtApply) {
    if (headCrow && headCrow.play) headCrow.play(pointsAtApply ? 'point' : 'nod');
  }
  /** Пока ответ готовится – ворона думает (та же пауза, что у трёх точек). */
  function thinkHeadCrow() {
    if (headCrow && headCrow.play) headCrow.play('think');
  }
  function destroyHeadCrow() {
    if (headCrow && headCrow.destroy) headCrow.destroy();
    headCrow = null;
  }

  /**
   * Ответ приходит не мгновенно: сначала три точки, потом сам ответ и кивок
   * вороны (владелец 09.09.2026 – «чтобы было понятно, что отвечает
   * ворона»). Пауза короткая и одна на ответ: это знак авторства, а не
   * поддельная «загрузка».
   * prefers-reduced-motion: без паузы и без точек – ответ сразу.
   */
  var TYPING_MS = 520;
  function respond(fn) {
    if (!log) return;
    if (REDUCED_MOTION) { fn(); scrollDown(); return; }
    var dots = el('div', { class: 'dpo-bot-typing', 'aria-hidden': 'true' }, [
      el('i', {}), el('i', {}), el('i', {}),
    ]);
    log.appendChild(dots);
    thinkHeadCrow();
    scrollDown();
    var myLog = log;
    setTimeout(function () {
      if (log !== myLog) return;
      if (dots.parentNode) dots.parentNode.removeChild(dots);
      // Кнопка заявки в ответе бывает у трёх исходов: «такого не нашла»,
      // «на сайте не написано» и честный отказ загрузки. Считаем ДО и ПОСЛЕ,
      // а не проверяем флаг: кнопку кладут три разные ветки renderReply.
      var applyBefore = myLog.querySelectorAll('.dpo-bot-apply').length;
      fn();
      reactHeadCrow(myLog.querySelectorAll('.dpo-bot-apply').length > applyBefore);
      scrollDown();
    }, TYPING_MS);
  }

  /**
   * Ворона уходит с экрана и появляется в шапке окна: play('leave') – она
   * машет крылом и убегает влево, – и только потом hide(). Окно при этом
   * открывается СРАЗУ, ждать уход не надо: 1,2с – ровно тот отрезок leave,
   * где ворона уже ушла из-под панели, дальше её добирает штатное угасание
   * hide(). В reduced motion уход не играем вовсе.
   */
  var leaveTimer = null;
  function hideCrow() {
    var hit = document.querySelector('.crow-hit-btn');
    if (hit) hit.style.pointerEvents = 'none';
    if (!window.crowMascot) return;
    clearTimeout(leaveTimer);
    if (REDUCED_MOTION) { window.crowMascot.hide(); return; }
    window.crowMascot.play('leave');
    leaveTimer = setTimeout(function () {
      if (window.crowMascot) window.crowMascot.hide();
    }, 1200);
  }
  function showCrow() {
    clearTimeout(leaveTimer);
    var hit = document.querySelector('.crow-hit-btn');
    if (hit) hit.style.pointerEvents = '';
    if (!window.crowMascot) return;
    window.crowMascot.show();
    // Возврат обязателен ИМЕННО через runIn: поза ухода оставляет ворону
    // за левым краем и с нулевой непрозрачностью (p.rx = -600, p.op = 0),
    // и без забега обратно она вернулась бы невидимой.
    if (!REDUCED_MOTION) window.crowMascot.play('runIn');
  }

  function close() {
    if (!panel) return;
    // Раньше маскота: destroy() снимает цикл кадров и наблюдатель, иначе
    // они остались бы жить на удалённом из документа узле.
    destroyHeadCrow();
    panel.remove();
    panel = null;
    log = null;
    setLaunchersExpanded(false);
    document.removeEventListener('keydown', onKeydown, true);
    // Ворона обязана вернуться РАНЬШЕ фокуса – иначе фокус садится на кнопку,
    // а сама ворона ещё не на месте (см. hideCrow/showCrow выше).
    showCrow();
    // Фокус обязан вернуться на ворону – иначе после закрытия он уезжает в начало страницы.
    (lastFocused || document.querySelector('[data-bot-open]')).focus();
  }

  function open(trigger) {
    if (panel) { close(); return; }
    injectStyles();
    lastFocused = trigger || document.activeElement;
    hideCrow();
    queue = window.DpoBotReply.createActionQueue();
    failureShown = false;

    var close_ = el('button', { type: 'button', class: 'dpo-bot-close', 'aria-label': 'Закрыть окно поддержки', text: '×' });
    close_.addEventListener('click', close);
    log = el('div', { class: 'dpo-bot-log' });
    log.setAttribute('aria-live', 'polite');
    var input = el('input', { type: 'text', id: 'dpoBotInput', placeholder: 'Например: банкротство онлайн', 'aria-label': 'Вопрос в поддержку' });
    var form = el('form', { id: 'dpoBotForm' }, [input, el('button', { type: 'submit', text: 'Спросить' })]);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var value = input.value;
      input.value = '';
      ask(value);
    });
    // IMPORTANT 4 (независимое ревью 08.09.2026): aria-modal="true" –
    // ловушка Tab внизу и правда ведёт себя как модальная, aria-modal
    // "false" при живой ловушке было несогласовано.
    // Ворона декоративна (alt="" у всех слоёв рантайма), поэтому слот
    // помечен aria-hidden: читалке хватает заголовка «Поддержка».
    var crowSlot = el('div', { class: 'dpo-bot-crow', 'aria-hidden': 'true' });
    panel = el('div', { id: 'dpoBotPanel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Поддержка' }, [
      el('div', { id: 'dpoBotHead' }, [
        el('div', { class: 'dpo-bot-brand' }, [crowSlot, el('h2', { text: 'Поддержка' })]),
        close_,
      ]),
      log,
      form,
    ]);
    document.body.appendChild(panel);
    // Монтировать только после вставки панели в документ: рантайм маскота
    // считает размеры слота.
    mountHeadCrow(crowSlot);
    setLaunchersExpanded(true);
    document.addEventListener('keydown', onKeydown, true);

    sheetCtl = window.dpoSheet
      ? window.dpoSheet.attach({ root: panel, sheet: panel, grip: '#dpoBotHead', onClose: close })
      : null;

    // Занятость нижнего края (баннер cookies, мобильная CTA-полоса) уже
    // отслеживается постоянным наблюдателем ниже (keepAboveBanners) – этот
    // вызов лишь немедленно ставит СВЕЖЕСОЗДАННУЮ панель на место, не
    // дожидаясь ближайшего срабатывания MutationObserver/resize.
    keepAboveBanners();

    // Перерисовка до снятия начального состояния – иначе браузер склеит
    // добавление узла и смену класса, и переход не проиграется.
    requestAnimationFrame(function () { if (panel) panel.classList.add('is-open'); });

    renderShell();
    // IMPORTANT 4: фокус переводится В ОКНО, на первую кнопку-подсказку –
    // раньше активной оставалась кнопка вороны, которую hideCrow() тут же
    // прячет, и Tab уходил наружу мимо ловушки фокуса.
    var firstHint = panel.querySelector('.dpo-bot-hints button');
    (firstHint || input).focus();

    var myPanel = panel;
    load(function (loaded) {
      if (panel !== myPanel) return;
      if (loaded) queue.resolve(loaded);
      else queue.reject();
    });
  }

  /**
   * IMPORTANT 3 (независимое ревью 08.09.2026): открыть -> Esc -> открыть
   * снова во время ещё идущей загрузки раньше сразу получало ложное
   * «Не получилось загрузить» (loading===true, data ещё null, done(null)).
   * Теперь колбэк встаёт в очередь loadCallbacks и получает РЕЗУЛЬТАТ
   * настоящей загрузки, а не текущее состояние flag'а.
   */
  function load(done) {
    if (data) { done(data); return; }
    loadCallbacks.push(done);
    if (loading) return;
    loading = true;
    Promise.all([
      fetch(href(CATALOG_URL), { credentials: 'omit' }).then(function (r) { return r.ok ? r.json() : null; }),
      fetch(href(FAQ_URL), { credentials: 'omit' }).then(function (r) { return r.ok ? r.json() : null; }),
    ])
      .then(function (parts) {
        loading = false;
        var catalog = parts[0];
        var faq = parts[1];
        if (catalog && Array.isArray(catalog.programs) && faq && Array.isArray(faq.answers)) {
          data = { programs: catalog.programs, answers: faq.answers, gaps: faq.gaps || [], duration: faq.duration || null };
        }
        var cbs = loadCallbacks;
        loadCallbacks = [];
        cbs.forEach(function (cb) { cb(data); });
      })
      .catch(function () {
        loading = false;
        var cbs = loadCallbacks;
        loadCallbacks = [];
        cbs.forEach(function (cb) { cb(null); });
      });
  }

  // Делегирование: на лендинге ворона и её vi-mode кнопка появляются из
  // хвоста index.html ПОСЛЕ window.load (crow-launcher-addon), а рантайм
  // лендинга к этому моменту уже клонировал разметку – прямой обработчик
  // на конкретном узле рисковал бы не пережить эту замену.
  document.addEventListener('click', function (event) {
    var trigger = event.target.closest('[data-bot-open]');
    if (!trigger) return;
    event.preventDefault();
    open(trigger);
  });

  // Наблюдатель за баннером cookies работает ВСЕГДА, а не только пока
  // открыто окно бота: ворона обязана уворачиваться от баннера ещё до
  // того, как по ней вообще кликнули (независимое ревью, второй заход –
  // на телефоне баннер до ответа перекрывал саму ворону). MutationObserver
  // на прямых детях body ловит и появление баннера (js/cookie-consent.js:
  // document.body.append(banner)), и его исчезновение по «Принять»/
  // «Отклонить» (banner.remove()), и появление самой вороны (mountCrow –
  // document.body.appendChild(host) по window.load) – без опроса по
  // таймеру, как у более старого keepAboveBottomBars в js/channel-invite.js.
  // ЛОВУШКА: рантайм лендинга подменяет весь документ целиком
  // (document.documentElement.replaceWith(...) – см. комментарии в
  // index.html), и document.body к моменту подмены становится ДРУГИМ
  // узлом – наблюдатель, привязанный к body СЕЙЧАС, наблюдал бы за уже
  // отсоединённым от документа деревом и не увидел бы ни баннер cookies,
  // ни ворону, которые появляются уже после подмены. document (сам
  // объект Document) не подменяется никогда – наблюдаем его целиком с
  // subtree:true, тем же приёмом, каким click-делегирование этого файла
  // переживает ту же подмену.
  new MutationObserver(keepAboveBanners).observe(document, { childList: true, subtree: true });
  window.addEventListener('resize', keepAboveBanners);
  keepAboveBanners();
})();
