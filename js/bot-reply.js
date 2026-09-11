(function (root, factory) {
if (typeof module === 'object' && module.exports) module.exports = factory(require('./bot-match'));
else root.DpoBotReply = factory(root.DpoBotMatch);
})(typeof self !== 'undefined' ? self : this, function (DpoBotMatch) {
'use strict';
function tokenize(text) {
return String(text || '')
.toLowerCase()
.replace(/ё/g, 'е')
.replace(/[^а-яa-z0-9\s]/g, ' ')
.split(/\s+/)
.filter(function (w) { return w.length >= 2 && !/^\d+$/.test(w); })
.map(DpoBotMatch.stem);
}
function tokenMatchesAny(token, qTokens) {
for (var i = 0; i < qTokens.length; i++) {
if (DpoBotMatch.sameStem(token, qTokens[i])) return true;
}
return false;
}
function triggerMatches(trigger, qTokens) {
var tTokens = tokenize(trigger);
if (!tTokens.length) return false;
return tTokens.every(function (t) { return tokenMatchesAny(t, qTokens); });
}
function findByTriggers(qTokens, list) {
for (var i = 0; i < list.length; i++) {
var triggers = list[i].triggers;
for (var j = 0; j < triggers.length; j++) {
if (triggerMatches(triggers[j], qTokens)) return list[i];
}
}
return null;
}
function parseDurationItem(raw) {
var m = /^(\d+(?:,\d+)?)\s+(\S+)/.exec(String(raw || '').trim());
if (!m) return null;
var word = m[2];
var root = /^недел/.test(word) ? 'недел' : /^месяц/.test(word) ? 'месяц' : /^(год|лет)/.test(word) ? 'год' : word;
var scale = root === 'недел' ? 7 : root === 'месяц' ? 30 : root === 'год' ? 365 : 1;
return { raw: String(raw).trim(), num: m[1], root: root, days: parseFloat(m[1].replace(',', '.')) * scale };
}
function durationRange(programs, type) {
var items = programs
.filter(function (p) { return p.type === type && p.duration; })
.map(function (p) { return parseDurationItem(p.duration); })
.filter(Boolean);
if (!items.length) return null;
var min = items[0];
var max = items[0];
items.forEach(function (it) {
if (it.days < min.days) min = it;
if (it.days > max.days) max = it;
});
if (min.raw === max.raw) return min.raw;
if (min.root === max.root) return min.num + ' – ' + max.raw;
return min.raw + ' – ' + max.raw;
}
function durationText(programs) {
var pk = durationRange(programs, 'ПК');
var pp = durationRange(programs, 'ПП');
var lines = [];
if (pk) lines.push('Повышение квалификации: длительность обычно ' + pk + '.');
if (pp) lines.push('Профессиональная переподготовка: длительность обычно ' + pp + '.');
return lines.join('\n');
}
function upcoming(programs, n) {
return programs
.slice()
.sort(function (a, b) {
var aHas = !!(a.startIso || a.start);
var bHas = !!(b.startIso || b.start);
if (aHas !== bHas) return aHas ? -1 : 1;
if (a.startIso && b.startIso) return a.startIso < b.startIso ? -1 : a.startIso > b.startIso ? 1 : 0;
return 0;
})
.slice(0, n);
}
function priceRange(programs) {
var prices = programs.map(function (p) { return p.price; }).filter(function (v) { return typeof v === 'number'; });
if (!prices.length) return null;
return { min: Math.min.apply(null, prices), max: Math.max.apply(null, prices) };
}
function formatPrice(n) {
return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽';
}
function sphereList(programs) {
var seen = {};
var order = [];
programs.forEach(function (p) {
if (p.sphere && !seen[p.sphere]) {
seen[p.sphere] = true;
order.push(p.sphere);
}
});
return order;
}
function pickBy(programs, field, value) {
return programs.filter(function (p) { return p[field] === value; });
}
function introFor(reason, count) {
if (reason === 'filter') return 'Отобрала по вашим условиям:';
return count === 1 ? 'Нашла одну программу:' : 'Вот что нашла:';
}
function titleHit(qStems, title) {
if (!qStems || !qStems.length) return false;
var titleWords = tokenize(title);
return qStems.some(function (s) { return titleWords.some(function (w) { return DpoBotMatch.sameStem(s, w); }); });
}
function classifySearch(found, qStems) {
if (found.reason === 'empty' || found.reason === 'none') return {};
if (found.reason === 'filter') {
return { primary: { intro: introFor('filter', found.programs.length), programs: found.programs } };
}
var strong = found.programs.filter(function (p) { return titleHit(qStems, p.title); });
if (strong.length) {
return { primary: { intro: introFor(found.reason, strong.length), programs: strong }, forExtra: strong };
}
return { weak: found.programs };
}
function withExtra(base, searchResult) {
if (searchResult && searchResult.forExtra && searchResult.forExtra.length) {
base.extra = searchResult.forExtra.slice(0, 5);
}
return base;
}
function reply(query, data) {
var qTokens = tokenize(query);
var found = DpoBotMatch.search(query, data.programs);
var qStems = DpoBotMatch.parseQuery(query).stems;
var searchResult = classifySearch(found, qStems);
var durationHit = data.duration && data.duration.triggers.some(function (t) { return triggerMatches(t, qTokens); });
if (durationHit) {
var text = durationText(data.programs);
if (text) return withExtra({ kind: 'duration', text: text, anchor: data.duration.anchor }, searchResult);
}
var answer = findByTriggers(qTokens, data.answers);
if (answer) return withExtra({ kind: 'answer', answer: answer }, searchResult);
var gap = findByTriggers(qTokens, data.gaps);
if (gap) return { kind: 'gap', gap: gap };
if (searchResult.primary) {
return { kind: 'programs', intro: searchResult.primary.intro, programs: searchResult.primary.programs.slice(0, 5) };
}
if (searchResult.weak && searchResult.weak.length) {
return { kind: 'programs-weak', programs: searchResult.weak.slice(0, 5) };
}
return { kind: 'none', programs: upcoming(data.programs, 3) };
}
function createActionQueue() {
var pending = [];
var settled = null;
return {
isEmpty: function () { return pending.length === 0; },
status: function () { return settled; },
run: function (onReady, onFail, data) {
if (settled === true) {
onReady(data);
return 'ran';
}
if (settled === false) {
onFail();
return 'failed';
}
pending.push({ onReady: onReady, onFail: onFail });
return 'queued';
},
resolve: function (data) {
settled = true;
var queue = pending;
pending = [];
queue.forEach(function (item) { item.onReady(data); });
return queue.length;
},
reject: function () {
settled = false;
var queue = pending;
pending = [];
queue.forEach(function (item) { item.onFail(); });
return queue.length;
},
};
}
var INTENT_TRIGGERS = {
priceRange: ['сколько стоит', 'цена'],
upcomingStarts: ['ближайший старт', 'когда старт'],
pickProgram: ['подобрать программу'],
};
var INTENT_ORDER = ['priceRange', 'upcomingStarts', 'pickProgram'];
function detectIntent(query) {
var parsed = DpoBotMatch.parseQuery(query);
if (parsed.priceMax !== null || parsed.priceMin !== null || parsed.format || parsed.type) return null;
var qTokens = tokenize(query);
for (var i = 0; i < INTENT_ORDER.length; i++) {
var key = INTENT_ORDER[i];
var triggers = INTENT_TRIGGERS[key];
for (var j = 0; j < triggers.length; j++) {
if (triggerMatches(triggers[j], qTokens)) return key;
}
}
return null;
}
return {
tokenize: tokenize,
triggerMatches: triggerMatches,
findByTriggers: findByTriggers,
durationText: durationText,
upcoming: upcoming,
priceRange: priceRange,
formatPrice: formatPrice,
sphereList: sphereList,
pickBy: pickBy,
introFor: introFor,
titleHit: titleHit,
classifySearch: classifySearch,
reply: reply,
createActionQueue: createActionQueue,
detectIntent: detectIntent,
};
});
