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

  /**
   * Две основы считаются одним словом, если они равны, либо одна
   * начинает другую при разнице длин от двух символов (и короткая
   * основа не короче MIN_STEM – иначе, как у «суд»/«судно», совпадают
   * только при полном равенстве). Порог в один символ склеивал бы
   * «право» с «правка»: разница длин ровно один.
   */
  function sameStem(a, b) {
    if (a === b) return true;
    var shorter = a.length < b.length ? a : b;
    if (shorter.length < MIN_STEM) return false;
    if (Math.abs(a.length - b.length) < 2) return false;
    return a.indexOf(b) === 0 || b.indexOf(a) === 0;
  }

  var FORMATS = [
    [/онлайн|дистанц|удал/, 'online'],
    // Отрицательный просмотр «не очный онлайн» был недостижим: online
    // проверяется раньше в этом же цикле и уже съедает слово «онлайн»
    // из remaining (см. consumeWord ниже), так что «очн» здесь никогда
    // не увидит рядом стоящее «онлайн» – убрано как мёртвый код (M3).
    [/очн|офлайн|аудитор/, 'offline'],
    [/смешан/, 'mixed'],
    [/гибрид/, 'hybrid'],
  ];

  /**
   * Общие слова вопроса про бота, которые не должны сами по себе давать
   * очки: они мелькают в подводках, названиях модулей и служебных полях
   * почти любой программы, а описывают не программу, а сам вопрос.
   *  - программа/курс/обучение – родовые слова темы разговора, а не её
   *    предмета («подобрать программу» ничего не говорит о праве);
   *  - формат – уже разобран отдельным полем (FORMATS выше);
   *  - подобрать/какой/нужен – служебные слова вопроса, не темы;
   *  - документ – вопрос «какой документ выдают» про диплом/справку, а
   *    не про содержание программы;
   *  - старт – уже разобран отдельно (start/startIso), как содержательное
   *    слово оно только даёт ложные совпадения по «ближайшие старты»;
   *  - стоит/цена – цена уже разобрана отдельным полем (priceMax/priceMin
   *    в parseQuery), как слово оно только шумит.
   */
  var STOP_WORDS = [
    'программа', 'курс', 'обучение', 'формат', 'подобрать',
    'какой', 'нужен', 'документ', 'старт', 'стоит', 'цена',
  ];
  var STOP_STEMS = STOP_WORDS.map(stem);

  /**
   * Вырезает из строки целое слово, накрывающее позицию [index, index+len)
   * найденного совпадения regex – а не только само совпадение. Регулярки
   * формата и цены нарочно матчат префикс/подстроку слова («дистанц» из
   * «дистанционно», «тыс» из «тысяч»), и если стереть только совпавшую
   * подстроку, огрызок слова («ионно», «яч») остаётся в тексте и попадает
   * в stems как мусорное слово. Раздвигаем границы до ближайших не-буквенных
   * символов в обе стороны и стираем целиком.
   */
  function consumeWord(str, index, len) {
    var start = index;
    var end = index + len;
    while (start > 0 && /[а-яa-z0-9]/.test(str[start - 1])) start--;
    while (end < str.length && /[а-яa-z0-9]/.test(str[end])) end++;
    return str.slice(0, start) + ' ' + str.slice(end);
  }

  // Число само по себе не цена. «за 3 месяца», «до 3 месяцев» – это срок,
  // а не стоимость: если следом идёт слово о длительности, ценой оно не
  // считается вовсе.
  // «лет\b» здесь не годится: \b в JS не видит границ вокруг кириллицы
  // (та же причина, что в I1 сломала «пп»/«пк») – «летний», «летом» тоже
  // совпали бы. Явный лукахед на не-кириллицу отличает «5 лет» от «5 летний».
  var DURATION_TAIL_RE = /^\s*(месяц|недел|год|лет(?=$|[^а-яё])|час|дн)/;

  function parseQuery(query) {
    var text = normalize(query);
    var out = { stems: [], priceMax: null, priceMin: null, format: null, type: null };
    if (!text.trim()) return out;

    var remaining = text;

    // Цена: «до 30 000», «дешевле 30 тысяч», «от 20 тысяч», «не дороже 40
    // тысяч», «не больше 100 руб», «за 100000».
    var price = remaining.match(/(до|дешевле|не дороже|не больше|за|от|дороже)\s+(\d[\d\s]*)\s*(тыс\w*|руб\w*|₽)?/);
    if (price) {
      var value = parseInt(price[2].replace(/\s/g, ''), 10);
      var hasMoneyUnit = !!price[3];
      var tail = remaining.slice(price.index + price[0].length, price.index + price[0].length + 12);
      var isDuration = DURATION_TAIL_RE.test(tail);
      // Число меньше тысячи без явной денежной единицы («до 30») слишком
      // легко перепутать с чем угодно (возраст, номер группы, шаг занятий
      // в месяцах) – ценой оно не считается.
      var tooSmall = !hasMoneyUnit && value < 1000;
      if (!isDuration && !tooSmall) {
        if (hasMoneyUnit && /тыс/.test(price[3])) value *= 1000;
        // Отрицательные обороты («не дороже», «не больше») проверяются
        // раньше: иначе подстрока «дороже» внутри «не дороже» перепутает
        // верх с низом.
        if (/^не\s/.test(price[1])) out.priceMax = value;
        else if (/от|дороже/.test(price[1])) out.priceMin = value;
        else out.priceMax = value;
        remaining = consumeWord(remaining, price.index, price[0].length);
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

    // «пп»/«пк» – это сокращения, различимые только когда стоят отдельным
    // словом: /пп\b/ здесь не работает вовсе, потому что \b в JS определён
    // через \w (ASCII), а кириллица в \w не входит – границы слова вокруг
    // русских букв не возникает никогда. Проверяем явную границу через
    // символ до и после совпадения (не-буква/начало-конец строки), без \b.
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
      // Общие слова вопроса («программу», «документ», «старты», «стоит»…)
      // не должны сами по себе давать очков – см. STOP_WORDS выше.
      .filter(function (s) { return STOP_STEMS.indexOf(s) === -1; });

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

  /**
   * Сортировка «кто стартует раньше» – сначала программы с назначенным
   * стартом (по возрастанию даты через startIso, YYYY-MM-DD – сравнивается
   * лексикографически, это и есть хронологический порядок), затем те, у
   * кого старта нет, в конец. «Есть старт» проверяется и по startIso, и по
   * старой подписи start – это позволяет данным без startIso (более старая
   * форма) по-прежнему хотя бы группироваться, даже если внутри группы
   * настоящей даты для сравнения нет.
   */
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

  return { stem: stem, sameStem: sameStem, parseQuery: parseQuery, search: search };
});
