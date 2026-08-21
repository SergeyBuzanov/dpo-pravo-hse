/**
 * Общий статический HTTP-слой для двух серверов проекта:
 * admin-server.js (локальная админка) и scripts/static-server.js (публичное
 * превью). До выноса сюда MIME-таблица, белые списки, resolveSafe и readBody
 * были продублированы в обоих файлах дословно и правились порознь.
 *
 * Здесь только то, что у серверов действительно общее. Различия — заголовки
 * безопасности, CSP, троттлинг, семантика 413 — остаются в самих серверах:
 * это их политика, а не статика.
 */

'use strict';

const path = require('node:path');

const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.ico': 'image/x-icon',
});

/** Страницы, которые разрешено отдавать из корня проекта. */
const PUBLIC_HTML = new Set([
  'index.html',
  'privacy.html',
  'ratings.html',
  'admin.html',
  'Каталог программ.html',
]);

/** Служебные файлы корня (их отдаёт только публичный превью-сервер). */
const ROOT_FILES = new Set([
  'favicon.svg',
  'favicon.ico',
  'robots.txt',
  'sitemap.xml',
]);

const ASSET_DIRS = new Set(['fonts', 'js', 'images']);
const ASSET_EXT = new Set(['.css', '.woff2', '.js', '.jpg', '.jpeg', '.png', '.webp', '.svg']);

/**
 * Каталоги со страницами. В отличие от ASSET_DIRS отсюда отдаётся HTML,
 * поэтому набор расширений отдельный и намеренно узкий: только страницы
 * программ и их общий стиль. Файлы сюда пишет только генератор
 * scripts/build-program-pages.js.
 */
const PAGE_DIRS = new Set(['programs']);
const PAGE_EXT = new Set(['.html', '.css']);

/**
 * Данные, которые страница тянет уже в браузере. Сейчас это один файл –
 * `content/programs-index.json`, справочник программ для списка в форме
 * заявки (собирает scripts/build-program-pages.js). Только .json и только
 * на один уровень: каталог content/ – место для публичных данных витрины,
 * и класть туда что-то ещё нужно осознанно.
 */
const DATA_DIRS = new Set(['content']);
const DATA_EXT = new Set(['.json']);

/**
 * Превращает УЖЕ РАСКОДИРОВАННЫЙ путь запроса в безопасный путь внутри root.
 * Отсекает traversal, абсолютные пути и любые dot-сегменты (.git,
 * .admin-credentials.json, .analytics и т.п. не должны быть достижимы ни при
 * каком белом списке — это второй рубеж, а не единственный).
 * @returns {{rel: string, abs: string, base: string}|null}
 */
function resolveSafe(pathname, root) {
  let decoded = String(pathname);
  if (decoded === '/' || decoded === '') decoded = '/index.html';

  const rel = path.normalize(decoded.replace(/^[/\\]+/, '')).replace(/^(\.\.([/\\]|$))+/, '');
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;

  const segments = rel.split(/[/\\]/).filter(Boolean);
  if (segments.some((s) => s.startsWith('.'))) return null;

  const rootResolved = path.resolve(root);
  const abs = path.resolve(rootResolved, rel);
  if (abs !== rootResolved && !abs.startsWith(rootResolved + path.sep)) return null;

  return { rel: segments.join('/'), abs, base: path.basename(rel) };
}

/** Белый список публичного превью-сервера: страницы, служебные файлы, ассеты. */
function isAllowedStatic(safe) {
  if (!safe) return false;
  if (PUBLIC_HTML.has(safe.base) && safe.rel === safe.base) return true;
  if (ROOT_FILES.has(safe.base) && safe.rel === safe.base) return true;
  const parts = safe.rel.split('/');
  const topDir = parts[0];
  const ext = path.extname(safe.rel).toLowerCase();
  // Страницы программ лежат ровно на один уровень глубже корня:
  // programs/<файл>. Вложенности там нет и быть не должно.
  if (PAGE_DIRS.has(topDir)) return parts.length === 2 && PAGE_EXT.has(ext);
  if (DATA_DIRS.has(topDir)) return parts.length === 2 && DATA_EXT.has(ext);
  return ASSET_DIRS.has(topDir) && ASSET_EXT.has(ext);
}

/**
 * Читает тело запроса с лимитом. При превышении отклоняет с
 * err.code = 'BODY_TOO_LARGE', НЕ разрывая сокет: чтение приостанавливается,
 * а ответ (413 и т.п.) отправляет вызывающая сторона — мгновенный destroy
 * ронял бы клиенту «сеть недоступна» вместо понятной ошибки.
 */
function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      req.pause();
      req.removeAllListeners('data');
      reject(err);
    };

    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        fail(Object.assign(new Error('body too large'), { code: 'BODY_TOO_LARGE' }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', fail);
  });
}

module.exports = {
  MIME,
  PUBLIC_HTML,
  PAGE_DIRS,
  PAGE_EXT,
  ROOT_FILES,
  ASSET_DIRS,
  ASSET_EXT,
  DATA_DIRS,
  DATA_EXT,
  resolveSafe,
  isAllowedStatic,
  readBody,
};
