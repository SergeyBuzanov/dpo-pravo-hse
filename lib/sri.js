/**
 * Subresource Integrity для тегов <script>. Хеш считается с диска в момент
 * сборки: если файл скрипта сменят, не пересобрав страницу, браузер его
 * не исполнит.
 *
 * crossorigin не ставим: скрипты same-origin, а anonymous превратил бы
 * запрос в CORS и потребовал бы ACAO на статике.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');

function integrityFor(rel) {
  const file = path.join(ROOT, rel.replace(/^\.\.\//, ''));
  const buf = fs.readFileSync(file);
  return 'sha384-' + crypto.createHash('sha384').update(buf).digest('base64');
}

function scriptTag(src, { defer = true, prefix = '' } = {}) {
  const rel = String(src).replace(/^\.\.\//, '');
  const href = `${prefix}${src}`;
  const integrity = integrityFor(rel);
  return `<script src="${href}"${defer ? ' defer' : ''} integrity="${integrity}"></script>`;
}

module.exports = { integrityFor, scriptTag };
