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

test('плитка сферы несёт свой id для цвета, в списке – все программы, «от» – минимальная цена', () => {
  const { html } = renderSpheres([...CORPORATE, ...FINANCE]);
  const cards = html.split('<div class="dpo-sphere" data-sphere="').slice(1);
  assert.equal(cards.length, 2);
  assert.match(cards[0], /^corporate"/);
  assert.match(cards[1], /^finance"/);
  for (const card of cards) assert.doesNotMatch(card, /is-extra|dpo-sphere-more|dpo-sphere-preview/);
  assert.equal(cards[0].split('class="dpo-prog"').length - 1, CORPORATE.length, 'в списке не все программы сферы');
  assert.match(cards[0], /dpo-sphere-count">5 программ · от /);
});

test('сфера с избытком программ ведёт в каталог со своим фильтром', () => {
  const { html } = renderSpheres([...CORPORATE, ...FINANCE]);
  assert.match(html, /href="Каталог программ\.html\?sphere=corporate">Все 5 программ сферы в каталоге</);
});

// Правило сменилось 02.09.2026 (финальная критика: в одной сетке
// соседствовали два разных имени ссылки). Ярлык теперь единый для всех
// сфер, а честность держится числом: оно всегда совпадает с фактическим
// количеством программ сферы – и когда часть скрыта, и когда показаны все.
test('ярлык сферы един и не врёт про число программ', () => {
  const { html } = renderSpheres([...CORPORATE, ...FINANCE]);
  assert.match(html, /href="Каталог программ\.html\?sphere=finance">Все 2 программы сферы в каталоге</);
  assert.doesNotMatch(html, /Открыть сферу в каталоге/);
});

test('em dash из данных не доходит до разметки', () => {
  const p = program('Корпоративное право: основные проблемы');
  p.title = 'Корпоративное право — основные проблемы';
  const { html } = renderSpheres([p]);
  assert.doesNotMatch(html, /—/);
  assert.match(html, /Корпоративное право – основные проблемы/);
});

// Тесты applyHeroStats сняты вместе с самой функцией: полоса показателей
// героя перестроена по указанию заказчика (август 2026) и больше не содержит
// зависящей от каталога ячейки «N программ доп. профобразования».
