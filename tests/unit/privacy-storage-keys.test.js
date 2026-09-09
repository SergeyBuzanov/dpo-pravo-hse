'use strict';

/**
 * Перечень браузерных настроек в политике ПДн (п. 2.4) обязан совпадать с
 * тем, что сайт действительно кладёт в localStorage.
 *
 * Сверка 09.09.2026 нашла расхождение в обе стороны: политика обещала
 * хранение выбранных для сравнения программ (сравнение живёт только в
 * памяти вкладки) и молчала про три наши отметки – закрытый баннер канала,
 * показанную подсказку помощника и уже показанные фразы первого экрана.
 *
 * Тест ловит появление НОВОГО ключа: политика – публичное обещание, и
 * добавить хранение молча нельзя. Если ключ появился законно, добавьте его
 * и сюда, и в п. 2.4 – одной правкой.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

/** Файлы, где может появиться браузерное хранилище. */
const SOURCES = ['index.html', 'Каталог программ.html', 'privacy.html', 'ratings.html', '404.html']
  .concat(fs.readdirSync(path.join(ROOT, 'js')).filter((f) => f.endsWith('.js')).map((f) => 'js/' + f));

/** Ключи, о которых политика говорит в п. 2.4. */
const DECLARED = new Set([
  'cookie-consent', // выбор по cookies
  'vi-mode', // версия для слабовидящих
  'channel-invite-closed', // закрытый баннер канала Центра
  'crow-askq-shown', // показанная подсказка помощника
  'dpo.slogan.bag.v2', // какие фразы первого экрана уже показаны
  'dpo.slogan.last.v2',
]);

/**
 * Ключи из кода. Имя бывает записано и литералом в вызове, и через
 * константу рядом – ищем оба вида, иначе половина ключей невидима
 * (именно так `channel-invite-closed` и `crow-askq-shown` не попали в
 * первую редакцию политики).
 */
function keysInSource(src) {
  const found = new Set();
  for (const m of src.matchAll(/(?:local|session)Storage\.(?:set|get|remove)Item\(\s*['"]([^'"]+)['"]/g)) {
    found.add(m[1]);
  }
  for (const m of src.matchAll(/(?:KEY|_KEY)\w*\s*=\s*['"]([\w.\-]+)['"]/g)) {
    if (/Storage\.(set|get|remove)Item\(\s*\w*KEY/.test(src)) found.add(m[1]);
  }
  return found;
}

test('в браузере не появилось ключей, о которых политика молчит', () => {
  const found = new Set();
  for (const file of SOURCES) {
    for (const key of keysInSource(read(file))) found.add(key);
  }
  const undeclared = [...found].filter((k) => !DECLARED.has(k));
  assert.deepEqual(
    undeclared,
    [],
    'в localStorage появились ключи, которых нет в п. 2.4 политики: ' + undeclared.join(', '),
  );
});

test('политика перечисляет ровно то, что сайт хранит', () => {
  const policy = read('privacy.html');
  const item = policy.slice(policy.indexOf('<p>2.4.'), policy.indexOf('<p>2.5.'));
  for (const [needle, what] of [
    ['выбор по cookies', 'cookie-consent'],
    ['версии для слабовидящих', 'vi-mode'],
    ['баннера канала', 'channel-invite-closed'],
    ['подсказка помощника', 'crow-askq-shown'],
    ['фразы первого экрана', 'dpo.slogan.*'],
  ]) {
    assert.ok(item.includes(needle), `в п. 2.4 нет упоминания «${needle}» (ключ ${what})`);
  }
  // Сравнение программ в браузере НЕ сохраняется – обещать его нельзя.
  assert.ok(
    /в браузере не сохраняется/.test(item),
    'из п. 2.4 пропала оговорка, что список сравнения не сохраняется',
  );
  const compare = read('js/compare.js');
  assert.ok(
    !/localStorage|sessionStorage/.test(compare),
    'сравнение начало что-то сохранять – политика в п. 2.4 утверждает обратное',
  );
});
