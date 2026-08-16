#!/usr/bin/env node
/**
 * Выносит вшитые ассеты из карты ресурсов index.html в обычные файлы.
 *
 * Лендинг собран сборщиком, который кладёт КАЖДЫЙ ассет в
 * `<script type="__bundler/manifest">` как base64, а в разметке оставляет
 * ссылку на uuid. Рантайм при загрузке страницы разворачивает карту в
 * data:/blob: и текстовой заменой подставляет ссылки в шаблон.
 *
 * Для шрифтов это худший из возможных вариантов доставки:
 *
 *   1. base64 раздувает двоичные данные на треть, и вся эта треть лежит
 *      в разметке, которую нельзя закешировать надолго;
 *   2. посетитель получает ВСЕ начертания сразу. У IBM Plex Sans и Source
 *      Serif 4 по шесть подмножеств (latin, latin-ext, cyrillic,
 *      cyrillic-ext, greek, vietnamese). На русском сайте греческое и
 *      вьетнамское не понадобится никогда, но в бандле они приезжают
 *      всегда: `unicode-range` умеет отменить ЗАГРУЗКУ файла, а data:-URL
 *      уже приехал внутри HTML;
 *   3. шрифт меняется раз в никогда, разметка — каждую сборку каталога,
 *      и склеенные вместе они инвалидируют кеш друг друга.
 *
 * После выноса `unicode-range` начинает работать как задумано: браузер
 * скачивает cyrillic и latin, а остальное не трогает.
 *
 * Имя файла ВЫЧИСЛЯЕТСЯ из соседнего @font-face (семейство + подмножество
 * по unicode-range), а не берётся из таблицы uuid. Это принципиально:
 * uuid живут ровно одну сборку, и таблица устарела бы при первой же
 * пересборке лендинга, причём молча.
 *
 * Использование:
 *   node scripts/unbundle-assets.js            # только отчёт
 *   node scripts/unbundle-assets.js --apply    # записать файлы и index.html
 *   node scripts/unbundle-assets.js --apply --js   # вынести ещё и скрипты
 *
 * Повторный запуск после --apply ничего не находит и ничего не пишет.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'index.html');
const FONTS_DIR = path.join(ROOT, 'fonts');
const JS_DIR = path.join(ROOT, 'js', 'bundle');
const VENDOR_DIR = path.join(ROOT, 'js', 'vendor');

const MANIFEST_OPEN = '<script type="__bundler/manifest"';
const EXTRES_OPEN = '<script type="__bundler/ext_resources"';
const FONT_MIME = /^font\//i;
const JS_MIME = /javascript/i;

/**
 * Строка загрузчика, собирающая карту внешних ресурсов. Библиотеки (React и
 * ReactDOM) не подключены тегом: рантайм лендинга берёт их по исходному
 * адресу unpkg из `window.__resources`. Пока адрес указывает на запись
 * карты ресурсов, вынести библиотеку в файл нельзя — ссылка повиснет.
 * Патч учит загрузчик понимать прямой путь.
 */
const LOADER_BEFORE = '      if (blobUrls[entry.uuid]) resourceMap[entry.id] = blobUrls[entry.uuid];';
const LOADER_AFTER =
  '      // entry.href — ресурс вынесен в файл (scripts/unbundle-assets.js);\n' +
  '      // entry.uuid — он всё ещё лежит в карте ресурсов этой страницы.\n' +
  '      if (entry.href) resourceMap[entry.id] = entry.href;\n' +
  '      else if (blobUrls[entry.uuid]) resourceMap[entry.id] = blobUrls[entry.uuid];';

/**
 * Подмножество определяется по характерным точкам unicode-range, а не по
 * полному совпадению строки: сборщики Google Fonts время от времени
 * дописывают в диапазоны новые символы, и точное сравнение сломалось бы на
 * ровном месте. Порядок проверок значим — cyrillic-ext надо распознать
 * раньше cyrillic, иначе он схлопнется в него.
 */
const SUBSETS = [
  ['cyrillic-ext', /U\+0460-052F/i],
  ['cyrillic', /U\+0400-045F/i],
  ['greek-ext', /U\+1F00-1FFF/i],
  ['greek', /U\+0370-0377/i],
  ['vietnamese', /U\+1EA0-1EF9/i],
  ['latin-ext', /U\+0100-02BA/i],
  ['latin', /U\+0000-00FF/i],
];

function subsetOf(unicodeRange) {
  for (const [name, re] of SUBSETS) if (re.test(unicodeRange)) return name;
  return null;
}

/** 'IBM Plex Sans' -> 'IBMPlexSans'; 'Source Serif 4' -> 'SourceSerif4'. */
function familySlug(family) {
  return family.replace(/['"]/g, '').replace(/[^A-Za-z0-9]+/g, '');
}

function sha1(buf) {
  return crypto.createHash('sha1').update(buf).digest('hex');
}

/**
 * Границы карты ресурсов внутри index.html.
 * Возвращает смещения содержимого, а не сам JSON: запись обратно должна
 * заменить ровно этот участок и не тронуть ни байта вокруг.
 */
function locateManifest(html) {
  const open = html.indexOf(MANIFEST_OPEN);
  if (open < 0) throw new Error('в index.html нет <script type="__bundler/manifest">');
  const start = html.indexOf('>', open) + 1;
  const end = html.indexOf('</script', start);
  if (end < 0) throw new Error('карта ресурсов не закрыта </script>');
  return { start, end };
}

/** Карта внешних ресурсов: [{id: адрес, uuid|href}]. Её может не быть. */
function readExtResources(html) {
  const open = html.indexOf(EXTRES_OPEN);
  if (open < 0) return null;
  const start = html.indexOf('>', open) + 1;
  const end = html.indexOf('</script', start);
  return { start, end, list: JSON.parse(html.slice(start, end)) };
}

/**
 * Ассет распакованными байтами. Сборщик хранит gzip внутри base64 —
 * `compressed: true`; несжатые записи тоже встречаются.
 */
function assetBytes(entry) {
  const raw = Buffer.from(entry.data, 'base64');
  if (!entry.compressed) return raw;
  return zlib.gunzipSync(raw);
}

/**
 * Ищет @font-face, объявляющий данный uuid, и вытаскивает из него
 * семейство и unicode-range.
 *
 * Разметка лендинга лежит в index.html JSON-строкой, поэтому переводы
 * строк и кавычки в ней экранированы. Разэкранируем копию ТОЛЬКО для
 * чтения — правки идут по исходному тексту.
 */
function fontFaceOf(html, uuid) {
  const flat = html.replace(/\\n/g, '\n').replace(/\\"/g, '"');
  const re = /@font-face\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(flat))) {
    const body = m[1];
    if (!body.includes(uuid)) continue;
    const family = (body.match(/font-family:\s*([^;]+)/) || [])[1];
    const range = (body.match(/unicode-range:\s*([^;]+)/) || [])[1];
    if (family) return { family: family.trim(), range: (range || '').trim() };
  }
  return null;
}

/** Файл в fonts/ с тем же содержимым — чтобы не плодить копию одних байтов. */
function findTwin(dir, digest) {
  if (!fs.existsSync(dir)) return null;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.woff2')) continue;
    if (sha1(fs.readFileSync(path.join(dir, name))) === digest) return name;
  }
  return null;
}

/**
 * Имя библиотеки из её исходного адреса на CDN:
 * https://unpkg.com/react@18.3.1/umd/react.production.min.js
 *   -> react-18.3.1.production.min.js
 * Версия в имени не украшение: без неё обновление библиотеки молча
 * подменило бы файл, на который ссылаются уже разосланные страницы.
 */
function vendorName(url, digest) {
  const clean = url.split(/[?#]/)[0];
  const file = clean.split('/').filter(Boolean).pop() || '';
  const version = (clean.match(/@(\d+\.\d+\.\d+[\w.-]*)/) || [])[1];
  if (!file.endsWith('.js')) return `lib-${digest.slice(0, 12)}.js`;
  if (!version) return file;
  const [head, ...rest] = file.split('.');
  return [`${head}-${version}`, ...rest].join('.');
}

/** Имя по «шапке» файла: сборщики оставляют там @license или путь исходника. */
function scriptName(bytes, digest) {
  const head = bytes.subarray(0, 400).toString('utf8');
  const license = head.match(/@license\s+([\w .-]+)/);
  if (license) return `${license[1].trim().toLowerCase().replace(/\s+/g, '-')}.js`;
  const generated = head.match(/GENERATED from ([\w-]+)/);
  if (generated) return `${generated[1]}.js`;
  return `app-${digest.slice(0, 12)}.js`;
}

function plan(html, { withJs }) {
  const { start, end } = locateManifest(html);
  const manifest = JSON.parse(html.slice(start, end));
  const extRes = readExtResources(html);
  const extList = extRes ? extRes.list : [];
  const items = [];

  for (const [uuid, entry] of Object.entries(manifest)) {
    if (!entry || typeof entry.mime !== 'string') continue;
    const isFont = FONT_MIME.test(entry.mime);
    const isJs = JS_MIME.test(entry.mime);
    if (!isFont && !(withJs && isJs)) continue;

    const bytes = assetBytes(entry);
    const digest = sha1(bytes);

    if (isFont) {
      const face = fontFaceOf(html, uuid);
      if (!face) {
        throw new Error(
          `шрифт ${uuid} не объявлен ни в одном @font-face — имя файла вычислить не из чего`,
        );
      }
      const subset = subsetOf(face.range);
      if (!subset) {
        throw new Error(
          `у шрифта ${uuid} (${face.family}) не распознан unicode-range: ${face.range || '—'}`,
        );
      }
      const name = `${familySlug(face.family)}-${subset}.woff2`;
      items.push({
        uuid,
        kind: 'font',
        bytes,
        digest,
        base64: entry.data.length,
        dir: FONTS_DIR,
        name,
        href: `fonts/${name}`,
        twin: findTwin(FONTS_DIR, digest),
        note: `${face.family} · ${subset}`,
      });
    } else {
      // Библиотека из карты внешних ресурсов знает свой исходный адрес —
      // от него и берём имя вместе с версией. Для остального имя даёт
      // заголовок файла, а в крайнем случае хеш: он же делает файл вечно
      // кешируемым, потому что имя меняется вместе с содержимым.
      const ext = extList.find((e) => e.uuid === uuid);
      const name = ext ? vendorName(ext.id, digest) : scriptName(bytes, digest);
      const dir = ext ? VENDOR_DIR : JS_DIR;
      const href = `js/${ext ? 'vendor' : 'bundle'}/${name}`;
      items.push({
        uuid,
        kind: 'js',
        external: ext ? ext.id : null,
        bytes,
        digest,
        base64: entry.data.length,
        dir,
        name,
        href,
        twin: null,
        note: ext ? `библиотека, ${ext.id.replace(/^https?:\/\//, '')}` : `${(bytes.length / 1024).toFixed(0)} КБ кода`,
      });
    }
  }

  return { start, end, manifest, items, extRes };
}

function apply(html, state) {
  const { manifest, items, extRes } = state;

  // Карта внешних ресурсов правится ПЕРВОЙ и по исходному тексту: дальше
  // смещения manifest сдвинутся, а искать заново незачем — оба участка
  // независимы. Запись переезжает с uuid на href, и рантайм после патча
  // берёт путь напрямую.
  let source = html;
  const vendors = items.filter((i) => i.external);
  if (vendors.length) {
    if (!extRes) throw new Error('библиотеки есть в карте ресурсов, а ext_resources нет');
    const next = extRes.list.map((e) => {
      const moved = vendors.find((v) => v.uuid === e.uuid);
      return moved ? { id: e.id, href: moved.href } : e;
    });
    source =
      html.slice(0, extRes.start) + JSON.stringify(next) + html.slice(extRes.end);

    if (source.includes(LOADER_BEFORE)) {
      source = source.replace(LOADER_BEFORE, LOADER_AFTER);
    } else if (!source.includes('if (entry.href) resourceMap[entry.id] = entry.href;')) {
      throw new Error(
        'загрузчик изменился: строку сборки resourceMap не удалось ни найти, ни распознать как уже исправленную',
      );
    }
  }

  // Смещения карты ресурсов пересчитываются: правка ext_resources выше
  // сдвинула текст.
  const at = locateManifest(source);
  let head = source.slice(0, at.start);
  let tail = source.slice(at.end);

  for (const item of items) {
    const target = path.join(item.dir, item.name);
    fs.mkdirSync(item.dir, { recursive: true });

    if (fs.existsSync(target)) {
      // Совпадение содержимого — файл уже вынесен прошлым запуском.
      // Расхождение — другой шрифт под тем же именем, и молча его
      // перезаписать значит сломать страницы, которые на него ссылаются.
      if (sha1(fs.readFileSync(target)) !== item.digest) {
        throw new Error(
          `${item.href} уже существует с другим содержимым — выберите имя вручную`,
        );
      }
    } else {
      fs.writeFileSync(target, item.bytes);
    }

    // Ссылки живут в шаблоне (он идёт ПОСЛЕ карты ресурсов), но замена по
    // всему тексту вокруг карты надёжнее: сборщик волен положить ссылку и
    // в статическую шапку. base64 самой карты в этот момент уже вырезан,
    // случайное совпадение uuid с телом ассета невозможно.
    head = head.split(item.uuid).join(item.href);
    tail = tail.split(item.uuid).join(item.href);
    delete manifest[item.uuid];
  }

  const next = head + JSON.stringify(manifest) + tail;

  // Оставшийся в разметке uuid означал бы битую ссылку на ресурс, которого
  // в карте больше нет: рантайм подставляет только известные ему uuid.
  for (const item of items) {
    if (next.includes(item.uuid)) {
      throw new Error(`uuid ${item.uuid} остался в index.html после замены`);
    }
  }
  return next;
}

function main() {
  const argv = process.argv.slice(2);
  const write = argv.includes('--apply');
  const withJs = argv.includes('--js');

  const html = fs.readFileSync(INDEX, 'utf8');
  const state = plan(html, { withJs });

  if (!state.items.length) {
    console.log('В карте ресурсов нечего выносить — всё уже лежит файлами.');
    return;
  }

  let saved = 0;
  console.log('Ассет'.padEnd(38), 'в HTML'.padStart(9), 'файлом'.padStart(9), ' что это');
  for (const item of state.items) {
    saved += item.base64;
    const twin = item.twin && item.twin !== item.name ? `  (те же байты, что в fonts/${item.twin})` : '';
    console.log(
      item.href.padEnd(38),
      `${(item.base64 / 1024).toFixed(0)} КБ`.padStart(9),
      `${(item.bytes.length / 1024).toFixed(0)} КБ`.padStart(9),
      ` ${item.note}${twin}`,
    );
  }
  console.log(
    `\nИтого из index.html уходит ${(saved / 1024).toFixed(0)} КБ ` +
      `(${(fs.statSync(INDEX).size / 1024).toFixed(0)} КБ сейчас).`,
  );

  if (!write) {
    console.log('Это только отчёт. Повторите с --apply, чтобы записать.');
    return;
  }

  const next = apply(html, state);
  const was = Buffer.byteLength(html);
  fs.writeFileSync(INDEX, next);
  // Байтами, а не символами: в разметке кириллица, и в символах файл
  // выглядит на десятую часть меньше, чем весит на диске и в сети.
  console.log(
    `index.html: ${(was / 1024).toFixed(0)} КБ -> ${(Buffer.byteLength(next) / 1024).toFixed(0)} КБ`,
  );
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error('Ошибка:', err.message);
    process.exitCode = 1;
  }
}

module.exports = { subsetOf, familySlug, locateManifest, plan };
