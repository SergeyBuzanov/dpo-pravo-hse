'use strict';

/**
 * Слои маскота. Ворона – самая тяжёлая картинка сайта, и она лежит на
 * пути к кнопке заявки: если вес уедет, посетитель на телефоне будет
 * ждать её вместо того, чтобы подать заявку.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const DIR = path.join(ROOT, 'images', 'crow');
const LAYERS = ['torso', 'neck', 'head', 'eyeL', 'eyeR', 'beak', 'mouth', 'arm', 'legL', 'legR', 'body'];
// still.webp (задача 12) – неподвижная ворона страницы 404, целый рисунок
// без нарезки на слои. Он не загружается вместе с 11 слоями (страница 404
// не подключает js/crow-mascot.js вовсе – её CSP запрещает script-src),
// поэтому это ожидаемый ДВЕНАДЦАТЫЙ файл каталога, но у него свой,
// отдельный бюджет веса (см. tests/unit/notfound-crow.test.js), а не общий
// с бюджетом анимированного маскота ниже.
const STILL = 'still.webp';

test('все слои на месте, still.webp – единственный лишний файл', () => {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.webp')).sort();
  assert.deepEqual(files, LAYERS.map((n) => n + '.webp').concat([STILL]).sort());
});

test('исходник целиком в репозиторий не попал (still.webp – не он: это пережатая копия, а не сам rest.png)', () => {
  assert.equal(fs.existsSync(path.join(DIR, 'rest.webp')), false);
  assert.equal(fs.existsSync(path.join(DIR, 'rest.png')), false);
});

test('маскот целиком (11 слоёв, без still.webp) не тяжелее 250 КБ', () => {
  // still.webp сюда осознанно не входит: страница 404 грузит только его,
  // без остальных 11 слоёв и без js/crow-mascot.js – это разные страницы,
  // разные бюджеты, второй проверяется отдельно в notfound-crow.test.js.
  const total = fs.readdirSync(DIR)
    .filter((f) => f.endsWith('.webp') && f !== STILL)
    .reduce((sum, f) => sum + fs.statSync(path.join(DIR, f)).size, 0);
  assert.ok(total <= 250 * 1024, `слои весят ${Math.round(total / 1024)} КБ`);
});
