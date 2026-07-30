const test = require('node:test');
const assert = require('node:assert');
const { safeHseUrl, fetchProgramItems, CATALOG_URL } = require('../../lib/hse-catalog');

test('нормальная ссылка на hse.ru проходит как есть', () => {
  assert.strictEqual(safeHseUrl('https://www.hse.ru/edu/dpo/123'), 'https://www.hse.ru/edu/dpo/123');
});

test('поддомен hse.ru проходит', () => {
  assert.strictEqual(safeHseUrl('https://pravo.hse.ru/dpo'), 'https://pravo.hse.ru/dpo');
});

test('javascript: отбрасывается, а не подменяется каталогом', () => {
  // Раньше сюда возвращался CATALOG_URL: карточка молча вела не на свою
  // программу, а на общий список — пользователь этого не замечал.
  assert.strictEqual(safeHseUrl('javascript:alert(1)'), null);
});

test('чужой домен отбрасывается', () => {
  assert.strictEqual(safeHseUrl('https://example.com/phish'), null);
});

test('неразбираемая строка отбрасывается', () => {
  assert.strictEqual(safeHseUrl('не ссылка'), null);
});

// ── фильтрация в fetchProgramItems ────────────────────────────────────
// Подменяем глобальный fetch: сеть в юнит-тестах не нужна, а разобрать надо
// именно ту ветку, где часть программ приходит с негодными ссылками.
function stubFetch(items) {
  const state = JSON.stringify({ items }).replace(/"(\w+)":/g, '$1:');
  const html = `<script>window.__INITIAL_STATE__ = ${state};window.__URQL_DATA__ = {}</script>`;
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => html });
  return () => { globalThis.fetch = original; };
}

test('программа с негодной ссылкой пропускается, остальные остаются', async () => {
  const restore = stubFetch([
    { id: 1, title: 'Хорошая', url: 'https://www.hse.ru/edu/dpo/1' },
    { id: 2, title: 'Плохая', url: 'javascript:alert(1)' },
  ]);
  try {
    const items = await fetchProgramItems(CATALOG_URL);
    assert.deepStrictEqual(items.map((i) => i.title), ['Хорошая']);
  } finally {
    restore();
  }
});

test('если годных ссылок не осталось — обновление отменяется', async () => {
  const restore = stubFetch([{ id: 1, title: 'Плохая', url: 'javascript:alert(1)' }]);
  try {
    await assert.rejects(() => fetchProgramItems(CATALOG_URL), /корректной ссылкой/);
  } finally {
    restore();
  }
});
