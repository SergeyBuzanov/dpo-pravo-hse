/**
 * Публичная выкладка для зеркала.
 *
 * Зеркало на GitHub Pages публикует ветку целиком, поэтому решает не
 * настройка хостинга, а содержимое дерева. Проверка 21.08.2026 показала,
 * что с ветки main наружу отдавались admin.html, docker-compose.yml,
 * .catalog-data.json и tests/run.sh – все с кодом 200.
 *
 * Тест сторожит обе стороны: чтобы лишнее не уехало и чтобы нужное не
 * пропало. Первое опаснее, второе заметнее.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { build, OUT } = require('../../scripts/build-public');

build();

const has = (rel) => fs.existsSync(path.join(OUT, rel));

test('в выкладке есть всё, ради чего она существует', () => {
  for (const rel of [
    'index.html',
    'Каталог программ.html',
    'privacy.html',
    'ratings.html',
    '404.html',
    'robots.txt',
    'sitemap.xml',
    'favicon.svg',
    'apple-touch-icon.png',
    '.nojekyll',
    'content/programs-index.json',
  ]) {
    assert.ok(has(rel), `в публичной выкладке нет ${rel}`);
  }
  assert.ok(fs.readdirSync(path.join(OUT, 'programs')).length > 20, 'страницы программ не скопированы');
  assert.ok(fs.existsSync(path.join(OUT, 'images', 'teachers')), 'портреты не скопированы');
  assert.ok(fs.existsSync(path.join(OUT, 'js', 'bundle')), 'бандл лендинга не скопирован');
});

test('наружу не уезжает ничего, кроме сайта', () => {
  for (const rel of [
    'admin.html',
    'admin-server.js',
    'docker-compose.yml',
    'Dockerfile',
    'docker',
    '.catalog-data.json',
    'package.json',
    'tests',
    'docs',
    'scripts',
    'lib',
    'DESIGN.md',
    'PRODUCT.md',
    'README.md',
    'APPLICATION-FORM.md',
  ]) {
    assert.equal(has(rel), false, `в публичную выкладку попал ${rel}`);
  }
});

test('в выкладке нет ни одного файла, начинающегося с точки, кроме .nojekyll', () => {
  const strays = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // .git появляется после --publish; сама выкладка его не содержит.
        if (entry.name === '.git') continue;
        walk(full);
      } else if (entry.name.startsWith('.') && entry.name !== '.nojekyll') {
        strays.push(path.relative(OUT, full));
      }
    }
  };
  walk(OUT);
  assert.deepEqual(strays, []);
});
