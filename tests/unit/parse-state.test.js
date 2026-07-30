const test = require('node:test');
const assert = require('node:assert');
const { parseInitialState } = require('../../lib/hse-catalog');

const wrap = (obj) => `<script>window.__INITIAL_STATE__ = ${obj};window.__URQL_DATA__ = {}</script>`;

test('обычный литерал разбирается', () => {
  const s = parseInitialState(wrap('{items:[{title:"Морской арбитраж",educationPricing:60000}]}'));
  assert.strictEqual(s.items[0].title, 'Морской арбитраж');
  assert.strictEqual(s.items[0].educationPricing, 60000);
});

test('new Date(...) превращается в число', () => {
  const s = parseInitialState(wrap('{items:[{startDate:new Date(1690000000000)}]}'));
  assert.strictEqual(s.items[0].startDate, 1690000000000);
});

test('__proto__: null отбрасывается в любой позиции', () => {
  // Прежняя версия оставляла висячую запятую, когда ключ шёл первым.
  assert.strictEqual(parseInitialState(wrap('{items:[{__proto__:null,title:"Х"}]}')).items[0].title, 'Х');
  assert.strictEqual(parseInitialState(wrap('{items:[{title:"Х",__proto__:null}]}')).items[0].title, 'Х');
  const mid = parseInitialState(wrap('{items:[{a:1,__proto__:null,title:"Х"}]}')).items[0];
  assert.strictEqual(mid.title, 'Х');
  assert.strictEqual(mid.a, 1);
});

test('null и true как значения не принимаются за ключи', () => {
  const s = parseInitialState(wrap('{items:[{title:"Х",duration:null,flag:true}]}'));
  assert.strictEqual(s.items[0].duration, null);
  assert.strictEqual(s.items[0].flag, true);
});

test('латиница с запятой и двоеточием внутри названия не ломает разбор', () => {
  // Именно этот случай ломал прежнюю регулярку: ", compliance:" внутри строки
  // она принимала за ключ объекта и вставляла кавычки посреди значения.
  const s = parseInitialState(wrap('{items:[{title:"Legal Tech, compliance: практика",educationPricing:1}]}'));
  assert.strictEqual(s.items[0].title, 'Legal Tech, compliance: практика');
});

test('экранированная кавычка внутри строки не сбивает разбор', () => {
  const s = parseInitialState(wrap('{items:[{title:"Курс \\"Право\\" и bar: baz",educationPricing:2}]}'));
  assert.ok(s.items[0].title.includes('bar: baz'));
});

test('отсутствие маркера — понятная ошибка', () => {
  assert.throws(() => parseInitialState('<html>ничего нет</html>'), /__INITIAL_STATE__/);
});

test('текст "__proto__:null" внутри строкового значения сохраняется дословно', () => {
  const s = parseInitialState(wrap('{items:[{title:"Курс __proto__:null практика"}]}'));
  assert.strictEqual(s.items[0].title, 'Курс __proto__:null практика');
});

test('текст "__proto__:null" с запятой перед ним внутри строки сохраняется дословно', () => {
  const s = parseInitialState(wrap('{items:[{title:"A, __proto__:null B"}]}'));
  assert.strictEqual(s.items[0].title, 'A, __proto__:null B');
});

test('текст "new Date(...)" внутри строкового значения сохраняется дословно', () => {
  const s = parseInitialState(wrap('{items:[{title:"Пример: new Date(1690000000000) в JS"}]}'));
  assert.strictEqual(s.items[0].title, 'Пример: new Date(1690000000000) в JS');
});

test('настоящие new Date(...) и __proto__: null вне строк по-прежнему обрабатываются во всех позициях', () => {
  // __proto__ первым ключом
  const first = parseInitialState(wrap(
    '{items:[{__proto__:null,title:"Х",startDate:new Date(1690000000000)}]}'
  )).items[0];
  assert.strictEqual(first.title, 'Х');
  assert.strictEqual(first.startDate, 1690000000000);

  // __proto__ последним ключом
  const last = parseInitialState(wrap(
    '{items:[{title:"Х",startDate:new Date(1690000000000),__proto__:null}]}'
  )).items[0];
  assert.strictEqual(last.title, 'Х');
  assert.strictEqual(last.startDate, 1690000000000);

  // __proto__ в середине
  const mid = parseInitialState(wrap(
    '{items:[{title:"Х",__proto__:null,startDate:new Date(1690000000000)}]}'
  )).items[0];
  assert.strictEqual(mid.title, 'Х');
  assert.strictEqual(mid.startDate, 1690000000000);
});
