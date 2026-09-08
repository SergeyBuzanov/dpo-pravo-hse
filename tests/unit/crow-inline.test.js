'use strict';

/**
 * Выход вороны в содержимое (задача 13): каталог (слот у панели поиска) и
 * лента «Топ-5» на лендинге. Проверяется контракт исходников – по образцу
 * соседних crow-*-тестов: слот на месте, «каждый раз» реализовано через
 * IntersectionObserver (не одноразовая отметка), клик открывает окно бота
 * ([data-bot-open]), reduced-motion и телефон не проигрывают пробег,
 * маскот в углу лендинга гасится тем же общим механизмом «на экране один».
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const CROW = read('js/crow-mascot.js');
const CATALOG = read('Каталог программ.html');
const INDEX = read('index.html');

test('js/crow-mascot.js: анимация walkAcross используется, invite держит реплику без авто-гашения', () => {
  assert.match(CROW, /A\.walkAcross\s*=\s*\{[^}]*dur:\s*5\.4/, 'walkAcross должна остаться 5,4с');
  assert.match(CROW, /A\.invite\s*=\s*\{[^}]*text:\s*'Подсказать\?'/, 'нет реплики «Подсказать?»');
  const invite = CROW.slice(CROW.indexOf('A.invite ='), CROW.indexOf('A.invite =') + 400);
  assert.match(invite, /loop:\s*0/, 'invite должна быть не зациклённой (loop:0) – иначе реплика гаснет и мигает заново на каждом витке');
});

test('js/crow-mascot.js: walkIn() пропускает пробег на узком экране и у reduced-motion, иначе играет walkAcross -> invite', () => {
  const fn = CROW.slice(CROW.indexOf('CrowMascot.prototype.walkIn'), CROW.indexOf('CrowMascot.prototype.walkIn') + 1500); // окно шире: в walkIn добавилось пояснение про holdRx
  assert.match(fn, /reducedMotion/, 'walkIn не проверяет prefers-reduced-motion');
  assert.match(fn, /skipWalk/, 'walkIn не принимает флаг узкого экрана (телефон)');
  assert.match(fn, /play\('walkAcross'\)/, 'walkIn не запускает walkAcross');
  // A.walkAcross зациклена (loop:1) – переход в очередь (this.queue), которым
  // пользуется play() в остальных местах файла, читается только у нецикличных
  // анимаций и для walkAcross НЕ СРАБОТАЕТ (была живая ловушка: маскот крутил
  // пробег вечно, реплика не появлялась никогда). Переход обязан идти явным
  // таймером на A.walkAcross.dur, а не через queue.
  assert.match(fn, /setTimeout/, 'нет явного таймера перехода к invite – у зацикленной walkAcross очередь this.queue не сработает');
  assert.match(fn, /A\.walkAcross\.dur/, 'таймер должен быть привязан к длительности walkAcross, а не к произвольному числу');
  assert.doesNotMatch(fn, /queue\s*=\s*\['invite'\]/, 'this.queue у зацикленной walkAcross не читается tick() – переход остался бы недостижим');
  // Где встала – там и стоит (владелец 08.09.2026): конечное смещение
  // пробега запоминается, иначе поза приглашения вернула бы ворону к
  // месту старта (invite = idle, горизонтального смещения не задаёт).
  assert.match(fn, /holdRx/, 'после реплики ворона откатится назад: конечное смещение пробега не запоминается');
});

test('js/crow-mascot.js: align:\'right\' ставит маскот у правого края слота, а не по центру', () => {
  const build = CROW.slice(CROW.indexOf('CrowMascot.prototype.build'), CROW.indexOf('CrowMascot.prototype.bind'));
  assert.match(build, /align\s*===\s*'right'/, 'нет ветки align:\'right\' в build()');
});

test('js/crow-mascot.js: mountWalkIn наблюдает пересечение и создаёт/уничтожает маскот заново каждый раз (решение владельца) – не одноразовая отметка', () => {
  const fn = CROW.slice(CROW.indexOf('function mountWalkIn'));
  assert.match(fn, /new IntersectionObserver/, 'нет наблюдателя пересечения');
  assert.match(fn, /isIntersecting\)\s*spawn\(\)\s*;\s*else\s*teardown\(\)/, 'вход/выход из кадра должны спавнить и уничтожать маскот заново – это и даёт "каждый раз", а не один раз за визит');
  assert.doesNotMatch(fn, /localStorage/, 'выход в содержимое не должен ограничиваться localStorage – решение владельца: каждый раз, а не один раз за визит');
});

test('js/crow-mascot.js: клик по маскоту открывает окно бота, а не встроенную реплику nod/askQ', () => {
  const fn = CROW.slice(CROW.indexOf('function mountWalkIn'), CROW.indexOf('function mountWalkIn') + 2200);
  assert.match(fn, /data-bot-open/, 'кнопка-хит не помечена [data-bot-open] – окно бота не откроется');
  assert.match(fn, /aria-label/, 'у кнопки-хита нет доступного имени для читалок');
  assert.match(fn, /onClick:\s*function\s*\(\)\s*\{\}/, 'у самого маскота должен быть пустой onClick – клики обязана ловить кнопка-хит поверх, иначе одновременно сыграют и nod/askQ, и открытие бота');
});

test('js/crow-mascot.js: кнопка-хит скрыта в vi-mode, как и сам маскот', () => {
  assert.match(CROW, /html\.vi-mode \.crow-walk-hit\{display:none!important\}/, 'кнопка-хит не скрыта в vi-mode – в этом режиме маскота не должно быть вовсе');
});

test('Каталог программ.html: слот у панели поиска на месте и доступен читалкам (единственный вход в бота на странице)', () => {
  const block = CATALOG.slice(CATALOG.indexOf('id="resultCount"'), CATALOG.indexOf('<main'));
  assert.match(block, /data-crow-walk/, 'нет слота выхода в содержимое рядом с тулбаром поиска');
  assert.doesNotMatch(block, /aria-hidden="true"[^>]*>\s*<div class="crow-walk-slot"/, 'строка со слотом не должна быть aria-hidden – кнопка внутри неё единственный на странице вход в бота');
});

test('Каталог программ.html: слот вызывается через CrowMascot.mountWalkIn после загрузки, размер слота в CSS совпадает с width у mountWalkIn (без прыжка высоты)', () => {
  assert.match(CATALOG, /CrowMascot\.mountWalkIn\(slot,\s*\{\s*assetPath:\s*'images\/crow\/'\s*\}\)/, 'mountWalkIn не вызывается в каталоге');
  const cssMatch = CATALOG.match(/\.crow-walk-slot\{\s*width:\s*(\d+)px;\s*height:\s*(\d+)px;\s*\}/);
  assert.ok(cssMatch, 'нет фиксированного размера у .crow-walk-slot – блок под маскотом будет прыгать по высоте (CLS) в момент появления в кадре');
  assert.equal(cssMatch[1], '120', 'ширина слота должна совпадать с width, который передаётся в mountWalkIn ниже');
});

test('.landing-template.html: слот у правого края ленты «Топ-5» на месте, вне шапки со стрелками', () => {
  const fs2 = require('node:fs');
  const tpl = fs2.readFileSync(path.join(ROOT, '.landing-template.html'), 'utf8');
  const top5 = tpl.slice(tpl.indexOf('id="top5"'), tpl.indexOf('<!-- TEACHERS'));
  assert.match(top5, /data-crow-walk/, 'нет слота выхода в содержимое в секции Топ-5');
  // Место уточнено владельцем дважды: 08.09.2026 – не под лентой (там
  // ворона оказывалась ниже программ, в пустой полосе); 09.09.2026 – ниже,
  // ПРЯМО над строкой «Все программы с фильтрами», а не над всей шапкой
  // секции. Прямо в .dpo-carousel-head слот класть по-прежнему нельзя: это
  // флекс-РЯД, слот стал бы третьим элементом и встал СБОКУ от заголовка.
  // Поэтому он и строка со стрелками лежат в общей КОЛОНКЕ .dpo-top5-aside.
  const asideStart = top5.indexOf('dpo-top5-aside');
  const navStart = top5.indexOf('dpo-carousel-nav');
  const trackStart = top5.indexOf('dpo-top5-track');
  const slotPos = top5.indexOf('data-crow-walk');
  assert.notEqual(asideStart, -1, 'нет колонки .dpo-top5-aside – слот в флекс-ряду шапки встанет сбоку');
  assert.ok(asideStart < slotPos, 'слот должен лежать ВНУТРИ колонки .dpo-top5-aside');
  assert.ok(slotPos < navStart, 'слот должен стоять НАД строкой «Все программы с фильтрами»');
  assert.ok(slotPos < trackStart, 'слот должен быть выше самой ленты');
  assert.match(tpl, /\.dpo-top5-aside\s*\{[^}]*flex-direction:\s*column/, 'колонка .dpo-top5-aside обязана быть колонкой, иначе ворона снова встанет сбоку');
});

test('index.html: crow-walk-addon вызывает mountWalkIn на window.load, после загрузки уже подключённого js/crow-mascot.js', () => {
  const addon = INDEX.slice(INDEX.indexOf('crow-walk-addon'));
  assert.match(addon, /CrowMascot\.mountWalkIn\(slot,\s*\{\s*assetPath:\s*'images\/crow\/'\s*\}\)/, 'mountWalkIn не вызывается в crow-walk-addon');
  assert.match(addon, /window\.addEventListener\('load'/, 'addon обязан ждать window.load – как и угловая ворона (рантайм ещё не подменил документ раньше)');
  // js/crow-mascot.js уже включён тегом <script defer> ВЫШЕ по файлу – addon
  // не должен догружать его динамически (в отличие от каталога, где скрипт
  // грузится лениво по требованию).
  assert.doesNotMatch(addon, /createElement\('script'\)/, 'на лендинге crow-mascot.js уже подключён тегом <script defer> – динамическая загрузка здесь не нужна');
});
