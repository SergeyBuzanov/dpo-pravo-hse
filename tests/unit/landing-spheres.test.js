const test = require('node:test');
const assert = require('node:assert');
const { renderSpheres } = require('../../scripts/build-landing');

// Программы с названиями из lib/program-spheres.js: раскладка по сферам
// идёт по фрагментам названий, выдуманное название ушло бы в unassigned.
const program = (title, price = 40000, kind = 'ПК', format = 'Онлайн синхронный') => ({
  id: '1',
  title,
  type: { shortTitle: kind, title: kind },
  studyFormat: { title: format },
  educationPricing: price,
  discountPrice: price,
});

const CORPORATE = [
  'Актуальные вопросы гражданского права',
  'Контрактное право Гонконга',
  'Английское контрактное право',
  'Корпоративное право: основные проблемы',
  'Деловые переговоры: правовые стратегии',
].map((t) => program(t));

const FINANCE = [
  program('Правовые вопросы банкротства: теории и практики'),
  program('Исламские финансы: правовые основы'),
];

test('плитка сферы – ссылка в каталог с фильтром сферы и якорем на фильтры, с фактами и виньеткой', () => {
  const { html } = renderSpheres([...CORPORATE, ...FINANCE]);
  const tiles = html.split('<a class="dpo-sphere" data-sphere="').slice(1);
  assert.equal(tiles.length, 2);
  assert.match(tiles[0], /^corporate" href="Каталог программ\.html\?sphere=corporate#filters"/);
  assert.match(tiles[1], /^finance" href="Каталог программ\.html\?sphere=finance#filters"/);
  assert.match(tiles[0], /<span class="dpo-sphere-index">01</);
  assert.match(tiles[0], /<li>5 программ(?: · [^<]*)?<\/li>/);
  assert.match(tiles[1], /<li>2 программы(?: · [^<]*)?<\/li>/);
  for (const tile of tiles) {
    assert.match(tile, /<svg class="dpo-sphere-vignette"/, 'нет виньетки');
    assert.match(tile, /Смотреть программы/, 'нет призыва');
    assert.doesNotMatch(tile, /от \d|dpo-prog-row|dpo-sphere-toggle/, 'цена или список на плитке');
  }
});

test('em dash из данных не доходит до разметки', () => {
  const p = program('Корпоративное право: основные проблемы');
  p.title = 'Корпоративное право — основные проблемы';
  const { html } = renderSpheres([p]);
  assert.doesNotMatch(html, /—/);
  // Названия программ на плитках больше не печатаются (плитка ведёт в каталог),
  // проверяется только отсутствие em dash в разметке секции.
});

// Тесты applyHeroStats сняты вместе с самой функцией: полоса показателей
// героя перестроена по указанию заказчика (август 2026) и больше не содержит
// зависящей от каталога ячейки «N программ доп. профобразования».
