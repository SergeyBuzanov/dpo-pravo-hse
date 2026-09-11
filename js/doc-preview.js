(function () {
'use strict';
var CSS = [
'.doc-backdrop{position:fixed;inset:0;z-index:9000;display:flex;align-items:center;',
'justify-content:center;padding:max(16px,4vh) 16px;overflow-y:auto;',
'background:rgba(33,30,27,.62);opacity:0;',
"font-family:'HSE Sans','IBM Plex Sans',sans-serif;",
'transition:opacity .22s cubic-bezier(.22,1,.36,1)}',
'.doc-backdrop.is-open{opacity:1}',
'.doc-window{position:relative;width:100%;max-width:1100px;background:#FBF9F5;color:#211E1B;',
'border-radius:18px;box-shadow:0 24px 60px rgba(33,30,27,.28);padding:clamp(18px,3vw,28px);',
'transform:translateY(12px) scale(.985);transition:transform .22s cubic-bezier(.22,1,.36,1)}',
'.doc-backdrop.is-open .doc-window{transform:none}',
'.doc-window h2{font-family:"HSE Slab","Source Serif 4",Georgia,serif;font-weight:600;',
'font-size:clamp(1.25rem,2vw,1.4375rem);line-height:1.2;margin:0 48px 14px 0}',
'.doc-window h2:focus-visible{outline:none;box-shadow:0 3px 0 #1658DA}',
'.doc-close{position:absolute;top:14px;right:14px;width:40px;height:40px;border-radius:999px;',
'border:1px solid rgba(33,30,27,.14);background:#fff;color:#211E1B;font-size:1.125rem;',
'line-height:1;cursor:pointer;touch-action:manipulation}',
'.doc-close:focus-visible{outline:3px solid #1658DA;outline-offset:2px}',
'.doc-figure{margin:0;border:1px solid rgba(33,30,27,.14);border-radius:8px;overflow:hidden;',
'background:#fff;line-height:0}',
'.doc-figure img{display:block;width:100%;height:auto}',
'.doc-note{margin:12px 0 0;font-size:0.8125rem;color:#6B6459}',
'@media (prefers-reduced-motion: reduce){',
'.doc-backdrop,.doc-window{transition:none !important}}',
'html.vi-mode .doc-window{background:#fff !important}',
'html.vi-mode .doc-close{border:2px solid #000 !important;color:#000 !important}',
].join('');
var styled = false;
var backdrop = null;
var hidden = [];
var lastTrigger = null;
function injectCss() {
if (styled) return;
styled = true;
var el = document.createElement('style');
el.setAttribute('data-doc-preview', '');
el.textContent = CSS;
document.head.appendChild(el);
}
function onKey(e) {
if (!backdrop) return;
if (e.key === 'Escape') { e.preventDefault(); shut(); return; }
if (e.key !== 'Tab') return;
var close = backdrop.querySelector('.doc-close');
if (!close) return;
e.preventDefault();
close.focus();
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
setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 240);
if (lastTrigger && document.contains(lastTrigger)) lastTrigger.focus();
}
function open(btn) {
injectCss();
lastTrigger = btn;
var base = btn.getAttribute('data-doc-preview');
var ext = btn.getAttribute('data-doc-ext') || 'png';
var height = btn.getAttribute('data-doc-height') || '848';
var label = btn.getAttribute('data-doc-label') || 'Образец документа';
backdrop = document.createElement('div');
backdrop.className = 'doc-backdrop';
var win = document.createElement('div');
win.className = 'doc-window';
win.setAttribute('role', 'dialog');
win.setAttribute('aria-modal', 'true');
win.setAttribute('aria-labelledby', 'doc-title');
var h2 = document.createElement('h2');
h2.id = 'doc-title';
h2.tabIndex = -1;
h2.textContent = 'Образец: ' + label;
var close = document.createElement('button');
close.type = 'button';
close.className = 'doc-close';
close.setAttribute('aria-label', 'Закрыть образец');
close.textContent = '×';
var fig = document.createElement('figure');
fig.className = 'doc-figure';
var pic = document.createElement('picture');
var src = document.createElement('source');
src.setAttribute('srcset', base + '.webp');
src.setAttribute('type', 'image/webp');
var img = document.createElement('img');
img.setAttribute('width', '1200');
img.setAttribute('height', height);
img.setAttribute('decoding', 'async');
img.alt = 'Образец бланка: ' + label;
img.src = base + '.' + ext;
pic.appendChild(src);
pic.appendChild(img);
fig.appendChild(pic);
var note = document.createElement('p');
note.className = 'doc-note';
note.textContent = 'Незаполненный образец бланка НИУ ВШЭ.';
win.appendChild(close);
win.appendChild(h2);
win.appendChild(fig);
win.appendChild(note);
backdrop.appendChild(win);
document.body.appendChild(backdrop);
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
}
document.addEventListener('click', function (e) {
var btn = e.target.closest && e.target.closest('[data-doc-preview]');
if (!btn) return;
e.preventDefault();
open(btn);
});
})();
