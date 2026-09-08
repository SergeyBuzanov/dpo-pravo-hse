'use strict';

/**
 * Окно поддержки после правок владельца 09.09.2026:
 *   - называется «Поддержка», слова «бот» в интерфейсе нет;
 *   - растёт от САМОГО НИЗА экрана, а не висит выше кромки;
 *   - в шапке живая ворона, ответ приходит после паузы «печатает…» и кивка –
 *     чтобы было видно, что отвечает именно она.
 *
 * Проверка контрактом исходника, как у соседних тестов bot и crow
 * поднять браузер ради этих утверждений нечем, а потерять их легко –
 * все три требования держатся на строках внутри одного файла.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const BOT = read('js/support-bot.js');
const LAUNCHER = read('js/crow-launcher.js');
const MASCOT = read('js/crow-mascot.js');

/** Строки, которые ВИДИТ или слышит посетитель (текст, aria-label, placeholder). */
function visibleStrings(src) {
  const out = [];
  const re = /(?:text|aria-label|placeholder|textContent\s*=)\s*[:=]?\s*'([^']*)'/g;
  let m;
  while ((m = re.exec(src))) out.push(m[1]);
  return out;
}

test('в интерфейсе окна нет слова «бот» – только «Поддержка»', () => {
  for (const [name, src] of [['support-bot', BOT], ['crow-launcher', LAUNCHER], ['crow-mascot', MASCOT]]) {
    const bad = visibleStrings(src).filter((t) => /бот/i.test(t));
    assert.deepEqual(bad, [], `${name}: слово «бот» осталось в видимой строке: ${bad.join(' | ')}`);
  }
  assert.ok(/el\('h2', \{ text: 'Поддержка' \}\)/.test(BOT), 'заголовок окна должен быть «Поддержка»');
});

test('окно растёт от самого низа экрана', () => {
  const rule = BOT.slice(BOT.indexOf("'#dpoBotPanel{position:fixed"), BOT.indexOf("'#dpoBotPanel.is-open"));
  assert.ok(/bottom:env\(safe-area-inset-bottom/.test(rule), 'панель обязана стоять вровень с низом окна');
  assert.ok(!/bottom:calc\(92px/.test(rule), 'прежний подъём на 92px должен быть снят');
  assert.ok(/border-radius:18px 18px 0 0/.test(rule), 'нижние углы спрямлены – окно приросло к кромке');
});

test('в шапке окна живая ворона, и она снимается при закрытии', () => {
  assert.match(BOT, /CrowMascot\.mount\(\{/, 'ворона в шапке не монтируется');
  const mount = BOT.slice(BOT.indexOf('function mountHeadCrow'), BOT.indexOf('function mountHeadCrow') + 700);
  assert.match(mount, /solo:\s*false/, 'solo:false обязателен – иначе инстанс полезет в правило «маскот на экране один»');
  assert.match(mount, /idleSeconds:\s*0/, 'собственная реплика в окне 56px шире самого окна – её надо гасить');
  const close = BOT.slice(BOT.indexOf('function close()'), BOT.indexOf('function close()') + 400);
  assert.match(close, /destroyHeadCrow\(\)/, 'закрытие окна обязано снимать ворону: иначе цикл кадров живёт на удалённом узле');
});

test('ответ приходит через паузу «печатает…» и кивок вороны', () => {
  const respond = BOT.slice(BOT.indexOf('function respond'), BOT.indexOf('function respond') + 800);
  assert.match(respond, /dpo-bot-typing/, 'нет индикатора «печатает…»');
  assert.match(respond, /nodHeadCrow\(\)/, 'ворона обязана кивать в момент появления ответа');
  assert.match(respond, /REDUCED_MOTION/, 'prefers-reduced-motion: пауза и точки не для всех');
  // Три места, где рождается ответ: обычный путь, выбор сферы/типа и честный отказ.
  assert.match(BOT, /respond\(function \(\) \{ action\(loaded\); \}\)/, 'обычный ответ идёт мимо паузы');
  const pick = BOT.slice(BOT.indexOf('function pickBy'), BOT.indexOf('function pickBy') + 900);
  assert.match(pick, /respond\(function \(\)/, 'выбор сферы/типа идёт мимо паузы');
  const fail = BOT.slice(BOT.indexOf('function showFailure'), BOT.indexOf('function showFailure') + 400);
  assert.match(fail, /respond\(function \(\)/, 'честный отказ идёт мимо паузы');
});
