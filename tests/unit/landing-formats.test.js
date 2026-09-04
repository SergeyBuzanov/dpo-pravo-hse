const test = require('node:test');
const assert = require('node:assert');
const { renderFormats } = require('../../scripts/build-landing');

// Программа каталога в том виде, в каком её читает генератор: тип, форма
// обучения, длительность строкой из источника и цена.
const program = (kind, format, duration, price = 40000) => ({
  id: '1',
  title: 'Программа',
  type: { shortTitle: kind, title: kind },
  studyFormat: { title: format },
  duration,
  educationPricing: price,
  discountPrice: price,
});

const PK = [
  program('ПК', 'Онлайн синхронный', '2 недели', 22000),
  program('ПК', 'Очный', '3 месяца'),
  program('ПК', 'Смешанный', null),
  program('ПК', 'Онлайн асинхронный', '1 месяц'),
];

const PP = [
  program('ПП', 'Смешанный', '6 месяцев', 130000),
  program('ПП', 'Гибридный (обучение проходит очно и параллельно в онлайн)', '8 месяцев'),
];

const cards = (html) => html.split('<li class="dpo-format">').slice(1);

test('карточка формата: номер ступени, водяной знак и строка фактов', () => {
  const html = renderFormats([...PK, ...PP]);
  const list = cards(html);
  assert.equal(list.length, 4, 'форматов в блоке четыре');

  // Номер – порядок ступени, а не число программ: его заказчик убрал 18.08.2026.
  list.forEach((card, i) => {
    const n = String(i + 1).padStart(2, '0');
    assert.match(card, new RegExp(`<span class="dpo-format-index">${n}</span>`), `нет номера ${n}`);
    assert.match(card, /<span class="dpo-format-doc" aria-hidden="true" style="top: -\d+px">/, 'нет скана бланка со своим сдвигом кадра');
    assert.match(card, /<source srcset="images\/document-[a-z]+\.webp" type="image\/webp">/, 'бланк без webp');
    assert.match(card, /<img loading="lazy" decoding="async" width="1200" height="84[78]" alt="" src="images\/document-[a-z]+\.(?:png|jpg)">/, 'бланк без размеров или запасного формата');
    assert.doesNotMatch(card, /dpo-format-vignette/, 'водяной знак остался вместе с бланком');
  });
  assert.doesNotMatch(html, /\d+ программ/, 'в блок вернулось число программ');

  // Длительность: единица одна на обе границы, если совпадает. «Обычно» –
  // потому что в каталоге длительность заполнена не у всех программ.
  assert.match(list[0], /<span class="dpo-format-stat-key">Длительность<\/span>обычно 2 недели – 3 месяца</);
  assert.match(list[1], /<span class="dpo-format-stat-key">Длительность<\/span>6 – 8 месяцев</);
  assert.match(list[0], /<span class="dpo-format-stat-key">Занятия<\/span>онлайн, очно и смешанно</);
  assert.match(list[1], /<span class="dpo-format-stat-key">Занятия<\/span>смешанно</);
});

test('формат без программ в каталоге остаётся без строки фактов, но с номером и знаком', () => {
  const list = cards(renderFormats([...PK, ...PP]));
  for (const card of list.slice(2)) {
    assert.doesNotMatch(card, /dpo-format-stats/, 'выдуманные факты у формата вне каталога');
    assert.match(card, /<span class="dpo-format-index">0[34]<\/span>/);
    assert.match(card, /<span class="dpo-format-doc"/);
  }
});

test('каждому формату – свой бланк, все четыре разные', () => {
  const list = cards(renderFormats([...PK, ...PP]));
  const files = list.map((c) => /src="images\/(document-[a-z]+)\./.exec(c)[1]);
  assert.deepEqual(files, ['document-pk', 'document-pp', 'document-cert', 'document-vo']);
});

test('тексты заказчика в карточке не тронуты', () => {
  const html = renderFormats([...PK, ...PP]);
  assert.match(html, /Короткие и ёмкие курсы для практикующих юристов/);
  assert.match(html, /Итоговый документ: удостоверение о повышении квалификации/);
  assert.match(html, /Итоговый документ: диплом о высшем образовании/);
  assert.doesNotMatch(html, /—/, 'em dash в разметке блока');
});
