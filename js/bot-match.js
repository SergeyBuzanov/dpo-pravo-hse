/**
 * Подбор программ для бота поддержки.
 *
 * Файл читают ОБА мира: браузер берёт его тегом <script> и получает
 * window.DpoBotMatch, Node требует его в тестах. Так поведение поиска
 * проверяется настоящими тестами, а не сверкой строк, и остаётся одно
 * место, где оно описано.
 *
 * Ни одной зависимости: в проекте их нет вовсе.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DpoBotMatch = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Окончания снимаются по одному разу, от длинных к коротким. */
  var ENDINGS = [
    'ниями', 'ениям', 'ования', 'ование', 'ением', 'ения', 'ение',
    'ями', 'ами', 'ого', 'ому', 'ыми', 'ими', 'ей', 'ов', 'ев',
    'ый', 'ий', 'ая', 'яя', 'ое', 'ее', 'ые', 'ие', 'ых', 'их',
    'ой', 'ом', 'ам', 'ах', 'ям', 'ях', 'ы', 'и', 'а', 'я', 'о', 'е', 'у', 'ю', 'ь',
  ];

  var MIN_STEM = 5;

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

  /** Две основы считаются одним словом, если одна начинает другую. */
  function sameStem(a, b) {
    if (a.length < MIN_STEM || b.length < MIN_STEM) return a === b;
    return a.indexOf(b) === 0 || b.indexOf(a) === 0;
  }

  var FORMATS = [
    [/онлайн|дистанц|удал/, 'online'],
    [/очн(?!ый онлайн)|офлайн|аудитор/, 'offline'],
    [/смешан/, 'mixed'],
    [/гибрид/, 'hybrid'],
  ];

  function parseQuery(query) {
    var text = normalize(query);
    var out = { stems: [], priceMax: null, priceMin: null, format: null, type: null };
    if (!text.trim()) return out;

    // Цена: «до 30 000», «дешевле 30 тысяч», «от 20 тысяч», «не дороже 40 тысяч», «за 100000».
    var price = text.match(/(до|дешевле|не дороже|не больше|за|от|дороже)\s+(\d[\d\s]*)\s*(тыс\w*)?/);
    if (price) {
      var value = parseInt(price[2].replace(/\s/g, ''), 10);
      if (price[3]) value *= 1000;
      // Отрицательные обороты («не дороже», «не больше») проверяются раньше:
      // иначе подстрока «дороже» внутри «не дороже» перепутает верх с низом.
      if (/^не\s/.test(price[1])) out.priceMax = value;
      else if (/от|дороже/.test(price[1])) out.priceMin = value;
      else out.priceMax = value;
    }

    for (var i = 0; i < FORMATS.length; i++) {
      if (FORMATS[i][0].test(text)) { out.format = FORMATS[i][1]; break; }
    }
    if (/переподготовк|новая профессия|пп\b/.test(text)) out.type = 'ПП';
    else if (/повышение квалификац|пк\b/.test(text)) out.type = 'ПК';

    out.stems = text
      .replace(/[^а-яa-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(function (w) { return w.length >= 3 && !/^\d+$/.test(w); })
      .map(stem);

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
    if (!!a.start === !!b.start) return 0;
    return a.start ? -1 : 1;
  }

  function search(query, programs) {
    var list = Array.isArray(programs) ? programs.slice() : [];
    var q = parseQuery(query);
    if (!q.stems.length && q.priceMax === null && q.priceMin === null && !q.format) {
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
        // Уровень (совпадение в названии) важнее суммы очков: программа
        // без единого слова в названии не должна обгонять ту, что есть.
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
    // Слова не совпали, но ограничение (цена/формат/тип) задано и что-то
    // ему удовлетворяет – это осмысленный отбор, а не «не нашёл». Не важно,
    // сузило ли оно выдачу: реплика бота зависит от reason, а список и так
    // правильный.
    var hasRestriction = !!q.format || !!q.type || q.priceMax !== null || q.priceMin !== null;
    if (hasRestriction && filtered.length) {
      return { reason: 'filter', programs: filtered };
    }
    // Не нашлось ничего: показываем те, что стартуют ближе всего. Это
    // честнее, чем притворяться, будто они «по смыслу» подходят.
    return { reason: 'none', programs: list.slice().sort(byStart).slice(0, 3) };
  }

  return { stem: stem, parseQuery: parseQuery, search: search };
});
