(function () {
'use strict';
var STYLES_ID = 'dpo-sheet-gesture-styles';
function injectStyles() {
if (document.getElementById(STYLES_ID)) return;
var style = document.createElement('style');
style.id = STYLES_ID;
style.textContent = [
'.dpo-sheet-handle{display:none}',
'@media (pointer:coarse){',
'.dpo-sheet-handle{display:block;width:36px;height:4px;border-radius:999px;',
'background:rgb(33 30 27 / .18);margin:-6px auto 12px;touch-action:none}',
'html.vi-mode .dpo-sheet-handle{background:#000 !important}',
'}',
'@media (prefers-reduced-motion:reduce){.dpo-sheet-handle{display:none !important}}',
].join('');
document.head.appendChild(style);
}
function attach(opts) {
if (!window.matchMedia('(pointer: coarse)').matches) return null;
if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
var root = opts.root;
var sheet = opts.sheet;
if (!root || !sheet) return null;
injectStyles();
var handle = document.createElement('span');
handle.className = 'dpo-sheet-handle';
handle.setAttribute('aria-hidden', 'true');
sheet.insertBefore(handle, sheet.firstChild);
var grips = opts.grip ? sheet.querySelectorAll(opts.grip) : [];
for (var i = 0; i < grips.length; i++) grips[i].style.touchAction = 'none';
var y = 0;
var vel = 0;
var raf = null;
var dragging = false;
var history = [];
var grab = 0;
function setY(value) {
y = value;
sheet.style.transform = value ? 'translateY(' + value.toFixed(2) + 'px)' : '';
var fade = Math.max(0, 1 - value / (sheet.offsetHeight || 480));
root.style.opacity = value > 0 ? String(0.35 + 0.65 * fade) : '';
}
function reset() {
if (raf) { cancelAnimationFrame(raf); raf = null; }
dragging = false;
vel = 0;
sheet.style.transition = '';
root.style.transition = '';
setY(0);
sheet.style.transform = '';
root.style.opacity = '';
}
function rubber(overshoot) {
var dim = 300, c = 0.55;
return (overshoot * dim * c) / (dim + c * Math.abs(overshoot));
}
function spring(target, response, onSettle) {
var k = Math.pow((2 * Math.PI) / response, 2);
var c = 2 * Math.sqrt(k);
var prev = performance.now();
if (raf) cancelAnimationFrame(raf);
function step(now) {
var dt = Math.min(32, now - prev) / 1000;
prev = now;
var a = k * (target - y) - c * vel;
vel += a * dt;
setY(y + vel * dt);
if (Math.abs(target - y) < 0.5 && Math.abs(vel) < 20) {
setY(target);
raf = null;
if (onSettle) onSettle();
return;
}
raf = requestAnimationFrame(step);
}
raf = requestAnimationFrame(step);
}
root.addEventListener('pointerdown', function (e) {
if (!e.isPrimary) return;
var inGrip = e.target === handle ||
(opts.grip && e.target.closest && e.target.closest(opts.grip));
if (!inGrip) return;
dragging = true;
if (raf) { cancelAnimationFrame(raf); raf = null; }
grab = e.clientY - y;
history = [{ t: e.timeStamp, y: y }];
sheet.style.transition = 'none';
root.style.transition = 'none';
sheet.setPointerCapture(e.pointerId);
e.preventDefault();
});
root.addEventListener('pointermove', function (e) {
if (!dragging || !e.isPrimary) return;
var raw = e.clientY - grab;
setY(raw >= 0 ? raw : -rubber(-raw));
history.push({ t: e.timeStamp, y: raw });
while (history.length > 6 || e.timeStamp - history[0].t > 100) history.shift();
});
function release(e) {
if (!dragging || !e.isPrimary) return;
dragging = false;
var last = history[history.length - 1];
var first = history[0];
vel = last && first && last.t > first.t
? ((last.y - first.y) / (last.t - first.t)) * 1000
: 0;
var projected = y + (vel / 1000) * 0.998 / (1 - 0.998);
var dismissAt = Math.max(140, (sheet.offsetHeight || 480) * 0.4);
if (projected > dismissAt && vel > -100) {
var exit = window.innerHeight - sheet.getBoundingClientRect().top + 40;
spring(exit, 0.3, function () {
root.style.transition = '';
opts.onClose();
root.style.opacity = '';
});
} else {
spring(0, 0.35, function () {
sheet.style.transition = '';
root.style.transition = '';
sheet.style.transform = '';
root.style.opacity = '';
});
}
}
root.addEventListener('pointerup', release);
root.addEventListener('pointercancel', release);
return { reset: reset };
}
window.dpoSheet = { attach: attach };
})();
