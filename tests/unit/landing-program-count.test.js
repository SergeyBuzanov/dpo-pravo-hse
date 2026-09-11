/**
 * Число программ в текстах лендинга, которые генератор не пересчитывает:
 * описание для поисковиков, превью ссылки (обе копии – в <head> и во
 * встроенном шаблоне) и текст для браузеров без JavaScript.
 *
 * 11.09.2026 в каталоге стало 27 программ, а эти места остались на 26 –
 * число видно в поисковой выдаче и в превью ссылки в мессенджерах.
 * Счётчики сфер («6 программ повышения квалификации и переподготовки»)
 * считает генератор, их тест не касается.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const total = JSON.parse(fs.readFileSync(path.join(ROOT, '.catalog-data.json'), 'utf8')).programs.length;

test('описание и текст без JavaScript называют столько программ, сколько в каталоге', () => {
  const found = [...html.matchAll(/(\d+) программ (?:повышения квалификации и профессиональной|факультета права)/g)];
  assert.ok(found.length >= 4, `ожидались описание, превью в двух копиях и текст без JavaScript, найдено ${found.length}`);
  for (const [phrase, n] of found) {
    assert.equal(Number(n), total, `«${phrase}» – а в каталоге ${total}`);
  }
});
