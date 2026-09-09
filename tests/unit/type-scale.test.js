'use strict';

/**
 * Шкала кеглей: код обязан совпадать с таблицей Typography в DESIGN.md.
 *
 * Долг тянулся с прогона 03.09.2026: хук дизайна ругался на пять файлов, а
 * гасить по одному значению нельзя – набегала вторая, недокументированная
 * шкала. Здесь она закрыта целиком: каждое значение font-size в этих
 * файлах – либо ступень таблицы, либо санкционированное исключение,
 * записанное в DESIGN.md.
 *
 * Что было снято (замер 09.09.2026): 0.9062rem (14,5px, 6 мест),
 * 0.8438rem (13,5px, 3), 0.875rem (14px, 5), 0.7812rem (12,5px, 3),
 * 1.0625rem (17px, 4), 0.75rem (12px, 1) – это дрейф в полпикселя-пиксель
 * от соседней ступени, и три разных кегля крестика в трёх окнах.
 *
 * ВАЖНО: тест держит ПЯТЬ файлов, а не весь сайт. На лендинге, в каталоге
 * и в админке своя очередь – там 18 разных clamp и пиксельные остатки,
 * это отдельное решение владельца (Known Gaps в DESIGN.md).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

/** Ступени таблицы Typography в DESIGN.md, как они записаны в коде. */
const SCALE = new Set([
  'clamp(2.25rem,5.4vw,4.25rem)', // display
  'clamp(1.75rem,3.2vw,2.625rem)', // headline
  'clamp(1.5rem,2.8vw,2.125rem)', // headline-compact
  'clamp(1.5rem,2.3vw,2.125rem)', // title-xl
  'clamp(1.3125rem,2.2vw,1.75rem)', // title-lg
  'clamp(1.375rem,2vw,1.875rem)', // numeral
  '1.3125rem', // title, родственный
  '1.25rem', // title, родственный (сжатая шапка)
  '1.1875rem', // title
  '1.125rem', // крестик окна – единый глиф четырёх окон
  '1.0938rem', // lede
  '1rem', // body
  '0.9688rem', // ui, родственный
  '0.9375rem', // ui
  '0.8125rem', // caption и label
  '0.6875rem', // micro-caps
  '0.5625rem', // lockup-sub
]);

/**
 * Санкционированные исключения – записаны в DESIGN.md с обоснованием.
 * Декоративная цифра «404» не текст: она рисует фон страницы и в шкале
 * витрины ей места нет.
 */
const SANCTIONED = new Set([
  'clamp(12.5rem,34vw,28.75rem)',
  '46vw',
]);

const FILES = [
  'js/application-form.js',
  '404.html',
  'scripts/build-program-pages.js',
  'js/channel-invite.js',
  'js/compare.js',
];

/** Все значения font-size файла, с номером строки и без лишних пробелов. */
function sizes(src) {
  const out = [];
  src.split('\n').forEach((line, i) => {
    const re = /font-size:\s*([^;'"}\n]+)/g;
    let m;
    while ((m = re.exec(line))) out.push({ line: i + 1, value: m[1].trim().replace(/\s+/g, '') });
  });
  return out;
}

for (const file of FILES) {
  test(`${file}: кегли только из шкалы DESIGN.md`, () => {
    const off = sizes(read(file)).filter((s) => !SCALE.has(s.value) && !SANCTIONED.has(s.value));
    assert.deepEqual(
      off,
      [],
      `вне шкалы: ${off.map((s) => `${s.value} (строка ${s.line})`).join(', ')}`,
    );
  });
}

test('крестик во всех окнах одного кегля', () => {
  // Было три разных: 1.25rem в заявке, 1.0625rem в приглашении канала,
  // 1.125rem в сравнении и в образце документа. Окно – один словарь.
  for (const file of ['js/application-form.js', 'js/channel-invite.js', 'js/compare.js', 'js/doc-preview.js']) {
    const src = read(file);
    const closeSizes = src
      .split('\n')
      .filter((l) => /close\{|close \{/.test(l) || (/font-size/.test(l) && /close/.test(l)))
      .join(' ')
      .match(/font-size:\s*([\d.]+rem)/g) || [];
    for (const s of closeSizes) {
      assert.match(s, /1\.125rem/, `${file}: крестик выбился из словаря окна`);
    }
  }
});

test('DESIGN.md знает ступень title-lg и единый крестик', () => {
  const design = read('DESIGN.md');
  assert.match(design, /title-lg/, 'ступень title-lg не внесена в таблицу');
  assert.match(design, /clamp\(1\.3125rem, 2\.2vw, 1\.75rem\)/, 'значение title-lg не записано');
  assert.match(design, /крестик.*1\.125rem|1\.125rem.*крестик/s, 'кегль крестика окна не записан');
});
