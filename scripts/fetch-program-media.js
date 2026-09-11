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
 * Уменьшенные копии: sips (macOS) или Python+Pillow (Windows и остальные).
 * Обложки ужимаются в images/programs/thumbs/<id>.jpg шириной 640px для
 * карточек, фото людей – до 160px. Без обоих инструментов остаются оригиналы.
 * WebP-спутники: cwebp, иначе тот же Python.
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
/** Учебные планы и расписания программ, зеркало hse.ru (владелец 09.09.2026). */
const FILES_DIR = path.join(ROOT, 'files');

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

/**
 * Скачивает PDF программы (учебный план, расписание) к себе.
 *
 * Зеркалим по решению владельца 09.09.2026: ссылка на hse.ru умирает при
 * первой же перестройке их каталога, а файл нужен слушателю. Тип ответа
 * проверяем: по ссылке «…pdf» маркетплейс может отдать страницу-заглушку,
 * и тогда у нас лёг бы HTML с расширением pdf.
 */
const MAX_PDF_BYTES = 4 * 1024 * 1024;

async function downloadPdf(url, dest) {
  const res = await fetch(assertHseUrl(url), {
    headers: { 'User-Agent': UA, Accept: 'application/pdf' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const ct = res.headers.get('content-type') || '';
  if (!/^application\/pdf/i.test(ct)) throw new Error('не PDF: ' + ct);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error('пустой ответ');
  if (buf.length > MAX_PDF_BYTES) throw new Error('слишком большой файл: ' + buf.length);
  // Подпись формата: content-type подделать проще, чем первые байты.
  if (buf.subarray(0, 4).toString('latin1') !== '%PDF') throw new Error('это не PDF по сигнатуре');
  fs.writeFileSync(dest, buf);
  return buf.length;
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
/**
 * Имя человека из карточки. Чистка обязана совпадать с textOf в
 * scripts/fetch-program-descriptions.js: тот скрипт кладёт имя в программу,
 * этот – в ключ справочника фото, и лендинг ищет фото по точному
 * совпадению. Пока стрелки снимал только один из двух, «Андреев Павел
 * Викторович ➞» попал в ключ, а имя в программе осталось без стрелки –
 * портрет не находился (64 фото из 65, находка аудита 05.09.2026).
 * Стрелками на hse.ru помечены ссылки «подробнее», к имени они не относятся.
 */
function teacherName(chunk) {
  return decodeEntities(String(chunk).replace(/<[^>]+>/g, ' '))
    .replace(/[\u2190-\u21FF\u2794-\u27BF\u2B00-\u2BFF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

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
      const nm = teacherName(name[1]);
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

const IMAGE_TOOLS = path.join(__dirname, 'image-tools.py');

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

function hasPythonTools() {
  try {
    execFileSync('python', ['-c', 'from PIL import Image'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function runPython(args) {
  execFileSync('python', [IMAGE_TOOLS, ...args], { stdio: 'ignore' });
}

function canResize() {
  return hasSips() || hasPythonTools();
}

function canWebp() {
  return hasCwebp() || hasPythonTools();
}

/**
 * WebP-спутник. Сканы бланков и обложки/портреты показывают его через
 * <picture>: WebP – <source>, исходный файл остаётся запасным.
 *
 * ВАЖНО: спутник обязан обновляться ВМЕСТЕ с оригиналом. Если <source>
 * укажет на исчезнувший файл, браузер не откатится на <img> – он уже выбрал
 * источник и покажет битую картинку. Поэтому webp пересоздаётся всякий раз,
 * когда оригинал новее спутника.
 */
function makeWebp(srcFile) {
  const dest = srcFile.replace(/\.(png|jpe?g)$/i, '.webp');
  if (dest === srcFile) return false;
  try {
    if (hasCwebp()) {
      execFileSync('cwebp', ['-quiet', '-q', '80', srcFile, '-o', dest], { stdio: 'ignore' });
    } else if (hasPythonTools()) {
      runPython(['webp', srcFile, dest, '80']);
    } else {
      return false;
    }
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
  if (ext !== 'png' || !canWebp()) return ext;
  const src = fileBase + '.png';
  const dest = fileBase + '.webp';
  try {
    if (makeWebp(src) && fs.existsSync(dest)) {
      fs.unlinkSync(src);
      return 'webp';
    }
  } catch {
    /* оставляем png */
  }
  return ext;
}

/** Миниатюра обложки: jpg шириной THUMB_WIDTH. Ошибка конвертера – не фатальна. */
function makeThumb(srcFile, destFile) {
  try {
    if (hasSips()) {
      execFileSync(
        '/usr/bin/sips',
        [
          '-s',
          'format',
          'jpeg',
          '-s',
          'formatOptions',
          '80',
          '--resampleWidth',
          String(THUMB_WIDTH),
          srcFile,
          '--out',
          destFile,
        ],
        { stdio: 'ignore' },
      );
    } else if (hasPythonTools()) {
      runPython(['thumb', srcFile, destFile, String(THUMB_WIDTH)]);
    } else {
      return false;
    }
    return fs.existsSync(destFile);
  } catch {
    return false;
  }
}

/** PNG-фото человека -> JPEG q82: hse.ru отдаёт портреты PNG-кругом с
 *  альфой, но альфа не нужна – и CSS, и сам вырез круглые, а PNG весит
 *  вдесятеро дороже (аудит 2026-08, находка 9). Конвертер плющит альфу на белое.
 *  Возвращает новое расширение файла. */
function toJpegInPlace(fileBase, ext) {
  if (ext !== 'png') return ext;
  const src = fileBase + '.png';
  const dest = fileBase + '.jpg';
  try {
    if (hasSips()) {
      execFileSync(
        '/usr/bin/sips',
        ['-s', 'format', 'jpeg', '-s', 'formatOptions', '82', src, '--out', dest],
        { stdio: 'ignore' },
      );
    } else if (hasPythonTools()) {
      runPython(['jpeg', src, dest, '82']);
    } else {
      return ext;
    }
    if (!fs.existsSync(dest)) return ext;
    fs.unlinkSync(src);
    return 'jpg';
  } catch {
    return ext;
  }
}

/** Ужимает файл по ширине на месте, если он шире порога. */
function shrinkInPlace(file, width) {
  try {
    if (hasSips()) {
      const out = execFileSync('/usr/bin/sips', ['-g', 'pixelWidth', file], { encoding: 'utf8' });
      const w = Number(out.match(/pixelWidth:\s*(\d+)/)?.[1]);
      if (!Number.isFinite(w) || w <= width) return false;
      execFileSync('/usr/bin/sips', ['--resampleWidth', String(width), file], { stdio: 'ignore' });
      return true;
    }
    if (hasPythonTools()) {
      runPython(['shrink', file, String(width)]);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

/** WebP-спутники для уже лежащих на диске обложек, миниатюр и портретов. */
function makeCompanions(dir) {
  if (!canWebp() || !fs.existsSync(dir)) return 0;
  let n = 0;
  for (const name of fs.readdirSync(dir)) {
    const ext = path.extname(name).toLowerCase();
    if (ext !== '.jpg' && ext !== '.jpeg' && ext !== '.png') continue;
    const src = path.join(dir, name);
    const dest = src.replace(/\.(png|jpe?g)$/i, '.webp');
    if (fs.existsSync(dest) && fs.statSync(dest).mtimeMs >= fs.statSync(src).mtimeMs) continue;
    if (makeWebp(src)) n++;
  }
  return n;
}

async function main() {
  const force = process.argv.includes('--force');
  const localOnly = process.argv.includes('--local');
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

  const resizer = canResize();
  if (resizer) fs.mkdirSync(THUMBS_DIR, { recursive: true });
  else console.warn('Ни sips, ни Python+Pillow: миниатюры не создаются, будут использоваться оригиналы.');

  if (localOnly) {
    let thumbs = 0;
    if (resizer) {
      for (const p of programs) {
        if (!p.image) continue;
        const src = path.join(ROOT, p.image);
        const dest = path.join(THUMBS_DIR, String(p.id) + '.jpg');
        if (!fs.existsSync(src)) continue;
        if (!force && fs.existsSync(dest)) continue;
        if (makeThumb(src, dest)) thumbs++;
      }
    }
    let teacherJpeg = 0;
    if (resizer && fs.existsSync(TEACHERS_DIR)) {
      for (const name of fs.readdirSync(TEACHERS_DIR)) {
        if (!/\.png$/i.test(name)) continue;
        const base = path.join(TEACHERS_DIR, name.replace(/\.png$/i, ''));
        shrinkInPlace(base + '.png', TEACHER_WIDTH);
        const next = toJpegInPlace(base, 'png');
        if (next === 'jpg') {
          const slug = path.basename(base);
          for (const [person, rel] of Object.entries(photos)) {
            if (rel === `images/teachers/${slug}.png`) {
              photos[person] = `images/teachers/${slug}.jpg`;
            }
          }
          teacherJpeg++;
        }
      }
    }
    const coverWebp = makeCompanions(PROGRAMS_DIR);
    const thumbWebp = makeCompanions(THUMBS_DIR);
    const teacherWebp = makeCompanions(TEACHERS_DIR);
    let docsWebp = 0;
    if (canWebp()) {
      for (const base of ['document-pk', 'document-pp', 'document-vo', 'document-cert']) {
        const stem = path.join(ROOT, 'images', base);
        const ext = existingFile(stem);
        if (!ext || ext === 'webp') continue;
        const file = `${stem}.${ext}`;
        const webp = `${stem}.webp`;
        if (!force && fs.existsSync(webp) && fs.statSync(webp).mtimeMs >= fs.statSync(file).mtimeMs) continue;
        if (makeWebp(file)) docsWebp++;
      }
    }
    if (teacherJpeg) {
      store.teacherPhotos = photos;
      fs.writeFileSync(STORE, JSON.stringify(store, null, 2) + '\n', 'utf8');
    }
    console.log(
      `Локально: миниатюр ${thumbs}, портретов PNG→JPEG ${teacherJpeg}, ` +
        `WebP обложек ${coverWebp}, миниатюр ${thumbWebp}, портретов ${teacherWebp}, бланков ${docsWebp}.`,
    );
    return;
  }

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
        if (resizer) {
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
    console.warn('Ни cwebp, ни Python+Pillow: WebP-спутники сканов не обновлены – проверьте блок «Документ».');
  }

  // Миниатюры обложек для карточек.
  let thumbs = 0;
  if (resizer) {
    for (const p of programs) {
      if (!p.image) continue;
      const src = path.join(ROOT, p.image);
      const dest = path.join(THUMBS_DIR, String(p.id) + '.jpg');
      if (!fs.existsSync(src)) continue;
      if (!force && fs.existsSync(dest)) continue;
      if (makeThumb(src, dest)) thumbs++;
    }
  }

  // Файлы программ: учебный план и расписание. Ссылки на оригиналы кладёт
  // scripts/fetch-program-descriptions.js, сюда приходит только доставка.
  // Расписание перекачиваем ВСЕГДА (решение владельца 09.09.2026:
  // «обновлять вместе»): у него меняется содержимое при том же адресе, и
  // пропуск по «файл уже есть» показывал бы слушателю прошлый семестр.
  fs.mkdirSync(FILES_DIR, { recursive: true });
  let programDocs = 0;
  const docFails = [];
  for (const p of programs) {
    if (!Array.isArray(p.files) || !p.files.length) continue;
    for (const f of p.files) {
      if (!f || !f.url || (f.kind !== 'plan' && f.kind !== 'schedule')) continue;
      const rel = `files/${p.id}-${f.kind}.pdf`;
      const dest = path.join(ROOT, rel);
      const stale = f.kind === 'schedule' || force || !fs.existsSync(dest);
      if (!stale) { f.path = rel; continue; }
      try {
        await downloadPdf(f.url, dest);
        f.path = rel;
        programDocs++;
        await sleep(DELAY_MS);
      } catch (err) {
        docFails.push(`${p.title.slice(0, 40)} (${f.kind}): ${err.message}`);
        if (!fs.existsSync(dest)) f.path = null;
      }
    }
  }
  if (docFails.length) {
    console.warn('\nФайлы программ, которые не скачались:');
    for (const line of docFails) console.warn('  - ' + line);
  }
  console.log(`Файлы программ: скачано ${programDocs}, всего с файлами ${programs.filter((x) => (x.files || []).some((f) => f.path)).length}/${programs.length}.`);

  const coverWebp = makeCompanions(PROGRAMS_DIR);
  const thumbWebp = makeCompanions(THUMBS_DIR);
  const teacherWebp = makeCompanions(TEACHERS_DIR);

  store.teacherPhotos = photos;
  fs.writeFileSync(STORE, JSON.stringify(store, null, 2) + '\n', 'utf8');

  const withImage = programs.filter((x) => x.image).length;
  console.log(
    `\nГотово. Обложек скачано: ${covers} (всего с обложкой ${withImage}/${programs.length}), ` +
      `миниатюр создано: ${thumbs}, фото людей скачано: ${teacherFiles} ` +
      `(в справочнике ${Object.keys(photos).length}), документы: ${docs.join(', ') || 'нет'}, ` +
      `WebP-спутников обновлено: ${webps + coverWebp + thumbWebp + teacherWebp}.`,
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

module.exports = { extractOgImage, extractTeacherPhotos, extractCertificate, extByContentType, main };
