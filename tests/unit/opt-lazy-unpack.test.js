'use strict';

/**
 * После document.documentElement.replaceWith браузер считает все картинки
 * видимыми и качает их разом. Распаковщик обязан снять src до подмены и
 * вернуть его IntersectionObserver'ом.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function unpacker() {
  const start = INDEX.indexOf("const templateEl = document.querySelector('script[type=\"__bundler/template\"]')");
  const end = INDEX.indexOf('Bundle unpack error:');
  assert.ok(start >= 0 && end > start, 'не найден распаковщик лендинга');
  return INDEX.slice(start, end);
}

const SRC = unpacker();

test('перед replaceWith адреса картинок уходят в data-dpo-src', () => {
  assert.match(SRC, /function holdTree\(/);
  assert.match(SRC, /data-dpo-src/);
  const holdAt = SRC.indexOf('holdTree(doc)');
  const swapAt = SRC.indexOf('document.documentElement.replaceWith');
  assert.ok(holdAt >= 0 && swapAt > holdAt, 'holdTree должен идти до replaceWith');
});

test('после подмены адреса возвращает IntersectionObserver, а не все сразу', () => {
  assert.match(SRC, /function armLazyRelease\(/);
  assert.match(SRC, /new IntersectionObserver/);
  assert.match(SRC, /rootMargin:\s*margin\s*\+\s*'px 0px'/);
  const swapAt = SRC.indexOf('document.documentElement.replaceWith');
  const armAt = SRC.lastIndexOf('armLazyRelease()');
  assert.ok(armAt > swapAt, 'вызов armLazyRelease должен идти после replaceWith');
});

test('герой и знак центра не откладываются', () => {
  assert.match(SRC, /hero-bg|brand-mark/);
  assert.match(SRC, /function isEagerImg/);
});
