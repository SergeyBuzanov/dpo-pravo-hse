(function () {
'use strict';
var ENDPOINT = '/api/application';
var PRIVACY_URL = 'privacy.html';
var FALLBACK_PHONE = '+7 (495) 772-95-90';
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
var PROGRAMS_URL = 'content/programs-index.json';
var programIndex = null;
var programsTried = false;
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
'.dpo-app h2{font-family:"HSE Slab","Source Serif 4",Georgia,serif;font-size: clamp(1.375rem,3.4vw,1.75rem);',
'line-height:1.15;margin:0 48px 6px 0;font-weight:600}',
'.dpo-app h2:focus{outline:none}',
'.dpo-app h2:focus-visible{text-decoration:underline;text-decoration-color:rgb(var(--accent));text-decoration-thickness:2px;text-underline-offset:6px}',
'.dpo-app-program{font-size:0.9375rem;line-height:1.5;color:var(--ink-mute);margin:0 0 20px}',
'.dpo-app-close{position:absolute;top:11px;right:11px;width:44px;height:44px;border-radius:999px;',
'border:1px solid rgb(var(--ink) / .12);background:rgb(var(--surface));color:rgb(var(--ink));font-size:1.25rem;line-height:1;',
'cursor:pointer;transition:background .15s,border-color .15s}',
'.dpo-app-close:hover{background:var(--bg-tint)}',
'.dpo-app-row{display:grid;gap:14px;grid-template-columns:1fr 1fr;margin-bottom:14px}',
'@media (max-width:520px){.dpo-app-row{grid-template-columns:1fr}}',
'.dpo-app-field{display:flex;flex-direction:column;gap:6px;margin-bottom:12px}',
'.dpo-app-more{margin:2px 0 14px;border-top:1px solid rgb(var(--ink) / .1);border-bottom:1px solid rgb(var(--ink) / .1)}',
'.dpo-app-more summary{display:flex;align-items:center;gap:8px;min-height:44px;cursor:pointer;',
'font-size:0.875rem;font-weight:600;color:rgb(var(--accent));list-style:none}',
'.dpo-app-more summary::-webkit-details-marker{display:none}',
'.dpo-app-more summary::after{content:"";width:8px;height:8px;border-right:1.6px solid currentColor;',
'border-bottom:1.6px solid currentColor;transform:rotate(45deg) translate(-2px,-2px);transition:transform .15s}',
'.dpo-app-more[open] summary::after{transform:rotate(-135deg) translate(-3px,-3px)}',
'.dpo-app-more-body{padding:4px 0 6px}',
'.dpo-app [hidden]{display:none}',
'.dpo-app-row .dpo-app-field{margin-bottom:0}',
'.dpo-app label{font-size:0.8125rem;font-weight:600;letter-spacing:.01em}',
'.dpo-app .req{color:rgb(var(--accent))}',
'.dpo-app input[type=text],.dpo-app input[type=tel],.dpo-app input[type=email],.dpo-app textarea,.dpo-app select{',
'font:inherit;font-size:0.9375rem;color:rgb(var(--ink));background:rgb(var(--surface));border:1px solid rgb(var(--ink) / .5);',
'border-radius:10px;padding:11px 13px;width:100%;transition:border-color .15s,box-shadow .15s}',
'.dpo-app textarea{min-height:88px;resize:vertical;font-family:inherit}',
'.dpo-app ::placeholder{color:var(--ink-mute);opacity:1}',
'.dpo-app input:focus-visible,.dpo-app textarea:focus-visible,.dpo-app select:focus-visible{outline:none;border-color:rgb(var(--accent));',
'box-shadow:0 0 0 3px rgb(var(--accent) / .18)}',
'.dpo-app [aria-invalid=true]{border-color:#B00020;background:rgba(176,0,32,.05)}',
'.dpo-app-err{font-size:0.8125rem;line-height:1.4;color:#B00020;margin:0}',
'.dpo-app-err:empty{display:none}',
'.dpo-app-check{display:flex;gap:9px;align-items:flex-start;font-size:0.9375rem;line-height:1.4;cursor:pointer;padding:4px 0}',
'.dpo-app-check input{margin:2px 0 0;width:17px;height:17px;accent-color:rgb(var(--accent));flex:none}',
'.dpo-app-consent{display:flex;gap:10px;align-items:flex-start;font-size:0.8125rem;line-height:1.5;',
'color:var(--ink-soft);margin:6px 0 4px;cursor:pointer}',
'.dpo-app-consent a{color:rgb(var(--accent))}',
'.dpo-app-submit{margin-top:18px;width:100%;font:inherit;font-size:0.9375rem;font-weight:600;color:rgb(var(--surface));',
'background:rgb(var(--accent));border:0;border-radius:999px;padding:14px 20px;cursor:pointer;',
'transition:background .15s,transform .12s}',
'.dpo-app-submit:hover{background:#1145AA}',
'.dpo-app-submit:active{transform:scale(.985)}',
'.dpo-app-submit[disabled]{opacity:.6;cursor:progress}',
'.dpo-app-note{font-size:0.75rem;line-height:1.5;color:var(--ink-mute);margin:12px 0 0;text-align:center}',
'.dpo-app-status{margin:14px 0 0;font-size:0.9375rem;line-height:1.5;border-radius:10px;padding:0}',
'.dpo-app-status:not(:empty){padding:12px 14px}',
'.dpo-app-status.is-error{background:rgba(176,0,32,.06);color:#B00020;',
'border:1px solid rgba(176,0,32,.22)}',
'.dpo-app-done{padding:4px 0}',
'.dpo-app-done h2{margin-bottom:10px}',
'.dpo-app-done p{font-size:0.9375rem;line-height:1.6;color:var(--ink-soft);margin:0 0 10px}',
'.dpo-app-done-program{background:var(--bg-tint);border:1px solid rgb(var(--ink) / .1);',
'border-radius:10px;padding:12px 14px;font-size:0.9375rem;line-height:1.5;color:rgb(var(--ink));margin:0 0 14px}',
'.dpo-app-done-program b{font-weight:600}',
'.dpo-app-next{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}',
'.dpo-app-next a{display:inline-flex;align-items:center;min-height:44px;padding:0 20px;border-radius:999px;',
'font-size:0.875rem;font-weight:600;text-decoration:none;color:rgb(var(--accent));background:rgb(var(--surface));',
'border:1px solid rgb(var(--accent) / .3);transition:background .15s,border-color .15s}',
'.dpo-app-next a:hover{background:rgb(var(--accent));border-color:rgb(var(--accent));color:rgb(var(--surface))}',
'html.vi-mode .dpo-app-next a{border:2px solid #000}',
'.dpo-app-trap{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}',
'@media (prefers-reduced-motion:reduce){.dpo-app-backdrop,.dpo-app{transition:none}',
'.dpo-app-submit:active{transform:none}}',
'html.vi-mode .dpo-app{background:#fff !important;border:2px solid #000 !important}',
'html.vi-mode .dpo-app input,html.vi-mode .dpo-app textarea,html.vi-mode .dpo-app select{',
'background:#fff !important;border:2px solid #000 !important}',
'html.vi-mode .dpo-app-done-program{background:#fff !important;border:2px solid #000 !important}',
'html.vi-mode .dpo-app-backdrop{background:rgba(0,0,0,.8) !important}',
'html.vi-mode .dpo-app :focus-visible{outline:3px solid #000 !important;outline-offset:2px}',
].join('');
var FOCUSABLE =
'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select,summary,[tabindex]:not([tabindex="-1"])';
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
function privacyHref() {
return /\/programs\//.test(location.pathname) ? '../' + PRIVACY_URL : PRIVACY_URL;
}
function programsHref() {
return /\/programs\//.test(location.pathname) ? '../' + PROGRAMS_URL : PROGRAMS_URL;
}
function absoluteUrl(href) {
if (!href) return location.href;
try {
return new URL(href, location.href).href;
} catch (e) {
return href;
}
}
function fillPrograms(select, items) {
if (!select || !items || !items.length) return;
if (select.dataset.filled === '1') return;
var groups = {};
var order = [];
items.forEach(function (item) {
var key = item.sphere || 'Другие программы';
if (!groups[key]) {
groups[key] = [];
order.push(key);
}
groups[key].push(item);
});
order.forEach(function (key) {
var group = el('optgroup', { label: key });
groups[key].forEach(function (item) {
var option = el('option', { value: item.id, text: item.title });
option.dataset.url = item.url || '';
group.appendChild(option);
});
select.appendChild(group);
});
select.dataset.filled = '1';
}
function loadPrograms(done) {
if (programIndex || programsTried) {
done(programIndex);
return;
}
programsTried = true;
if (typeof fetch !== 'function') {
done(null);
return;
}
fetch(programsHref(), { credentials: 'omit' })
.then(function (response) {
return response.ok ? response.json() : null;
})
.then(function (body) {
programIndex = body && Array.isArray(body.programs) && body.programs.length ? body.programs : null;
done(programIndex);
})
.catch(function () {
done(null);
});
}
var LIVE_RULES = {
phone: function (v) {
if (!/^[0-9+()\-\s.]+$/.test(v)) return 'В телефоне допустимы только цифры, пробелы и знаки + ( ) -';
var digits = v.replace(/\D/g, '').length;
if (digits < 10 || digits > 15) return 'Проверьте телефон: нужен номер с кодом страны или города.';
return '';
},
email: function (v) {
return /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/.test(v) ? '' : 'Проверьте адрес почты: похоже, в нём опечатка.';
},
};
function liveCheck(input) {
var rule = LIVE_RULES[input.name];
var box = document.getElementById('dpo-app-' + input.name + '-err');
if (!rule || !box) return;
var value = input.value.trim();
var message = value ? rule(value) : '';
box.textContent = message;
if (message) input.setAttribute('aria-invalid', 'true');
else input.removeAttribute('aria-invalid');
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
if (LIVE_RULES[name]) {
input.addEventListener('blur', function () { liveCheck(input); });
input.addEventListener('input', function () { if (input.hasAttribute('aria-invalid')) liveCheck(input); });
}
return el('div', { class: 'dpo-app-field' }, [
el('label', { for: 'dpo-app-' + name, html: label + (required ? ' <span class="req">*</span>' : '') }),
input,
el('p', { class: 'dpo-app-err', id: 'dpo-app-' + name + '-err' }),
]);
}
function buildForm() {
var sources = el(
'select',
{ id: 'dpo-app-sources', name: 'sources' },
[el('option', { value: '', text: 'Не выбрано' })].concat(
SOURCES.map(function (pair) {
return el('option', { value: pair[0], text: pair[1] });
}),
),
);
var otherField = el('div', { class: 'dpo-app-field', hidden: 'hidden', id: 'dpo-app-other-wrap' }, [
el('label', { for: 'dpo-app-sourceOther', text: 'Уточните, откуда узнали' }),
el('input', { type: 'text', id: 'dpo-app-sourceOther', name: 'sourceOther', autocomplete: 'off' }),
]);
var programSelect = el('select', {
id: 'dpo-app-program',
name: 'program',
'aria-describedby': 'dpo-app-program-err',
}, [el('option', { value: '', text: 'Ещё не выбрал(а) – помогите подобрать' })]);
var programField = el('div', { class: 'dpo-app-field', id: 'dpo-app-program-wrap', hidden: 'hidden' }, [
el('label', { for: 'dpo-app-program', text: 'Программа' }),
programSelect,
el('p', { class: 'dpo-app-err', id: 'dpo-app-program-err' }),
]);
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
var kindSelect = el(
'select',
{ id: 'dpo-app-kind', name: 'applicantType' },
[
el('option', { value: 'personal', text: 'За себя' }),
el('option', { value: 'corporate', text: 'От организации – обучение сотрудников' }),
],
);
kindSelect.addEventListener('change', function () {
applyKind(kindSelect.value, true);
});
var kindField = el('div', { class: 'dpo-app-field', id: 'dpo-app-kind-wrap' }, [
el('label', { for: 'dpo-app-kind', text: 'Кто подаёт заявку' }),
kindSelect,
]);
var corpBlock = el('div', { class: 'dpo-app-row', id: 'dpo-app-corp', hidden: 'hidden' }, [
field('employeesCount', 'Сколько сотрудников обучить', 'text', false),
field('timeframe', 'Желаемые сроки', 'text', false),
]);
corpBlock.querySelector('#dpo-app-employeesCount').placeholder = 'например: 8 или 10–15';
corpBlock.querySelector('#dpo-app-timeframe').placeholder = 'например: октябрь – декабрь';
var form = el('form', { class: 'dpo-app-form', novalidate: 'novalidate' }, [
el('div', { class: 'dpo-app-field' }, [
el('label', { for: 'dpo-app-topic', text: 'Тема обращения' }),
topicSelect,
]),
kindField,
corpBlock,
programField,
el('div', { class: 'dpo-app-row' }, [
field('lastName', 'Фамилия', 'text', true, 'family-name'),
field('firstName', 'Имя', 'text', true, 'given-name'),
]),
el('div', { class: 'dpo-app-row' }, [
field('phone', 'Телефон', 'tel', true, 'tel'),
field('email', 'Электронная почта', 'email', true, 'email'),
]),
el('details', { class: 'dpo-app-more' }, [
el('summary', { text: 'Ещё о себе: должность, место работы, откуда узнали' }),
el('div', { class: 'dpo-app-more-body' }, [
el('div', { class: 'dpo-app-row' }, [
field('position', 'Должность', 'text', false, 'organization-title'),
field('company', 'Место работы', 'text', false, 'organization'),
]),
el('div', { class: 'dpo-app-field' }, [
el('label', { for: 'dpo-app-sources', text: 'Как вы узнали о нас?' }),
sources,
]),
otherField,
el('label', { class: 'dpo-app-check' }, [
el('input', { type: 'checkbox', name: 'noAnnouncements' }),
el('span', { text: 'Не присылать анонсы новых программ и мероприятий Центра ДПО' }),
]),
]),
]),
el('div', { class: 'dpo-app-field' }, [
el('label', { for: 'dpo-app-comment', text: 'Комментарий или вопрос' }),
el('textarea', {
id: 'dpo-app-comment',
name: 'comment',
rows: '3',
placeholder: 'Например: интересует корпоративный формат для группы из восьми юристов',
}),
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
sources.addEventListener('change', function () {
var other = sources.value === 'other';
otherField.hidden = !other;
if (other) otherField.querySelector('input').focus();
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
function applyTopic(topic) {
if (!backdrop) return;
context.topic = topic;
var title = backdrop.querySelector('h2');
if (title) title.textContent = TOPIC_TITLES[topic] || TOPIC_TITLES.program;
var wrap = backdrop.querySelector('#dpo-app-program-wrap');
var select = backdrop.querySelector('#dpo-app-program');
var hasList = select && select.options.length > 1;
if (wrap) wrap.hidden = !(topic === 'program' && hasList);
var kindWrap = backdrop.querySelector('#dpo-app-kind-wrap');
if (kindWrap) kindWrap.hidden = topic !== 'program';
var corp = backdrop.querySelector('#dpo-app-corp');
if (corp) {
var kindSel = backdrop.querySelector('#dpo-app-kind');
corp.hidden = topic !== 'program' || !kindSel || kindSel.value !== 'corporate';
}
var caption = backdrop.querySelector('.dpo-app-program');
if (!caption) return;
if (topic === 'program') {
caption.textContent = hasList
? ''
: context.programTitle
? 'Программа: ' + context.programTitle
: 'Расскажите о себе – учебный офис свяжется с вами и подберёт программу.';
caption.hidden = hasList;
} else {
caption.hidden = false;
caption.textContent = TOPIC_HINTS[topic] || '';
}
}
function applyKind(kind, focusFirst) {
if (!backdrop) return;
context.kind = kind;
var corp = backdrop.querySelector('#dpo-app-corp');
if (!corp) return;
var corporate = kind === 'corporate' && (context.topic || 'program') === 'program';
corp.hidden = !corporate;
if (corporate) {
var more = backdrop.querySelector('.dpo-app-more');
if (more) more.open = true;
if (focusFirst) {
var firstCorp = corp.querySelector('input');
if (firstCorp) firstCorp.focus();
}
}
}
function preselectProgram() {
if (!backdrop) return;
var select = backdrop.querySelector('#dpo-app-program');
if (!select) return;
if (!context.programId) {
select.value = '';
applyTopic(context.topic);
return;
}
var known = select.querySelector('option[value="' + String(context.programId).replace(/"/g, '') + '"]');
if (!known && context.programTitle) {
known = el('option', { value: context.programId, text: context.programTitle });
known.dataset.url = context.programUrl || '';
select.appendChild(known);
}
if (known) select.value = context.programId;
applyTopic(context.topic);
}
function openDialog(trigger) {
injectStyles();
lastTrigger = trigger;
context = {
programId: trigger.getAttribute('data-program-id') || '',
programTitle: trigger.getAttribute('data-program-title') || '',
programUrl: trigger.getAttribute('data-program-url') || location.href,
topic: trigger.getAttribute('data-application-topic') || 'program',
kind: trigger.getAttribute('data-application-kind') || 'personal',
};
if (!backdrop) {
backdrop = buildDialog();
document.body.appendChild(backdrop);
sheetCtl = window.dpoSheet
? window.dpoSheet.attach({
root: backdrop,
sheet: backdrop.querySelector('.dpo-app'),
grip: '#dpo-app-title, .dpo-app-program',
onClose: closeDialog,
})
: null;
}
if (sheetCtl) sheetCtl.reset();
var topicSelect = backdrop.querySelector('#dpo-app-topic');
if (topicSelect) topicSelect.value = context.topic;
applyTopic(context.topic);
var kindSelect = backdrop.querySelector('#dpo-app-kind');
if (kindSelect) kindSelect.value = context.kind;
applyKind(context.kind, false);
loadPrograms(function (items) {
if (!backdrop) return;
fillPrograms(backdrop.querySelector('#dpo-app-program'), items);
preselectProgram();
});
document.addEventListener('keydown', onKeydown, true);
document.documentElement.style.overflow = 'hidden';
hideBackground(true);
requestAnimationFrame(function () {
backdrop.classList.add('is-open');
});
var title = backdrop.querySelector('#dpo-app-title');
if (title) {
title.setAttribute('tabindex', '-1');
title.focus();
}
}
function hideBackground(on) {
if (!backdrop) return;
Array.prototype.forEach.call(document.body.children, function (node) {
if (node === backdrop) return;
if (on) {
node.setAttribute('aria-hidden', 'true');
if ('inert' in node) node.inert = true;
} else {
node.removeAttribute('aria-hidden');
if ('inert' in node) node.inert = false;
}
});
}
var sheetCtl = null;
function closeDialog() {
if (!backdrop) return;
hideBackground(false);
backdrop.classList.remove('is-open');
document.removeEventListener('keydown', onKeydown, true);
document.documentElement.style.overflow = '';
var node = backdrop;
window.setTimeout(function () {
if (node.classList.contains('is-open')) return;
if (node && node.parentNode) node.parentNode.removeChild(node);
if (node === backdrop) backdrop = null;
}, 220);
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
fields.forEach(function (item) {
var box = form.querySelector('#dpo-app-' + item.field + '-err');
var input = form.querySelector('#dpo-app-' + item.field);
if (box) box.textContent = item.message;
if (input) input.setAttribute('aria-invalid', 'true');
});
var first = form.querySelector('[aria-invalid="true"]');
if (first) first.focus();
}
function chosenProgram(form) {
var select = form.querySelector('#dpo-app-program');
var wrap = form.querySelector('#dpo-app-program-wrap');
if (select && wrap && !wrap.hidden && select.value) {
var option = select.options[select.selectedIndex];
return {
id: select.value,
title: option ? option.textContent : '',
url: absoluteUrl((option && option.dataset.url) || ''),
};
}
return {
id: context.programId || '',
title: context.programTitle || '',
url: context.programId ? absoluteUrl(context.programUrl) : context.programUrl || location.href,
};
}
function collect(form) {
var data = new FormData(form);
var program = chosenProgram(form);
return {
topic: data.get('topic') || 'program',
applicantType: data.get('applicantType') || 'personal',
employeesCount: data.get('employeesCount') || '',
timeframe: data.get('timeframe') || '',
firstName: data.get('firstName') || '',
lastName: data.get('lastName') || '',
phone: data.get('phone') || '',
email: data.get('email') || '',
position: data.get('position') || '',
company: data.get('company') || '',
sources: data.getAll('sources').filter(Boolean),
sourceOther: data.get('sourceOther') || '',
comment: data.get('comment') || '',
noAnnouncements: Boolean(data.get('noAnnouncements')),
consent: Boolean(data.get('consent')),
website: data.get('website') || '',
programId: program.id,
programTitle: program.title,
programUrl: program.url,
};
}
function showDone(dialog, program) {
var form = dialog.querySelector('form');
if (form) form.remove();
var isProgram = (context.topic || 'program') === 'program';
var catalogHref = /\/programs\//.test(location.pathname)
? '../Каталог программ.html'
: 'Каталог программ.html';
var named =
isProgram && program && program.title
? el('p', {
class: 'dpo-app-done-program',
html: 'Заявка на программу <b>' + escapeText(program.title) + '</b>',
})
: null;
var done = el('div', { class: 'dpo-app-done' }, [
named,
el('p', {
text: isProgram
? 'Заявка принята. Учебный офис Центра ДПО свяжется с вами по указанному телефону ' +
'или почте, чтобы подтвердить участие и рассказать о ближайшем наборе.'
: 'Обращение принято и записано. Учебный офис Центра ДПО прочитает его и свяжется ' +
'с вами, если потребуется уточнение.',
}),
isProgram ? el('p', { text: 'Обычно это занимает один рабочий день. Оплата проходит на стороне НИУ ВШЭ – её реквизиты пришлёт учебный офис.' }) : null,
el('div', { class: 'dpo-app-next' }, [
el('a', { href: catalogHref, text: 'Посмотреть другие программы' }),
]),
]);
dialog.querySelector('h2').textContent = 'Спасибо!';
if (navigator.vibrate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
navigator.vibrate(10);
}
var caption = dialog.querySelector('.dpo-app-program');
if (caption) caption.remove();
dialog.appendChild(done);
dialog.querySelector('.dpo-app-close').focus();
}
function escapeText(value) {
var box = document.createElement('span');
box.textContent = String(value == null ? '' : value);
return box.innerHTML;
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
var program = chosenProgram(form);
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
showDone(dialog, program);
return;
}
restore();
if (result.status === 400 && result.body.fields) {
showErrors(form, result.body.fields);
status.classList.add('is-error');
status.textContent = 'Проверьте отмеченные поля.';
return;
}
reportFailure(result.status);
status.classList.add('is-error');
status.textContent =
result.status === 429
? 'Слишком много попыток подряд. Подождите минуту и отправьте ещё раз.'
: 'Не удалось отправить заявку. Попробуйте ещё раз или позвоните: ' + FALLBACK_PHONE;
})
.catch(function () {
reportFailure(0);
restore();
status.classList.add('is-error');
status.textContent =
'Заявка не отправлена – нет связи с сервером. Попробуйте ещё раз или позвоните: ' + FALLBACK_PHONE;
});
}
function reportFailure(httpStatus) {
if (typeof window.__dpoAnalyticsEvent === 'function') {
window.__dpoAnalyticsEvent('form_error', { label: 'http ' + httpStatus });
}
}
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
