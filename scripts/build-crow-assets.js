#!/usr/bin/env node
/**
 * Пережимает слои маскота-вороны в рабочий вес.
 *
 *   node scripts/build-crow-assets.js <каталог-с-исходниками> [каталог-назначения]
 *
 * Примеры:
 *   node scripts/build-crow-assets.js ~/Downloads/design_handoff_crow_mascot/parts
 *     -> результат в images/crow (по умолчанию)
 *   node scripts/build-crow-assets.js ~/Downloads/design_handoff_crow_mascot/parts /tmp/crow-preview
 *     -> результат в стороне, для сверки перед перезаписью images/crow
 *
 * Исходники – пакет `design_handoff_crow_mascot`, присланный владельцем
 * 08.09.2026: 12 PNG от дизайнера (см. README пакета), рантайм
 * `crow-mascot.js` грузит из них только 11 – слой `rest.png` (полный
 * силуэт целиком) был исходником для нарезки на части, в рантайме не
 * используется и в сборку не попадает: его нет в списке LAYERS ниже.
 *
 * Задача 12 (08.09.2026): `rest.png` всё же пригодился – странице 404
 * скрипты запрещены её же CSP (`script-src` там нет вовсе), анимированный
 * маскот там невозможен в принципе, а неподвижная картинка нужна. Тот же
 * `rest.png` пережимается ЦЕЛИКОМ (без нарезки на слои) в `still.webp` –
 * см. `buildStill` ниже. Композиция исходника (ворона с лупой и
 * приподнятой бровью) уже читается как «думает», кадрировать её не
 * потребовалось.
 *
 * Вся геометрия маскота в `crow-mascot.js` задана в процентах от сцены
 * 1400×1465 (размер слоёв torso/neck). Поэтому масштаб ОДИН И ТОТ ЖЕ для
 * всех слоёв: кадрирование или разный масштаб развалят взаимное положение
 * частей. При смене исходников менять SCALE можно только сразу для всех.
 *
 * Каталог исходников – обязательный аргумент: у пакета от дизайнера нет
 * постоянного места в репозитории, дефолтный путь был бы либо чужой
 * машине, либо временным каталогом текущей сессии. Каталог назначения
 * по умолчанию – images/crow, но его можно подменить, чтобы сначала
 * посмотреть результат новой поставки в стороне и сравнить, а не
 * перезаписывать репозиторий вслепую.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Слои в порядке, которого ждёт tests/unit/crow-assets.test.js.
const LAYERS = ['torso', 'neck', 'head', 'eyeL', 'eyeR', 'beak', 'mouth', 'arm', 'legL', 'legR', 'body'];

// Сцена 1400×1465, рабочая ширина маскота на странице 260px -> с запасом
// под экраны 2x нужно ~520-560px сцены, то есть масштаб около 0,4.
const SCALE = 0.4;
// Бюджет (250 КБ на всю ворону) при масштабе 0,4 даёт большой запас
// (~80 КБ против лимита) – берём lossless, а не lossy-качество: у слоёв
// плоская заливка и чёткие края (клюв, глаза), lossy на них даёт ringing
// при уменьшении в 2,5 раза, а бюджет всё равно не тратится весь.
const WEBP_LOSSLESS_EFFORT = 9;

// Неподвижная ворона страницы 404 (задача 12): 260px на странице -> 520px
// исходника для чёткости на экранах 2x, как у слоёв выше. Не входит в
// LAYERS – это отдельная картинка, не участвующая в анимации, и в бюджет
// 250 КБ маскота (tests/unit/crow-assets.test.js) не считается: она не
// грузится вместе с 11 слоями, а живёт на отдельной странице без них.
const STILL_SOURCE = 'rest.png';
const STILL_OUT = 'still.webp';
const STILL_TARGET_WIDTH = 520;

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUT_DIR = path.join(ROOT, 'images', 'crow');

function pixelSize(file) {
  const out = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file], { encoding: 'utf8' });
  const width = Number(out.match(/pixelWidth:\s*(\d+)/)[1]);
  const height = Number(out.match(/pixelHeight:\s*(\d+)/)[1]);
  return { width, height };
}

function hasAlpha(file) {
  const out = execFileSync('sips', ['-g', 'hasAlpha', file], { encoding: 'utf8' });
  return /hasAlpha:\s*yes/.test(out);
}

function kb(bytes) {
  return `${Math.round((bytes / 1024) * 10) / 10} КБ`;
}

/** Тот же приём, что для слоёв (sips для масштаба, cwebp lossless для веса), но
 * на целую картинку без нарезки: странице 404 хватает одного неподвижного кадра. */
function buildStill(srcDir, outDir, tmpDir) {
  const srcFile = path.join(srcDir, STILL_SOURCE);
  if (!fs.existsSync(srcFile)) {
    throw new Error(`не найден исходник: ${srcFile}`);
  }

  const before = fs.statSync(srcFile).size;
  const { width, height } = pixelSize(srcFile);
  const targetWidth = STILL_TARGET_WIDTH;
  const targetHeight = Math.round((height * targetWidth) / width);

  const resizedFile = path.join(tmpDir, 'still.png');
  execFileSync('sips', ['-z', String(targetHeight), String(targetWidth), srcFile, '--out', resizedFile], { stdio: 'ignore' });

  if (!hasAlpha(resizedFile)) {
    throw new Error('альфа-канал потерян при масштабировании: still');
  }

  const outFile = path.join(outDir, STILL_OUT);
  execFileSync('cwebp', ['-lossless', '-z', String(WEBP_LOSSLESS_EFFORT), resizedFile, '-o', outFile], { stdio: 'ignore' });

  const after = fs.statSync(outFile).size;
  console.log(`${'still'.padEnd(6)} ${kb(before).padStart(10)} -> ${kb(after).padStart(9)}  (${width}x${height} -> ${targetWidth}x${targetHeight})`);
  return { width: targetWidth, height: targetHeight, size: after };
}

function build(srcDir, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const tmpDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'crow-assets-'));

  let totalBefore = 0;
  let totalAfter = 0;

  for (const layer of LAYERS) {
    const srcFile = path.join(srcDir, `${layer}.png`);
    if (!fs.existsSync(srcFile)) {
      throw new Error(`не найден исходник слоя: ${srcFile}`);
    }

    const before = fs.statSync(srcFile).size;
    const { width, height } = pixelSize(srcFile);
    const targetWidth = Math.round(width * SCALE);
    const targetHeight = Math.round(height * SCALE);

    const resizedFile = path.join(tmpDir, `${layer}.png`);
    execFileSync('sips', ['-z', String(targetHeight), String(targetWidth), srcFile, '--out', resizedFile], { stdio: 'ignore' });

    if (!hasAlpha(resizedFile)) {
      throw new Error(`альфа-канал потерян при масштабировании: ${layer}`);
    }

    const outFile = path.join(outDir, `${layer}.webp`);
    execFileSync('cwebp', ['-lossless', '-z', String(WEBP_LOSSLESS_EFFORT), resizedFile, '-o', outFile], { stdio: 'ignore' });

    const after = fs.statSync(outFile).size;
    totalBefore += before;
    totalAfter += after;

    console.log(`${layer.padEnd(6)} ${kb(before).padStart(10)} -> ${kb(after).padStart(9)}  (${width}x${height} -> ${targetWidth}x${targetHeight})`);
  }

  const still = buildStill(srcDir, outDir, tmpDir);

  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log('---');
  console.log(`итого  ${kb(totalBefore).padStart(10)} -> ${kb(totalAfter).padStart(9)}`);
  return still;
}

if (require.main === module) {
  const srcArg = process.argv[2];
  if (!srcArg) {
    console.error('Нужен каталог с исходниками первым аргументом.');
    console.error('Пример: node scripts/build-crow-assets.js path/to/design_handoff_crow_mascot/parts [каталог-назначения]');
    process.exit(1);
  }
  const outArg = process.argv[3];
  build(path.resolve(srcArg), outArg ? path.resolve(outArg) : DEFAULT_OUT_DIR);
}

module.exports = { build, buildStill, LAYERS, SCALE, STILL_TARGET_WIDTH };
