(function () {
'use strict';
var wrap = null;
var chips = [];
function press(chip) {
chips.forEach(function (c) { c.setAttribute('aria-pressed', c === chip ? 'true' : 'false'); });
}
function init() {
wrap = document.querySelector('.tl-wrap');
chips = Array.prototype.slice.call(document.querySelectorAll('.starts-chip[data-scroll]'));
if (!wrap || !chips.length) return;
var ticking = false;
wrap.addEventListener('scroll', function () {
if (ticking) return;
ticking = true;
window.requestAnimationFrame(function () {
ticking = false;
var x = wrap.scrollLeft + 24;
var current = chips[0];
chips.forEach(function (c) { if (Number(c.getAttribute('data-scroll')) <= x) current = c; });
if (wrap.scrollLeft >= wrap.scrollWidth - wrap.clientWidth - 2) current = chips[chips.length - 1];
press(current);
});
}, { passive: true });
}
document.addEventListener('click', function (e) {
var chip = e.target && e.target.closest ? e.target.closest('.starts-chip[data-scroll]') : null;
if (!chip || !wrap) return;
press(chip);
wrap.scrollTo({ left: Number(chip.getAttribute('data-scroll')), behavior: 'smooth' });
});
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
})();
