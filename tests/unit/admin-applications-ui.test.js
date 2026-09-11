'use strict';

/**
 * Вкладка заявок должна уметь то, что собирает форма: фильтры, корпоративные
 * поля, кликабельные телефон и почту, бейдж новых и проверку SMTP.
 * Разметка собирается в admin.html – тест читает исходник, чтобы поля не
 * выпали при следующей правке панели.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'admin.html'), 'utf8');

test('на вкладке заявок есть бейдж новых и фильтры статуса/темы', () => {
  assert.match(src, /id="appBadge"/);
  assert.match(src, /data-app-status="new"/);
  assert.match(src, /data-app-topic="course-idea"/);
  assert.match(src, /data-app-topic="teaching"/);
});

test('карточка заявки показывает организацию и даёт tel/mailto', () => {
  assert.match(src, /applicantType === 'corporate'/);
  assert.match(src, /employeesCount/);
  assert.match(src, /timeframe/);
  assert.match(src, /telHref/);
  assert.match(src, /mailto:/);
  assert.match(src, /corp-mark/);
});

test('диагностика умеет предупреждение почты и пробное письмо', () => {
  assert.match(src, /id="mailTestBtn"/);
  assert.match(src, /\/api\/mail\/test/);
  assert.match(src, /c\.warn/);
  assert.match(src, /id="mailBanner"/);
});
