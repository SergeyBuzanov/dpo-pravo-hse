const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// Реализация живёт в lib/catalog-store и реэкспортируется из update-catalog —
// тест закрепляет именно публичную точку, которой пользуется рендер каталога.
const { writeAtomic } = require('../../update-catalog');

test('запись перезаписывает существующий файл', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dpo-'));
  const file = path.join(dir, 'catalog.html');
  fs.writeFileSync(file, 'старое', 'utf8');
  await writeAtomic(file, 'новое');
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'новое');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('после записи временных файлов не остаётся', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dpo-'));
  const file = path.join(dir, 'catalog.html');
  await writeAtomic(file, 'содержимое');
  assert.deepStrictEqual(fs.readdirSync(dir), ['catalog.html']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('исходный файл цел, если запись во временный не удалась', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dpo-'));
  const file = path.join(dir, 'catalog.html');
  fs.writeFileSync(file, 'важные данные', 'utf8');
  // Целевой путь лежит в несуществующем подкаталоге «нет» — запись во
  // временный файл упадёт с ENOENT.
  await assert.rejects(writeAtomic(path.join(dir, 'нет', 'catalog.html'), 'x'));
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'важные данные');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('временный файл убирается, если rename не удался', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dpo-'));
  const file = path.join(dir, 'catalog.html');
  // Целевой путь — существующий НЕПУСТОЙ каталог: запись во временный файл
  // рядом пройдёт нормально, а вот rename поверх него упадёт (ENOTEMPTY;
  // на Windows — EPERM). Так падает именно rename, а не запись.
  fs.mkdirSync(file);
  fs.writeFileSync(path.join(file, 'занято'), 'x', 'utf8');

  await assert.rejects(writeAtomic(file, 'x'));
  const leftovers = fs.readdirSync(dir).filter((name) => name.endsWith('.tmp'));
  assert.deepStrictEqual(leftovers, []);

  fs.rmSync(dir, { recursive: true, force: true });
});
