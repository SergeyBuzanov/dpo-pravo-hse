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

