'use strict';

/**
 * Ворона, карусель и бот не должны конкурировать с первым экраном:
 * 11 слоёв маскота ждут простоя, автоход ленты – появления в кадре,
 * данные бота и раньше грузились только при открытии окна.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('ворона монтируется после load и простоя, а не сразу', () => {
  const src = read('js/crow-launcher.js');
  assert.match(src, /function whenIdle/);
  assert.match(src, /requestIdleCallback/);
  assert.match(src, /pointerdown/);
  const boot = src.slice(src.indexOf('function boot('));
  assert.match(boot, /whenIdle\(mount\)/);
  assert.match(boot, /addEventListener\('load'/);
});

test('автоход карусели не крутит rAF, пока лента не в кадре', () => {
  const src = read('js/carousel.js');
  assert.match(src, /function startRaf/);
  assert.match(src, /rafStarted/);
  assert.match(src, /if \(!io\) startRaf\(\)/);
  assert.doesNotMatch(
    src,
    /window\.requestAnimationFrame\(step\);\s*\n\s*window\.requestAnimationFrame\(step\)/,
  );
});

test('бот по-прежнему тянет данные при первом открытии, не при загрузке', () => {
  const src = read('js/support-bot.js');
  assert.match(src, /ПЕРВОМ открытии окна/);
  const load = src.slice(src.indexOf('function load('), src.indexOf('function load(') + 900);
  assert.match(load, /fetch\(href\(CATALOG_URL\)/);
  assert.match(src, /document\.addEventListener\('click'/);
});
