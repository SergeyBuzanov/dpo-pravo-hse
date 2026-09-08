'use strict';

/**
 * Подбор программ. Проверяется поведение, а не текст файла: это
 * единственная часть бота, где ошибка не видна глазом – список просто
 * окажется не тем.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { stem, parseQuery, search } = require('../../js/bot-match');

const PROGRAMS = [
  {
    id: '1', title: 'Актуальные вопросы налогового администрирования',
    sphere: 'Финансовое право', type: 'ПК', format: 'online',
    price: 22000, start: 'Старт: 5 октября', keywords: ['Налоговые споры', 'Юристы'],
  },
  {
    id: '2', title: 'Английское контрактное право',
    sphere: 'Международное право', type: 'ПК', format: 'offline',
    price: 60000, start: null, keywords: ['Договорная работа', 'Юристы'],
  },
  {
    id: '3', title: 'Банкротство юридических лиц',
    sphere: 'Корпоративное и договорное право', type: 'ПП', format: 'mixed',
    price: 45000, start: 'Старт: 1 ноября', keywords: ['Несостоятельность', 'Предприниматели'],
  },
];

test('основа слова сводит словоформы к одной', () => {
  const base = stem('налоги');
  assert.equal(stem('налоговый').startsWith(base) || base.startsWith(stem('налоговый')), true);
  assert.equal(stem('налогообложение').startsWith(base), true);
});

test('основа не склеивает разные слова', () => {
  assert.notEqual(stem('право'), stem('практика'));
});

test('слово из названия находит программу', () => {
  const out = search('банкротство', PROGRAMS);
  assert.equal(out.reason, 'title');
  assert.deepEqual(out.programs.map((p) => p.id), ['3']);
});

test('слово из ключевых слов находит программу', () => {
  const out = search('несостоятельность', PROGRAMS);
  assert.equal(out.reason, 'keywords');
  assert.deepEqual(out.programs.map((p) => p.id), ['3']);
});

test('цена и формат читаются как ограничение', () => {
  const q = parseQuery('онлайн дешевле 30 тысяч');
  assert.equal(q.priceMax, 30000);
  assert.equal(q.format, 'online');
  const out = search('онлайн дешевле 30 тысяч', PROGRAMS);
  assert.equal(out.reason, 'filter');
  assert.deepEqual(out.programs.map((p) => p.id), ['1']);
});

test('пустой запрос возвращает подсказки, а не пустоту', () => {
  const out = search('   ', PROGRAMS);
  assert.equal(out.reason, 'empty');
  assert.deepEqual(out.programs, []);
});

test('несуществующее слово даёт «не нашёл» и программы с ближайшим стартом', () => {
  const out = search('криптовалюта', PROGRAMS);
  assert.equal(out.reason, 'none');
  assert.equal(out.programs.length, 3);
  // Сперва те, у кого старт назначен: программа без старта уходит вниз.
  assert.equal(out.programs[0].id, '1');
  assert.equal(out.programs[2].id, '2');
});

test('порядок выдачи устойчив: совпадение в названии выше совпадения в словах', () => {
  const out = search('юристы налоговых', PROGRAMS);
  assert.equal(out.programs[0].id, '1');
});
