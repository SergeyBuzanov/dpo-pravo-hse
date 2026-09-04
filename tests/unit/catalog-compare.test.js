/**
 * Сравнение программ: договор между генератором карточек и скриптом.
 *
 * Таблица сравнения читает данные ИЗ КАРТОЧЕК (data-cmp-*), которые пишет
 * `update-catalog.js`. Стоит переименовать атрибут в генераторе – и таблица
 * молча заполнится прочерками: ошибки в консоли не будет, страница не
 * упадёт, а сравнивать станет нечего. Поэтому тест сводит обе стороны:
 * какие атрибуты просит `js/compare.js` и какие есть на карточках.
 *
 * Остальное – про то, чем сравнение живёт: у карточки должен быть свой
 * `data-id` (по нему собирается адрес ?compare=…, и он обязан быть
 * единственным), а у каждой – ровно одна отметка «Сравнить».
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const CATALOG = fs.readFileSync(path.join(ROOT, 'Каталог программ.html'), 'utf8');
const SCRIPT = fs.readFileSync(path.join(ROOT, 'js', 'compare.js'), 'utf8');

/** Открывающие теги карточек каталога. */
const CARDS = CATALOG.match(/<div class="card"[^>]*>/g) || [];

test('каталог отдаёт карточки со своим id, и id не повторяются', () => {
  assert.ok(CARDS.length >= 20, `карточек нашлось ${CARDS.length}`);
  const ids = CARDS.map((tag) => (tag.match(/data-id="([^"]*)"/) || [])[1]);
  assert.ok(ids.every(Boolean), 'у карточки нет data-id');
  assert.equal(new Set(ids).size, ids.length, 'data-id повторяется – выбор перепутает программы');
  // Адрес ?compare=id,id разбирается по запятой и проверяется маской.
  assert.ok(ids.every((id) => /^[\w-]{1,40}$/.test(id)), 'id не проходит маску из compare.js');
});

test('у каждой карточки ровно одна отметка «Сравнить»', () => {
  const toggles = CATALOG.match(/data-compare-toggle/g) || [];
  assert.equal(toggles.length, CARDS.length, 'отметок не столько же, сколько карточек');
  const pressed = CATALOG.match(/class="card-compare"[\s\S]{0,200}?aria-pressed="false"/g) || [];
  assert.equal(pressed.length, CARDS.length, 'отметка приходит не в снятом состоянии');
  const labels = CATALOG.match(/class="card-compare"[\s\S]{0,300}?aria-label="Сравнить: [^"]+"/g) || [];
  assert.equal(labels.length, CARDS.length, 'у отметки нет доступного имени с названием программы');
});

test('скрипт просит только те данные, которые генератор кладёт в карточку', () => {
  const asked = [...new Set((SCRIPT.match(/data-cmp-[a-z-]+/g) || []))];
  assert.ok(asked.length >= 5, `в compare.js нашлось ${asked.length} полей – разбор сломался`);
  for (const name of asked) {
    const present = CARDS.filter((tag) => tag.includes(`${name}="`)).length;
    assert.equal(present, CARDS.length, `${name}: есть у ${present} карточек из ${CARDS.length}`);
  }
});

test('скрипт подключён к каталогу и знает про предел в три программы', () => {
  assert.match(CATALOG, /<script src="js\/compare\.js" defer><\/script>/, 'compare.js не подключён');
  assert.match(SCRIPT, /var MAX = 3;/, 'предел сравнения изменился – решение владельца было «до трёх»');
});

test('данные для таблицы не пусты: формат, модули и преподаватели заполнены у всех', () => {
  for (const name of ['data-cmp-format', 'data-cmp-modules', 'data-cmp-teachers']) {
    const empty = CARDS.filter((tag) => tag.includes(`${name}=""`)).length;
    assert.equal(empty, 0, `${name} пуст у ${empty} карточек – в таблице будет прочерк`);
  }
});
