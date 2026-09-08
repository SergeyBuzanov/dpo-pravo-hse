'use strict';

/**
 * Все анимации маскота разложены по местам (решение владельца 09.09.2026).
 * В пакете их четырнадцать, и семь простаивали – тест закрепляет, где какая
 * играет, чтобы они не разъехались при следующей правке соседнего кода:
 *
 *   wave   – окно поддержки открылось (приветствие);
 *   think  – пока готовится ответ, вместе с тремя точками;
 *   point  – в ответе появилась кнопка «Подать заявку»;
 *   jump   – заявка отправлена, экран «Спасибо!»;
 *   helpQ  – простой в КАТАЛОГЕ («Чем помочь?»), вместо askQ;
 *   runIn  – появление в углу и возврат после закрытия окна;
 *   leave  – уход с экрана, когда окно открывается.
 *
 * Проверка контрактом исходника: анимации живут в браузере, а держатся на
 * одной строке в каждом файле – потерять их легче всего молча.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const BOT = read('js/support-bot.js');
const MASCOT = read('js/crow-mascot.js');
const LAUNCHER = read('js/crow-launcher.js');
const FORM = read('js/application-form.js');

/** Все четырнадцать анимаций пакета обязаны существовать в рантайме. */
const ALL = ['idle', 'runIn', 'walk', 'walkAcross', 'nod', 'shake', 'wave', 'inspect',
  'point', 'jump', 'think', 'leave', 'helpQ', 'askQ'];

test('рантайм по-прежнему знает все анимации пакета', () => {
  for (const name of ALL) {
    assert.ok(new RegExp('^A\\.' + name + ' = \\{', 'm').test(MASCOT), `анимация ${name} пропала из рантайма`);
  }
});

test('wave: приветствие при открытии окна поддержки', () => {
  const mount = BOT.slice(BOT.indexOf('function mountHeadCrow'), BOT.indexOf('function mountHeadCrow') + 900);
  assert.match(mount, /play\('wave'\)/, 'ворона не машет при открытии окна');
  assert.match(mount, /REDUCED_MOTION/, 'приветствие должно молчать в режиме без движения');
});

test('think и point: пока готовится ответ и когда в ответе кнопка заявки', () => {
  assert.match(BOT, /function thinkHeadCrow[\s\S]{0,160}play\('think'\)/, 'нет позы размышления');
  assert.match(BOT, /function reactHeadCrow[\s\S]{0,200}play\(pointsAtApply \? 'point' : 'nod'\)/,
    'кнопка заявки в ответе должна давать указание, а не кивок');
  const respond = BOT.slice(BOT.indexOf('function respond'), BOT.indexOf('function respond') + 1400);
  assert.match(respond, /thinkHeadCrow\(\)/, 'размышление не запускается вместе с тремя точками');
  assert.match(respond, /dpo-bot-apply/, 'появление кнопки заявки не отслеживается');
});

test('leave и runIn: уход при открытии окна и возврат после закрытия', () => {
  const hide = BOT.slice(BOT.indexOf('function hideCrow'), BOT.indexOf('function hideCrow') + 700);
  assert.match(hide, /play\('leave'\)/, 'ворона не уходит с экрана');
  assert.match(hide, /hide\(\)/, 'после ухода маскот обязан скрыться');
  const show = BOT.slice(BOT.indexOf('function showCrow'), BOT.indexOf('function showCrow') + 800);
  assert.match(show, /play\('runIn'\)/,
    'возврат обязан идти через runIn: поза ухода оставляет ворону за краем и невидимой');
  // Появление в углу – тоже runIn, и оно уже было: гейт reduced-motion там же.
  assert.match(MASCOT, /this\.anim = this\.reducedMotion \? 'idle' : 'runIn'/, 'появление в углу перестало быть забегом');
});

test('helpQ: в каталоге ворона предлагает помощь, а не спрашивает', () => {
  assert.match(MASCOT, /idleAnim: opts\.idleAnim \|\| 'askQ'/, 'рантайм не принимает выбор реплики простоя');
  assert.match(MASCOT, /this\.play\(A\[this\.opt\.idleAnim\] \? this\.opt\.idleAnim : 'askQ'\)/,
    'простой по-прежнему жёстко играет askQ');
  assert.match(LAUNCHER, /getElementById\('filters'\) \? 'helpQ' : 'askQ'/,
    'каталог не отличается от остальных страниц – helpQ не сыграет');
});

test('jump: заявка отправлена', () => {
  const done = FORM.slice(FORM.indexOf("'Спасибо!'"), FORM.indexOf("'Спасибо!'") + 1400);
  assert.match(done, /play\('jump'\)/, 'на экране «Спасибо!» играет не прыжок');
});
