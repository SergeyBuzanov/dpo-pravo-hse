const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

// Каскад появления карточек задан списком селекторов в js/smooth-ui.js.
// Два из них (.dpo-top5-grid и .dpo-why-card) указывали на классы, которых
// в разметке нет, – каскад в «Топ-5» и «Почему выбирают» не работал ни дня,
// и заметить это по коду было нельзя: несовпавший селектор молчит.
// Сторож сверяет список с настоящей разметкой лендинга.

/** Список CARD_CASCADE из js/smooth-ui.js, без комментариев. */
function cascadeSelectors() {
  const src = fs
    .readFileSync(path.join(ROOT, 'js', 'smooth-ui.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
  const block = src.match(/const CARD_CASCADE = \[([\s\S]*?)\]\.join/);
  assert.ok(block, 'в js/smooth-ui.js не найден список CARD_CASCADE');
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/** Все классы, встречающиеся в разметке лендинга. */
function landingClasses() {
  // Разметка index.html лежит JSON-строкой: кавычки и переводы строк
  // экранированы, без разэкранирования атрибуты не находятся.
  const src = fs
    .readFileSync(path.join(ROOT, 'index.html'), 'utf8')
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n');
  const set = new Set();
  for (const m of src.matchAll(/class="([^"]*)"/g)) {
    m[1].split(/\s+/).forEach((c) => c && set.add(c));
  }
  return set;
}

test('каждый селектор каскада опирается на класс, который есть в разметке', () => {
  const classes = landingClasses();
  for (const sel of cascadeSelectors()) {
    for (const cls of sel.match(/\.[\w-]+/g) || []) {
      assert.ok(
        classes.has(cls.slice(1)),
        `селектор каскада «${sel}» ссылается на класс ${cls}, которого нет в разметке`,
      );
    }
  }
});

test('плитки «Топ-5» и строки «Почему выбирают» входят в каскад', () => {
  const selectors = cascadeSelectors();
  assert.ok(
    selectors.some((s) => s.includes('.dpo-top5-track') && s.includes('.dpo-tile')),
    'плитки ленты «Топ-5» выпали из каскада появления',
  );
  assert.ok(
    selectors.some((s) => s.includes('.dpo-why-row')),
    'строки блока «Почему выбирают» выпали из каскада появления',
  );
});
