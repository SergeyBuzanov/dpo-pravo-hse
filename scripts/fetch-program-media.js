#!/usr/bin/env node
/**
 * Скачивает медиа программ с маркетплейса hse.ru к нам в репозиторий.
 *
 *   node scripts/fetch-program-media.js            # только недостающее
 *   node scripts/fetch-program-media.js --force    # перекачать всё
 *
 * Что и зачем забираем:
 *   - og:image страницы программы -> images/programs/<id>.<ext>. CSP сайта
 *     (img-src 'self') запрещает показывать картинки с hse.ru напрямую,
 *     поэтому единственный способ дать карточкам обложки – хранить копии
 *     у себя. URL og:image часто несёт суффиксы ресайзера
 *     («…png:c779x410+0+33:r1520x800!») – качаем ПО НЕМУ как есть, это уже
 *     кадрированная редакцией версия, а имя файла делаем своё по id.
 *   - Фото преподавателей из слайдера (img.dpo-sponsor__img_person, та же
 *     разметка, что разбирает fetch-program-descriptions.js) ->
 *     images/teachers/<slug-имени>.<ext>. Один человек встречается в
 *     нескольких программах – файл один, ключ справочника = точное имя.
 *   - Образцы документов (удостоверение ПК, диплом ПП) ->
 *     images/document-pk.png / document-pp.png.
 *
 * В .catalog-data.json пишутся: поле image у программы и top-level
 * справочник teacherPhotos { "<имя>": "images/teachers/…" }. Оба поля
 * переживают пересборку каталога – см. lib/catalog-store.js.
 *
 * Запросы идут последовательно с паузой: это чужой сайт, и обходить его
 * двадцатью шестью параллельными запросами невежливо.
 *
 * Уменьшенные копии: при наличии sips (macOS) обложки ужимаются в
 * images/programs/thumbs/<id>.jpg шириной 640px для карточек, фото людей –
 * до 160px по ширине. Без sips используются оригиналы.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { slugify } = require('../lib/program-slug');

const ROOT = path.join(__dirname, '..');
const STORE = path.join(ROOT, '.catalog-data.json');
const PROGRAMS_DIR = path.join(ROOT, 'images', 'programs');
const THUMBS_DIR = path.join(PROGRAMS_DIR, 'thumbs');
const TEACHERS_DIR = path.join(ROOT, 'images', 'teachers');

const DELAY_MS = 800;
const TIMEOUT_MS = 15000;
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const THUMB_WIDTH = 640;
const TEACHER_WIDTH = 160;

/** Образец удостоверения ПК: адрес проверен вручную, отдаёт 200. */
const DOC_PK_URL = 'https://www.hse.ru/f/src/edu/dpo/docs/pk/page-01.png';
/** Кандидат для диплома ПП: по аналогии; надёжнее – со страницы ПП-программы. */
const DOC_PP_URL = 'https://www.hse.ru/f/src/edu/dpo/docs/pp/page-01.png';

/** Ходим только на hse.ru: тот же контракт, что у остальных загрузчиков. */
function assertHseUrl(url) {
  const u = new URL(String(url));
  if (u.protocol !== 'https:') throw new Error('только https');
  if (u.hostname !== 'hse.ru' && !u.hostname.endsWith('.hse.ru')) {
    throw new Error('только hse.ru: ' + u.hostname);
  }
  return u.toString();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const decodeEntities = (s) =>
  String(s)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

/** Расширение по фактическому content-type; URL с суффиксом ресайзера врёт. */
function extByContentType(ct, url) {
  const t = String(ct || '').toLowerCase();
  if (t.includes('image/jpeg') || t.includes('image/jpg')) return 'jpg';
  if (t.includes('image/png')) return 'png';
  if (t.includes('image/webp')) return 'webp';
  if (t.includes('image/gif')) return 'gif';
  // Фолбэк: расширение из пути ДО двоеточия ресайзера.
  const m = String(url).match(/\.(jpe?g|png|webp|gif)(?=[:?]|$)/i);
  return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg';
}

async function fetchHtml(url) {
  const res = await fetch(assertHseUrl(url), {
    headers: { 'User-Agent': UA, Accept: 'text/html' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.text();
}

/** Скачивает картинку; отвечает именем расширения. Не картинка – ошибка. */
async function downloadImage(url, destBase) {
  const res = await fetch(assertHseUrl(url), {
    headers: { 'User-Agent': UA, Accept: 'image/*' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const ct = res.headers.get('content-type') || '';
  if (!/^image\//i.test(ct)) throw new Error('не картинка: ' + ct);
  const ext = extByContentType(ct, url);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error('пустой ответ');
  fs.writeFileSync(destBase + '.' + ext, buf);
  return ext;
}

/** Уже скачанный файл с любым из допустимых расширений. */
function existingFile(destBase) {
  for (const ext of ['jpg', 'png', 'webp', 'gif']) {
    if (fs.existsSync(destBase + '.' + ext)) return ext;
  }
  return null;
}

/** og:image страницы программы. */
function extractOgImage(html) {
  const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  return m ? decodeEntities(m[1]).trim() : null;
}

/**
 * Люди из слайдера преподавателей: имя + src фото. Тот же разбор, что в
 * fetch-program-descriptions.js (карточки dpo-sponsor__card внутри
 * dpo-slider, признак людей – класс dpo-sponsor__img_person), только
 * теперь нам нужен и адрес снимка.
 */
function extractTeacherPhotos(html) {
  const out = [];
  for (const sec of html.matchAll(/<section[^>]*dpo-slider[\s\S]*?<\/section>/g)) {
    const block = sec[0];
    if (!block.includes('dpo-sponsor__img_person')) continue;
    for (const c of block.matchAll(/<li[^>]*class="[^"]*dpo-sponsor__card[^"]*"[^>]*>([\s\S]*?)<\/li>/g)) {
      const card = c[1];
      const img = card.match(/<img[^>]+class="[^"]*dpo-sponsor__img_person[^"]*"[^>]*>/i);
      const name = card.match(/class="[^"]*dpo-caption[^"]*"[^>]*>([\s\S]*?)<\/[a-z0-9]+>/i);
      if (!img || !name) continue;
      const src = img[0].match(/\bsrc=["']([^"']+)["']/i);
      const nm = decodeEntities(name[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
      if (!src || !nm) continue;
      out.push({ name: nm, src: decodeEntities(src[1]).trim() });
    }
  }
  return out;
}

/** Образец документа на странице программы (класс dpo-certificate__img). */
function extractCertificate(html) {
  const m = html.match(/<img[^>]+class="[^"]*dpo-certificate__img[^"]*"[^>]*>/i);
  if (!m) return null;
  const src = m[0].match(/\bsrc=["']([^"']+)["']/i);
  return src ? decodeEntities(src[1]).trim() : null;
}

function hasSips() {
  try {
    execFileSync('/usr/bin/sips', ['--help'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function hasCwebp() {
  try {
    execFileSync('cwebp', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * WebP-спутник скана бланка. Сканы – единственные тяжёлые картинки сайта
 * (палитровый PNG 1200×848 весит 220–253 КБ), и WebP срезает их втрое:
 * 220 → 70 КБ на том же качестве. Разметка показывает их через <picture>,
 * где WebP – <source>, а исходный файл остаётся запасным.
 *
 * ВАЖНО: спутник обязан обновляться ВМЕСТЕ с оригиналом. Если <source>
 * укажет на исчезнувший файл, браузер не откатится на <img> – он уже выбрал
 * источник и покажет битую картинку. Поэтому webp пересоздаётся всякий раз,
 * когда скан скачан заново.
 */
function makeWebp(srcFile) {
  const dest = srcFile.replace(/\.(png|jpe?g)$/i, '.webp');
  if (dest === srcFile) return false;
  try {
    execFileSync('cwebp', ['-quiet', '-q', '80', srcFile, '-o', dest], { stdio: 'ignore' });
    return fs.existsSync(dest);
  } catch {
    return false;
  }
}

/**
 * PNG-обложка программы -> WebP. Маркетплейс отдаёт часть обложек
 * палитровым PNG (8-bit colormap): это фотография, сохранённая в формате
 * для схем, и весит она 196–708 КБ против 63–131 КБ в WebP. Страница
 * программы отдаёт полноразмерную обложку через srcset как 2x, то есть на
 * ретине посетитель качал именно её (находка 10 аудита 08.2026, закрыта
 * 21.08.2026). Возвращает новое расширение.
 */
function toWebpInPlace(fileBase, ext) {
  if (ext !== 'png' || !hasCwebp()) return ext;
  try {
    execFileSync('cwebp', ['-quiet', '-q', '80', fileBase + '.png', '-o', fileBase + '.webp'], {
      stdio: 'ignore',
    });
    if (!fs.existsSync(fileBase + '.webp')) return ext;
    fs.unlinkSync(fileBase + '.png');
    return 'webp';
  } catch {
    return ext;
  }
}

/** Миниатюра обложки: jpg шириной THUMB_WIDTH. Ошибка sips – не фатальна. */
function makeThumb(srcFile, destFile) {
  try {
    execFileSync(
      '/usr/bin/sips',
      ['-s', 'format', 'jpeg', '--resampleWidth', String(THUMB_WIDTH), srcFile, '--out', destFile],
      { stdio: 'ignore' },
    );
    return fs.existsSync(destFile);
  } catch {
    return false;
  }
}

/** PNG-фото человека -> JPEG q82: hse.ru отдаёт портреты PNG-кругом с
 *  альфой, но альфа не нужна – и CSS, и сам вырез круглые, а PNG весит
 *  вдесятеро дороже (аудит 2026-08, находка 9). sips плющит альфу на белое.
 *  Возвращает новое расширение файла. */
function toJpegInPlace(fileBase, ext) {
  if (ext !== 'png') return ext;
  try {
    execFileSync(
      '/usr/bin/sips',
      ['-s', 'format', 'jpeg', '-s', 'formatOptions', '82', fileBase + '.png', '--out', fileBase + '.jpg'],
      { stdio: 'ignore' },
    );
    if (!fs.existsSync(fileBase + '.jpg')) return ext;
    fs.unlinkSync(fileBase + '.png');
    return 'jpg';
  } catch {
    return ext;
  }
}

/** Ужимает файл по ширине на месте, если он шире порога. */
function shrinkInPlace(file, width) {
  try {
    const out = execFileSync('/usr/bin/sips', ['-g', 'pixelWidth', file], { encoding: 'utf8' });
    const w = Number(out.match(/pixelWidth:\s*(\d+)/)?.[1]);
    if (!Number.isFinite(w) || w <= width) return false;
    execFileSync('/usr/bin/sips', ['--resampleWidth', String(width), file], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const force = process.argv.includes('--force');
  if (!fs.existsSync(STORE)) {
    console.error('Нет .catalog-data.json — сначала запустите node update-catalog.js');
    process.exitCode = 1;
    return;
  }

  const store = JSON.parse(fs.readFileSync(STORE, 'utf8'));
  const programs = store.programs || [];
  const photos = store.teacherPhotos && typeof store.teacherPhotos === 'object' ? store.teacherPhotos : {};

  fs.mkdirSync(PROGRAMS_DIR, { recursive: true });
  fs.mkdirSync(TEACHERS_DIR, { recursive: true });

  const sips = hasSips();
  if (sips) fs.mkdirSync(THUMBS_DIR, { recursive: true });
  else console.warn('sips не найден: миниатюры не создаются, будут использоваться оригиналы.');

  let covers = 0;
  let teacherFiles = 0;
  const noCover = [];
  const noPhoto = new Set();
  const failed = [];
  let ppCertUrl = null;

  for (const [i, p] of programs.entries()) {
    const id = String(p.id || '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!id || !p.url) continue;

    const coverBase = path.join(PROGRAMS_DIR, id);
    const haveCover = existingFile(coverBase);
    // Идемпотентность по программе: обложка на месте, все преподаватели уже
    // в справочнике – страницу не трогаем вовсе (и не ждём паузу).
    const teachersDone = (p.teachers || []).every((t) => t && t.name && photos[t.name]);
    // ПП-страница нужна дополнительно только пока не скачан образец диплома.
    const needPPCert =
      (p.type?.shortTitle || p.type?.title) === 'ПП' &&
      !ppCertUrl &&
      (force || !existingFile(path.join(ROOT, 'images', 'document-pp')));
    if (!force && haveCover && p.image && teachersDone && !needPPCert) continue;

    let html;
    try {
      html = await fetchHtml(p.url);
    } catch (err) {
      failed.push(`${p.title.slice(0, 50)}: страница – ${err.message}`);
      await sleep(DELAY_MS);
      continue;
    }

    // Обложка из og:image.
    if (force || !haveCover) {
      const og = extractOgImage(html);
      if (!og) {
        noCover.push(p.title);
      } else {
        try {
          const ext = toWebpInPlace(coverBase, await downloadImage(og, coverBase));
          p.image = `images/programs/${id}.${ext}`;
          covers++;
        } catch (err) {
          noCover.push(p.title);
          failed.push(`${p.title.slice(0, 50)}: og:image – ${err.message}`);
        }
      }
    } else if (!p.image) {
      p.image = `images/programs/${id}.${haveCover}`;
    }

    // Фото людей. Ключ справочника – точное имя из карточки: оно совпадает
    // с полем name в teachers у программ (тот же разбор той же разметки).
    const people = extractTeacherPhotos(html);
    for (const person of people) {
      if (!force && photos[person.name]) continue;
      const slug = slugify(person.name);
      const base = path.join(TEACHERS_DIR, slug);
      const have = existingFile(base);
      if (!force && have) {
        photos[person.name] = `images/teachers/${slug}.${have}`;
        continue;
      }
      try {
        let ext = await downloadImage(person.src, base);
        if (sips) {
          shrinkInPlace(base + '.' + ext, TEACHER_WIDTH);
          ext = toJpegInPlace(base, ext);
        }
        photos[person.name] = `images/teachers/${slug}.${ext}`;
        teacherFiles++;
        await sleep(250);
      } catch (err) {
        failed.push(`фото ${person.name}: ${err.message}`);
      }
    }

    // У кого из заявленных в данных преподавателей фото на странице нет.
    for (const t of p.teachers || []) {
      if (t && t.name && !photos[t.name]) noPhoto.add(t.name);
    }

    // Кандидат на образец диплома ПП – с первой же ПП-страницы.
    if ((p.type?.shortTitle || p.type?.title) === 'ПП' && !ppCertUrl) {
      ppCertUrl = extractCertificate(html);
    }

    process.stdout.write(`  [${i + 1}/${programs.length}] ${p.title.slice(0, 60)}\n`);
    await sleep(DELAY_MS);
  }

  // Образцы документов. ПК – проверенный адрес; ПП – сперва то, что нашлось
  // на странице ПП-программы, затем адрес по аналогии с ПК.
  const docs = [];
  const pkDest = path.join(ROOT, 'images', 'document-pk.png');
  if (force || !fs.existsSync(pkDest)) {
    try {
      await downloadImage(DOC_PK_URL, pkDest.replace(/\.png$/, ''));
      docs.push('document-pk');
    } catch (err) {
      failed.push('document-pk: ' + err.message);
    }
  } else docs.push('document-pk (уже был)');

  const ppDest = path.join(ROOT, 'images', 'document-pp');
  if (force || !existingFile(ppDest)) {
    let got = false;
    for (const cand of [ppCertUrl, DOC_PP_URL].filter(Boolean)) {
      try {
        await downloadImage(cand, ppDest);
        docs.push('document-pp');
        got = true;
        break;
      } catch {
        // пробуем следующий кандидат
      }
    }
    if (!got) failed.push('document-pp: не найден ни на странице ПП, ни по адресу по аналогии');
  } else docs.push('document-pp (уже был)');

  // WebP-спутники сканов: разметка блока «Документ» показывает их через
  // <picture>, и отсутствующий спутник даст битую картинку, а не откат на
  // оригинал. Поэтому проходим по ВСЕМ сканам, а не только по свежим.
  let webps = 0;
  if (hasCwebp()) {
    for (const base of ['document-pk', 'document-pp', 'document-vo', 'document-cert']) {
      const stem = path.join(ROOT, 'images', base);
      // existingFile отдаёт РАСШИРЕНИЕ, а не путь.
      const ext = existingFile(stem);
      if (!ext || ext === 'webp') continue;
      const file = `${stem}.${ext}`;
      const webp = `${stem}.webp`;
      if (!force && fs.existsSync(webp) && fs.statSync(webp).mtimeMs >= fs.statSync(file).mtimeMs) continue;
      if (makeWebp(file)) webps++;
    }
  } else {
    console.warn('cwebp не найден: WebP-спутники сканов не обновлены – проверьте блок «Документ».');
  }

  // Миниатюры обложек для карточек.
  let thumbs = 0;
  if (sips) {
    for (const p of programs) {
      if (!p.image) continue;
      const src = path.join(ROOT, p.image);
      const dest = path.join(THUMBS_DIR, String(p.id) + '.jpg');
      if (!fs.existsSync(src)) continue;
      if (!force && fs.existsSync(dest)) continue;
      if (makeThumb(src, dest)) thumbs++;
    }
  }

  store.teacherPhotos = photos;
  fs.writeFileSync(STORE, JSON.stringify(store, null, 2) + '\n', 'utf8');

  const withImage = programs.filter((x) => x.image).length;
  console.log(
    `\nГотово. Обложек скачано: ${covers} (всего с обложкой ${withImage}/${programs.length}), ` +
      `миниатюр создано: ${thumbs}, фото людей скачано: ${teacherFiles} ` +
      `(в справочнике ${Object.keys(photos).length}), документы: ${docs.join(', ') || 'нет'}, ` +
      `WebP-спутников обновлено: ${webps}.`,
  );
  if (noCover.length) {
    console.warn(`Без обложки (${noCover.length}):`);
    for (const t of noCover) console.warn('  - ' + t);
  }
  if (noPhoto.size) {
    console.warn(`Преподаватели без фото (${noPhoto.size}):`);
    for (const n of noPhoto) console.warn('  - ' + n);
  }
  if (failed.length) {
    console.warn(`Ошибки (${failed.length}):`);
    for (const f of failed) console.warn('  - ' + f);
  }
  console.log('Дальше: node update-catalog.js --from-store, чтобы пересобрать витрину с обложками.');
}

if (require.main === module) main();

module.exports = { extractOgImage, extractTeacherPhotos, extractCertificate, extByContentType };
