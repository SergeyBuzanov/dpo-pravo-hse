(function () {
'use strict';
var CATALOG_URL = 'content/bot-catalog.json';
var FAQ_URL = 'content/bot-faq.json';
var GREETING = 'Спрашивайте про программы: тему, формат, цену или ближайший старт.';
var HINTS = ['Подобрать программу', 'Онлайн', 'Какой документ выдают', 'Ближайшие старты', 'Сколько стоит'];
var TYPE_LABELS = [['ПК', 'Повышение квалификации'], ['ПП', 'Переподготовка']];
var REDUCED_MOTION = typeof window.matchMedia === 'function' &&
window.matchMedia('(prefers-reduced-motion: reduce)').matches;
var GAP_TEXT = 'Об этом на сайте не написано, а придумывать я не стану. Оставьте заявку – ответит учебный офис.';
var FAIL_TEXT = 'Не получилось загрузить программы. Напишите нам – ответим.';
var WAIT_TEXT = 'Секунду, гружу программы…';
var CSS = [
'#dpoBotPanel{position:fixed;right:16px;bottom:env(safe-area-inset-bottom,0px);',
"font-family:'HSE Sans','IBM Plex Sans',system-ui,sans-serif;",
'z-index:930;width:min(380px,calc(100vw - 32px));max-height:min(70vh,560px);',
'display:flex;flex-direction:column;background:var(--bg);color:rgb(var(--ink));',
'border:1px solid rgb(var(--ink) / .12);border-radius:18px 18px 0 0;overflow:hidden;',
'box-shadow:0 24px 60px rgb(var(--ink) / .28);opacity:0;transform:translateY(28px);',
'transition:opacity .22s cubic-bezier(.22,1,.36,1),transform .22s cubic-bezier(.22,1,.36,1)}',
'#dpoBotPanel.is-open{opacity:1;transform:none}',
'body:has(#dpoBotPanel) #channelInvite,body:has(#dpoBotPanel) #channelInviteBadge{display:none!important}',
'body:has(#dpoBotPanel) .dpo-mobile-cta,body:has(#dpoBotPanel) .mobile-cta,',
'body:has(#dpoBotPanel) .buy-bar{display:none!important}',
'#dpoBotHead{display:flex;align-items:center;justify-content:space-between;gap:8px;',
'padding:10px 14px 8px 14px;border-bottom:1px solid rgb(var(--ink) / .1);flex:none}',
'.dpo-bot-brand{display:flex;align-items:center;gap:10px;min-width:0}',
'.dpo-bot-crow{width:56px;flex:none}',
'html.vi-mode .dpo-bot-crow{display:none}',
'.dpo-bot-typing{display:inline-flex;align-items:center;gap:5px;align-self:flex-start;',
'padding:12px 14px;border-radius:14px;background:var(--bg-tint)}',
'.dpo-bot-typing i{width:7px;height:7px;border-radius:50%;background:rgb(var(--ink) / .45);',
'animation:dpoBotDot 1.05s infinite ease-in-out}',
'.dpo-bot-typing i:nth-child(2){animation-delay:.15s}',
'.dpo-bot-typing i:nth-child(3){animation-delay:.3s}',
'@keyframes dpoBotDot{0%,60%,100%{transform:translateY(0);opacity:.45}30%{transform:translateY(-4px);opacity:1}}',
'@media (prefers-reduced-motion:reduce){.dpo-bot-typing i{animation:none}}',
'#dpoBotHead h2{margin:0;font-family:"HSE Slab","Source Serif 4",Georgia,serif;',
'font-size:1.1875rem;font-weight:600;line-height:1.3}',
'.dpo-bot-close{width:44px;height:44px;flex:none;border-radius:999px;border:0;',
'display:inline-flex;align-items:center;justify-content:center;',
'background:transparent;color:rgb(var(--ink));font-size:1.25rem;line-height:1;cursor:pointer;',
'transition:background .15s}',
'.dpo-bot-close:hover{background:var(--bg-tint)}',
'.dpo-bot-log{flex:1 1 auto;overflow-y:auto;padding:14px 18px;display:flex;flex-direction:column;gap:10px}',
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
'@media (max-width:700px){#dpoBotPanel{left:0;right:0;bottom:0;width:100%;',
'max-height:82vh;border-radius:18px 18px 0 0}}',
'@media (prefers-reduced-motion:reduce){#dpoBotPanel{transition:none}}',
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
function programCard(p) {
var link = el('a', { href: href(p.url), text: p.title });
var meta = [p.formatLabel, p.hours, p.priceLabel, p.start].filter(Boolean).join(' · ');
return el('article', { class: 'dpo-bot-card' }, [link, el('p', { text: meta })]);
}
function say(text) {
log.appendChild(el('p', { class: 'dpo-bot-say', text: text }));
}
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
if (out.answer.note) say(out.answer.note);
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
var failureShown = false;
function showFailure() {
if (failureShown) return;
failureShown = true;
respond(function () {
say(FAIL_TEXT);
applyButton();
});
}
function runWhenReady(action) {
var wasEmpty = queue.isEmpty();
var status = queue.run(function (loaded) {
respond(function () { action(loaded); });
}, showFailure, data);
if (status === 'queued' && wasEmpty) say(WAIT_TEXT);
scrollDown();
}
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
function hintsRow() {
var row = el('div', { class: 'dpo-bot-hints' });
HINTS.forEach(function (text) {
var button = el('button', { type: 'button', text: text });
button.addEventListener('click', function () { ask(text); });
row.appendChild(button);
});
return row;
}
function renderShell() {
say(GREETING);
log.appendChild(hintsRow());
}
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
if (document.querySelector('.dpo-app-backdrop')) return;
event.preventDefault();
close();
return;
}
trapFocus(event);
}
function setLaunchersExpanded(expanded) {
var nodes = document.querySelectorAll('[data-bot-open]');
for (var i = 0; i < nodes.length; i++) nodes[i].setAttribute('aria-expanded', String(expanded));
}
function topOf(node) {
if (!node) return null;
var rect = node.getBoundingClientRect();
return rect.height ? rect.top : null;
}
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
['body>.crow-mascot', '.crow-hit-btn', '#crow-vi-btn'].forEach(function (selector) {
var node = document.querySelector(selector);
if (node) node.style.bottom = value;
});
if (panel) panel.style.bottom = value;
}
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
if (!REDUCED_MOTION) headCrow.play('wave');
} catch (e) { headCrow = null; }
}
function reactHeadCrow(pointsAtApply) {
if (headCrow && headCrow.play) headCrow.play(pointsAtApply ? 'point' : 'nod');
}
function thinkHeadCrow() {
if (headCrow && headCrow.play) headCrow.play('think');
}
function destroyHeadCrow() {
if (headCrow && headCrow.destroy) headCrow.destroy();
headCrow = null;
}
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
var applyBefore = myLog.querySelectorAll('.dpo-bot-apply').length;
fn();
reactHeadCrow(myLog.querySelectorAll('.dpo-bot-apply').length > applyBefore);
scrollDown();
}, TYPING_MS);
}
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
if (!REDUCED_MOTION) window.crowMascot.play('runIn');
}
function close() {
if (!panel) return;
destroyHeadCrow();
panel.remove();
panel = null;
log = null;
setLaunchersExpanded(false);
document.removeEventListener('keydown', onKeydown, true);
showCrow();
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
mountHeadCrow(crowSlot);
setLaunchersExpanded(true);
document.addEventListener('keydown', onKeydown, true);
sheetCtl = window.dpoSheet
? window.dpoSheet.attach({ root: panel, sheet: panel, grip: '#dpoBotHead', onClose: close })
: null;
keepAboveBanners();
requestAnimationFrame(function () { if (panel) panel.classList.add('is-open'); });
renderShell();
var firstHint = panel.querySelector('.dpo-bot-hints button');
(firstHint || input).focus();
var myPanel = panel;
load(function (loaded) {
if (panel !== myPanel) return;
if (loaded) queue.resolve(loaded);
else queue.reject();
});
}
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
document.addEventListener('click', function (event) {
var trigger = event.target.closest('[data-bot-open]');
if (!trigger) return;
event.preventDefault();
open(trigger);
});
new MutationObserver(keepAboveBanners).observe(document, { childList: true, subtree: true });
window.addEventListener('resize', keepAboveBanners);
keepAboveBanners();
})();
