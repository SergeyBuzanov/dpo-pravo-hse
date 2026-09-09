'use strict';

/**
 * Заглушка обложки в каталоге (владелец 09.09.2026).
 *
 * У программы «Безопасное внедрение цифровых инструментов в кадровую
 * работу» (id 1129129056) обложки нет: на hse.ru у страницы нет og:image,
 * и в images/programs лежит 25 файлов на 26 программ. Карточка без полосы
 * обложки на телефоне выходила 266px против 372–404 у соседей – ряд
 * читался как поломка, а не как программа без картинки.
 *
 * Решение владельца: ставить фирменную заглушку. Тест держит ТРИ вещи
 * сразу, потому что каждая по отдельности возвращает прежний провал:
 *   - генератор рисует полосу обложки КАЖДОЙ карточке, с картинкой и без;
 *   - у карточки без картинки полоса помечена классом .card-media-blank;
 *   - у этого класса есть своя заливка и знак центра – иначе полоса
 *     осталась бы пустым тёмным прямоугольником поверх чужого градиента.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const CATALOG = read('Каталог программ.html');
const GENERATOR = read('update-catalog.js');

/** Правило целиком по имени селектора. */
function rule(src, selector) {
  const at = src.indexOf(selector + '{') === -1 ? src.indexOf(selector + ' {') : src.indexOf(selector + '{');
  assert.notEqual(at, -1, `правило ${selector} пропало`);
  return src.slice(at, src.indexOf('}', at));
}

test('полоса обложки есть у каждой карточки каталога', () => {
  const cards = CATALOG.match(/<div class="card"/g) || [];
  const covers = CATALOG.match(/class="card-media/g) || [];
  assert.equal(cards.length, 26, 'в каталоге не 26 карточек – проверить .catalog-data.json');
  assert.equal(covers.length, cards.length, 'карточка без полосы обложки снова короче соседей');
});

test('карточка без картинки несёт класс заглушки', () => {
  const at = CATALOG.indexOf('data-id="1129129056"');
  assert.notEqual(at, -1, 'карточка программы 1129129056 пропала из каталога');
  const card = CATALOG.slice(at, at + 2000);
  assert.match(card, /class="card-media card-media-blank"/, 'заглушка на карточке без обложки не проставлена');
  // Внутри заглушки картинки нет: файла обложки не существует, подставлять
  // нечего – полоса красится заливкой и знаком центра.
  const cover = card.slice(card.indexOf('card-media-blank'));
  assert.ok(!/card-thumb/.test(cover.slice(0, 200)), 'в заглушке не должно быть картинки');
});

test('заглушка красится сама: своя заливка и знак центра', () => {
  const base = rule(CATALOG, '.card-media-blank');
  assert.match(base, /linear-gradient/, 'у заглушки нет фирменной заливки');
  const mark = rule(CATALOG, '.card-media-blank::before');
  assert.match(mark, /images\/logo\/brand-mark-96\.webp/, 'знак центра не подставлен');
  assert.match(mark, /border-radius:\s*50%/, 'знак обязан быть кругом: кадр непрозрачный, квадратом он грязный');
  assert.match(rule(CATALOG, '.card-media-blank::after'), /background:\s*none/, 'вуаль притушит знак');
  assert.ok(
    fs.existsSync(path.join(ROOT, 'images/logo/brand-mark-96.webp')),
    'файла знака нет на диске – заглушка выйдет пустой',
  );
  // Порядок правил: .card-media::after и .card-media-blank::after равны по
  // весу (0,1,1), побеждает написанное НИЖЕ. Ловушка шапки 08–09.09.2026
  // повторяться не должна.
  assert.ok(
    CATALOG.indexOf('.card-media-blank::after') > CATALOG.indexOf('.card-media::after'),
    'правило заглушки объявлено выше базового и проигрывает ему по порядку',
  );
});

test('генератор рисует заглушку, когда картинки нет', () => {
  assert.match(GENERATOR, /card-media card-media-blank/, 'update-catalog.js больше не рисует заглушку');
});
