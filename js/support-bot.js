/**
 * Окно бота поддержки: подбор программ и готовые ответы с сайта.
 *
 * Самодостаточный виджет по образцу js/application-form.js и js/quiz.js –
 * разметка и стили живут ЗДЕСЬ, а не в HTML страниц: лендинг собирается
 * визуальным сборщиком, каталог и страницы программ – своими генераторами,
 * и виджет, разложенный по источникам, разъехался бы при первой же
 * пересборке любого из них.
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
 * Ядро поиска – js/bot-match.js (window.DpoBotMatch), обязано быть
 * подключено раньше этого файла тегом <script>.
 */
(function () {
  'use strict';

  var CATALOG_URL = 'content/bot-catalog.json';
  var FAQ_URL = 'content/bot-faq.json';

  var GREETING = 'Спрашивайте про программы: тему, формат, цену или ближайший старт.';
  var HINTS = ['Подобрать программу', 'Онлайн', 'Какой документ выдают', 'Ближайшие старты', 'Сколько стоит'];
  var GAP_TEXT = 'Об этом на сайте не написано, а придумывать я не стану. Оставьте заявку – ответит учебный офис.';
  var FAIL_TEXT = 'Не получилось загрузить программы. Напишите нам – ответим.';

  var CSS = [
    '#dpoBotPanel{position:fixed;right:16px;bottom:calc(92px + env(safe-area-inset-bottom,0px));',
    "font-family:'HSE Sans','IBM Plex Sans',system-ui,sans-serif;",
    'z-index:930;width:min(380px,calc(100vw - 32px));max-height:min(70vh,560px);',
    'display:flex;flex-direction:column;background:var(--bg);color:rgb(var(--ink));',
    'border:1px solid rgb(var(--ink) / .12);border-radius:18px;overflow:hidden;',
    'box-shadow:0 24px 60px rgb(var(--ink) / .28);opacity:0;transform:translateY(12px) scale(.985);',
    'transition:opacity .22s cubic-bezier(.22,1,.36,1),transform .22s cubic-bezier(.22,1,.36,1)}',
    '#dpoBotPanel.is-open{opacity:1;transform:none}',
    '#dpoBotHead{display:flex;align-items:center;justify-content:space-between;gap:8px;',
    'padding:14px 14px 10px 18px;border-bottom:1px solid rgb(var(--ink) / .1);flex:none}',
    // Кегль – ступень «title» шкалы DESIGN.md (1.1875rem/600/1.3, «заголовки карточек»).
    '#dpoBotHead h2{margin:0;font-family:"HSE Slab","Source Serif 4",Georgia,serif;',
    'font-size:1.1875rem;font-weight:600;line-height:1.3}',
    '.dpo-bot-close{width:36px;height:36px;flex:none;border-radius:999px;border:0;',
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
    '.dpo-bot-more{align-self:flex-start;font-size:0.9375rem;font-weight:600;color:rgb(var(--accent));',
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
    '.dpo-bot-fail{margin:0 0 12px;font-size:0.9375rem;line-height:1.5}',
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
  var durationTextCache = '';
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

  // ---- Подбор ответа --------------------------------------------------

  /**
   * Слова запроса и триггера сравниваются основами (DpoBotMatch.sameStem),
   * а не через parseQuery: тот нарочно вырезает служебные слова вопроса
   * («документ», «формат», «старт», «стоит» – см. STOP_WORDS в
   * js/bot-match.js), но для готовых ответов бота это ровно те слова,
   * которые называют тему («какой документ выдают»).
   *
   * Порог длины слова – 2 символа, а не 3 (как в parseQuery): «пк»/«пп» –
   * настоящие триггеры ответа pk-vs-pp, и при пороге 3 отсекались бы оба,
   * и в тексте вопроса, и в самом триггере.
   */
  function tokenize(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[^а-яa-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(function (w) { return w.length >= 2 && !/^\d+$/.test(w); })
      .map(window.DpoBotMatch.stem);
  }

  function tokenMatchesAny(token, qTokens) {
    for (var i = 0; i < qTokens.length; i++) {
      if (window.DpoBotMatch.sameStem(token, qTokens[i])) return true;
    }
    return false;
  }

  /**
   * Триггер – ВСЕ его слова обязаны найтись в вопросе (а не хотя бы одно):
   * иначе общее слово многословного триггера ложно ловит вопрос совсем не о
   * той теме («занятия» из триггера «пропуск занятия» одним словом ловило
   * бы «когда занятия» – нашёл при ручной проверке; несколько похожих слов
   * в других триггерах, см. tests/unit/bot-faq.test.js, той же природы).
   */
  function triggerMatches(trigger, qTokens) {
    var tTokens = tokenize(trigger);
    if (!tTokens.length) return false;
    return tTokens.every(function (t) { return tokenMatchesAny(t, qTokens); });
  }

  function findByTriggers(qTokens, list) {
    for (var i = 0; i < list.length; i++) {
      var triggers = list[i].triggers;
      for (var j = 0; j < triggers.length; j++) {
        if (triggerMatches(triggers[j], qTokens)) return list[i];
      }
    }
    return null;
  }

  /** "2 недели" -> {num:"2", root:"недел", days:14, raw:"2 недели"}. */
  function parseDurationItem(raw) {
    var m = /^(\d+(?:,\d+)?)\s+(\S+)/.exec(String(raw || '').trim());
    if (!m) return null;
    var word = m[2];
    var root = /^недел/.test(word) ? 'недел' : /^месяц/.test(word) ? 'месяц' : /^(год|лет)/.test(word) ? 'год' : word;
    var scale = root === 'недел' ? 7 : root === 'месяц' ? 30 : root === 'год' ? 365 : 1;
    return { raw: String(raw).trim(), num: m[1], root: root, days: parseFloat(m[1].replace(',', '.')) * scale };
  }

  /**
   * "2 недели – 3 месяца" для разброса разных единиц, "6 – 8 месяцев" –
   * для одной (число берётся из меньшего, единица – у большего, как в
   * самой цитате): числа считаются из каталога, а не хранятся строкой –
   * иначе устареют при первом же обновлении программ.
   */
  function durationRange(programs, type) {
    var items = programs
      .filter(function (p) { return p.type === type && p.duration; })
      .map(function (p) { return parseDurationItem(p.duration); })
      .filter(Boolean);
    if (!items.length) return null;
    var min = items[0];
    var max = items[0];
    items.forEach(function (it) {
      if (it.days < min.days) min = it;
      if (it.days > max.days) max = it;
    });
    if (min.raw === max.raw) return min.raw;
    if (min.root === max.root) return min.num + ' – ' + max.raw;
    return min.raw + ' – ' + max.raw;
  }

  function durationText(programs) {
    var pk = durationRange(programs, 'ПК');
    var pp = durationRange(programs, 'ПП');
    var lines = [];
    if (pk) lines.push('Повышение квалификации: длительность обычно ' + pk + '.');
    if (pp) lines.push('Профессиональная переподготовка: длительность обычно ' + pp + '.');
    return lines.join('\n');
  }

  /** Ближайшие по старту программы – тот же порядок, что у reason:'none' в DpoBotMatch.search. */
  function upcoming(programs, n) {
    return programs
      .slice()
      .sort(function (a, b) {
        var aHas = !!(a.startIso || a.start);
        var bHas = !!(b.startIso || b.start);
        if (aHas !== bHas) return aHas ? -1 : 1;
        if (a.startIso && b.startIso) return a.startIso < b.startIso ? -1 : a.startIso > b.startIso ? 1 : 0;
        return 0;
      })
      .slice(0, n);
  }

  function introFor(reason, count) {
    if (reason === 'filter') return 'Отобрала по вашим условиям:';
    return count === 1 ? 'Нашла одну программу:' : 'Вот что нашла:';
  }

  /**
   * Порядок ровно по спеке: сперва подбор программ, потом готовый ответ с
   * сайта, потом честное «не нашла». Программы – вперёд ответа: человек,
   * назвавший тему, ищет программу, а не определение.
   */
  function reply(query) {
    var found = window.DpoBotMatch.search(query, data.programs);
    if (found.reason !== 'empty' && found.reason !== 'none') {
      return { kind: 'programs', reason: found.reason, programs: found.programs.slice(0, 5) };
    }
    var qTokens = tokenize(query);
    var durationHit = data.duration && data.duration.triggers.some(function (t) { return triggerMatches(t, qTokens); });
    if (durationHit) {
      if (!durationTextCache) durationTextCache = durationText(data.programs);
      if (durationTextCache) return { kind: 'duration', text: durationTextCache, anchor: data.duration.anchor };
    }
    var answer = findByTriggers(qTokens, data.answers);
    if (answer) return { kind: 'answer', answer: answer };
    var gap = findByTriggers(qTokens, data.gaps);
    if (gap) return { kind: 'gap' };
    return { kind: 'none', programs: upcoming(data.programs, 3) };
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

  function moreLink(anchor) {
    log.appendChild(el('a', { class: 'dpo-bot-more', href: href(anchor), text: 'Подробнее на сайте' }));
  }

  function applyButton() {
    log.appendChild(el('button', { type: 'button', class: 'dpo-bot-apply', 'data-application': '', text: 'Подать заявку' }));
  }

  function renderReply(out) {
    if (out.kind === 'programs') {
      say(introFor(out.reason, out.programs.length));
      out.programs.forEach(function (p) { log.appendChild(programCard(p)); });
      return;
    }
    if (out.kind === 'duration') {
      out.text.split('\n').forEach(say);
      moreLink(out.anchor);
      return;
    }
    if (out.kind === 'answer') {
      out.answer.text.split('\n').forEach(say);
      moreLink(out.answer.anchor);
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

  /** Запрос от посетителя: своя реплика, затем ответ бота. */
  function ask(query) {
    var text = String(query || '').trim();
    if (!text) return;
    log.appendChild(el('p', { class: 'dpo-bot-mine', text: text }));
    renderReply(reply(text));
    log.scrollTop = log.scrollHeight;
  }

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
   * Первый экран окна: приветствие вороны, кнопки-подсказки и строка ввода;
   * либо, если данные не доехали, честная строка и кнопка заявки.
   */
  function render(loaded) {
    log.textContent = '';
    var form = document.getElementById('dpoBotForm');
    if (!loaded) {
      log.appendChild(el('p', { class: 'dpo-bot-fail', text: FAIL_TEXT }));
      applyButton();
      if (form) form.hidden = true;
      return;
    }
    say(GREETING);
    log.appendChild(hintsRow());
    if (form) form.hidden = false;
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
   * На телефоне лист выезжает от нижнего края и обязан не перекрывать
   * мобильную полосу-CTA (js/smooth-ui.js) и баннер cookies
   * (js/cookie-consent.js) – тот же приём измерения занятости нижнего
   * края, что у keepAboveBottomBars в js/channel-invite.js.
   */
  function clearBottomBars() {
    if (!panel || !window.matchMedia('(max-width: 700px)').matches) return;
    var topOf = function (node) {
      if (!node) return null;
      var rect = node.getBoundingClientRect();
      return rect.height ? rect.top : null;
    };
    var tops = [topOf(document.getElementById('cookieBanner')), topOf(document.querySelector('.dpo-mobile-cta'))].filter(
      function (v) { return v != null; },
    );
    if (!tops.length) { panel.style.bottom = ''; return; }
    var overlap = window.innerHeight - Math.min.apply(null, tops);
    panel.style.bottom = 'calc(' + Math.max(0, overlap + 12) + 'px + env(safe-area-inset-bottom, 0px))';
  }

  function close() {
    if (!panel) return;
    window.removeEventListener('resize', clearBottomBars);
    panel.remove();
    panel = null;
    log = null;
    setLaunchersExpanded(false);
    document.removeEventListener('keydown', onKeydown, true);
    // Фокус обязан вернуться на ворону – иначе после закрытия он уезжает в начало страницы.
    (lastFocused || document.querySelector('[data-bot-open]')).focus();
  }

  function open(trigger) {
    if (panel) { close(); return; }
    injectStyles();
    lastFocused = trigger || document.activeElement;

    var close_ = el('button', { type: 'button', class: 'dpo-bot-close', 'aria-label': 'Закрыть окно бота', text: '×' });
    close_.addEventListener('click', close);
    log = el('div', { class: 'dpo-bot-log' });
    log.setAttribute('aria-live', 'polite');
    var input = el('input', { type: 'text', id: 'dpoBotInput', placeholder: 'Например: банкротство онлайн', 'aria-label': 'Вопрос боту' });
    var form = el('form', { id: 'dpoBotForm' }, [input, el('button', { type: 'submit', text: 'Спросить' })]);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var value = input.value;
      input.value = '';
      ask(value);
    });
    panel = el('div', { id: 'dpoBotPanel', role: 'dialog', 'aria-modal': 'false', 'aria-label': 'Бот поддержки' }, [
      el('div', { id: 'dpoBotHead' }, [el('h2', { text: 'Бот поддержки' }), close_]),
      log,
      form,
    ]);
    document.body.appendChild(panel);
    setLaunchersExpanded(true);
    document.addEventListener('keydown', onKeydown, true);

    sheetCtl = window.dpoSheet
      ? window.dpoSheet.attach({ root: panel, sheet: panel, grip: '#dpoBotHead', onClose: close })
      : null;

    clearBottomBars();
    window.addEventListener('resize', clearBottomBars);

    // Перерисовка до снятия начального состояния – иначе браузер склеит
    // добавление узла и смену класса, и переход не проиграется.
    requestAnimationFrame(function () { if (panel) panel.classList.add('is-open'); });

    load(function (loaded) { if (panel) render(loaded); });
  }

  function load(done) {
    if (data || loading) { done(data); return; }
    loading = true;
    Promise.all([
      fetch(href(CATALOG_URL), { credentials: 'omit' }).then(function (r) { return r.ok ? r.json() : null; }),
      fetch(href(FAQ_URL), { credentials: 'omit' }).then(function (r) { return r.ok ? r.json() : null; }),
    ])
      .then(function (parts) {
        loading = false;
        var catalog = parts[0];
        var faq = parts[1];
        if (!catalog || !Array.isArray(catalog.programs) || !faq || !Array.isArray(faq.answers)) {
          done(null);
          return;
        }
        data = { programs: catalog.programs, answers: faq.answers, gaps: faq.gaps || [], duration: faq.duration || null };
        done(data);
      })
      .catch(function () {
        loading = false;
        done(null);
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
})();
