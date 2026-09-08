/**
 * Логика подбора ответа бота поддержки – ЧИСТЫЕ функции без DOM.
 *
 * Файл читают ОБА мира: браузер берёт его тегом <script> (после
 * js/bot-match.js, до js/support-bot.js) и получает window.DpoBotReply,
 * Node требует его в тестах. Тот же приём и то же обоснование, что у
 * js/bot-match.js: поведение подбора ответа проверяется настоящими
 * тестами, а не сверкой строк руками в браузере (независимое ревью
 * 08.09.2026 нашло именно то, что живые прогоны без теста пропускали).
 *
 * Разметка, стили и открытие/закрытие окна остаются в js/support-bot.js.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./bot-match'));
  else root.DpoBotReply = factory(root.DpoBotMatch);
})(typeof self !== 'undefined' ? self : this, function (DpoBotMatch) {
  'use strict';

  /**
   * Слова запроса и триггера сравниваются основами (DpoBotMatch.sameStem),
   * а не через parseQuery: тот нарочно вырезает служебные слова вопроса
   * («документ», «формат», «старт», «стоит» – см. STOP_WORDS в
   * js/bot-match.js), но для готовых ответов бота это ровно те слова,
   * которые называют тему («какой документ выдают»).
   *
   * Порог длины слова – 2 символа, а не 3 (как в parseQuery): «пк»/«пп» –
   * настоящие триггеры ответа pk-vs-pp, и при пороге 3 отсекались бы оба,
   * и в тексте вопроса, и в самом триггере.
   */
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

  /**
   * Триггер – ВСЕ его слова обязаны найтись в вопросе (а не хотя бы одно):
   * иначе общее слово многословного триггера ложно ловит вопрос совсем не
   * о той теме («занятия» из триггера «пропуск занятия» одним словом
   * ловило бы «когда занятия» – нашлось при ручной проверке задачи 14).
   */
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

  /** "2 недели" -> {num:"2", root:"недел", days:14, raw:"2 недели"}. */
  function parseDurationItem(raw) {
    var m = /^(\d+(?:,\d+)?)\s+(\S+)/.exec(String(raw || '').trim());
    if (!m) return null;
    var word = m[2];
    var root = /^недел/.test(word) ? 'недел' : /^месяц/.test(word) ? 'месяц' : /^(год|лет)/.test(word) ? 'год' : word;
    var scale = root === 'недел' ? 7 : root === 'месяц' ? 30 : root === 'год' ? 365 : 1;
    return { raw: String(raw).trim(), num: m[1], root: root, days: parseFloat(m[1].replace(',', '.')) * scale };
  }

  /**
   * "2 недели – 3 месяца" для разброса разных единиц, "6 – 8 месяцев" –
   * для одной (число берётся из меньшего, единица – у большего, как в
   * самой цитате): числа считаются из каталога, а не хранятся строкой –
   * иначе устареют при первом же обновлении программ.
   */
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

  /** Ближайшие по старту программы – тот же порядок, что у reason:'none' в DpoBotMatch.search. */
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

  /** Список сфер каталога в порядке первого появления – источник кнопок «Подобрать программу». */
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

  /** Прямой фильтр по полю каталога (sphere/type) – для встречного вопроса «Подобрать программу». */
  function pickBy(programs, field, value) {
    return programs.filter(function (p) { return p[field] === value; });
  }

  function introFor(reason, count) {
    if (reason === 'filter') return 'Отобрала по вашим условиям:';
    return count === 1 ? 'Нашла одну программу:' : 'Вот что нашла:';
  }

  /** Слово запроса встретилось в САМОМ НАЗВАНИИ программы – самостоятельная проверка, не берёт score у DpoBotMatch.search (он его не отдаёт наружу). */
  function titleHit(qStems, title) {
    if (!qStems || !qStems.length) return false;
    var titleWords = tokenize(title);
    return qStems.some(function (s) { return titleWords.some(function (w) { return DpoBotMatch.sameStem(s, w); }); });
  }

  /**
   * Порог силы совпадения (IMPORTANT 6, независимое ревью 08.09.2026):
   * «Вот что нашла» остаётся только для сильных совпадений (слово запроса
   * – в названии программы, не только в ключевых словах/сфере). Подобран
   * по живым запросам – см. tests/unit/bot-reply.test.js и отчёт задачи 14:
   * «банкротство» без порога отдавал 3 карточки, из них 2 про налоги и
   * исламские финансы (только по ключевым словам) – с порогом остаётся 1,
   * с настоящим совпадением в названии; «налоги» аналогично 5 -> 1;
   * «договор» ни у одной программы нет слова в названии – весь список идёт
   * честно, как «близкое по теме», а не как точное совпадение.
   *
   * `filter` (явное ограничение – формат/цена/тип) в `forExtra` не идёт:
   * это ограничение, а не смысловая близость к теме готового ответа –
   * прицепленное «ещё нашла» под ответом pk-vs-pp иначе тащило бы простой
   * список из 23 программ ПК, случайно словивших тип из аббревиатуры в
   * вопросе «пк и пп в чём разница».
   */
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

  /**
   * Порядок (IMPORTANT 6, правка 1): если запрос совпал с триггерами
   * готового ответа (длительность/ответ/пробел) – показывается ОН, поиск
   * программ идёт под ним как «Ещё нашла программы по теме» и только при
   * сильном совпадении. Раньше подбор программ шёл ПЕРЕД готовым ответом
   * и «персональные данные»/«пк и пп в чём разница»/«можно без
   * юридического образования» уходили в случайные программы мимо ответа.
   */
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

  /**
   * Очередь действий до прихода данных (CRITICAL 2, независимое ревью
   * 08.09.2026): reply() читает data.programs – вызывать его, пока данные
   * ещё не пришли, нельзя (было Uncaught TypeError). Действие, запрошенное
   * раньше данных, копится и выполняется целиком, как только они пришли;
   * при неудаче загрузки очередь один раз получает признак ошибки и
   * дальше не копится молча (это же чинит IMPORTANT 3 – повторное
   * открытие во время ещё идущей загрузки не показывает ложную ошибку,
   * а ждёт тот же результат).
   */
  function createActionQueue() {
    var pending = [];
    var settled = null; // null – ждём, true – данные пришли, false – загрузка не удалась
    return {
      isEmpty: function () { return pending.length === 0; },
      status: function () { return settled; },
      /** 'ran' – выполнено сразу, 'queued' – встало в очередь, 'failed' – данные не пришли и не придут. */
      run: function (action, data) {
        if (settled === true) {
          action(data);
          return 'ran';
        }
        if (settled === false) return 'failed';
        pending.push(action);
        return 'queued';
      },
      resolve: function (data) {
        settled = true;
        var queue = pending;
        pending = [];
        queue.forEach(function (fn) { fn(data); });
        return queue.length;
      },
      reject: function () {
        settled = false;
        pending = [];
      },
    };
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
  };
});
