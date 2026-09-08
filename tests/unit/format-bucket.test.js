'use strict';

/**
 * Коды форматов – общий словарь каталога, фильтров и бота. Разъедутся –
 * переход «показать в каталоге» приведёт в пустой список.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { formatBucket } = require('../../lib/program-labels');
const updateCatalog = require('../../update-catalog');

test('порядок проверок: составной формат не считается онлайном', () => {
  assert.equal(formatBucket('Смешанный (онлайн + очно)').value, 'mixed');
  assert.equal(formatBucket('Гибридный онлайн').value, 'hybrid');
});

test('основные форматы каталога', () => {
  assert.equal(formatBucket('Онлайн асинхронный').value, 'online');
  assert.equal(formatBucket('Очный').value, 'offline');
});

test('незнакомый формат не выдаётся за известный', () => {
  const out = formatBucket('Индивидуальные консультации');
  assert.equal(out.value, 'other');
  assert.equal(out.label, 'Индивидуальные консультации');
});

test('update-catalog отдаёт ту же функцию, а не свою копию', () => {
  assert.equal(updateCatalog.formatBucket, formatBucket);
});
