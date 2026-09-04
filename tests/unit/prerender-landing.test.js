/**
 * Пререндер лендинга.
 *
 * Страница собирается снятием отрисованного DOM: это единственное место в
 * проекте, где результат зависит от внешней программы (Chrome). Поэтому
 * тест сторожит не «получилось ли», а ровно те три способа получить тихо
 * испорченную главную:
 *
 *   1. в выводе остался слой отрисовки – тогда react грузится ЗРЯ, а
 *      рантайм второй раз перерисовывает уже готовую разметку;
 *   2. в выводе нет хвоста с нашими скриптами – страница мертва: ни формы,
 *      ни меню, ни согласия на cookies;
 *   3. в выводе ЕСТЬ разметка, которую наши скрипты дописывают сами
 *      (баннер cookies, мобильная панель) – при загрузке она удвоится.
 *
 * Прогон целиком требует Chrome. Без него проверяются только разборные
 * части, а полный прогон пропускается – молча падать на чужой машине
 * из-за отсутствия браузера этот тест не должен.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { prerender, buildInput, stripRenderLayer, verify, TAIL_START } = require('../../scripts/prerender-landing');

const ROOT = path.resolve(__dirname, '..', '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const CHROME = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean).find((p) => fs.existsSync(p));

test('вход для съёмки отделяет хвост со скриптами от оболочки сборщика', () => {
  const { input, tail } = buildInput(INDEX);
  assert.ok(tail.startsWith(TAIL_START), 'хвост начинается не с vi-mode-addon');
  // Считать надо ТЕГИ, а не упоминания: в комментариях разметки те же
  // файлы названы по имени (js/nav-menu.js упомянут там трижды).
  const tag = (name) => new RegExp(`<script src="js/${name}\\.js"`);
  assert.match(tail, tag('application-form'), 'в хвосте нет наших скриптов');
  assert.doesNotMatch(input, tag('application-form'), 'скрипты остались во входе');
  assert.match(input, /__bundler\/template/, 'во входе нет шаблона сборщика');
  assert.equal(input.length + tail.length, INDEX.length, 'при разрезании потерян или задвоен текст');
});

test('слой отрисовки вырезается целиком', () => {
  const dom = [
    '<html><head><style>x-dc{display:none!important}</style>',
    '<script src="js/vendor/react-18.3.1.production.min.js"></script>',
    '<script src="js/vendor/react-dom-18.3.1.production.min.js"></script>',
    '<script src="js/bundle/dc-runtime.js"></script></head>',
    '<body><x-dc><helmet><title>т</title></helmet><div>шаблон</div></x-dc>',
    '<script type="text/x-dc" data-dc-script="" data-props="{}">class Component {}</script>',
    '<main>отрисованное</main></body></html>',
  ].join('');
  const out = stripRenderLayer(dom);
  assert.doesNotMatch(out, /<x-dc/, 'остался <x-dc>');
  assert.doesNotMatch(out, /dc-runtime\.js/, 'остался dc-runtime');
  assert.doesNotMatch(out, /react(-dom)?-[\d.]+\.production/, 'остался react');
  assert.doesNotMatch(out, /text\/x-dc/, 'остался скрипт логики компонента');
  assert.match(out, /<main>отрисованное<\/main>/, 'вырезано лишнее');
});

test('проверка ловит пустую и недоделанную страницу', () => {
  assert.throws(() => verify('<html><body></body></html>'), /нет <title>/);
  const almost = '<html><head><title>т</title><link rel="canonical" href="#">' +
    '<script type="application/ld+json">{}</script></head><body>' +
    '<div class="dpo-hero"></div><div id="contacts"></div>' +
    '<script src="js/application-form.js"></script></body></html>';
  assert.doesNotThrow(() => verify(almost), 'полная страница не должна отклоняться');
  assert.throws(() => verify(almost.replace('js/application-form.js', 'js/нет.js')), /нет наших скриптов/);
  assert.throws(() => verify(almost + '<script type="__bundler/manifest"></script>'), /слой сборщика/);
  assert.throws(() => verify(almost.replace('<div id="contacts">', '<div id="contacts">{{ accent }}')), /подстановка/);
});

test('комментарии и стили не считаются недоделанной разметкой', () => {
  // 02.09.2026 детектор уже ловил сам себя: в стилях страницы лежит
  // пояснение, почему `{{ }}` внутри <style> не работают.
  const page = '<html><head><title>т</title><link rel="canonical" href="#">' +
    '<script type="application/ld+json">{}</script>' +
    '<style>/* так нельзя: color: {{ accent }} */</style></head><body>' +
    '<!-- заглушка sc-placeholder тут только в тексте пояснения -->' +
    '<div class="dpo-hero"></div><div id="contacts"></div>' +
    '<script src="js/application-form.js"></script></body></html>';
  assert.doesNotThrow(() => verify(page));
});

test('снятая страница статична, жива и ничего не дублирует', { skip: CHROME ? false : 'Chrome не найден' }, async () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dpo-prerender-test-')), 'index.html');
  const res = await prerender({ out });
  const page = fs.readFileSync(res.file, 'utf8');

  // Слой отрисовки ушёл.
  assert.doesNotMatch(page, /__bundler/, 'остался слой сборщика');
  assert.doesNotMatch(page, /dc-runtime\.js|<x-dc/, 'остался рантайм отрисовки');

  // Разметка на месте – проверяем по видимым секциям страницы, а не по длине.
  for (const id of ['spheres', 'starts', 'top5', 'teachers', 'contacts']) {
    assert.match(page, new RegExp(`id="${id}"`), `в статике нет секции #${id}`);
  }

  // Хвост на месте и ровно в одном экземпляре.
  for (const js of ['application-form', 'nav-menu', 'cookie-consent', 'smooth-ui']) {
    const n = page.split(`<script src="js/${js}.js"`).length - 1;
    assert.equal(n, 1, `тег js/${js}.js в статике ${n} раз`);
  }

  // Разметка, которую дописывают сами скрипты, в статике лежать не должна:
  // иначе при загрузке она удвоится.
  assert.doesNotMatch(page, /id="cookieBanner"/, 'баннер cookies попал в статику');
  assert.doesNotMatch(page, /dpo-mobile-cta/, 'мобильная панель попала в статику');
  assert.doesNotMatch(page, /id="viToggle"/, 'кнопка «для слабовидящих» попала в статику');

  // Ради чего всё затевалось: картинка героя должна находиться сразу.
  const headStart = page.slice(page.indexOf('<head'), page.indexOf('<head') + 1200);
  assert.match(headStart, /rel="preload"[^>]*hero-composite/, 'preload героя не в начале шапки');

  fs.rmSync(path.dirname(res.file), { recursive: true, force: true });
});
