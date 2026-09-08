#!/usr/bin/env node
/**
 * Пережимает слои маскота-вороны в рабочий вес.
 *
 *   node scripts/build-crow-assets.js [каталог-с-исходниками]
 *
 * Исходники – 12 PNG от дизайнера (см. README пакета `design_handoff_
 * crow_mascot`), рантайм `crow-mascot.js` грузит из них только 11 – слой
 * `rest.png` был исходником для нарезки и в сборку не попадает.
 *
 * Вся геометрия маскота в `crow-mascot.js` задана в процентах от сцены
 * 1400×1465 (размер слоёв torso/neck). Поэтому масштаб ОДИН И ТОТ ЖЕ для
 * всех слоёв: кадрирование или разный масштаб развалят взаимное положение
 * частей. При смене исходников менять SCALE можно только сразу для всех.
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

// Пакет от дизайнера уже распакован сюда для этого прогона; для следующей
// поставки маскота передать новый каталог первым аргументом.
const DEFAULT_SRC = '/private/tmp/claude-501/-Users-buzanovsergey/aef4de8d-698a-46ed-bdd0-5abdf3b853d5/scratchpad/crow/design_handoff_crow_mascot/parts';

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'images', 'crow');

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

function build(srcDir) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
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

    const outFile = path.join(OUT_DIR, `${layer}.webp`);
    execFileSync('cwebp', ['-lossless', '-z', String(WEBP_LOSSLESS_EFFORT), resizedFile, '-o', outFile], { stdio: 'ignore' });

    const after = fs.statSync(outFile).size;
    totalBefore += before;
    totalAfter += after;

    console.log(`${layer.padEnd(6)} ${kb(before).padStart(10)} -> ${kb(after).padStart(9)}  (${width}x${height} -> ${targetWidth}x${targetHeight})`);
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log('---');
  console.log(`итого  ${kb(totalBefore).padStart(10)} -> ${kb(totalAfter).padStart(9)}`);
}

if (require.main === module) {
  const srcDir = process.argv[2] || DEFAULT_SRC;
  build(path.resolve(srcDir));
}

module.exports = { build, LAYERS, SCALE };
