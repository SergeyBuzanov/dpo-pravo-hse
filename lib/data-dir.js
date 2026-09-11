/**
 * Каталог закрытых данных (креды, заявки, аналитика, расписание).
 *
 * По умолчанию это корень проекта — как было. В Docker публичный nginx
 * монтирует весь репозиторий как document root, поэтому боевые секреты
 * уводятся в DPO_DATA_DIR на отдельный том: даже ошибка в белом списке
 * nginx не отдаст пароль и журнал заявок.
 */

'use strict';

const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function dataDir() {
  const env = String(process.env.DPO_DATA_DIR || '').trim();
  return env ? path.resolve(env) : ROOT;
}

function dataFile(...parts) {
  return path.join(dataDir(), ...parts);
}

module.exports = { ROOT, dataDir, dataFile };
