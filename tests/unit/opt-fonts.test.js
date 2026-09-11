'use strict';

/**
 * Неиспользуемые начертания HSE Sans/Slab не должны висеть в CSS:
 * Thin, Italic и Slab Italic в разметке сайта не встречаются.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const CSS = fs.readFileSync(path.join(ROOT, 'fonts', 'fonts-hse.css'), 'utf8');

test('fonts-hse.css не подключает Thin и курсивы', () => {
  assert.doesNotMatch(CSS, /HSESans-Thin/);
  assert.doesNotMatch(CSS, /HSESans-Italic/);
  assert.doesNotMatch(CSS, /HSESlab-Italic/);
  assert.doesNotMatch(CSS, /src:[^;]*Italic/);
});

test('рабочие начертания на месте', () => {
  assert.match(CSS, /HSESans-Regular/);
  assert.match(CSS, /HSESans-SemiBold/);
  assert.match(CSS, /HSESans-Bold/);
  assert.match(CSS, /HSESlab-Regular/);
  assert.match(CSS, /HSESlab-Black/);
});
