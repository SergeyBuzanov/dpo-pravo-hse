/**
 * Форма заявки на программу.
 *
 * Один самодостаточный виджет на все страницы сайта: лендинг, страницы
 * программ, каталог. Ставится атрибутом на любую кнопку или ссылку:
 *
 *   <button data-application data-program-id="802031223"
 *           data-program-title="Транспортное право">Подать заявку</button>
 *
 * Разметка окна и стили живут ЗДЕСЬ, а не в HTML страниц, и это осознанно:
 * страницы программ собираются генератором, лендинг — визуальным сборщиком,
 * каталог — третьим скриптом. Разложенная по трём источникам форма
 * разъехалась бы при первой же пересборке любого из них. Стили вставляются
 * элементом <style>, что разрешено CSP страниц (style-src 'unsafe-inline').
 *
 * Отправка идёт через fetch на свой домен (connect-src 'self'), а не
 * обычным submit: в CSP стоит form-action 'none', и это правило остаётся —
 * оно запрещает браузеру отправить данные формы куда бы то ни было ещё,
 * даже если на страницу попадёт чужая разметка.
 *
 * Доступность здесь не украшение: заявку подают в том числе с клавиатуры и
 * через экранный диктор. Реализованы ловушка фокуса, возврат фокуса на
 * кнопку при закрытии, Esc, aria-invalid с привязкой сообщений к полям и
 * живая область для итога отправки.
 */

(function () {
  'use strict';

  var ENDPOINT = '/api/application';
  var PRIVACY_URL = 'privacy.html';
  /** Телефон центра показывается, когда отправка не удалась. */
  var FALLBACK_PHONE = '+7 (495) 772-95-90';

  /**
   * Темы обращения. Одна форма на все каналы: карточки «Куда пойти дальше»
   * открывают её с предвыбранной темой (data-application-topic), кнопки
   * записи на программу – с темой «Заявка на программу». Тема уходит на
   * сервер, пишется в журнал и попадает в тему письма учебному офису.
   */
  var TOPICS = [
    ['program', 'Заявка на программу'],
    ['course-idea', 'Идея курса'],
    ['teaching', 'Хочу стать преподавателем'],
    ['feedback', 'Отзыв о работе центра'],
  ];
  var TOPIC_TITLES = {
    program: 'Заявка на обучение',
    'course-idea': 'Идея курса',
    teaching: 'Стать нашим преподавателем',
    feedback: 'Помогите нам стать лучше',
  };
  var TOPIC_HINTS = {
    'course-idea': 'Расскажите в комментарии, какой программы вам не хватает.',
    teaching: 'Расскажите в комментарии о себе и о курсе, который готовы вести.',
    feedback: 'Поделитесь в комментарии, что стоит улучшить в работе центра или на сайте.',
  };

  var SOURCES = [
    ['hse-site', 'Сайт НИУ ВШЭ'],
    ['telegram', 'Телеграм-канал'],
    ['search', 'Поисковые системы'],
    ['ad', 'Реклама или баннер'],
    ['social', 'Социальные сети'],
    ['mailing', 'Почтовая рассылка'],
    ['board', 'Стенд объявлений'],
    ['recommendation', 'По рекомендации'],
    ['other', 'Другое'],
  ];

  var CSS = [
    '.dpo-app-backdrop{position:fixed;inset:0;z-index:9000;display:flex;align-items:flex-start;',
    "font-family:'HSE Sans','IBM Plex Sans',system-ui,sans-serif;",
    'justify-content:center;padding:max(16px,4vh) 16px;overflow-y:auto;',
    'background:rgb(var(--ink) / .55);opacity:0;transition:opacity .22s cubic-bezier(.22,1,.36,1)}',
    '.dpo-app-backdrop.is-open{opacity:1}',
    '.dpo-app{position:relative;width:100%;max-width:560px;background:var(--bg);color:rgb(var(--ink));',
    'border-radius:18px;box-shadow:0 24px 60px rgb(var(--ink) / .28);padding:clamp(22px,4vw,34px);',
    'transform:translateY(12px) scale(.985);transition:transform .22s cubic-bezier(.22,1,.36,1)}',
    '.dpo-app-backdrop.is-open .dpo-app{transform:none}',
    '.dpo-app h2{font-family:"HSE Slab","Source Serif 4",Georgia,serif;font-size:clamp(22px,3.4vw,28px);',
    'line-height:1.15;margin:0 8px 6px 0;font-weight:600}',
    '.dpo-app-program{font-size:14px;line-height:1.5;color:var(--ink-mute);margin:0 0 20px}',
    '.dpo-app-close{position:absolute;top:14px;right:14px;width:38px;height:38px;border-radius:50%;',
    'border:1px solid rgb(var(--ink) / .12);background:rgb(var(--surface));color:rgb(var(--ink));font-size:20px;line-height:1;',
    'cursor:pointer;transition:background .15s,border-color .15s}',
    '.dpo-app-close:hover{background:var(--bg-tint)}',
    '.dpo-app-row{display:grid;gap:14px;grid-template-columns:1fr 1fr;margin-bottom:14px}',
    '@media (max-width:520px){.dpo-app-row{grid-template-columns:1fr}}',
    '.dpo-app-field{display:flex;flex-direction:column;gap:6px;margin-bottom:14px}',
    // Класс с display:flex перебивает встроенное правило [hidden]{display:none}:
    // без этой строки поле «уточните, откуда узнали» видно всегда.
    '.dpo-app [hidden]{display:none}',
    '.dpo-app-row .dpo-app-field{margin-bottom:0}',
    '.dpo-app label{font-size:13px;font-weight:600;letter-spacing:.01em}',
    '.dpo-app .req{color:rgb(var(--accent))}',
    '.dpo-app input[type=text],.dpo-app input[type=tel],.dpo-app input[type=email],.dpo-app textarea,.dpo-app select{',
    'font:inherit;font-size:15px;color:rgb(var(--ink));background:rgb(var(--surface));border:1px solid rgb(var(--ink) / .16);',
    'border-radius:10px;padding:11px 13px;width:100%;transition:border-color .15s,box-shadow .15s}',
    '.dpo-app textarea{min-height:88px;resize:vertical;font-family:inherit}',
    '.dpo-app ::placeholder{color:var(--ink-mute);opacity:.75}',
    '.dpo-app input:focus-visible,.dpo-app textarea:focus-visible,.dpo-app select:focus-visible{outline:none;border-color:rgb(var(--accent));',
    'box-shadow:0 0 0 3px rgb(var(--accent) / .18)}',
    '.dpo-app [aria-invalid=true]{border-color:#B00020;background:rgba(176,0,32,.05)}',
    '.dpo-app-err{font-size:13px;line-height:1.4;color:#B00020;min-height:0}',
    '.dpo-app-sources{border:0;padding:0;margin:4px 0 16px}',
    '.dpo-app-sources legend{font-size:13px;font-weight:600;padding:0;margin-bottom:10px}',
    '.dpo-app-checks{display:grid;grid-template-columns:1fr 1fr;gap:8px 16px}',
    '@media (max-width:520px){.dpo-app-checks{grid-template-columns:1fr}}',
    '.dpo-app-check{display:flex;gap:9px;align-items:flex-start;font-size:14px;line-height:1.4;cursor:pointer}',
    '.dpo-app-check input{margin:2px 0 0;width:17px;height:17px;accent-color:rgb(var(--accent));flex:none}',
    '.dpo-app-consent{display:flex;gap:10px;align-items:flex-start;font-size:13px;line-height:1.5;',
    'color:var(--ink-soft);margin:6px 0 4px;cursor:pointer}',
    '.dpo-app-consent a{color:rgb(var(--accent))}',
    '.dpo-app-submit{margin-top:18px;width:100%;font:inherit;font-size:15px;font-weight:600;color:rgb(var(--surface));',
    'background:rgb(var(--accent));border:0;border-radius:999px;padding:14px 20px;cursor:pointer;',
    'transition:background .15s,transform .12s}',
    '.dpo-app-submit:hover{background:#1145AA}',
    '.dpo-app-submit:active{transform:scale(.985)}',
    '.dpo-app-submit[disabled]{opacity:.6;cursor:progress}',
    '.dpo-app-note{font-size:12px;line-height:1.5;color:var(--ink-mute);margin:12px 0 0;text-align:center}',
    '.dpo-app-status{margin:14px 0 0;font-size:14px;line-height:1.5;border-radius:10px;padding:0}',
    '.dpo-app-status:not(:empty){padding:12px 14px}',
    // Цвет ошибки — системный #B00020; фон и граница выведены из него, а не
    // подобраны глазом (правило производного состояния в DESIGN.md).
    '.dpo-app-status.is-error{background:rgba(176,0,32,.06);color:#B00020;',
    'border:1px solid rgba(176,0,32,.22)}',
    '.dpo-app-done{text-align:center;padding:14px 0 4px}',
    '.dpo-app-done h2{margin-bottom:10px}',
    '.dpo-app-done p{font-size:15px;line-height:1.6;color:var(--ink-soft);margin:0 0 8px}',
    // Ловушка для роботов. `display:none` роботы распознают, поэтому поле
    // уводится за пределы экрана и снимается с обхода Tab и диктора.
    '.dpo-app-trap{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}',
    '@media (prefers-reduced-motion:reduce){.dpo-app-backdrop,.dpo-app{transition:none}',
    '.dpo-app-submit:active{transform:none}}',
    // Режим для слабовидящих: та же логика, что у остальных страниц —
    // жирные границы, никакой полупрозрачности.
    'html.vi-mode .dpo-app{border:2px solid #000}',
    'html.vi-mode .dpo-app input,html.vi-mode .dpo-app textarea,html.vi-mode .dpo-app select{border:2px solid #000}',
    'html.vi-mode .dpo-app-backdrop{background:rgba(0,0,0,.8)}',
    // Глобальное правило vi-mode гасит box-shadow, которым нарисован фокус
    // формы, — сфокусированное поле было неотличимо от обычного (WCAG 2.4.7).
    // Правило то же, что в каталоге и на остальных страницах.
    'html.vi-mode .dpo-app :focus-visible{outline:3px solid #000 !important;outline-offset:2px}',
  ].join('');

  var FOCUSABLE =
    'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select,[tabindex]:not([tabindex="-1"])';

  var backdrop = null;
  var lastTrigger = null;
  var context = {};

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        if (key === 'text') node.textContent = attrs[key];
        else if (key === 'html') node.innerHTML = attrs[key];
        else if (attrs[key] != null) node.setAttribute(key, attrs[key]);
      });
    }
    (children || []).forEach(function (child) {
      if (child) node.appendChild(child);
    });
    return node;
  }

  function injectStyles() {
    if (document.getElementById('dpo-app-styles')) return;
    var style = document.createElement('style');
    style.id = 'dpo-app-styles';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  /**
   * Путь к политике обработки данных зависит от того, где лежит страница:
   * из programs/ до неё на уровень выше.
   */
  function privacyHref() {
    return /\/programs\//.test(location.pathname) ? '../' + PRIVACY_URL : PRIVACY_URL;
  }

  function field(name, label, type, required, autocomplete) {
    var input = el('input', {
      type: type,
      id: 'dpo-app-' + name,
      name: name,
      autocomplete: autocomplete || 'off',
      required: required ? 'required' : null,
      'aria-describedby': 'dpo-app-' + name + '-err',
    });
    return el('div', { class: 'dpo-app-field' }, [
      el('label', { for: 'dpo-app-' + name, html: label + (required ? ' <span class="req">*</span>' : '') }),
      input,
      el('p', { class: 'dpo-app-err', id: 'dpo-app-' + name + '-err' }),
    ]);
  }

  function buildForm() {
    var sources = el(
      'div',
      { class: 'dpo-app-checks' },
      SOURCES.map(function (pair) {
        return el('label', { class: 'dpo-app-check' }, [
          el('input', { type: 'checkbox', name: 'sources', value: pair[0] }),
          el('span', { text: pair[1] }),
        ]);
      }),
    );

    var otherField = el('div', { class: 'dpo-app-field', hidden: 'hidden', id: 'dpo-app-other-wrap' }, [
      el('label', { for: 'dpo-app-sourceOther', text: 'Уточните, откуда узнали' }),
      el('input', { type: 'text', id: 'dpo-app-sourceOther', name: 'sourceOther', autocomplete: 'off' }),
    ]);

    // Выбор темы обращения: одна форма на все каналы, карточки «Куда пойти
    // дальше» лишь предвыбирают тему. Смена темы меняет заголовок окна и
    // подсказку – человек видит, что именно отправляет.
    var topicSelect = el(
      'select',
      { id: 'dpo-app-topic', name: 'topic' },
      TOPICS.map(function (pair) {
        return el('option', { value: pair[0], text: pair[1] });
      }),
    );
    topicSelect.addEventListener('change', function () {
      applyTopic(topicSelect.value);
    });

    var form = el('form', { class: 'dpo-app-form', novalidate: 'novalidate' }, [
      el('div', { class: 'dpo-app-field' }, [
        el('label', { for: 'dpo-app-topic', text: 'Тема обращения' }),
        topicSelect,
      ]),
      el('div', { class: 'dpo-app-row' }, [
        field('lastName', 'Фамилия', 'text', true, 'family-name'),
        field('firstName', 'Имя', 'text', true, 'given-name'),
      ]),
      el('div', { class: 'dpo-app-row' }, [
        field('phone', 'Телефон', 'tel', true, 'tel'),
        field('email', 'Электронная почта', 'email', true, 'email'),
      ]),
      el('div', { class: 'dpo-app-row' }, [
        field('position', 'Должность', 'text', false, 'organization-title'),
        field('company', 'Место работы', 'text', false, 'organization'),
      ]),
      el('fieldset', { class: 'dpo-app-sources' }, [
        el('legend', { text: 'Как вы узнали о нас?' }),
        sources,
      ]),
      otherField,
      el('div', { class: 'dpo-app-field' }, [
        el('label', { for: 'dpo-app-comment', text: 'Комментарий или вопрос' }),
        el('textarea', {
          id: 'dpo-app-comment',
          name: 'comment',
          rows: '3',
          placeholder: 'Например: интересует корпоративный формат для группы из восьми юристов',
        }),
      ]),
      el('label', { class: 'dpo-app-check', style: 'margin-bottom:12px' }, [
        el('input', { type: 'checkbox', name: 'noAnnouncements' }),
        el('span', { text: 'Не присылать анонсы новых программ и мероприятий Центра ДПО' }),
      ]),
      el('label', { class: 'dpo-app-consent' }, [
        el('input', { type: 'checkbox', name: 'consent', id: 'dpo-app-consent', 'aria-describedby': 'dpo-app-consent-err' }),
        el('span', {
          html:
            'Я подтверждаю, что ознакомился с <a href="' +
            privacyHref() +
            '" target="_blank" rel="noopener">Политикой обработки персональных данных</a>, ' +
            'и даю согласие на обработку моих персональных данных для рассмотрения заявки. <span class="req">*</span>',
        }),
      ]),
      el('p', { class: 'dpo-app-err', id: 'dpo-app-consent-err' }),
      // Ловушка: человек этого поля не видит и не встретит при обходе Tab.
      el('div', { class: 'dpo-app-trap', 'aria-hidden': 'true' }, [
        el('label', { for: 'dpo-app-website', text: 'Не заполняйте это поле' }),
        el('input', { type: 'text', id: 'dpo-app-website', name: 'website', tabindex: '-1', autocomplete: 'off' }),
      ]),
      el('button', { type: 'submit', class: 'dpo-app-submit', text: 'Отправить заявку' }),
      el('p', { class: 'dpo-app-status', role: 'status', 'aria-live': 'polite' }),
      el('p', {
        class: 'dpo-app-note',
        text: 'Мы свяжемся с вами по телефону или почте. Данные не передаются третьим лицам.',
      }),
    ]);

    // «Другое» открывает поле для свободного ввода — и только оно.
    sources.addEventListener('change', function (event) {
      if (event.target.value !== 'other') return;
      otherField.hidden = !event.target.checked;
      if (event.target.checked) otherField.querySelector('input').focus();
    });

    return form;
  }

  function buildDialog() {
    var close = el('button', {
      type: 'button',
      class: 'dpo-app-close',
      'aria-label': 'Закрыть форму',
      html: '&times;',
    });
    var dialog = el(
      'div',
      { class: 'dpo-app', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dpo-app-title' },
      [
        close,
        el('h2', { id: 'dpo-app-title', text: 'Заявка на обучение' }),
        el('p', { class: 'dpo-app-program' }),
        buildForm(),
      ],
    );
    var wrap = el('div', { class: 'dpo-app-backdrop' }, [dialog]);

    close.addEventListener('click', closeDialog);
    wrap.addEventListener('mousedown', function (event) {
      // Закрытие по клику мимо окна — но только если нажатие И началось, и
      // закончилось на подложке: иначе выделение текста, доведённое мышью
      // за край окна, закрывало бы форму с заполненными полями.
      if (event.target === wrap) wrap.dataset.outside = '1';
    });
    wrap.addEventListener('click', function (event) {
      if (event.target === wrap && wrap.dataset.outside === '1') closeDialog();
      delete wrap.dataset.outside;
    });
    dialog.querySelector('form').addEventListener('submit', onSubmit);
    return wrap;
  }

  function onKeydown(event) {
    if (!backdrop) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDialog();
      return;
    }
    if (event.key !== 'Tab') return;

    // Ловушка фокуса: за пределы окна Tab не выпускает.
    var items = Array.prototype.filter.call(
      backdrop.querySelectorAll(FOCUSABLE),
      function (node) {
        return node.offsetParent !== null || node === document.activeElement;
      },
    );
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

  /** Заголовок окна и подсказка следуют за выбранной темой обращения. */
  function applyTopic(topic) {
    if (!backdrop) return;
    context.topic = topic;
    var title = backdrop.querySelector('h2');
    if (title) title.textContent = TOPIC_TITLES[topic] || TOPIC_TITLES.program;
    var caption = backdrop.querySelector('.dpo-app-program');
    if (!caption) return;
    if (topic === 'program') {
      caption.textContent = context.programTitle
        ? 'Программа: ' + context.programTitle
        : 'Расскажите о себе – учебный офис свяжется с вами и подберёт программу.';
    } else {
      caption.textContent = TOPIC_HINTS[topic] || '';
    }
  }

  function openDialog(trigger) {
    injectStyles();
    lastTrigger = trigger;
    context = {
      programId: trigger.getAttribute('data-program-id') || '',
      programTitle: trigger.getAttribute('data-program-title') || '',
      programUrl: trigger.getAttribute('data-program-url') || location.href,
      topic: trigger.getAttribute('data-application-topic') || 'program',
    };

    if (!backdrop) {
      backdrop = buildDialog();
      document.body.appendChild(backdrop);
    }

    var topicSelect = backdrop.querySelector('#dpo-app-topic');
    if (topicSelect) topicSelect.value = context.topic;
    applyTopic(context.topic);

    document.addEventListener('keydown', onKeydown, true);
    document.documentElement.style.overflow = 'hidden';
    // Перерисовка до снятия начального состояния — иначе переход не
    // проигрывается: браузер склеит добавление элемента и смену класса.
    requestAnimationFrame(function () {
      backdrop.classList.add('is-open');
    });

    var firstInput = backdrop.querySelector('input');
    if (firstInput) firstInput.focus();
  }

  function closeDialog() {
    if (!backdrop) return;
    backdrop.classList.remove('is-open');
    document.removeEventListener('keydown', onKeydown, true);
    document.documentElement.style.overflow = '';
    var node = backdrop;
    window.setTimeout(function () {
      if (node && node.parentNode) node.parentNode.removeChild(node);
      if (node === backdrop) backdrop = null;
    }, 220);
    // Фокус возвращается на кнопку, с которой окно открыли: иначе он
    // уезжает в начало страницы, и человек с клавиатуры теряет место.
    if (lastTrigger && document.contains(lastTrigger)) lastTrigger.focus();
  }

  function clearErrors(form) {
    Array.prototype.forEach.call(form.querySelectorAll('.dpo-app-err'), function (node) {
      node.textContent = '';
    });
    Array.prototype.forEach.call(form.querySelectorAll('[aria-invalid]'), function (node) {
      node.removeAttribute('aria-invalid');
    });
  }

  function showErrors(form, fields) {
    var firstNode = null;
    fields.forEach(function (item) {
      var box = form.querySelector('#dpo-app-' + item.field + '-err');
      var input = form.querySelector('#dpo-app-' + item.field);
      if (box) box.textContent = item.message;
      if (input) {
        input.setAttribute('aria-invalid', 'true');
        if (!firstNode) firstNode = input;
      }
    });
    if (firstNode) firstNode.focus();
  }

  function collect(form) {
    var data = new FormData(form);
    return {
      topic: data.get('topic') || 'program',
      firstName: data.get('firstName') || '',
      lastName: data.get('lastName') || '',
      phone: data.get('phone') || '',
      email: data.get('email') || '',
      position: data.get('position') || '',
      company: data.get('company') || '',
      sources: data.getAll('sources'),
      sourceOther: data.get('sourceOther') || '',
      noAnnouncements: Boolean(data.get('noAnnouncements')),
      consent: Boolean(data.get('consent')),
      website: data.get('website') || '',
      programId: context.programId,
      programTitle: context.programTitle,
      programUrl: context.programUrl,
    };
  }

  function showDone(dialog) {
    var form = dialog.querySelector('form');
    if (form) form.remove();
    // Текст итога зависит от темы: «подтвердить участие» уместно только
    // у заявки на программу, обращению обещается ответ при необходимости.
    var isProgram = (context.topic || 'program') === 'program';
    var done = el('div', { class: 'dpo-app-done' }, [
      el('p', {
        text: isProgram
          ? 'Заявка принята. Учебный офис Центра ДПО свяжется с вами по указанному телефону ' +
            'или почте, чтобы подтвердить участие и рассказать о ближайшем наборе.'
          : 'Обращение принято и записано. Учебный офис Центра ДПО прочитает его и свяжется ' +
            'с вами, если потребуется уточнение.',
      }),
      isProgram ? el('p', { text: 'Обычно это занимает один рабочий день.' }) : null,
    ]);
    dialog.querySelector('h2').textContent = 'Спасибо!';
    var caption = dialog.querySelector('.dpo-app-program');
    if (caption) caption.remove();
    dialog.appendChild(done);
    dialog.querySelector('.dpo-app-close').focus();
  }

  function onSubmit(event) {
    event.preventDefault();
    var form = event.target;
    var dialog = form.closest('.dpo-app');
    var button = form.querySelector('.dpo-app-submit');
    var status = form.querySelector('.dpo-app-status');

    clearErrors(form);
    status.textContent = '';
    status.classList.remove('is-error');
    button.disabled = true;
    button.textContent = 'Отправляем…';

    var restore = function () {
      button.disabled = false;
      button.textContent = 'Отправить заявку';
    };

    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(collect(form)),
    })
      .then(function (response) {
        return response
          .json()
          .catch(function () {
            return {};
          })
          .then(function (body) {
            return { status: response.status, body: body };
          });
      })
      .then(function (result) {
        if (result.status === 200) {
          showDone(dialog);
          return;
        }
        restore();
        if (result.status === 400 && result.body.fields) {
          showErrors(form, result.body.fields);
          status.classList.add('is-error');
          status.textContent = 'Проверьте отмеченные поля.';
          return;
        }
        status.classList.add('is-error');
        status.textContent =
          result.status === 429
            ? 'Слишком много попыток подряд. Подождите минуту и отправьте ещё раз.'
            : 'Не удалось отправить заявку. Попробуйте ещё раз или позвоните: ' + FALLBACK_PHONE;
      })
      .catch(function () {
        restore();
        status.classList.add('is-error');
        // Сюда попадаем при обрыве сети и при недоступном приёмнике. Молчать
        // здесь нельзя: человек уверен, что заявку получили.
        status.textContent =
          'Заявка не отправлена – нет связи с сервером. Попробуйте ещё раз или позвоните: ' + FALLBACK_PHONE;
      });
  }

  // Делегирование: кнопки могут появиться после загрузки (карточки каталога
  // и лента программ рисуются скриптом). Форму открывают два вида триггеров:
  // [data-application] – заявка на программу, и [data-application-topic] с
  // НЕПУСТОЙ темой – карточки обращений «Куда пойти дальше». Пустая тема
  // означает обычную ссылку, её не перехватываем.
  document.addEventListener('click', function (event) {
    var trigger = event.target.closest('[data-application],[data-application-topic]');
    if (!trigger) return;
    if (!trigger.hasAttribute('data-application') && !trigger.getAttribute('data-application-topic')) {
      return;
    }
    event.preventDefault();
    openDialog(trigger);
  });
})();
