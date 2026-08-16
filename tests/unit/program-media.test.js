const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Медиа программ: обложки и фото преподавателей скачаны к нам скриптом
// scripts/fetch-program-media.js, потому что CSP сайта (img-src 'self')
// запрещает картинки с чужих доменов. Тест проверяет две вещи:
//   1) хранилище не ссылается на несуществующие файлы – битая картинка
//      в каталоге хуже, чем её отсутствие;
//   2) формула персональной ссылки оплаты маркетплейса (buildPayUrl)
//      разворачивается назад в тот же id и action=cart.

const ROOT = path.join(__dirname, '..', '..');
const STORE = path.join(ROOT, '.catalog-data.json');
const { buildPayUrl } = require('../../scripts/build-program-pages');

const store = JSON.parse(fs.readFileSync(STORE, 'utf8'));
const programs = store.programs || [];

test('у всех программ с полем image файл лежит на диске', () => {
  const withImage = programs.filter((p) => p.image);
  assert.ok(withImage.length > 0, 'ни одной программы с image – запустите node scripts/fetch-program-media.js');
  for (const p of withImage) {
    assert.match(p.image, /^images\/programs\/[a-z0-9_.-]+$/i, `${p.id}: путь вне images/programs/`);
    assert.ok(fs.existsSync(path.join(ROOT, p.image)), `${p.id}: нет файла ${p.image}`);
  }
});

test('все пути справочника teacherPhotos существуют и лежат в images/teachers/', () => {
  const photos = store.teacherPhotos || {};
  const names = Object.keys(photos);
  assert.ok(names.length > 0, 'справочник teacherPhotos пуст');
  for (const name of names) {
    assert.match(photos[name], /^images\/teachers\/[a-z0-9_.-]+$/i, `${name}: путь вне images/teachers/`);
    assert.ok(fs.existsSync(path.join(ROOT, photos[name])), `${name}: нет файла ${photos[name]}`);
  }
});

test('payUrl – валидный https-адрес на lk.hse.ru', () => {
  const u = new URL(buildPayUrl('958734693'));
  assert.strictEqual(u.protocol, 'https:');
  assert.strictEqual(u.hostname, 'lk.hse.ru');
  assert.strictEqual(u.pathname, '/signin');
  assert.strictEqual(u.searchParams.get('systemid'), '27');
});

test('payUrl разворачивается назад в action=cart того же id', () => {
  for (const id of ['958734693', '1129129055']) {
    const u = new URL(buildPayUrl(id));
    const gateway = new URL(u.searchParams.get('redirecturl'));
    assert.strictEqual(gateway.hostname, 'www.hse.ru');
    assert.strictEqual(gateway.searchParams.get('ext'), 'marketplace');
    const i = gateway.searchParams.get('i');
    // Звёздочка перед base64 обязательна – так кодирует сам маркетплейс.
    assert.ok(i.startsWith('*'), 'нет звёздочки перед base64');
    const back = Buffer.from(i.slice(1), 'base64').toString('utf8');
    assert.strictEqual(back, `https://www.hse.ru/edu/dpo/${id}?action=cart`);
  }
});

test('на собранных страницах программ payUrl стоит у программ маркетплейса', () => {
  const marketplace = programs.filter((p) => /^\d+$/.test(String(p.id)));
  assert.ok(marketplace.length > 0);
  for (const p of marketplace.slice(0, 5)) {
    const files = fs
      .readdirSync(path.join(ROOT, 'programs'))
      .filter((f) => f.endsWith(`-${p.id}.html`));
    assert.strictEqual(files.length, 1, `${p.id}: страница не найдена`);
    const html = fs.readFileSync(path.join(ROOT, 'programs', files[0]), 'utf8');
    assert.ok(html.includes('class="cta-pay"'), `${files[0]}: нет кнопки оплаты`);
    assert.ok(html.includes('lk.hse.ru/signin'), `${files[0]}: нет ссылки ЛК`);
  }
});
