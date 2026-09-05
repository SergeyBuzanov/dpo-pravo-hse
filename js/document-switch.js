(function () {
'use strict';
var ORDER = ['pk', 'pp', 'vo', 'cert'];
var current = 'pk';
function activate(key, focusTab) {
if (ORDER.indexOf(key) < 0) return;
var tabs = document.querySelectorAll('[data-dpo-doc]');
if (!tabs.length) return;
for (var i = 0; i < tabs.length; i++) {
var t = tabs[i];
var on = t.getAttribute('data-dpo-doc') === key;
t.classList.toggle('is-active', on);
t.setAttribute('aria-selected', on ? 'true' : 'false');
if (on) t.removeAttribute('tabindex');
else t.setAttribute('tabindex', '-1');
if (on && focusTab) t.focus();
}
var items = document.querySelectorAll('[data-dpo-doc-item]');
for (var j = 0; j < items.length; j++) {
var show = items[j].getAttribute('data-dpo-doc-item') === key;
items[j].classList.toggle('is-doc-current', show);
items[j].hidden = !show;
}
var view = document.getElementById('docView');
var activeTab = document.getElementById('docTab-' + key);
if (view && activeTab) view.setAttribute('aria-labelledby', activeTab.id);
current = key;
}
document.addEventListener('click', function (e) {
var target = e.target;
if (!target || !target.closest) return;
var tab = target.closest('[data-dpo-doc]');
if (tab) {
activate(tab.getAttribute('data-dpo-doc'));
return;
}
var view = target.closest('.dpo-doc-view');
if (view) {
activate(ORDER[(ORDER.indexOf(current) + 1) % ORDER.length]);
}
});
document.addEventListener('keydown', function (e) {
var tab = e.target && e.target.closest ? e.target.closest('[data-dpo-doc]') : null;
if (!tab) return;
var idx = ORDER.indexOf(tab.getAttribute('data-dpo-doc'));
var next = null;
if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = ORDER[(idx + 1) % ORDER.length];
else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = ORDER[(idx - 1 + ORDER.length) % ORDER.length];
else if (e.key === 'Home') next = ORDER[0];
else if (e.key === 'End') next = ORDER[ORDER.length - 1];
if (!next) return;
e.preventDefault();
activate(next, true);
});
var n = 0;
var timer = setInterval(function () {
var active = document.querySelector('[data-dpo-doc].is-active');
var stale = active && active.getAttribute('data-dpo-doc') !== current;
var items = document.querySelectorAll('[data-dpo-doc-item]');
for (var i = 0; i < items.length && !stale; i++) {
var mustShow = items[i].getAttribute('data-dpo-doc-item') === current;
if (items[i].classList.contains('is-doc-current') !== mustShow) stale = true;
}
if (stale) activate(current);
if (++n > 40) clearInterval(timer);
}, 250);
})();
