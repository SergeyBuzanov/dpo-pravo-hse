'use strict';

/**
 * Ворона в углу не должна уезжать за кромку экрана.
 *
 * Живой дефект 09.09.2026 (владелец: «ворона пропала с угла справа внизу»):
 * js/support-bot.js уводит ворону и панель от баннера cookies и мобильной
 * полосы-CTA – keepAboveBanners() пишет им `style.bottom`. Когда ни баннера,
 * ни полосы на экране нет, значение пустое, а пустая строка в style.bottom
 * не «возвращает как было», а СТИРАЕТ объявление. У маскота `bottom: 0` жил
 * только в инлайновом стиле (js/crow-mascot.js, build()) – и исчезал вместе
 * с ним. Фиксированный элемент без top/bottom встаёт в статическую позицию:
 * замер показал bottom: -209px, ворона целиком ниже кромки окна.
 *
 * Поэтому опора обязана быть в СТИЛЕВОМ ПРАВИЛЕ, а не только в инлайне:
 * инлайн его перекрывает, когда надо увернуться от баннера, и возвращает
 * управление правилу, когда уворачиваться не от чего.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const LAUNCHER = read('js/crow-launcher.js');
const BOT = read('js/support-bot.js');

test('js/crow-launcher.js: у углового маскота есть опора bottom в правиле', () => {
  // Правило собирается склейкой ('...' + edge + '...'), поэтому берём
  // кусок исходника от селектора до закрывающей скобки правила.
  const at = LAUNCHER.indexOf('body>.crow-mascot{');
  assert.notEqual(at, -1, 'правило body>.crow-mascot пропало из инжектируемых стилей');
  const rule = LAUNCHER.slice(at, LAUNCHER.indexOf('}', at));
  assert.match(rule, /bottom:0/, 'нет bottom:0 – стёртый инлайн уронит ворону под кромку окна');
});

test('js/support-bot.js: keepAboveBanners по-прежнему пишет bottom трём элементам угла', () => {
  // Тест держит связь между двумя файлами: если селекторы разъедутся,
  // причина дефекта вернётся, а правило-опора станет бессмысленным.
  const fn = BOT.slice(BOT.indexOf('function keepAboveBanners'), BOT.indexOf('function keepAboveBanners') + 1600);
  assert.match(fn, /'body>\.crow-mascot'/, 'угловой маскот выпал из списка');
  assert.match(fn, /style\.bottom = value/, 'keepAboveBanners перестал писать bottom');
});
