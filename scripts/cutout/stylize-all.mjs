// Прогон стилизации по всем преподавателям из .catalog-data.json:
// у кого есть личная страница hse.ru – скачивается исходник 720x720
// (адрес вида /pubs/share/thumb/<id>:c720x720+0+0:r720x720!), у прочих
// берётся локальное превью 160px. Итог кладётся ПОВЕРХ прежнего файла
// в images/teachers/ – имена и ссылки в генераторах не меняются,
// прежние оригиналы остаются в истории git.
//
//   node scripts/cutout/stylize-all.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const STYLIZE = path.join(HERE, 'stylize');
const BG = path.join(HERE, 'bg-720.png');
const TMP = fs.mkdtempSync('/tmp/stylize-');

const store = JSON.parse(fs.readFileSync(path.join(ROOT, '.catalog-data.json'), 'utf8'));
const photos = store.teacherPhotos || {};
const pages = store.teacherPages || {};

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

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
  let source = target;
  let big = false;
  const page = pages[name];
  if (page) {
    try {
      const html = await fetchText(page);
      const m = html.match(/\/pubs\/share\/thumb\/(\d+):/);
      if (m) {
        const src = path.join(TMP, `${m[1]}.jpg`);
        await fetchBinary(`https://www.hse.ru/pubs/share/thumb/${m[1]}:c720x720+0+0:r720x720!`, src);
        source = src;
        big = true;
      }
    } catch (e) {
      console.warn(`  ${name}: крупный исходник не добыт (${e.message}), беру превью 160px`);
    }
  }
  const out = path.join(TMP, `out-${i}.jpg`);
  try {
    execFileSync(STYLIZE, [source, BG, out], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    report.failed.push(`${name}: ${String(e.stderr || e.message).trim()}`);
    continue;
  }
  fs.copyFileSync(out, target);
  (big ? report.big : report.small).push(`${name} -> ${rel}`);
  console.log(`${i}/${Object.keys(photos).length} ${big ? '720px' : '160px'} ${name}`);
}

console.log(`\nИтого: из 720px – ${report.big.length}, из превью 160px – ${report.small.length}, не вышло – ${report.failed.length}`);
for (const f of report.failed) console.log(`  ОТКАЗ: ${f}`);
fs.writeFileSync(path.join(TMP, 'report.json'), JSON.stringify(report, null, 2));
console.log(`Отчёт: ${path.join(TMP, 'report.json')}`);
