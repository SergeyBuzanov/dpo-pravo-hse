/**
 * Мешок с перемешиванием для девизов первого экрана.
 *
 * Зачем не Math.random() по всему списку. Равномерный выбор из девяти фраз
 * даёт повтор подряд примерно каждую девятую загрузку, а на коротком визите
 * (открыл, вернулся, обновил) это выглядит как поломка: «оно не меняется».
 * Мешок гарантирует, что за круг посетитель увидит весь банк и ни одну фразу
 * дважды.
 *
 * Как работает. Индексы всех фраз (по weight штук каждый) складываются в
 * мешок и перемешиваются Фишером – Йетсом. Каждая загрузка достаёт один и
 * удаляет его. Опустевший мешок насыпается заново; если первым в новом мешке
 * оказался тот же индекс, что показали последним, он меняется местами со
 * следующим – иначе на стыке кругов был бы повтор.
 *
 * Файл без единого обращения к DOM и к localStorage намеренно: так его можно
 * прогнать юнит-тестами в Node, а хранилище и разметка остаются снаружи.
 * Тот же файл вшивается в страницу сборкой (scripts/build-landing.js), поэтому
 * ниже нет ни синтаксиса модулей, ни стрелочных функций – только то, что
 * одинаково понимают Node и браузеры, которые сайт поддерживает.
 */

'use strict';

/**
 * Перемешивание Фишера – Йетса. Идёт с конца и меняет текущий элемент со
 * случайным из необработанной части. Наивная сортировка со случайным
 * компаратором даёт неравномерное распределение, поэтому её тут нет.
 *
 * rand – функция в [0, 1). Передаётся снаружи, чтобы тест мог подсунуть
 * предсказуемую последовательность вместо Math.random.
 */
function shuffle(list, rand) {
  var out = list.slice();
  for (var i = out.length - 1; i > 0; i--) {
    var j = Math.floor(rand() * (i + 1));
    var tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/**
 * Свежий мешок: индекс каждой фразы повторяется weight раз.
 * Вес меньше единицы или не число считается единицей – банк редактирует
 * человек, и опечатка в весе не должна выкидывать фразу из ротации совсем.
 */
function fillBag(slogans, rand) {
  var indices = [];
  for (var i = 0; i < slogans.length; i++) {
    var w = slogans[i] && Number(slogans[i].weight);
    if (!isFinite(w) || w < 1) w = 1;
    for (var k = 0; k < Math.floor(w); k++) indices.push(i);
  }
  return shuffle(indices, rand);
}

/**
 * Насыпает мешок так, чтобы одинаковые индексы не стояли рядом и первый не
 * повторял последний показанный.
 *
 * Не перебором. Случайная перестановка при трёх одинаковых из шести ложится
 * без соседств лишь в пятой части случаев, и на длинной серии перебор рано или
 * поздно упирается в лимит попыток.
 *
 * Способ конструктивный: элементы раскладываются группами от самой частой к
 * самой редкой по позициям через одну – сначала чётные (0, 2, 4…), затем
 * нечётные (1, 3, 5…). При таком порядке два одинаковых окажутся рядом только
 * если одного индекса больше половины мешка, а тогда развести его нельзя по
 * арифметике ни одним способом.
 *
 * Случайность сохраняется: группы одинакового размера тасуются между собой,
 * а при весах по единице все группы размера 1, и раскладка вырождается в
 * обычную случайную перестановку – то есть в поведение до всех этих правил.
 */
function drawBag(slogans, last, rand) {
  var random = typeof rand === 'function' ? rand : Math.random;
  var flat = fillBag(slogans, random);
  if (flat.length < 2) return flat;

  // Группы «индекс -> сколько раз», от частых к редким. Порядок внутри
  // одинаковых размеров случайный: fillBag уже перетасовал, а sort в JS
  // устойчив, поэтому исходный случайный порядок равных сохраняется.
  var counts = {};
  var order = [];
  for (var i = 0; i < flat.length; i++) {
    if (counts[flat[i]] === undefined) {
      counts[flat[i]] = 0;
      order.push(flat[i]);
    }
    counts[flat[i]]++;
  }
  order.sort(function (a, b) {
    return counts[b] - counts[a];
  });

  var n = flat.length;
  var slots = [];
  for (var even = 0; even < n; even += 2) slots.push(even);
  for (var odd = 1; odd < n; odd += 2) slots.push(odd);

  var bag = new Array(n);
  var at = 0;
  for (var g = 0; g < order.length; g++) {
    for (var k = 0; k < counts[order[g]]; k++) {
      bag[slots[at++]] = order[g];
    }
  }

  // Стык кругов: первый элемент повторяет последний показанный. Разворот
  // сохраняет отсутствие соседств внутри, а начало и конец меняет местами.
  if (bag[0] === last && bag[n - 1] !== last) bag.reverse();
  // Оба конца совпали с last – так бывает только у преобладающего индекса.
  // Меняем начало с ближайшим непохожим, соседство при этом возможно, но
  // повтор на стыке хуже: он виден посетителю сразу.
  if (bag[0] === last) {
    for (var j = 1; j < n; j++) {
      if (bag[j] === last) continue;
      var tmp = bag[0];
      bag[0] = bag[j];
      bag[j] = tmp;
      break;
    }
  }
  return bag;
}

/**
 * Выдаёт следующий индекс и новое состояние.
 *
 * state – { bag: number[], last: number|null }. Возвращает
 * { index, state } – состояние сразу пригодно для записи в хранилище.
 *
 * Индексы за границами текущего списка отбрасываются на чтении: у посетителя
 * в браузере может лежать мешок, насыпанный до правки банка, и без фильтра
 * он показал бы пустоту или уронил бы страницу.
 */
function next(slogans, state, rand) {
  var random = typeof rand === 'function' ? rand : Math.random;
  var size = slogans.length;
  if (!size) return { index: -1, state: { bag: [], last: null } };

  var bag = [];
  if (state && Object.prototype.toString.call(state.bag) === '[object Array]') {
    for (var i = 0; i < state.bag.length; i++) {
      var v = state.bag[i];
      if (typeof v === 'number' && v >= 0 && v < size && Math.floor(v) === v) bag.push(v);
    }
  }
  var last = state && typeof state.last === 'number' && state.last >= 0 && state.last < size
    ? state.last
    : null;

  if (!bag.length) bag = drawBag(slogans, last, random);

  var index = bag.shift();
  return { index: index, state: { bag: bag, last: index } };
}

if (typeof module === 'object' && module.exports) {
  module.exports = { shuffle: shuffle, fillBag: fillBag, drawBag: drawBag, next: next };
}
