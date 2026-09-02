// Прогон стилизации по преподавателям из .catalog-data.json.
//
// Решение заказчика 02.09.2026 (вторая итерация): стилизуются ТОЛЬКО
// преподаватели с личной страницей hse.ru, у которых удалось скачать
// крупный исходник 720x720 (адрес вида
// /pubs/share/thumb/<id>:c720x720+0+0:r720x720!). Превью 160px не
// стилизуются – из них получалось плохо, такие фото остаются
// оригиналами. Фон – bg-blue-720.png: РОВНЫЙ фирменный синий #102D69
// (цвет круга официальной эмблемы из брендбука) БЕЗ водяных знаков –
// финальный выбор заказчика 02.09 после трёх показов (пергамент с
// эмблемой, синий с надписями, сравнение четырёх светлых). Пергаментный
// bg-720.png оставлен рядом на случай возврата.
//
// Итог кладётся ПОВЕРХ прежнего файла в images/teachers/ – имена и
// ссылки в генераторах не меняются, оригиналы живут в истории git.
// ПРОГОН НЕИДЕМПОТЕНТЕН: перед повтором вернуть оригиналы
// `git checkout <коммит-с-оригиналами> -- images/teachers`.
//
//   node scripts/cutout/stylize-all.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const STYLIZE = path.join(HERE, 'stylize');
const BG = path.join(HERE, 'bg-blue-720.png');
const TMP = fs.mkdtempSync('/tmp/stylize-');

const store = JSON.parse(fs.readFileSync(path.join(ROOT, '.catalog-data.json'), 'utf8'));
const photos = store.teacherPhotos || {};
const pages = store.teacherPages || {};

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

// Осмотрено глазами 02.09.2026: у этих преподавателей исходник 720x720 –
// сцена с конференции, вырезка тянет тёмный ком (микрофон, стол, сосед).
// Остаются оригиналами, пока не появится нормальный портрет.
const SKIP = new Set(['Панарина Мария Михайловна']);

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.text();
}

async function fetchBinary(url, dest) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 5000) throw new Error(`подозрительно мало байт (${buf.length}): ${url}`);
  fs.writeFileSync(dest, buf);
}

const report = { big: [], small: [], failed: [] };
let i = 0;
for (const [name, rel] of Object.entries(photos)) {
  i += 1;
  const target = path.join(ROOT, rel);
  if (!fs.existsSync(target)) {
    report.failed.push(`${name}: нет файла ${rel}`);
    continue;
  }
  const page = pages[name];
  if (!page || SKIP.has(name)) {
    report.small.push(`${name}: ${SKIP.has(name) ? 'в списке исключений' : 'без личной страницы'} – оставлен оригинал`);
    continue;
  }
  let source = null;
  try {
    const html = await fetchText(page);
    const m = html.match(/\/pubs\/share\/thumb\/(\d+):/);
    if (!m) throw new Error('на странице не нашлось фото /pubs/share/thumb/');
    const src = path.join(TMP, `${m[1]}.jpg`);
    await fetchBinary(`https://www.hse.ru/pubs/share/thumb/${m[1]}:c720x720+0+0:r720x720!`, src);
    source = src;
  } catch (e) {
    report.failed.push(`${name}: крупный исходник не добыт (${e.message}) – оставлен оригинал`);
    console.warn(`  ${name}: ${e.message} – оставляю оригинал`);
    continue;
  }
  const out = path.join(TMP, `out-${i}.jpg`);
  try {
    execFileSync(STYLIZE, [source, BG, out], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    report.failed.push(`${name}: ${String(e.stderr || e.message).trim()} – оставлен оригинал`);
    continue;
  }
  fs.copyFileSync(out, target);
  report.big.push(`${name} -> ${rel}`);
  console.log(`${i}/${Object.keys(photos).length} 720px ${name}`);
}

console.log(`\nИтого: стилизовано из 720px – ${report.big.length}, оставлено оригиналами (нет страницы) – ${report.small.length}, отказов – ${report.failed.length}`);
for (const f of report.failed) console.log(`  ОТКАЗ: ${f}`);
fs.writeFileSync(path.join(TMP, 'report.json'), JSON.stringify(report, null, 2));
console.log(`Отчёт: ${path.join(TMP, 'report.json')}`);
