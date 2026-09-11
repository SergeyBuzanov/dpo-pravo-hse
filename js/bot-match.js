(function (root, factory) {
if (typeof module === 'object' && module.exports) module.exports = factory();
else root.DpoBotMatch = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';
var ENDINGS = [
'ниями', 'ениям', 'ования', 'ование', 'ением', 'ения', 'ение',
'ями', 'ами', 'ого', 'ому', 'ыми', 'ими', 'ей', 'ов', 'ев',
'ый', 'ий', 'ая', 'яя', 'ое', 'ее', 'ые', 'ие', 'ых', 'их',
'ой', 'ом', 'ам', 'ах', 'ям', 'ях', 'ы', 'и', 'а', 'я', 'о', 'е', 'у', 'ю', 'ь',
];
var MIN_STEM = 4;
function normalize(word) {
return String(word || '').toLowerCase().replace(/ё/g, 'е');
}
function stem(word) {
var w = normalize(word);
for (var i = 0; i < ENDINGS.length; i++) {
var end = ENDINGS[i];
if (w.length - end.length >= MIN_STEM && w.slice(-end.length) === end) {
return w.slice(0, w.length - end.length);
}
}
return w;
}
function sameStem(a, b) {
if (a === b) return true;
var shorter = a.length < b.length ? a : b;
if (shorter.length < MIN_STEM) return false;
if (Math.abs(a.length - b.length) < 2) return false;
return a.indexOf(b) === 0 || b.indexOf(a) === 0;
}
var FORMATS = [
[/онлайн|дистанц|удал/, 'online'],
[/очн|офлайн|аудитор/, 'offline'],
[/смешан/, 'mixed'],
[/гибрид/, 'hybrid'],
];
var STOP_WORDS = [
'программа', 'курс', 'обучение', 'формат', 'подобрать',
'какой', 'нужен', 'документ', 'старт', 'стоит', 'цена',
];
var STOP_STEMS = STOP_WORDS.map(stem);
function consumeWord(str, index, len) {
var start = index;
var end = index + len;
while (start > 0 && /[а-яa-z0-9]/.test(str[start - 1])) start--;
while (end < str.length && /[а-яa-z0-9]/.test(str[end])) end++;
return str.slice(0, start) + ' ' + str.slice(end);
}
var DURATION_TAIL_RE = /^\s*(месяц|недел|год|лет(?=$|[^а-яё])|час|дн)/;
function parseQuery(query) {
var text = normalize(query);
var out = { stems: [], priceMax: null, priceMin: null, format: null, type: null };
if (!text.trim()) return out;
var remaining = text;
var price = remaining.match(/(?<![а-яa-z])(до|дешевле|не дороже|не больше|за|от|дороже)\s+(\d[\d\s]*)\s*(тыс\w*|руб\w*|₽)?/);
if (price) {
var value = parseInt(price[2].replace(/\s/g, ''), 10);
var hasMoneyUnit = !!price[3];
var tail = remaining.slice(price.index + price[0].length, price.index + price[0].length + 12);
var isDuration = DURATION_TAIL_RE.test(tail);
var tooSmall = !hasMoneyUnit && value < 1000;
if (!isDuration && !tooSmall) {
if (hasMoneyUnit && /тыс/.test(price[3])) value *= 1000;
if (/^не\s/.test(price[1])) out.priceMax = value;
else if (/от|дороже/.test(price[1])) out.priceMin = value;
else out.priceMax = value;
var matchedLen = price[0].replace(/\s+$/, '').length;
remaining = consumeWord(remaining, price.index, matchedLen);
}
}
for (var i = 0; i < FORMATS.length; i++) {
var fm = remaining.match(FORMATS[i][0]);
if (fm) {
out.format = FORMATS[i][1];
remaining = consumeWord(remaining, fm.index, fm[0].length);
break;
}
}
if (/переподготовк|новая профессия/.test(remaining)) {
var pp = remaining.match(/переподготовк[а-яa-z]*|новая профессия/);
out.type = 'ПП';
remaining = consumeWord(remaining, pp.index, pp[0].length);
} else if (/повышение квалификац/.test(remaining)) {
var pk = remaining.match(/повышение квалификац[а-яa-z]*/);
out.type = 'ПК';
remaining = consumeWord(remaining, pk.index, pk[0].length);
} else {
var abbr = remaining.match(/(^|[^а-яa-z0-9])(пп|пк)(?=$|[^а-яa-z0-9])/);
if (abbr) {
out.type = abbr[2] === 'пп' ? 'ПП' : 'ПК';
remaining = consumeWord(remaining, abbr.index + abbr[1].length, abbr[2].length);
}
}
out.stems = remaining
.replace(/[^а-яa-z0-9\s]/g, ' ')
.split(/\s+/)
.filter(function (w) { return w.length >= 3 && !/^\d+$/.test(w); })
.map(stem)
.filter(function (s) {
return !STOP_STEMS.some(function (stopStem) { return sameStem(s, stopStem); });
});
return out;
}
function hits(stems, text) {
var words = normalize(text).replace(/[^а-яa-z0-9\s]/g, ' ').split(/\s+/).map(stem);
var n = 0;
for (var i = 0; i < stems.length; i++) {
for (var j = 0; j < words.length; j++) {
if (sameStem(stems[i], words[j])) { n++; break; }
}
}
return n;
}
function byStart(a, b) {
var aHas = !!(a.startIso || a.start);
var bHas = !!(b.startIso || b.start);
if (aHas !== bHas) return aHas ? -1 : 1;
if (a.startIso && b.startIso) {
if (a.startIso < b.startIso) return -1;
if (a.startIso > b.startIso) return 1;
return 0;
}
return 0;
}
function search(query, programs) {
var list = Array.isArray(programs) ? programs.slice() : [];
var q = parseQuery(query);
if (!q.stems.length && q.priceMax === null && q.priceMin === null && !q.format && !q.type) {
return { reason: 'empty', programs: [] };
}
var filtered = list.filter(function (p) {
if (q.format && p.format !== q.format) return false;
if (q.type && p.type !== q.type) return false;
if (q.priceMax !== null && !(typeof p.price === 'number' && p.price <= q.priceMax)) return false;
if (q.priceMin !== null && !(typeof p.price === 'number' && p.price >= q.priceMin)) return false;
return true;
});
var scored = filtered
.map(function (p) {
var inTitle = hits(q.stems, p.title);
var inWords = hits(q.stems, (p.keywords || []).join(' '));
var inSphere = hits(q.stems, p.sphere || '');
return { p: p, score: inTitle * 3 + inWords * 2 + inSphere, inTitle: inTitle };
})
.filter(function (row) { return row.score > 0; })
.sort(function (a, b) {
var aTier = a.inTitle > 0 ? 1 : 0;
var bTier = b.inTitle > 0 ? 1 : 0;
if (aTier !== bTier) return bTier - aTier;
return b.score - a.score;
});
if (scored.length) {
return {
reason: scored[0].inTitle > 0 ? 'title' : 'keywords',
programs: scored.map(function (row) { return row.p; }),
};
}
var hasRestriction = !!q.format || !!q.type || q.priceMax !== null || q.priceMin !== null;
if (hasRestriction && filtered.length) {
return { reason: 'filter', programs: filtered };
}
return { reason: 'none', programs: list.slice().sort(byStart).slice(0, 3) };
}
return { stem: stem, sameStem: sameStem, parseQuery: parseQuery, search: search };
});
