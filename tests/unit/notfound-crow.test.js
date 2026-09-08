'use strict';

/**
 * Страница 404 объявляет собственную строгую CSP без script-src (JavaScript
 * там запрещён целиком), поэтому маскот здесь – обычная неподвижная
 * картинка, а не виджет js/crow-mascot.js. Тест держит два факта разом:
 * картинка на месте, и политика ради неё не ослаблена.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const HTML = fs.readFileSync(path.join(ROOT, '404.html'), 'utf8');

test('на 404 есть неподвижная ворона – обычный img, alt пустой', () => {
  const match = HTML.match(/<img[^>]*images\/crow\/still\.webp[^>]*>/);
  assert.ok(match, 'нет img на images/crow/still.webp');
  assert.match(match[0], /alt=""/, 'alt должен быть пустым – картинка декоративна, смысл несёт текст рядом');
});

test('на 404 нет ни одного тега <script> и CSP не ослаблена', () => {
  assert.doesNotMatch(HTML, /<script/i, 'страница-ошибки обязана оставаться без JS');
  const csp = HTML.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
  assert.ok(csp, 'мета-тег CSP пропал со страницы');
  assert.doesNotMatch(csp[1], /script-src/, 'script-src появляться не должен – скрипты по-прежнему запрещены целиком');
  assert.match(csp[1], /default-src 'none'/, 'default-src \'none\' – самая строгая политика на сайте, её нельзя ослаблять');
});

test('images/crow/still.webp существует и укладывается в бюджет 60 КБ', () => {
  const file = path.join(ROOT, 'images', 'crow', 'still.webp');
  assert.ok(fs.existsSync(file), 'нет images/crow/still.webp');
  const size = fs.statSync(file).size;
  assert.ok(size <= 60 * 1024, `still.webp весит ${Math.round(size / 1024)} КБ, бюджет – 60 КБ`);
});
