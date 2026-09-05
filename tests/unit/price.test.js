const test = require('node:test');
const assert = require('node:assert');
const { formatPrice } = require('../../lib/hse-catalog');

test('цена задана — форматируется с рублём', () => {
  assert.strictEqual(formatPrice({ educationPricing: 50000 }), '50 000 ₽');
});

test('есть скидочная цена — она в приоритете', () => {
  assert.strictEqual(formatPrice({ educationPricing: 50000, discountPrice: 40000 }), '40 000 ₽');
});

test('явный ноль — Бесплатно', () => {
  assert.strictEqual(formatPrice({ educationPricing: 0 }), 'Бесплатно');
});

test('цена отсутствует — Цена по запросу, а не Бесплатно', () => {
  assert.strictEqual(formatPrice({}), 'Цена по запросу');
  assert.strictEqual(formatPrice({ educationPricing: null }), 'Цена по запросу');
  assert.strictEqual(formatPrice({ educationPricing: undefined }), 'Цена по запросу');
});


// Цена не спорит с названием программы (владелец 05.09.2026, вечер): нигде
// на сайте она не набирается жирным. Смотрим на ПРАВИЛА, а не на текст
// файла: комментарии вырезаются, иначе проверка ловит слово «price» в
// пояснении – ловушка, уже трижды стоившая времени в этом проекте.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

/** Весь CSS страницы: и отдельным файлом, и всеми блоками <style>. */
function cssOf(file) {
  // В index.html разметка лежит JSON-строкой, переводы строк в ней
  // экранированы – без разэкранирования правила слипаются в одну строку.
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\\n/g, '\n');
  const raw = file.endsWith('.css')
    ? src
    : [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
  return raw.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/** Правила, чей селектор упоминает цену. */
function priceRules(css) {
  const out = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim();
    if (/(^|[\s.#>,])[\w-]*price/i.test(selector)) out.push({ selector, body: m[2] });
  }
  return out;
}

for (const file of ['programs/program.css', 'Каталог программ.html', 'index.html']) {
  test(`${file}: цена набрана обычным начертанием`, () => {
    const rules = priceRules(cssOf(file));
    assert.ok(rules.length > 0, `в ${file} не найдено ни одного правила цены`);
    for (const rule of rules) {
      const weight = /font-weight\s*:\s*([^;]+)/i.exec(rule.body);
      if (!weight) continue;
      const value = weight[1].trim();
      assert.ok(
        !/bold|[6-9]00/i.test(value),
        `${file}: «${rule.selector}» набрана жирным (font-weight: ${value})`,
      );
    }
  });
}
