'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { slugify, programHref, MAX_SLUG } = require('../../lib/program-slug');

test('кириллица транслитерируется, пробелы и знаки становятся дефисами', () => {
  assert.equal(slugify('Актуальные вопросы гражданского права'), 'aktualnye-voprosy-grazhdanskogo-prava');
  assert.equal(slugify('Юриспруденция: правовое регулирование бизнеса (2026)'), 'yurisprudentsiya-pravovoe-regulirovanie-biznesa-2026');
});

test('ё, ъ и ь не ломают слаг; латиница и цифры остаются', () => {
  assert.equal(slugify('Съёмка объектов'), 'semka-obektov');
  assert.equal(slugify('LegalTech 2.0'), 'legaltech-2-0');
});

test('длина ограничена MAX_SLUG без висящего дефиса', () => {
  const slug = slugify('слово '.repeat(40));
  assert.ok(slug.length <= MAX_SLUG);
  assert.doesNotMatch(slug, /-$/);
});

test('пустой или бессмысленный заголовок даёт запасной слаг', () => {
  assert.equal(slugify(''), 'programma');
  assert.equal(slugify('!!!'), 'programma');
});

test('programHref: слаг плюс очищенный id в папке programs', () => {
  assert.equal(programHref({ id: '958734693', title: 'Гражданское право' }), 'programs/grazhdanskoe-pravo-958734693.html');
  assert.equal(programHref({ id: '../x', title: 'Право' }), 'programs/pravo-x.html');
  assert.equal(programHref({ title: 'Право' }), 'programs/pravo.html');
});
