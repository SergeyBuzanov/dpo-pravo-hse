(function (global) {
'use strict';
function assetBase() {
return /\/programs\//.test(location.pathname) ? '../images/crow/' : 'images/crow/';
}
function injectStyle(edge, width, height) {
if (document.getElementById('crow-launcher-style')) return;
var style = document.createElement('style');
style.id = 'crow-launcher-style';
style.textContent =
'body>.crow-mascot{right:' + edge + 'px!important;bottom:0;pointer-events:none}' +
'.crow-hit-btn{position:fixed;right:' + edge + 'px;bottom:0;width:' + width + 'px;height:' + height + 'px;' +
'z-index:921;background:transparent;border:0;padding:0;margin:0;cursor:pointer;border-radius:16px}' +
'.crow-hit-btn:focus-visible{outline:none;box-shadow:0 0 0 2px #FBF9F5,0 0 0 4px rgb(var(--accent, 22 88 218))}' +
'.crow-hit-btn .visually-hidden{position:absolute;width:1px;height:1px;margin:-1px;padding:0;' +
'overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}' +
'html.crow-inline-live .crow-hit-btn{pointer-events:none}' +
'html.vi-mode .crow-hit-btn{display:none}' +
'#crow-vi-btn{display:none}' +
'html.vi-mode #crow-vi-btn{display:inline-flex;align-items:center;justify-content:center;' +
'position:fixed;right:' + edge + 'px;bottom:calc(16px + env(safe-area-inset-bottom, 0px));' +
'z-index:920;min-height:44px;padding:0 16px;border-radius:999px;cursor:pointer;' +
"font:600 0.8125rem/1 'HSE Sans','IBM Plex Sans',system-ui,sans-serif;" +
'background:#fff!important;color:#000!important;border:2px solid #000!important}';
(document.head || document.documentElement).appendChild(style);
}
function mount() {
if (!global.CrowMascot || global.crowMascot) return;
if (document.querySelector('.crow-hit-btn')) return;
var narrow = window.matchMedia('(max-width: 1023px)').matches;
var width = narrow ? 96 : 200;
var height = Math.round(width * 1465 / 1400);
var edge = narrow ? 8 : 24;
injectStyle(edge, width, height);
var hit = document.createElement('button');
hit.type = 'button';
hit.className = 'crow-hit-btn';
hit.setAttribute('data-bot-open', '');
var hitLabel = document.createElement('span');
hitLabel.className = 'visually-hidden';
hitLabel.textContent = 'Открыть поддержку';
hit.appendChild(hitLabel);
document.body.appendChild(hit);
var viBtn = document.createElement('button');
viBtn.type = 'button';
viBtn.id = 'crow-vi-btn';
viBtn.setAttribute('data-bot-open', '');
viBtn.textContent = 'Поддержка';
document.body.appendChild(viBtn);
global.crowMascot = global.CrowMascot.mount({
assetPath: assetBase(),
anchor: 'bottom-right',
width: width,
zIndex: 920,
idleSeconds: 14,
idleAnim: document.getElementById('filters') ? 'helpQ' : 'askQ'
});
}
function whenIdle(fn) {
var ran = false;
function run() {
if (ran) return;
ran = true;
fn();
}
if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 3500 });
else setTimeout(run, 1200);
var evs = ['pointerdown', 'keydown', 'scroll', 'touchstart'];
for (var i = 0; i < evs.length; i++) {
window.addEventListener(evs[i], run, { once: true, passive: true });
}
}
function boot() {
function start() { whenIdle(mount); }
if (document.readyState === 'complete') start();
else window.addEventListener('load', start);
}
global.CrowLauncher = { mount: mount, boot: boot };
boot();
})(window);
