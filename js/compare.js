/**
 * Сравнение программ в каталоге.
 *
 * Решение владельца 04.09.2026: отметка «Сравнить» в карточке, липкая
 * полоса внизу каталога, таблица поверх страницы, не больше ТРЁХ программ
 * разом. Выбор живёт в адресе (?compare=id,id) – ссылку можно послать
 * коллеге, и она откроется тем же сравнением.
 *
 * Откуда берутся строки таблицы
 * -----------------------------
 * Из самой карточки: data-cmp-* пишет генератор `update-catalog.js`,
 * название и адрес читаются из h3 и .card-link. Второго JSON с теми же
 * числами на странице нет намеренно: два источника одних и тех же данных
 * разъезжаются, а лишний блок – это ещё пятнадцать килобайт на странице,
 * которую открывают все.
 *
 * Разметка полосы и окна создаётся здесь, а не в «Каталог программ.html»:
 * до первой отметки они не нужны никому, а держать в странице разметку,
 * которая почти всегда скрыта, – значит платить за неё весом и рисковать
 * тем, что она разъедется с кодом.
 *
 * Слушатели повешены на document делегированием: карточки перерисовываются
 * фильтром, и слушатель на самой кнопке пережил бы не всякую перерисовку.
 */

(function () {
  'use strict';

  /** Больше трёх колонок не помещается на ноутбуке без сжатия текста. */
  var MAX = 3;
  var PARAM = 'compare';

  /** Тип программы в карточке сокращён до ПК/ПП – в таблице пишем словами. */
  var TYPE_FULL = {
    'ПК': 'Повышение квалификации',
    'ПП': 'Профессиональная переподготовка',
  };

  var attr = function (name) {
    return function (card) { return (card.getAttribute(name) || '').trim(); };
  };

  /**
   * Строки таблицы. Порядок – от того, что решает выбор («что это вообще
   * за документ»), к подробностям. Пустое значение показывается прочерком:
   * длительность заполнена у 14 программ из 26, и врать «уточняется» там,
   * где данных нет, хуже, чем честный прочерк.
   */
  var ROWS = [
    ['Документ', function (card) {
      var t = (card.getAttribute('data-type') || '').trim();
      return TYPE_FULL[t] || t;
    }],
    ['Формат', attr('data-cmp-format')],
    ['Длительность', attr('data-cmp-duration')],
    // В карточке подпись целиком – «Старт: 7 сентября 2026 г.». В строке,
    // которая и так называется «Старт», приставка лишняя.
    ['Старт', function (card) {
      return (card.getAttribute('data-cmp-start') || '').replace(/^Старт:\s*/, '').trim();
    }],
    ['Цена', function (card) {
      var el = card.querySelector('.price');
      return el ? el.textContent.trim() : '';
    }],
    ['Модулей', attr('data-cmp-modules')],
    ['Преподавателей', attr('data-cmp-teachers')],
    // Аудитория приходит списком, и пункты в нём длинные («Финансовые
    // директора и руководители финансово-экономических служб»). В строку
    // через точку они склеиваются в кашу, поэтому строка списочная.
    ['Для кого', attr('data-cmp-audience'), 'list'],
  ];

  var CSS = [
    /* Отметка в углу карточки. Поверх растянутой ссылки (.card-link::after
       накрывает карточку целиком), поэтому z-index и своя мишень 44px. */
    '.card-compare{position:absolute;z-index:2;top:32px;right:32px;',
    'display:inline-flex;align-items:center;gap:7px;',
    "font:600 0.75rem/1 'HSE Sans','IBM Plex Sans',sans-serif;",
    'color:rgb(var(--ink));background:rgb(var(--surface) / .92);backdrop-filter:blur(6px);',
    'border:1px solid var(--line);border-radius:999px;padding:7px 12px 7px 9px;cursor:pointer;',
    'transition:background .2s ease,border-color .2s ease,color .2s ease}',
    '.card-compare::before{content:"";position:absolute;inset:-8px -6px}',
    '.card-compare-box{width:13px;height:13px;border:1.5px solid rgb(var(--ink) / .45);',
    'border-radius:4px;display:inline-block;position:relative;transition:background .2s ease,border-color .2s ease}',
    '.card-compare[aria-pressed="true"]{background:rgb(var(--accent));border-color:rgb(var(--accent));color:rgb(var(--surface))}',
    '.card-compare[aria-pressed="true"] .card-compare-box{background:rgb(var(--surface));border-color:rgb(var(--surface))}',
    '.card-compare[aria-pressed="true"] .card-compare-box::after{content:"";position:absolute;',
    'left:3.5px;top:0.5px;width:4px;height:8px;border:solid rgb(var(--accent));border-width:0 2px 2px 0;transform:rotate(45deg)}',
    '@media (hover:hover) and (pointer:fine){.card-compare:hover{border-color:rgb(var(--accent));color:rgb(var(--accent))}',
    '.card-compare[aria-pressed="true"]:hover{color:rgb(var(--surface))}}',

    /* Полоса выбора. На телефоне поднята над плавающей панелью «Программы /
       Подать заявку», которая уже занимает низ экрана. */
    '.cmp-bar{position:fixed;z-index:61;left:12px;right:12px;',
    'bottom:calc(12px + env(safe-area-inset-bottom, 0px));',
    'display:flex;align-items:center;gap:12px;flex-wrap:wrap;',
    'padding:10px 12px;background:rgb(var(--surface) / .96);backdrop-filter:blur(12px);',
    'border:1px solid var(--line);border-radius:18px;box-shadow:0 12px 40px rgb(var(--ink) / .16);',
    "font-family:'HSE Sans','IBM Plex Sans',sans-serif;",
    'opacity:0;transform:translateY(12px);pointer-events:none;',
    'transition:opacity .24s cubic-bezier(.22,1,.36,1),transform .24s cubic-bezier(.22,1,.36,1)}',
    '.cmp-bar.is-open{opacity:1;transform:none;pointer-events:auto}',
    '.cmp-bar-count{font-size:0.8125rem;font-weight:600;color:rgb(var(--ink))}',
    '.cmp-bar-hint{font-size:0.8125rem;color:var(--ink-mute)}',
    '.cmp-bar-list{display:flex;gap:6px;flex-wrap:wrap;margin:0;padding:0;list-style:none;flex:1;min-width:0}',
    '.cmp-bar-list li{display:inline-flex}',
    '.cmp-chip{display:inline-flex;align-items:center;gap:6px;max-width:min(38vw,260px);',
    "font:500 0.75rem/1.2 'HSE Sans','IBM Plex Sans',sans-serif;color:rgb(var(--ink));",
    'background:var(--bg-tint);border:0;border-radius:999px;padding:7px 10px;cursor:pointer}',
    '.cmp-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.cmp-chip::after{content:"×";font-size:0.9375rem;line-height:1;color:var(--ink-mute)}',
    '@media (hover:hover) and (pointer:fine){.cmp-chip:hover::after{color:rgb(var(--accent))}}',
    '.cmp-bar-actions{display:inline-flex;align-items:center;gap:8px;margin-left:auto}',
    '.cmp-open,.cmp-clear{min-height:36px;padding:0 16px;border-radius:999px;cursor:pointer;',
    "font:600 0.8125rem/1.2 'HSE Sans','IBM Plex Sans',sans-serif}",
    '.cmp-open{background:rgb(var(--accent));color:rgb(var(--surface));border:1px solid rgb(var(--accent))}',
    '.cmp-open[disabled]{opacity:.45;cursor:default}',
    '.cmp-clear{background:transparent;color:var(--ink-mute);border:1px solid var(--line)}',

    /* Окно сравнения. Тот же словарь, что у окна заявки: затемнение,
       карточка на бумаге, крестик в углу. */
    '.cmp-backdrop{position:fixed;inset:0;z-index:9000;display:flex;align-items:flex-start;justify-content:center;',
    'padding:max(16px,4vh) 16px;overflow-y:auto;background:rgb(var(--ink) / .55);',
    "font-family:'HSE Sans','IBM Plex Sans',sans-serif;",
    'opacity:0;transition:opacity .22s cubic-bezier(.22,1,.36,1)}',
    '.cmp-backdrop.is-open{opacity:1}',
    '.cmp-window{position:relative;width:100%;max-width:1040px;background:var(--bg);color:rgb(var(--ink));',
    'border-radius:18px;box-shadow:0 24px 60px rgb(var(--ink) / .28);padding:clamp(20px,3.4vw,30px);',
    'transform:translateY(12px) scale(.985);transition:transform .22s cubic-bezier(.22,1,.36,1)}',
    '.cmp-backdrop.is-open .cmp-window{transform:none}',
    // Кегль – ступень headline-compact из DESIGN.md, а не своя величина.
    '.cmp-window h2{font-family:"HSE Slab","Source Serif 4",Georgia,serif;font-weight:600;',
    'font-size:clamp(1.5rem,2.8vw,2.125rem);line-height:1.15;letter-spacing:-0.01em;margin:0 48px 4px 0}',
    '.cmp-window h2:focus-visible{outline:none;box-shadow:0 3px 0 rgb(var(--accent))}',
    '.cmp-sub{margin:0 0 18px;font-size:0.8125rem;color:var(--ink-mute)}',
    '.cmp-close{position:absolute;top:14px;right:14px;width:40px;height:40px;border-radius:999px;',
    'border:1px solid var(--line);background:rgb(var(--surface));color:rgb(var(--ink));',
    'font-size:1.125rem;line-height:1;cursor:pointer}',
    '.cmp-scroll{overflow-x:auto;margin:0 -4px;padding:0 4px}',
    '.cmp-table{border-collapse:collapse;width:100%;font-size:0.9375rem}',
    '.cmp-table th,.cmp-table td{text-align:left;vertical-align:top;padding:11px 14px;',
    'border-bottom:1px solid var(--line)}',
    '.cmp-table tbody th{white-space:nowrap;font-weight:600;color:var(--ink-mute);font-size:0.8125rem;',
    'position:sticky;left:0;background:var(--bg);z-index:1}',
    '.cmp-table thead th{font-family:"HSE Slab","Source Serif 4",Georgia,serif;font-size:0.9375rem;',
    'font-weight:600;line-height:1.25;min-width:180px;border-bottom:1px solid rgb(var(--ink) / .25)}',
    '.cmp-table thead th:first-child{min-width:0}',
    '.cmp-table thead a{color:rgb(var(--accent))}',
    '.cmp-table thead a:hover{text-decoration:underline}',
    /* Различия помечены точкой у названия строки: подсветка всей строки на
       трёх колонках превращает таблицу в шахматную доску. */
    '.cmp-table tr.is-diff th::before{content:"";display:inline-block;width:5px;height:5px;border-radius:50%;',
    'background:rgb(var(--accent));margin-right:7px;vertical-align:middle}',
    '.cmp-table tr.is-diff th{color:rgb(var(--ink))}',
    '.cmp-actions td{border-bottom:0;padding-top:16px}',
    '.cmp-apply{min-height:38px;padding:0 16px;border-radius:999px;cursor:pointer;',
    'background:rgb(var(--accent));color:rgb(var(--surface));border:1px solid rgb(var(--accent));',
    "font:600 0.8125rem/1.2 'HSE Sans','IBM Plex Sans',sans-serif}",
    '.cmp-none{color:var(--ink-mute)}',
    '.cmp-list{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:4px}',
    '.cmp-list li{position:relative;padding-left:12px}',
    '.cmp-list li::before{content:"";position:absolute;left:0;top:0.55em;width:4px;height:4px;',
    'border-radius:50%;background:rgb(var(--ink) / .35)}',

    /* Полоса поднимается над плавающей панелью каталога, а страница
       получает запас снизу – иначе последняя карточка уезжает под полосу. */
    '@media (max-width: 760px){',
    '.cmp-bar{bottom:calc(84px + env(safe-area-inset-bottom, 0px))}',
    '.cmp-bar-list{order:3;width:100%;flex:none}',
    '.cmp-bar-actions{margin-left:auto}',
    'html.has-cmp-bar body{padding-bottom:calc(176px + env(safe-area-inset-bottom, 0px))}',
    '.cmp-table thead th{min-width:150px}',
    '}',
    '@media (prefers-reduced-transparency: reduce){',
    '.cmp-bar{background:rgb(var(--surface));backdrop-filter:none}',
    '.card-compare{background:rgb(var(--surface));backdrop-filter:none}}',
    '@media (prefers-contrast: more){',
    '.cmp-bar{background:rgb(var(--surface));backdrop-filter:none;border-color:rgb(var(--ink))}}',
    '@media (prefers-reduced-motion: reduce){',
    '.cmp-bar,.cmp-backdrop,.cmp-window,.card-compare,.card-compare-box{transition:none !important}}',
    /* Версия для слабовидящих: свои рамки, без прозрачности и теней. */
    'html.vi-mode .cmp-bar,html.vi-mode .cmp-window{background:#fff !important;backdrop-filter:none !important;',
    'border:2px solid #000 !important;box-shadow:none !important}',
    'html.vi-mode .card-compare,html.vi-mode .cmp-open,html.vi-mode .cmp-clear,',
    'html.vi-mode .cmp-close,html.vi-mode .cmp-apply{border:2px solid #000 !important}',
  ].join('');

  var selected = [];
  var bar = null;
  var backdrop = null;
  var lastTrigger = null;
  var hidden = [];

  function injectCss() {
    if (document.getElementById('cmp-css')) return;
    var style = document.createElement('style');
    style.id = 'cmp-css';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function cardById(id) {
    if (!/^[\w-]{1,40}$/.test(id)) return null;
    return document.querySelector('.card[data-id="' + id + '"]');
  }

  function titleOf(card) {
    var h = card.querySelector('h3');
    return h ? h.textContent.trim() : '';
  }

  function hrefOf(card) {
    var a = card.querySelector('.card-link');
    return a ? a.getAttribute('href') : '';
  }

  function track(type, payload) {
    if (typeof window.__dpoAnalyticsEvent === 'function') window.__dpoAnalyticsEvent(type, payload || {});
  }

  /* ── Адрес ───────────────────────────────────────────────────────────── */

  function readUrl() {
    var raw = new URLSearchParams(location.search).get(PARAM);
    if (!raw) return [];
    return raw.split(',').slice(0, MAX).filter(function (id) { return cardById(id); });
  }

  function writeUrl() {
    var params = new URLSearchParams(location.search);
    if (selected.length) params.set(PARAM, selected.join(','));
    else params.delete(PARAM);
    // Запятые в адресе оставляем как есть: %2C в ссылке, которой делятся
    // руками, читается хуже, а в строке запроса запятая разрешена.
    var q = params.toString().replace(/%2C/g, ',');
    history.replaceState(null, '', location.pathname + (q ? '?' + q : '') + location.hash);
  }

  /* ── Выбор ───────────────────────────────────────────────────────────── */

  function syncToggles() {
    var all = document.querySelectorAll('[data-compare-toggle]');
    for (var i = 0; i < all.length; i++) {
      var card = all[i].closest('.card');
      var on = card && selected.indexOf(card.getAttribute('data-id')) !== -1;
      all[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  function toggle(id) {
    var at = selected.indexOf(id);
    if (at !== -1) {
      selected.splice(at, 1);
    } else if (selected.length >= MAX) {
      say('Можно сравнить не больше трёх программ – снимите одну.');
      return;
    } else {
      selected.push(id);
    }
    syncToggles();
    writeUrl();
    renderBar();
  }

  function clearAll() {
    selected = [];
    syncToggles();
    writeUrl();
    renderBar();
  }

  /* ── Полоса ──────────────────────────────────────────────────────────── */

  function say(text) {
    if (!bar) return;
    bar.querySelector('.cmp-bar-hint').textContent = text;
  }

  function buildBar() {
    bar = document.createElement('div');
    bar.className = 'cmp-bar';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Сравнение программ');
    bar.innerHTML =
      '<span class="cmp-bar-count" aria-live="polite"></span>' +
      '<span class="cmp-bar-hint"></span>' +
      '<ul class="cmp-bar-list"></ul>' +
      '<span class="cmp-bar-actions">' +
      '<button type="button" class="cmp-clear">Очистить</button>' +
      '<button type="button" class="cmp-open">Сравнить</button>' +
      '</span>';
    document.body.appendChild(bar);
    bar.querySelector('.cmp-clear').addEventListener('click', clearAll);
    bar.querySelector('.cmp-open').addEventListener('click', function () { open(this); });
  }

  function renderBar() {
    if (!bar) buildBar();
    var open = selected.length > 0;
    bar.classList.toggle('is-open', open);
    document.documentElement.classList.toggle('has-cmp-bar', open);
    if (!open) return;

    bar.querySelector('.cmp-bar-count').textContent = 'Выбрано ' + selected.length + ' из ' + MAX;
    bar.querySelector('.cmp-bar-hint').textContent =
      selected.length < 2 ? 'Отметьте ещё одну программу' : '';
    bar.querySelector('.cmp-open').disabled = selected.length < 2;

    var list = bar.querySelector('.cmp-bar-list');
    list.textContent = '';
    selected.forEach(function (id) {
      var card = cardById(id);
      if (!card) return;
      var li = document.createElement('li');
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'cmp-chip';
      chip.setAttribute('aria-label', 'Убрать из сравнения: ' + titleOf(card));
      var span = document.createElement('span');
      span.textContent = titleOf(card);
      chip.appendChild(span);
      chip.addEventListener('click', function () { toggle(id); });
      li.appendChild(chip);
      list.appendChild(li);
    });
  }

  /* ── Окно ────────────────────────────────────────────────────────────── */

  function buildTable(cards) {
    var table = document.createElement('table');
    table.className = 'cmp-table';

    var head = document.createElement('thead');
    var headRow = document.createElement('tr');
    headRow.appendChild(document.createElement('th'));
    cards.forEach(function (card) {
      var th = document.createElement('th');
      th.scope = 'col';
      var a = document.createElement('a');
      a.href = hrefOf(card);
      a.textContent = titleOf(card);
      th.appendChild(a);
      headRow.appendChild(th);
    });
    head.appendChild(headRow);
    table.appendChild(head);

    var body = document.createElement('tbody');
    ROWS.forEach(function (row) {
      var values = cards.map(function (card) { return row[1](card) || ''; });
      if (!values.some(Boolean)) return; // строка пуста у всех – не показываем
      var tr = document.createElement('tr');
      var uniq = values.filter(function (v, i) { return values.indexOf(v) === i; });
      if (uniq.length > 1) tr.className = 'is-diff';
      var th = document.createElement('th');
      th.scope = 'row';
      th.textContent = row[0];
      tr.appendChild(th);
      values.forEach(function (value) {
        var td = document.createElement('td');
        if (!value) {
          td.className = 'cmp-none';
          td.textContent = '—';
        } else if (row[2] === 'list') {
          var ul = document.createElement('ul');
          ul.className = 'cmp-list';
          value.split(' · ').forEach(function (item) {
            // Пункты приходят с hse.ru как есть, у части в конце запятая.
            var text = item.replace(/[,;]+$/, '').trim();
            if (!text) return;
            var li = document.createElement('li');
            li.textContent = text;
            ul.appendChild(li);
          });
          td.appendChild(ul);
        } else {
          td.textContent = value;
        }
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });

    var actions = document.createElement('tr');
    actions.className = 'cmp-actions';
    actions.appendChild(document.createElement('td'));
    cards.forEach(function (card) {
      var td = document.createElement('td');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cmp-apply';
      // Та же кнопка, что в карточке: окно заявки открывает
      // js/application-form.js по data-application и подставляет программу.
      btn.setAttribute('data-application', '');
      btn.setAttribute('data-program-id', card.getAttribute('data-id') || '');
      btn.setAttribute('data-program-title', titleOf(card));
      btn.setAttribute('data-program-url', hrefOf(card));
      btn.setAttribute('aria-label', 'Заявка: ' + titleOf(card));
      btn.textContent = 'Подать заявку';
      td.appendChild(btn);
      actions.appendChild(td);
    });
    body.appendChild(actions);

    table.appendChild(body);
    return table;
  }

  function open(trigger) {
    var cards = selected.map(cardById).filter(Boolean);
    if (cards.length < 2) return;
    lastTrigger = trigger || document.activeElement;

    backdrop = document.createElement('div');
    backdrop.className = 'cmp-backdrop';
    var win = document.createElement('div');
    win.className = 'cmp-window';
    win.setAttribute('role', 'dialog');
    win.setAttribute('aria-modal', 'true');
    win.setAttribute('aria-labelledby', 'cmp-title');

    var h2 = document.createElement('h2');
    h2.id = 'cmp-title';
    h2.tabIndex = -1;
    h2.textContent = 'Сравнение программ';
    var sub = document.createElement('p');
    sub.className = 'cmp-sub';
    sub.textContent = 'Точкой отмечены строки, в которых программы различаются.';
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'cmp-close';
    close.setAttribute('aria-label', 'Закрыть сравнение');
    close.textContent = '×';
    var scroll = document.createElement('div');
    scroll.className = 'cmp-scroll';
    scroll.appendChild(buildTable(cards));

    win.appendChild(close);
    win.appendChild(h2);
    win.appendChild(sub);
    win.appendChild(scroll);
    backdrop.appendChild(win);
    document.body.appendChild(backdrop);

    // Фон убирается и от указателя, и от диктора: aria-modal понимают не все
    // связки браузер+диктор, inert снимает фокус, чтение и клики разом.
    hidden = [];
    Array.prototype.forEach.call(document.body.children, function (node) {
      if (node === backdrop) return;
      hidden.push([node, node.getAttribute('aria-hidden')]);
      node.setAttribute('aria-hidden', 'true');
      if ('inert' in node) node.inert = true;
    });
    document.documentElement.style.overflow = 'hidden';

    close.addEventListener('click', shut);
    backdrop.addEventListener('mousedown', function (e) { if (e.target === backdrop) shut(); });
    document.addEventListener('keydown', onKey, true);

    requestAnimationFrame(function () {
      backdrop.classList.add('is-open');
      h2.focus();
    });
    track('compare_open', { label: String(cards.length), title: 'Сравнение программ' });
  }

  function onKey(e) {
    if (!backdrop) return;
    if (e.key === 'Escape') { e.preventDefault(); shut(); return; }
    if (e.key !== 'Tab') return;
    var items = Array.prototype.filter.call(
      backdrop.querySelectorAll('a[href], button:not([disabled])'),
      function (el) { return el.offsetParent !== null || el === document.activeElement; }
    );
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || !backdrop.contains(document.activeElement))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function shut() {
    if (!backdrop) return;
    var node = backdrop;
    backdrop = null;
    document.removeEventListener('keydown', onKey, true);
    hidden.forEach(function (pair) {
      var el = pair[0];
      if (pair[1] === null) el.removeAttribute('aria-hidden');
      else el.setAttribute('aria-hidden', pair[1]);
      if ('inert' in el) el.inert = false;
    });
    hidden = [];
    document.documentElement.style.overflow = '';
    node.classList.remove('is-open');
    var done = function () { if (node.parentNode) node.parentNode.removeChild(node); };
    setTimeout(done, 240);
    if (lastTrigger && document.contains(lastTrigger)) lastTrigger.focus();
  }

  /* ── Запуск ──────────────────────────────────────────────────────────── */

  function start() {
    if (!document.querySelector('[data-compare-toggle]')) return false;
    injectCss();
    selected = readUrl();
    syncToggles();
    if (selected.length) renderBar();
    return true;
  }

  document.addEventListener('click', function (e) {
    var toggleBtn = e.target.closest && e.target.closest('[data-compare-toggle]');
    if (!toggleBtn) return;
    var card = toggleBtn.closest('.card');
    if (!card) return;
    e.preventDefault();
    toggle(card.getAttribute('data-id'));
  });

  // Разметку каталога отдаёт сервер, но страницу могли открыть до её
  // появления (или скрипт – раньше конца разбора). Ждём карточки так же,
  // как остальные скрипты сайта: интервалом с потолком.
  if (!start()) {
    var tries = 0;
    var timer = setInterval(function () {
      if (start() || ++tries > 100) clearInterval(timer);
    }, 150);
  }
})();
