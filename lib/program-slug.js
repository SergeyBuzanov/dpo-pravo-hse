'use strict';

/**
 * Адреса страниц программ: `programs/<slug>-<id>.html`.
 *
 * Slug читаемый, id устойчивый. Название программы на hse.ru может
 * измениться — адрес при этом поедет, но id в хвосте позволяет найти
 * страницу и поставить редирект. Только slug был бы хрупким, только id —
 * нечитаемым.
 */

const MAP = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

const MAX_SLUG = 60;

function transliterate(str) {
  return String(str)
    .toLowerCase()
    .split('')
    .map((ch) => (Object.prototype.hasOwnProperty.call(MAP, ch) ? MAP[ch] : ch))
    .join('');
}

function slugify(title) {
  const slug = transliterate(title)
    // Диакритика латиницы (français → francais) до отбрасывания символов.
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG)
    .replace(/-+$/g, '');
  return slug || 'programma';
}

/** Имя файла относительно корня сайта. */
function programHref(program) {
  const id = String(program?.id || '').replace(/[^a-zA-Z0-9_-]/g, '');
  const slug = slugify(program?.title || '');
  return `programs/${slug}${id ? `-${id}` : ''}.html`;
}

module.exports = { slugify, programHref, MAX_SLUG };
