#!/usr/bin/env node
/**
 * Снимок закрытых данных: заявки, креды, аналитика.
 *
 *   node scripts/backup-data.js
 *
 * Куда: backups/YYYY-MM-DDTHHMMSS/ (каталог в git не попадает).
 * Источник: DPO_DATA_DIR, иначе .data, .applications, .analytics, креды в корне.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { dataDir, ROOT } = require('../lib/data-dir');

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return 0;
  fs.cpSync(src, dest, { recursive: true, dereference: true });
  return 1;
}

function copyFile(src, dest) {
  if (!fs.existsSync(src) || !fs.statSync(src).isFile()) return 0;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return 1;
}

function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const out = path.join(ROOT, 'backups', stamp);
  fs.mkdirSync(out, { recursive: true });

  const dir = dataDir();
  let n = 0;
  n += copyDir(path.join(dir, '.applications'), path.join(out, '.applications'));
  n += copyDir(path.join(dir, '.analytics'), path.join(out, '.analytics'));
  n += copyFile(path.join(dir, '.admin-credentials.json'), path.join(out, '.admin-credentials.json'));
  n += copyFile(path.join(dir, '.admin-status.json'), path.join(out, '.admin-status.json'));
  n += copyFile(path.join(dir, '.catalog-schedule.json'), path.join(out, '.catalog-schedule.json'));
  if (dir !== ROOT) {
    n += copyDir(path.join(ROOT, '.applications'), path.join(out, 'root-applications'));
  }

  console.log(`Бэкап: ${path.relative(ROOT, out)} (${n} объектов).`);
  if (!n) console.warn('Нечего копировать: нет .data / заявок / аналитики.');
}

if (require.main === module) main();
module.exports = { main };
