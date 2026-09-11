/**
 * WebP-спутник рядом с JPEG/PNG и разметка <picture>.
 *
 * Браузер, выбрав <source type="image/webp">, уже не откатится на <img>,
 * если файла нет: будет пустая рамка. Поэтому спутник подставляется только
 * когда файл лежит на диске. Запасной <img> остаётся исходником.
 *
 * loading="lazy" обязано стоять ДО src: на лендинге React присваивает
 * пропсы по порядку, и браузер учитывает ленивость только если атрибут
 * выставлен раньше адреса.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

function webpSibling(root, rel) {
  const src = String(rel || '');
  const webp = src.replace(/\.(jpe?g|png)$/i, '.webp');
  if (webp === src) return null;
  return fs.existsSync(path.join(root, webp)) ? webp : null;
}

/**
 * @param {object} opts
 * @param {string} opts.src        путь от корня сайта (уже экранированный)
 * @param {string} [opts.webp]     путь спутника, тоже экранированный
 * @param {string} [opts.alt]
 * @param {string} [opts.className]
 * @param {boolean} [opts.lazy]
 * @param {string} [opts.extra]    прочие атрибуты img, со стартовым пробелом
 * @param {string} [opts.prefix]   например "../" на страницах программ
 */
function picture({ src, webp, alt, className, lazy = true, extra = '', prefix = '' }) {
  const img =
    '<img' +
    (className ? ` class="${className}"` : '') +
    (lazy ? ' loading="lazy"' : '') +
    ' decoding="async"' +
    (alt != null ? ` alt="${alt}"` : '') +
    extra +
    ` src="${prefix}${src}">`;
  if (!webp) return img;
  return `<picture><source srcset="${prefix}${webp}" type="image/webp">${img}</picture>`;
}

module.exports = { webpSibling, picture };
