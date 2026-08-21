const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { next, fillBag, shuffle } = require('../../lib/slogan-bag');

const BANK = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'content', 'slogans.json'), 'utf8'),
);
const SLOGANS = BANK.slogans;

/** Прогоняет n загрузок подряд, как это делает браузер: состояние переносится. */
function run(slogans, n, rand) {
  let state = null;
  const seen = [];
  for (let i = 0; i < n; i++) {
    const r = next(slogans, state, rand);
    state = r.state;
    seen.push(r.index);
  }
  return seen;
}

// ── Содержимое банка ──────────────────────────────────────────────────────

test('банк не пуст и не разросся, первая фраза – дефолтная из разметки', () => {
  // Точное число здесь стояло раньше и ломало тест при каждой правке банка
  // (21.08.2026: девятая фраза снята как дублирующая лид). Границы важнее
  // числа: одна фраза – это уже не ротация, а десяток – позиционирование
  // без позиции.
  assert.ok(SLOGANS.length >= 4 && SLOGANS.length <= 10, `фраз в банке: ${SLOGANS.length}`);
  assert.strictEqual(SLOGANS[0].text, 'Здесь право становится искусством');
});

test('ни одна фраза не повторяет лид первого экрана', () => {
  // «Образование для профессионалов права» дословно совпадало с началом
  // лида, стоящего строкой ниже: на экране получалось заикание.
  const lead = 'Образование для профессионалов права';
  for (const s of SLOGANS) {
    assert.notStrictEqual(s.text, lead, 'девиз дословно повторяет лид героя');
  }
});

test('в фразах нет длинного тире', () => {
  for (const s of SLOGANS) {
    assert.ok(!s.text.includes('—'), `длинное тире в «${s.text}»`);
  }
});

test('фразы не заканчиваются точкой', () => {
  for (const s of SLOGANS) {
    assert.ok(!/\.$/.test(s.text.trim()), `точка в конце «${s.text}»`);
  }
});

test('дефолтная фраза банка совпадает с той, что стоит в разметке', () => {
  const index = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
  assert.ok(
    index.includes(SLOGANS[0].text),
    'фраза №1 банка не найдена в index.html – без JavaScript покажется не то',
  );
});

// ── Ротация ───────────────────────────────────────────────────────────────

test('за круг показаны все фразы и ни одна не повторилась', () => {
  const seen = run(SLOGANS, SLOGANS.length);
  assert.strictEqual(new Set(seen).size, SLOGANS.length, `круг дал ${seen.join(',')}`);
});

test('две подряд идущие загрузки не дают одну фразу, включая стык кругов', () => {
  // Кругов много: стык проверяется не один раз, а на каждом обороте.
  const seen = run(SLOGANS, 200);
  for (let i = 1; i < seen.length; i++) {
    assert.notStrictEqual(seen[i], seen[i - 1], `повтор на загрузке ${i}: индекс ${seen[i]}`);
  }
});

test('повторов нет и при вырожденном генераторе, всегда возвращающем ноль', () => {
  const seen = run(SLOGANS, 60, () => 0);
  for (let i = 1; i < seen.length; i++) {
    assert.notStrictEqual(seen[i], seen[i - 1], `повтор на загрузке ${i}`);
  }
});

test('повторов нет и при генераторе, всегда возвращающем почти единицу', () => {
  const seen = run(SLOGANS, 60, () => 0.999999);
  for (let i = 1; i < seen.length; i++) {
    assert.notStrictEqual(seen[i], seen[i - 1], `повтор на загрузке ${i}`);
  }
});

test('за много кругов каждая фраза показана примерно поровну', () => {
  const seen = run(SLOGANS, SLOGANS.length * 40);
  const counts = new Map();
  for (const i of seen) counts.set(i, (counts.get(i) || 0) + 1);
  assert.strictEqual(counts.size, SLOGANS.length, 'какая-то фраза не показалась ни разу');
  for (const [i, n] of counts) assert.strictEqual(n, 40, `фраза ${i} показана ${n} раз вместо 40`);
});

// ── Веса ──────────────────────────────────────────────────────────────────

test('вес больше единицы кладёт индекс в мешок несколько раз', () => {
  const weighted = [{ text: 'а', weight: 3 }, { text: 'б', weight: 1 }, { text: 'в', weight: 1 }];
  const bag = fillBag(weighted, () => 0.5);
  assert.strictEqual(bag.length, 5);
  assert.strictEqual(bag.filter((i) => i === 0).length, 3);
});

test('битый вес не выбрасывает фразу из ротации', () => {
  const broken = [{ text: 'а', weight: 0 }, { text: 'б' }, { text: 'в', weight: 'два' }];
  const bag = fillBag(broken, () => 0.5);
  assert.strictEqual(bag.length, 3, 'каждая фраза должна попасть в мешок хотя бы раз');
});

test('вес больше единицы не отменяет правила «не два раза подряд»', () => {
  // Половина мешка – максимум, при котором развести дубли ещё возможно.
  const weighted = [
    { text: 'а', weight: 3 },
    { text: 'б', weight: 1 },
    { text: 'в', weight: 1 },
    { text: 'г', weight: 1 },
  ];
  const seen = run(weighted, 300);
  for (let i = 1; i < seen.length; i++) {
    assert.notStrictEqual(seen[i], seen[i - 1], `повтор на загрузке ${i}`);
  }
});

test('при недостижимом весе ротация не ломается, соседство лишь допускается', () => {
  // 5 из 6 – развести нельзя по арифметике. Проверяем, что выбор не падает и
  // обе фразы участвуют, а не что повторов нет: их не может не быть.
  const weighted = [{ text: 'а', weight: 5 }, { text: 'б', weight: 1 }];
  const seen = run(weighted, 60);
  assert.strictEqual(new Set(seen).size, 2, 'обе фразы должны показываться');
  assert.strictEqual(seen.filter((i) => i === 1).length, 10, 'редкая фраза должна выпадать по весу');
});

// ── Устойчивость к мусору в хранилище ─────────────────────────────────────

test('индексы за границами банка отбрасываются', () => {
  // Так выглядит мешок, насыпанный до того, как из банка убрали фразы.
  const r = next(SLOGANS, { bag: [99, -1, 3.5, 2], last: null });
  assert.strictEqual(r.index, 2, 'должен взяться единственный годный индекс');
});

test('мусор вместо состояния не роняет выбор', () => {
  for (const junk of [null, undefined, {}, { bag: 'строка' }, { bag: null, last: 'да' }]) {
    const r = next(SLOGANS, junk);
    assert.ok(r.index >= 0 && r.index < SLOGANS.length, `негодный индекс для ${JSON.stringify(junk)}`);
  }
});

test('пустой банк не роняет выбор', () => {
  const r = next([], null);
  assert.strictEqual(r.index, -1);
});

test('банк из одной фразы работает, хотя повтор в нём неизбежен', () => {
  const seen = run([{ text: 'одна', weight: 1 }], 5);
  assert.deepStrictEqual(seen, [0, 0, 0, 0, 0]);
});

// ── Перемешивание ─────────────────────────────────────────────────────────

test('перемешивание не теряет и не размножает элементы', () => {
  const src = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  const out = shuffle(src, Math.random);
  assert.deepStrictEqual(out.slice().sort((a, b) => a - b), src);
  assert.deepStrictEqual(src, [0, 1, 2, 3, 4, 5, 6, 7, 8], 'исходный массив изменён на месте');
});
