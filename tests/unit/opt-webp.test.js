'use strict';

/**
 * Обложки, миниатюры и портреты обязаны иметь WebP-спутник: разметка
 * показывает его через <picture>, и отсутствующий файл даёт битую картинку.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const { webpSibling, picture } = require('../../lib/picture');

function listImages(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((n) => /\.(jpe?g|png)$/i.test(n))
    .map((n) => path.join(dir, n));
}

test('у JPEG/PNG обложек есть WebP-спутник', () => {
  const files = listImages(path.join(ROOT, 'images', 'programs'));
  assert.ok(files.length > 0, 'нет обложек');
  const missing = files.filter((f) => !fs.existsSync(f.replace(/\.(png|jpe?g)$/i, '.webp')));
  assert.deepEqual(missing.map((f) => path.basename(f)), [], 'обложки без WebP');
});

test('у миниатюр обложек есть WebP-спутник', () => {
  const files = listImages(path.join(ROOT, 'images', 'programs', 'thumbs'));
  assert.ok(files.length > 20, `миниатюр мало: ${files.length}`);
  const missing = files.filter((f) => !fs.existsSync(f.replace(/\.(png|jpe?g)$/i, '.webp')));
  assert.deepEqual(missing.map((f) => path.basename(f)), [], 'миниатюры без WebP');
});

test('у портретов преподавателей есть WebP-спутник', () => {
  const files = listImages(path.join(ROOT, 'images', 'teachers'));
  assert.ok(files.length > 40, `портретов мало: ${files.length}`);
  const missing = files.filter((f) => !fs.existsSync(f.replace(/\.(png|jpe?g)$/i, '.webp')));
  assert.deepEqual(missing.map((f) => path.basename(f)), [], 'портреты без WebP');
});

test('picture() ставит loading раньше src и не врёт про отсутствующий спутник', () => {
  const html = picture({
    src: 'images/teachers/x.jpg',
    webp: 'images/teachers/x.webp',
    alt: 'Имя',
    className: 'card-thumb',
    lazy: true,
  });
  assert.match(html, /<picture>/);
  assert.match(html, /type="image\/webp"/);
  const img = html.match(/<img\b[^>]*>/)[0];
  assert.ok(img.indexOf('loading="lazy"') < img.indexOf(' src='), 'src раньше loading');
  assert.equal(picture({ src: 'a.jpg', alt: '' }), '<img loading="lazy" decoding="async" alt="" src="a.jpg">');
});

test('каталог отдаёт обложки через picture и WebP', () => {
  const html = fs.readFileSync(path.join(ROOT, 'Каталог программ.html'), 'utf8');
  assert.match(html, /<picture><source srcset="images\/programs\/thumbs\/\d+\.webp" type="image\/webp">/);
  assert.match(html, /class="card-thumb"[^>]*loading="lazy"/);
});

test('портреты лендинга отдаются через picture и WebP', () => {
  const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const open = '<script type="__bundler/template">\n';
  const start = src.indexOf(open);
  assert.ok(start >= 0);
  const end = src.indexOf('\n  </script>', start + open.length);
  const template = JSON.parse(src.slice(start + open.length, end));
  assert.match(template, /<picture><source srcset="images\/teachers\/[^"]+\.webp" type="image\/webp">/);
});

test('webpSibling возвращает путь только если файл есть', () => {
  const sample = listImages(path.join(ROOT, 'images', 'teachers'))[0];
  assert.ok(sample);
  const rel = path.relative(ROOT, sample).replace(/\\/g, '/');
  assert.equal(webpSibling(ROOT, rel), rel.replace(/\.(png|jpe?g)$/i, '.webp'));
  assert.equal(webpSibling(ROOT, 'images/teachers/no-such-file.jpg'), null);
});
