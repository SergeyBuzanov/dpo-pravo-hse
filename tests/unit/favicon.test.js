'use strict';

/**
 * Иконка сайта – знак центра «ворон на весах» (решение владельца 08.09.2026).
 *
 * Иконку легко потерять на одной странице из семи: она подключается в шапке
 * каждой, а в index.html – ДВАЖДЫ (в статической шапке файла и в блоке
 * helmet внутри шаблона, потому что рантайм заменяет documentElement
 * целиком). Ровно так когда-то потерялась картинка превью ссылки. Тест
 * держит все места разом и падает, если кто-то заведёт страницу без иконки.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { resolveSafe, isAllowedStatic } = require('../../lib/static-http');

const ROOT = path.resolve(__dirname, '..', '..');
const ICONS = [
  'images/logo/favicon-16.png',
  'images/logo/favicon-32.png',
  'images/logo/favicon-48.png',
  'images/logo/apple-touch-icon-180.png',
];

/** Страницы, у которых обязана быть иконка вкладки. */
const PAGES = [
  'index.html',
  '404.html',
  'privacy.html',
  'ratings.html',
  'admin.html',
  'Каталог программ.html',
  'programs/angliyskoe-kontraktnoe-pravo-856421092.html',
];

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('файлы иконки на месте и не пусты', () => {
  for (const icon of ICONS) {
    const stat = fs.statSync(path.join(ROOT, icon));
    assert.ok(stat.size > 500, `${icon} подозрительно мал: ${stat.size} байт`);
  }
});

test('иконка подключена на каждой странице', () => {
  for (const page of PAGES) {
    const html = read(page);
    assert.match(html, /favicon-32\.png/, `нет иконки вкладки: ${page}`);
  }
});

test('в index.html иконка есть в ОБЕИХ копиях шапки', () => {
  // Статическая шапка и helmet внутри шаблона: рантайм заменяет документ
  // целиком, поэтому одной копии мало.
  const html = read('index.html');
  const hits = html.split('favicon-32.png').length - 1;
  assert.ok(hits >= 2, `иконка в index.html найдена ${hits} раз, нужно минимум 2`);
});

test('иконка для iOS подключена там, где страница публичная', () => {
  // admin.html – внутренний инструмент, «на экран Домой» её не ставят.
  for (const page of PAGES.filter((p) => p !== 'admin.html')) {
    assert.match(read(page), /apple-touch-icon-180\.png/, `нет иконки iOS: ${page}`);
  }
});

test('ссылок на снятые файлы не осталось', () => {
  for (const page of PAGES) {
    const html = read(page).replace(/<!--[\s\S]*?-->/g, ' ');
    assert.doesNotMatch(html, /href="[^"]*favicon\.svg"/, `осталась ссылка на favicon.svg: ${page}`);
    assert.doesNotMatch(
      html,
      /href="[^"]*\/?apple-touch-icon\.png"/,
      `осталась ссылка на старый apple-touch-icon.png: ${page}`,
    );
  }
  assert.equal(fs.existsSync(path.join(ROOT, 'favicon.svg')), false);
  assert.equal(fs.existsSync(path.join(ROOT, 'apple-touch-icon.png')), false);
});

test('белый список статики отдаёт иконки наружу', () => {
  for (const icon of ICONS) {
    assert.equal(isAllowedStatic(resolveSafe('/' + icon, ROOT)), true, icon);
  }
});
