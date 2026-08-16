const test = require('node:test');
const assert = require('node:assert');
const { renderSpheres, applyHeroStats } = require('../../scripts/build-landing');

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

test('в карточке сферы не больше трёх программ', () => {
  const { html } = renderSpheres([...CORPORATE, ...FINANCE]);
  for (const card of html.split('<div class="dpo-sphere">').slice(1)) {
    const shown = card.split('class="dpo-prog"').length - 1;
    assert.ok(shown >= 1 && shown <= 3, `в карточке ${shown} программ`);
  }
});

test('сфера с избытком программ ведёт в каталог со своим фильтром', () => {
  const { html } = renderSpheres([...CORPORATE, ...FINANCE]);
  assert.match(html, /href="Каталог программ\.html\?sphere=corporate">Все 5 программ сферы</);
});

test('сфера из трёх и меньше программ не врёт про число за ссылкой', () => {
  const { html } = renderSpheres([...CORPORATE, ...FINANCE]);
  assert.match(html, /href="Каталог программ\.html\?sphere=finance">Открыть сферу в каталоге</);
  assert.doesNotMatch(html, /Все 2 программы сферы/);
});

test('em dash из данных не доходит до разметки', () => {
  const p = program('Корпоративное право: основные проблемы');
  p.title = 'Корпоративное право — основные проблемы';
  const { html } = renderSpheres([p]);
  assert.doesNotMatch(html, /—/);
  assert.match(html, /Корпоративное право – основные проблемы/);
});

test('число программ в статистике героя подставляется по подписи', () => {
  const tpl = "a\n{ n: '30+', label: 'программ доп. профобразования' }\nb";
  assert.match(applyHeroStats(tpl, 26), /\{ n: '26', label: 'программ доп\. профобразования' \}/);
});

test('пропавшая подпись статистики роняет сборку, а не молчит', () => {
  assert.throws(() => applyHeroStats('никакой статистики тут нет', 26), /не найдена ячейка/);
});
