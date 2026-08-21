/**
 * Спутники картинок и порядок атрибутов – две вещи, которые ломаются молча.
 *
 * 1. <picture> с WebP: если <source> указывает на исчезнувший файл, браузер
 *    НЕ откатывается на <img> – источник уже выбран, и посетитель видит
 *    пустую рамку вместо бланка. Спутники держит в синхроне
 *    scripts/fetch-program-media.js, но проверить наличие дешевле, чем
 *    заметить дыру глазами.
 *
 * 2. loading="lazy" обязано стоять ДО src: рантайм лендинга – React, он
 *    присваивает пропсы по порядку, а браузер включает ленивую загрузку
 *    только если атрибут выставлен раньше адреса. При обратном порядке все
 *    64 портрета и четыре скана качались сразу – 2,35 МБ ниже сгиба
 *    (замер 21.08.2026).
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

/** Разметка лендинга лежит JSON-строкой внутри script type=__bundler/template. */
function landingTemplate() {
  const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const open = '<script type="__bundler/template">\n';
  const start = src.indexOf(open);
  assert.ok(start >= 0, 'в index.html не найден блок шаблона');
  const end = src.indexOf('\n  </script>', start + open.length);
  return JSON.parse(src.slice(start + open.length, end));
}

const template = landingTemplate();

test('у каждого <source> с WebP есть файл', () => {
  const sources = [...template.matchAll(/<source[^>]+srcset="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(sources.length > 0, 'в шаблоне не осталось ни одного <source> – проверка потеряла смысл');
  for (const src of sources) {
    assert.ok(fs.existsSync(path.join(ROOT, src)), `нет файла ${src}, картинка будет битой`);
  }
});

test('у каждого <source> есть запасной <img> с существующим файлом', () => {
  const pictures = [...template.matchAll(/<picture>([\s\S]*?)<\/picture>/g)].map((m) => m[1]);
  assert.ok(pictures.length > 0);
  for (const inner of pictures) {
    const fallback = inner.match(/<img[^>]+src="([^"]+)"/);
    assert.ok(fallback, 'в <picture> нет запасного <img>');
    assert.ok(fs.existsSync(path.join(ROOT, fallback[1])), `нет запасного файла ${fallback[1]}`);
  }
});

test('loading="lazy" стоит раньше src у всех отложенных картинок', () => {
  const imgs = [...template.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
  const lazy = imgs.filter((tag) => /loading="lazy"/.test(tag));
  assert.ok(lazy.length > 50, `отложенных картинок всего ${lazy.length} – похоже, разметка изменилась`);
  for (const tag of lazy) {
    const posLoading = tag.indexOf('loading="lazy"');
    const posSrc = tag.indexOf(' src=');
    assert.ok(posSrc === -1 || posLoading < posSrc, `src раньше loading: ${tag.slice(0, 110)}…`);
  }
});

test('сканы бланков отдаются в WebP, а не палитровым PNG', () => {
  for (const base of ['document-pk', 'document-pp', 'document-vo', 'document-cert']) {
    const webp = path.join(ROOT, 'images', `${base}.webp`);
    assert.ok(fs.existsSync(webp), `нет ${base}.webp`);
    const size = fs.statSync(webp).size;
    assert.ok(size < 120 * 1024, `${base}.webp весит ${Math.round(size / 1024)} КБ – больше порога 120 КБ`);
  }
});
