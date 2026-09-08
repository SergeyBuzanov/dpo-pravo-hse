'use strict';

/**
 * Карточки одной высоты (владелец 09.09.2026: «чтобы смотрелись
 * симметрично») – три ленты сразу: программы в «Выборе слушателей», отзывы
 * выпускников и сетка каталога.
 *
 * Тест держит ИМЕННО ПАРУ приёмов, потому что поодиночке каждый уже
 * отменяли и возвращали:
 *   - растяжение до общей высоты (align-items: stretch) – его снимали
 *     01.09 у отзывов и 02.09 у тайлов, потому что в коротких карточках
 *     висела пустота до 200px;
 *   - ограничение текста (ровно три строки у названия и подводки, узкая
 *     полоса длины у цитат) – без него растяжение эту пустоту и создаёт.
 * Вместе они дают ровную высоту БЕЗ пустоты; порознь – возвращают один из
 * двух прежних дефектов.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const INDEX = read('index.html');
const CATALOG = read('Каталог программ.html');
const BUILD = read('scripts/build-landing.js');

/** Правило целиком по имени селектора – в index.html стили лежат одной строкой. */
function rule(src, selector) {
  const at = src.indexOf(selector + ' {');
  const at2 = at === -1 ? src.indexOf(selector + '{') : at;
  assert.notEqual(at2, -1, `правило ${selector} пропало`);
  return src.slice(at2, src.indexOf('}', at2));
}

test('тайлы «Выбора слушателей»: растяжение и ровно три строки текста', () => {
  assert.match(rule(INDEX, '.dpo-top5-track'), /align-items:\s*stretch/, 'тайлы снова разной высоты');
  const title = rule(INDEX, '.dpo-tile-title');
  assert.match(title, /-webkit-line-clamp:\s*3/, 'без ограничения самый длинный заголовок тянет все тайлы');
  assert.match(title, /min-height:\s*calc\(1\.3em \* 3\)/, 'без min-height короткий заголовок роняет тайл');
  const tagline = rule(INDEX, '.dpo-tile-tagline');
  assert.match(tagline, /-webkit-line-clamp:\s*3/, 'подводка обязана держаться в трёх строках');
  assert.match(tagline, /min-height:\s*calc\(1\.55em \* 3\)/, 'подводке нужен постоянный бокс');
});

test('отзывы: растяжение, постоянный бокс цитаты и узкая полоса длины', () => {
  assert.match(rule(INDEX, '.dpo-reviews-track'), /align-items:\s*stretch/, 'карточки отзывов снова разной высоты');
  assert.match(rule(INDEX, '.dpo-review-text'), /min-height:\s*calc\(1\.65em \* 7\)/, 'цитате нужен постоянный бокс');
  // Именно РАЗБРОС ДЛИН давал разницу высот – полоса отбора обязана быть узкой.
  assert.match(
    BUILD,
    /f\.text\.length >= 180 && f\.text\.length <= 380/,
    'полоса длины отзывов расширена – цитаты снова разъедутся по высоте',
  );
});

test('каталог: название ровно в три строки и постоянный ряд овалов', () => {
  const h3 = rule(CATALOG, '.card h3');
  assert.match(h3, /-webkit-line-clamp:\s*3/, 'длинное название снова растянет ряд сетки');
  assert.match(h3, /min-height:\s*calc\(1\.4em \* 3\)/, 'короткое название снова уронит карточку');
  assert.match(rule(CATALOG, '.card .card-tags'), /min-height:\s*26px/, 'перенос овалов гуляет в высоту карточки');
});
