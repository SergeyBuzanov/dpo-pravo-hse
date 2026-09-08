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

test('все слои на месте и ни одного лишнего', () => {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.webp')).sort();
  assert.deepEqual(files, LAYERS.map((n) => n + '.webp').sort());
});

test('исходник целиком в репозиторий не попал', () => {
  assert.equal(fs.existsSync(path.join(DIR, 'rest.webp')), false);
  assert.equal(fs.existsSync(path.join(DIR, 'rest.png')), false);
});

test('маскот целиком не тяжелее 250 КБ', () => {
  const total = fs.readdirSync(DIR)
    .filter((f) => f.endsWith('.webp'))
    .reduce((sum, f) => sum + fs.statSync(path.join(DIR, f)).size, 0);
  assert.ok(total <= 250 * 1024, `слои весят ${Math.round(total / 1024)} КБ`);
});
