#!/usr/bin/env node
/**
 * Пререндер лендинга: статичный HTML вместо клиентской отрисовки.
 *
 *   node scripts/prerender-landing.js                 # в .prerender/index.html
 *   node scripts/prerender-landing.js --out файл      # куда положить результат
 *   node scripts/prerender-landing.js --keep-input    # оставить вход для разбора
 *
 * Зачем
 * -----
 * `index.html` – оболочка сборщика: разметка страницы лежит СТРОКОЙ JSON в
 * `<script type="__bundler/template">`, а рисует её на клиенте связка
 * react + react-dom + `js/bundle/dc-runtime.js` (элемент `<x-dc>` и класс
 * `Component extends DCLogic` в `<script type="text/x-dc">`). До первого
 * пикселя браузер обязан скачать и исполнить ~200 КБ чужого JS: замер
 * 03.09.2026 – LCP 6,2 с, Performance 51. Каталог и страницы программ
 * статичны и дают 90+.
 *
 * Скрипт снимает УЖЕ ОТРИСОВАННЫЙ DOM системным Chrome (`--dump-dom`) и
 * вырезает из него слой отрисовки. На выходе обычная статическая страница:
 * тот же HTML, но без react, react-dom и dc-runtime.
 *
 * Почему без зависимостей
 * -----------------------
 * В проекте нет ни одной npm-зависимости и нет lockfile – это его свойство,
 * а не случайность. Headless-браузер здесь берётся готовый: Chrome, который
 * и так стоит на машине сборки (или путь в переменной CHROME). Никакого
 * puppeteer/playwright в дереве не появляется.
 *
 * Что снимается и что дописывается обратно
 * ----------------------------------------
 * Наши собственные `js/*.js` лежат СНАРУЖИ шаблона, в хвосте index.html.
 * В живой странице они исполняются ДО подмены документа и потому дописывают
 * свою разметку (мобильная панель, баннер cookies) уже после отрисовки.
 * Если снимать DOM вместе с ними, эта разметка попала бы в статику и
 * удвоилась при следующей загрузке. Поэтому DOM снимается со страницы БЕЗ
 * хвоста, а хвост дописывается в результат как есть – порядок и поведение
 * скриптов сохраняются, меняется только то, что разметка к их запуску уже
 * на месте (они это умеют: ждут её интервалом).
 *
 * Из внешней шапки переносятся `<link rel="preload">`: остальное (charset,
 * viewport, og:*, canonical, ld+json) рантайм переносит в отрисованную
 * шапку сам через `<helmet>`, а preload нужен ровно на старте.
 */

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const { MIME, resolveSafe, isAllowedStatic } = require('../lib/static-http');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'index.html');
const DEFAULT_OUT = path.join(ROOT, '.prerender', 'index.html');

/** Начало хвоста внешнего документа: всё от него до </body> – наши скрипты. */
const TAIL_START = '<!-- vi-mode-addon:';

/** Где искать Chrome. Переменная CHROME перебивает список. */
const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
];

function findChrome() {
  const fromEnv = process.env.CHROME;
  if (fromEnv) {
    if (!fs.existsSync(fromEnv)) throw new Error(`CHROME=${fromEnv}: файла нет`);
    return fromEnv;
  }
  const found = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  if (found) return found;
  throw new Error(
    'Chrome не найден. Укажите путь: CHROME=/путь/к/chrome node scripts/prerender-landing.js'
  );
}

/**
 * Сервер на время съёмки. Отдаёт подготовленный вход по «/» и остальные
 * файлы проекта по тем же правилам, что и оба сервера сайта: белый список
 * из lib/static-http, никакого своего разрешения путей.
 */
function serve(inputHtml) {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (pathname === '/' || pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(inputHtml);
      return;
    }
    const safe = resolveSafe(pathname, ROOT);
    if (!safe || !isAllowedStatic(safe)) {
      res.writeHead(404).end('not found');
      return;
    }
    const file = safe.abs;
    if (!fs.existsSync(file)) {
      res.writeHead(404).end('not found');
      return;
    }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

/** Вход для съёмки: та же страница, но без хвоста с нашими скриптами. */
function buildInput(html) {
  const tailAt = html.indexOf(TAIL_START);
  const bodyEnd = html.lastIndexOf('</body>');
  if (tailAt === -1 || bodyEnd === -1 || bodyEnd < tailAt) {
    throw new Error(`В index.html не найден хвост «${TAIL_START}» перед </body>`);
  }
  return {
    input: html.slice(0, tailAt) + html.slice(bodyEnd),
    tail: html.slice(tailAt, bodyEnd),
  };
}

/**
 * Съёмка DOM. Именно ASYNC spawn, а не spawnSync: страницу отдаёт наш же
 * сервер в этом процессе, а spawnSync блокирует цикл событий – сервер тогда
 * не ответит ни на один запрос, и Chrome ждёт вечно (проверено).
 */
function dumpDom(chrome, url) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dpo-prerender-'));
  return new Promise((resolve, reject) => {
    const child = spawn(chrome, [
      '--headless',
      '--disable-gpu',
      // Свой профиль: снимок не должен зависеть от состояния браузера
      // пользователя, а параллельный запуск – ломать его сессию.
      `--user-data-dir=${profile}`,
      '--window-size=1440,900',
      // Виртуальное время: рантайм рисует по DOMContentLoaded и ждёт
      // загрузки скриптов, реальные секунды ждать незачем.
      '--virtual-time-budget=15000',
      '--dump-dom',
      url,
    ]);
    let out = '';
    let err = '';
    let done = false;
    let guard;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    const finish = (fn, arg) => {
      if (done) return;
      done = true;
      clearTimeout(guard);
      child.kill('SIGKILL');
      fs.rmSync(profile, { recursive: true, force: true });
      fn(arg);
    };
    // Документ напечатан целиком – ждать выхода самого Chrome незачем: со
    // своим профилем он после --dump-dom остаётся жить (проверено, 45 с).
    child.stdout.on('data', (c) => {
      out += c;
      if (out.trimEnd().endsWith('</html>')) finish(resolve, out);
    });
    child.stderr.on('data', (c) => { err += c; });
    // Предохранитель: зависший Chrome не должен вешать сборку.
    guard = setTimeout(
      () => finish(reject, new Error(`chrome --dump-dom не отдал документ за 120 с: ${err.slice(-400)}`)),
      120000
    );
    child.on('error', (e) => finish(reject, e));
    child.on('close', (code) => {
      if (done) return;
      finish(
        reject,
        new Error(`chrome --dump-dom вернул ${code}, документ не получен: ${err.slice(-400)}`)
      );
    });
  });
}

/** Вырезает парный элемент вместе с содержимым (вложенных таких нет). */
function cutElement(html, tag) {
  const open = new RegExp(`<${tag}(\\s[^>]*)?>`, 'i').exec(html);
  if (!open) return html;
  const close = html.indexOf(`</${tag}>`, open.index);
  if (close === -1) return html;
  return html.slice(0, open.index) + html.slice(close + tag.length + 3);
}

function stripRenderLayer(dom) {
  let out = dom;
  // Источник отрисовки: сам шаблон (скрыт стилем) и логика компонента.
  out = cutElement(out, 'x-dc');
  out = out.replace(/<style>\s*x-dc\{display:none!important\}\s*<\/style>/gi, '');
  out = out.replace(/<script type="text\/x-dc"[\s\S]*?<\/script>/gi, '');
  // Сам движок отрисовки. Он уже отработал – в статике не нужен.
  out = out.replace(
    /<script src="js\/(bundle\/dc-runtime|vendor\/react-dom-[\d.]+\.production\.min|vendor\/react-[\d.]+\.production\.min)\.js"><\/script>/gi,
    ''
  );
  return out;
}

function prerender({ out = DEFAULT_OUT, keepInput = false } = {}) {
  const html = fs.readFileSync(SOURCE, 'utf8');
  const { input, tail } = buildInput(html);
  const preloads = (html.slice(0, html.indexOf('</head>')).match(/<link rel="preload"[^>]*>/gi) || []);
  if (!preloads.length) throw new Error('В шапке index.html нет ни одного <link rel="preload">');

  const chrome = findChrome();

  return serve(input).then(async ({ server, port }) => {
    let dom;
    try {
      dom = await dumpDom(chrome, `http://127.0.0.1:${port}/`);
    } finally {
      server.close();
    }

    let page = stripRenderLayer(dom);

    // Preload ставится В НАЧАЛО шапки, а не в конец: шапка отрисованной
    // страницы начинается со ста килобайт встроенных стилей, и найденный
    // после них preload героя опаздывает ровно на их разбор.
    const headOpen = /<head[^>]*>/i.exec(page);
    if (!headOpen) throw new Error('В снятом DOM нет <head>');
    const headAt = headOpen.index + headOpen[0].length;
    page = page.slice(0, headAt) + '\n' + preloads.join('\n') + '\n' + page.slice(headAt);

    const bodyEnd = page.lastIndexOf('</body>');
    if (bodyEnd === -1) throw new Error('В снятом DOM нет </body>');
    page = page.slice(0, bodyEnd) + '\n' + tail + '\n' + page.slice(bodyEnd);

    page = page.replace(
      /^<!DOCTYPE html>/i,
      '<!DOCTYPE html>\n<!-- Собрано scripts/prerender-landing.js из index.html. Не править руками. -->'
    );

    verify(page);

    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, page, 'utf8');
    if (keepInput) fs.writeFileSync(path.join(path.dirname(out), 'input.html'), input, 'utf8');

    return { file: out, bytes: Buffer.byteLength(page), sourceBytes: Buffer.byteLength(html) };
  });
}

/**
 * Проверки, после которых страницу можно отдавать людям. Каждая – про
 * конкретный способ получить пустую или сломанную статику, а не про «вдруг».
 */
function verify(page) {
  const fail = (msg) => {
    throw new Error(`Пререндер не прошёл проверку: ${msg}`);
  };
  if (/__bundler/.test(page)) fail('в выводе остался слой сборщика (__bundler)');
  if (/<x-dc[\s>]/i.test(page)) fail('в выводе остался элемент <x-dc>');
  if (/dc-runtime\.js/.test(page)) fail('в выводе остался dc-runtime.js');
  if (/\bwindow\.React\b/.test(page)) fail('в выводе осталась ссылка на React');
  if (!/<title[\s>]/i.test(page)) fail('нет <title> – шапка не перенесена рантаймом');
  if (!/rel="canonical"/i.test(page)) fail('нет canonical');
  if (!/application\/ld\+json/.test(page)) fail('нет микроразметки');
  if (!/class="dpo-hero/.test(page)) fail('нет героя – разметка не отрисовалась');
  if (!/id="contacts"/.test(page)) fail('нет секции контактов – разметка отрисовалась не до конца');
  if (!/js\/application-form\.js/.test(page)) fail('в выводе нет наших скриптов');
  // Проверять только РАЗМЕТКУ. В стилях, скриптах и комментариях страницы
  // лежат и `{{ ... }}`, и `sc-placeholder` – в пояснениях к тому, почему так
  // делать нельзя. Детектор, читающий комментарии, ловит сам себя.
  const markup = page
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const interp = markup.match(/\{\{[^}]{1,60}\}\}/g);
  if (interp) fail(`неразрешённая подстановка шаблона: ${interp.slice(0, 3).join(', ')}`);
  if (/sc-placeholder|sc-missing/.test(markup)) {
    fail('в разметке остались заглушки рантайма (sc-placeholder)');
  }
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const outAt = argv.indexOf('--out');
  const opts = {
    out: outAt !== -1 ? path.resolve(argv[outAt + 1]) : DEFAULT_OUT,
    keepInput: argv.includes('--keep-input'),
  };
  prerender(opts).then(
    ({ file, bytes, sourceBytes }) => {
      const kb = (n) => (n / 1024).toFixed(0) + ' КБ';
      console.log(`Пререндер: ${path.relative(ROOT, file)} – ${kb(bytes)} (исходник ${kb(sourceBytes)})`);
    },
    (err) => {
      console.error(String(err.message || err));
      process.exit(1);
    }
  );
}

module.exports = { prerender, buildInput, stripRenderLayer, verify, TAIL_START };
