(function () {
'use strict';
var STEP_RATIO = 0.86;
function trackFor(btn) {
var id = btn.getAttribute('aria-controls');
return id ? document.getElementById(id) : null;
}
function atStart(track) {
return track.scrollLeft <= 1;
}
function atEnd(track) {
return track.scrollLeft + track.clientWidth >= track.scrollWidth - 1;
}
function syncButtons(track) {
if (!track.id) return;
var btns = document.querySelectorAll('[aria-controls="' + track.id + '"][data-dpo-scroll]');
var looped = track.hasAttribute('data-dpo-loop');
for (var i = 0; i < btns.length; i++) {
if (looped) {
btns[i].disabled = false;
continue;
}
var dir = btns[i].getAttribute('data-dpo-scroll');
var spent = dir === 'prev' ? atStart(track) : atEnd(track);
btns[i].disabled = spent || track.scrollWidth <= track.clientWidth + 1;
}
}
document.addEventListener('click', function (e) {
var btn = e.target && e.target.closest ? e.target.closest('[data-dpo-scroll]') : null;
if (!btn) return;
var track = trackFor(btn);
if (!track) return;
e.preventDefault();
var delta = Math.max(240, Math.round(track.clientWidth * STEP_RATIO));
if (track.hasAttribute('data-dpo-loop')) {
track._dpoHold = (window.performance ? performance.now() : Date.now()) + 1200;
}
track.scrollBy({
left: btn.getAttribute('data-dpo-scroll') === 'prev' ? -delta : delta,
behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
});
});
document.addEventListener('scroll', function (e) {
var t = e.target;
if (t && t.classList && t.classList.contains('dpo-track')) syncButtons(t);
}, true);
window.addEventListener('resize', function () {
var tracks = document.querySelectorAll('.dpo-track');
for (var i = 0; i < tracks.length; i++) syncButtons(tracks[i]);
});
var n = 0;
var timer = setInterval(function () {
var tracks = document.querySelectorAll('.dpo-track');
for (var i = 0; i < tracks.length; i++) syncButtons(tracks[i]);
if (++n > 40) clearInterval(timer);
}, 250);
var SPEED_PX_PER_SEC = 26;
var COARSE = window.matchMedia('(hover: none), (pointer: coarse)');
function loopedTracks() {
return document.querySelectorAll('[data-dpo-loop]');
}
function paused(track) {
return track.hasAttribute('data-dpo-stopped') ||
track.matches(':hover') || track.contains(document.activeElement);
}
document.addEventListener('click', function (e) {
var btn = e.target && e.target.closest ? e.target.closest('[data-dpo-pause]') : null;
if (!btn) return;
var track = trackFor(btn);
if (!track) return;
var stopped = track.toggleAttribute('data-dpo-stopped');
var btns = document.querySelectorAll('[aria-controls="' + track.id + '"][data-dpo-pause]');
for (var i = 0; i < btns.length; i++) {
btns[i].setAttribute('aria-pressed', stopped ? 'true' : 'false');
btns[i].setAttribute('aria-label', stopped ? 'Запустить ленту' : 'Остановить ленту');
btns[i].classList.toggle('is-stopped', stopped);
}
});
var visible = typeof WeakSet === 'function' ? new WeakSet() : null;
var io = null;
if (visible && typeof IntersectionObserver === 'function') {
io = new IntersectionObserver(function (entries) {
for (var i = 0; i < entries.length; i++) {
if (entries[i].isIntersecting) visible.add(entries[i].target);
else visible.delete(entries[i].target);
}
}, { threshold: 0.15 });
}
function inView(track) {
if (!io) return true;
if (!track._dpoObserved) {
track._dpoObserved = true;
io.observe(track);
return false;
}
return visible.has(track);
}
var last = null;
function step(now) {
var dt = last == null ? 0 : Math.min((now - last) / 1000, 0.05);
last = now;
if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches &&
!COARSE.matches &&
!document.documentElement.classList.contains('vi-mode') &&
!document.hidden) {
var tracks = loopedTracks();
for (var i = 0; i < tracks.length; i++) {
var t = tracks[i];
if (!inView(t) || paused(t)) continue;
if (t._dpoHold && now < t._dpoHold) continue;
var half = t.scrollWidth / 2;
if (half < 1) continue;
if (t._dpoPos == null || Math.abs(t._dpoPos - t.scrollLeft) > 2) t._dpoPos = t.scrollLeft;
var speed = Number(t.getAttribute('data-dpo-speed')) || SPEED_PX_PER_SEC;
t._dpoPos += speed * dt;
if (t._dpoPos >= half) t._dpoPos -= half;
t.scrollLeft = t._dpoPos;
}
}
window.requestAnimationFrame(step);
}
window.requestAnimationFrame(step);
document.addEventListener('scroll', function (e) {
var t = e.target;
if (!t || !t.hasAttribute || !t.hasAttribute('data-dpo-loop')) return;
var half = t.scrollWidth / 2;
if (half < 1) return;
if (t.scrollLeft >= half) t.scrollLeft -= half;
else if (t.scrollLeft < 0.5) t.scrollLeft += half;
}, true);
})();
