/**
 * Справочник программ для формы заявки.
 *
 * Форма (js/application-form.js) строит из него список «Программа»: без
 * него человек, открывший окно из шапки, не может назвать программу, и в
 * учебный офис уходит заявка без предмета. Проверяется ровно то, на чём
 * это ломается молча: файл на месте, состав совпадает с каталогом, адреса
 * относительные (сайт живёт и на своём домене, и в подкаталоге зеркала),
 * и белый список статики пускает .json из content/ – но только .json.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { resolveSafe, isAllowedStatic } = require('../../lib/static-http');

const ROOT = path.resolve(__dirname, '..', '..');
const INDEX = path.join(ROOT, 'content', 'programs-index.json');
const STORE = path.join(ROOT, '.catalog-data.json');

const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

test('справочник программ собран и не пуст', () => {
  assert.ok(fs.existsSync(INDEX), 'нет content/programs-index.json – запустите build-program-pages');
  const { programs } = read(INDEX);
  assert.ok(Array.isArray(programs) && programs.length > 0);
});

test('состав справочника совпадает с каталогом', () => {
  const catalog = read(STORE).programs || [];
  const indexed = read(INDEX).programs;
  assert.equal(indexed.length, catalog.length);
  const catalogIds = new Set(catalog.map((p) => String(p.id)));
  for (const item of indexed) {
    assert.ok(catalogIds.has(item.id), `в справочнике программа не из каталога: ${item.id}`);
    assert.ok(item.title, `у программы ${item.id} нет названия`);
    assert.ok(item.sphere, `у программы ${item.id} нет сферы`);
  }
});

test('адреса программ относительные: домен подставляется браузером', () => {
  for (const item of read(INDEX).programs) {
    assert.match(item.url, /^programs\/[^/]+\.html$/, `подозрительный адрес: ${item.url}`);
  }
});

test('страница программы из справочника действительно существует', () => {
  for (const item of read(INDEX).programs) {
    assert.ok(fs.existsSync(path.join(ROOT, item.url)), `нет страницы ${item.url}`);
  }
});

test('белый список статики отдаёт content/*.json', () => {
  assert.equal(isAllowedStatic(resolveSafe('/content/programs-index.json', ROOT)), true);
});

test('в content/ публичен только .json и только один уровень', () => {
  assert.equal(isAllowedStatic(resolveSafe('/content/secrets.txt', ROOT)), false);
  assert.equal(isAllowedStatic(resolveSafe('/content/sub/inner.json', ROOT)), false);
});
