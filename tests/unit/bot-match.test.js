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

// --- Регрессии по находкам ревью 2026-09-08 ---

test('CRITICAL 1: совпадение в названии всегда выше совпадения в keywords, даже при меньшей сумме очков', () => {
  const progs = [
    { id: 'a', title: 'Налоговые споры', keywords: [] },
    { id: 'b', title: 'Общий курс', keywords: ['Налоговое администрирование', 'Право'] },
  ];
  const out = search('налоговое право', progs);
  assert.equal(out.programs[0].id, 'a');
});

test('CRITICAL 2: «не дороже N» задаёт верхнюю границу цены, а не нижнюю', () => {
  const q = parseQuery('не дороже 40000');
  assert.equal(q.priceMax, 40000);
  assert.equal(q.priceMin, null);
  const out = search('не дороже 40000', PROGRAMS);
  assert.equal(out.reason, 'filter');
  assert.deepEqual(out.programs.map((p) => p.id), ['1']);
});

test('IMPORTANT 3: «право» и «правка» не считаются одним словом', () => {
  assert.notEqual(stem('право'), stem('правка'));
  const progs = [{ id: 'x', title: 'Международное право', keywords: [] }];
  const out = search('правка документа', progs);
  assert.equal(out.reason, 'none');
});

test('IMPORTANT 4: цена «за N» распознаётся, запрос не считается пустым', () => {
  const q = parseQuery('за 100000');
  assert.equal(q.priceMax, 100000);
  const out = search('за 100000', PROGRAMS);
  assert.notEqual(out.reason, 'empty');
});

test('IMPORTANT 5: ограничение без сужения выдачи – всё равно «filter», а не «none»', () => {
  // priceMax=100000 не отсекает ни одну из трёх программ (макс. цена – 60000),
  // а слово «космонавтика» не совпадает ни с одним названием/keywords/сферой.
  const out = search('дешевле 100 тысяч космонавтика', PROGRAMS);
  assert.equal(out.reason, 'filter');
});

// --- Регрессия по повторному ревью 2026-09-08 ---

test('IMPORTANT (повтор): падежные формы «право» продолжают находить программу после ужесточения sameStem', () => {
  const progs = [{ id: 'p', title: 'Международное право', keywords: [] }];
  for (const form of ['право', 'права', 'правом', 'праву', 'правами']) {
    const out = search(form, progs);
    assert.equal(out.reason, 'title', `форма «${form}» не нашла программу`);
    assert.deepEqual(out.programs.map((x) => x.id), ['p'], `форма «${form}»`);
  }
});

test('IMPORTANT (повтор): «право» и «правовой» – одна основа при поиске', () => {
  const progs = [{ id: 'p', title: 'Правовое регулирование цифровой экономики', keywords: [] }];
  const out = search('право', progs);
  assert.equal(out.reason, 'title');
});

test('IMPORTANT (повтор): «суд» и «судно» по-прежнему не путаются', () => {
  const progs = [{ id: 's', title: 'Морское право: страхование судна', keywords: [] }];
  const out = search('суд', progs);
  assert.equal(out.reason, 'none');
});
