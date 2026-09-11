'use strict';

/**
 * Генератор страниц программ обязан прятать протухшие «Важно».
 * Сверяем живые HTML с isNoticeFresh: если функция говорит «старое»,
 * на странице не должно остаться блока .notice.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const { isNoticeFresh } = require('../../lib/catalog-store');
const { programHref } = require('../../lib/program-slug');

const store = JSON.parse(fs.readFileSync(path.join(ROOT, '.catalog-data.json'), 'utf8'));
const withNotice = (store.programs || []).filter((p) => p.notice && p.notice.text);

test('в каталоге есть объявления – иначе тест не о чем', () => {
  assert.ok(withNotice.length > 0, 'в .catalog-data.json нет ни одного notice');
});

test('протухшее «Важно» не попадает на страницу программы', () => {
  const stale = withNotice.filter((p) => !isNoticeFresh(p.notice));
  assert.ok(stale.length > 0, 'ожидались объявления старше 90 дней – иначе нечего проверять');
  for (const p of stale) {
    const file = path.join(ROOT, programHref(p).replace(/^\//, ''));
    const html = fs.readFileSync(file, 'utf8');
    assert.equal(
      html.includes('class="notice"'),
      false,
      `${path.basename(file)} показывает объявление от ${p.notice.date}`,
    );
  }
});

test('свежее или бессрочное «Важно» остаётся на странице', () => {
  const fresh = withNotice.filter((p) => isNoticeFresh(p.notice));
  for (const p of fresh) {
    const file = path.join(ROOT, programHref(p).replace(/^\//, ''));
    const html = fs.readFileSync(file, 'utf8');
    assert.ok(html.includes('class="notice"'), `${path.basename(file)} потеряла актуальное объявление`);
    assert.match(html, /class="notice-text"/, 'блок «Важно» без текста');
  }
});
