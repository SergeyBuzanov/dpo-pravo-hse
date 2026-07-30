const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// В main функция асинхронная (fs/promises + rename) и называется writeAtomic.
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

test('исходный файл цел, если запись во временный не удалась', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dpo-'));
  const file = path.join(dir, 'catalog.html');
  fs.writeFileSync(file, 'важные данные', 'utf8');
  // Целевой путь лежит в несуществующем подкаталоге "нет" — writeFileSync
  // во временный файл упадёт с ENOENT.
  assert.throws(() => writeFileAtomic(path.join(dir, 'нет', 'catalog.html'), 'x'));
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'важные данные');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('временный файл убирается, если renameSync не удался', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dpo-'));
  const file = path.join(dir, 'catalog.html');
  // Целевой путь — существующий каталог: writeFileSync во временный файл
  // рядом пройдёт нормально, а вот renameSync поверх каталога упадёт
  // (на Windows — с EPERM). Так падает именно renameSync, а не запись
  // во временный файл.
  fs.mkdirSync(file);
  const tmp = `${file}.tmp-${process.pid}`;

  assert.throws(() => writeFileAtomic(file, 'x'));
  assert.strictEqual(fs.existsSync(tmp), false);

  fs.rmSync(dir, { recursive: true, force: true });
});
