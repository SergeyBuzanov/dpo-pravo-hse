(function () {
'use strict';
var GRIDS = ['.dpo-spheres', '.dpo-formats'];
var observed = {};
function watch(selector) {
var grid = document.querySelector(selector);
if (!grid || grid.classList.contains('is-in') || grid === observed[selector]) return;
if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
if (!('IntersectionObserver' in window)) return;
grid.classList.add('dpo-fly');
observed[selector] = grid;
var io = new IntersectionObserver(
function (entries) {
if (!entries.some(function (en) { return en.isIntersecting; })) return;
grid.classList.add('is-in');
io.disconnect();
},
{ threshold: 0.1 },
);
io.observe(grid);
}
function fly() {
for (var i = 0; i < GRIDS.length; i++) watch(GRIDS[i]);
}
function allFound() {
for (var i = 0; i < GRIDS.length; i++) if (!observed[GRIDS[i]]) return false;
return true;
}
fly();
var tries = 0;
var timer = window.setInterval(function () {
fly();
if (allFound() || ++tries > 60) window.clearInterval(timer);
}, 200);
if ('MutationObserver' in window) {
new MutationObserver(function () {
for (var i = 0; i < GRIDS.length; i++) {
var grid = document.querySelector(GRIDS[i]);
if (grid && grid !== observed[GRIDS[i]]) watch(GRIDS[i]);
}
}).observe(document, { childList: true, subtree: true });
}
})();
