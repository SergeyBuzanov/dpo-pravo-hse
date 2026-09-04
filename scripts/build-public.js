#!/usr/bin/env node
/**
 * Сборка ПУБЛИЧНОЙ выкладки сайта.
 *
 *   node scripts/build-public.js              # собрать в .public/
 *   node scripts/build-public.js --publish    # собрать и выложить на зеркало
 *
 * Зачем
 * -----
 * Публичное зеркало (`SergeyBuzanov/dpo-pravo-hse`, GitHub Pages) публикует
 * ветку `main` ЦЕЛИКОМ, а в ней лежит вся рабочая копия. Проверено
 * 21.08.2026: наружу отдавались `admin.html`, `docker-compose.yml`,
 * `.catalog-data.json` и `tests/run.sh` – каждый со своим кодом 200.
 * Паролей там нет (`.admin-credentials.json` не в репозитории), но показывать
 * заказчику витрину вместе с устройством админки и инфраструктуры незачем.
 *
 * Скрипт собирает дерево, в котором лежит ровно сайт, и выкладывает его в
 * отдельную ветку `gh-pages` зеркала. После первой выкладки надо ОДИН РАЗ
 * переключить источник Pages в настройках репозитория: Settings → Pages →
 * Branch: gh-pages / (root). До переключения ничего не меняется – `main`
 * продолжает обслуживать сайт.
 *
 * Белый список
 * ------------
 * Берётся из `lib/static-http.js` – того же места, откуда его берут оба
 * сервера проекта. Два списка неминуемо разошлись бы, а расхождение здесь
 * означает либо пропавшую страницу, либо лишний файл наружу.
 * `admin.html` вычитается ЯВНО: локальному превью она нужна, зеркалу – нет.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  PUBLIC_HTML,
  ROOT_FILES,
  ASSET_DIRS,
  ASSET_EXT,
  PAGE_DIRS,
  PAGE_EXT,
  DATA_DIRS,
  DATA_EXT,
} = require('../lib/static-http');
const { prerender } = require('./prerender-landing');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '.public');
const MIRROR = 'https://github.com/SergeyBuzanov/dpo-pravo-hse.git';
const BRANCH = 'gh-pages';

/** Локальной админке страница нужна, зеркалу – нет. */
const NEVER_PUBLISH = new Set(['admin.html']);

/**
 * Файлы корня, которых нет в белых списках серверов, но на витрине они
 * обязаны быть: их запрашивает не наш код, а браузер и поисковик.
 */
const EXTRA_ROOT = ['404.html', 'apple-touch-icon.png', '.nojekyll'];

function copyFile(rel) {
  const from = path.join(ROOT, rel);
  if (!fs.existsSync(from)) return false;
  const to = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  return true;
}

/** Копирует каталог на один уровень, отбирая по расширениям. */
function copyDir(dir, allowedExt, { recursive = false } = {}) {
  const from = path.join(ROOT, dir);
  if (!fs.existsSync(from)) return 0;
  let n = 0;
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (recursive) n += copyDir(rel, allowedExt, { recursive });
      continue;
    }
    if (!allowedExt.has(path.extname(entry.name).toLowerCase())) continue;
    if (copyFile(rel)) n++;
  }
  return n;
}

function build() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const report = [];

  let pages = 0;
  for (const name of PUBLIC_HTML) {
    if (NEVER_PUBLISH.has(name)) continue;
    if (copyFile(name)) pages++;
  }
  report.push(`страницы корня: ${pages}`);

  let root = 0;
  for (const name of [...ROOT_FILES, ...EXTRA_ROOT]) if (copyFile(name)) root++;
  report.push(`служебные файлы: ${root}`);

  // Ассеты (fonts, js, images) – с подкаталогами: там лежат
  // images/programs/thumbs, images/teachers и js/vendor, js/bundle.
  let assets = 0;
  for (const dir of ASSET_DIRS) assets += copyDir(dir, ASSET_EXT, { recursive: true });
  report.push(`ассеты: ${assets}`);

  let programs = 0;
  for (const dir of PAGE_DIRS) programs += copyDir(dir, PAGE_EXT);
  report.push(`страницы программ: ${programs}`);

  let data = 0;
  for (const dir of DATA_DIRS) data += copyDir(dir, DATA_EXT);
  report.push(`данные для браузера: ${data}`);

  // Признак того, что Pages не должен пропускать выкладку через Jekyll:
  // иначе каталоги, начинающиеся с подчёркивания, молча не публикуются.
  fs.writeFileSync(path.join(OUT, '.nojekyll'), '', 'utf8');

  console.log('Публичная выкладка собрана в .public/');
  for (const line of report) console.log('  ' + line);

  // То, чего в выкладке нет намеренно: печатаем, чтобы отсутствие было
  // видимым решением, а не случайностью.
  const excluded = ['admin.html', 'admin-server.js', 'docker-compose.yml', '.catalog-data.json', 'tests', 'docs', 'scripts', 'lib']
    .filter((name) => fs.existsSync(path.join(ROOT, name)))
    .filter((name) => !fs.existsSync(path.join(OUT, name)));
  console.log('  не публикуется: ' + excluded.join(', '));

  return OUT;
}

/**
 * Выкладка. История ветки не нужна: `gh-pages` – артефакт сборки, а не
 * работа. Поэтому каждый раз это свежий репозиторий с одним коммитом,
 * который уезжает с --force. Основная история живёт в main обоих адресов.
 */
function publish() {
  const git = (...args) => execFileSync('git', ['-C', OUT, ...args], { stdio: 'inherit' });
  git('init', '-q');
  git('add', '-A');
  git('-c', 'user.name=dpo-publisher', '-c', 'user.email=dpo@localhost', 'commit', '-q', '-m', 'Публичная выкладка сайта');
  git('push', '--force', '--quiet', MIRROR, `HEAD:${BRANCH}`);
  console.log(`\nВыложено в ${MIRROR} -> ветка ${BRANCH}.`);
  console.log('Если источник Pages ещё не переключён: Settings → Pages → Branch: gh-pages / (root).');
}

/**
 * Пререндер лендинга поверх скопированного index.html.
 *
 * Ошибка здесь ОСТАНАВЛИВАЕТ сборку, а не пропускается: молча выложенная
 * клиентская версия отличается от статичной только скоростью, заметить
 * подмену на витрине нечем, а разница – LCP 3,3 с против 0,8 с (замер
 * 04.09.2026, локально, без троттлинга). Если Chrome на машине нет и
 * выложить надо всё равно – `--no-prerender`, но это видимое решение.
 */
function prerenderLanding() {
  return prerender({ out: path.join(OUT, 'index.html') }).then(({ bytes }) => {
    console.log(`  лендинг: статичный HTML, ${(bytes / 1024).toFixed(0)} КБ (пререндер)`);
  });
}

if (require.main === module) {
  build();
  const landing = process.argv.includes('--no-prerender')
    ? Promise.resolve(console.log('  лендинг: БЕЗ пререндера (--no-prerender)'))
    : prerenderLanding();
  landing.then(
    () => {
      if (process.argv.includes('--publish')) publish();
    },
    (err) => {
      console.error('\nПререндер лендинга не удался, выкладка остановлена:');
      console.error('  ' + String(err.message || err));
      console.error('  Собрать без него: node scripts/build-public.js --no-prerender');
      process.exit(1);
    }
  );
}

module.exports = { build, OUT, NEVER_PUBLISH };
