const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Сохранение каталога не должно терять содержательные поля программ.
//
// Админка редактирует «тонкую» строку: id, название, ссылка, тип, формат,
// длительность, цена, дата старта, замок, источник. Описания, аудитория,
// результаты, модули, преподаватели, отзывы и обложка в редактор не
// попадают – их подтягивают отдельные скрипты со страниц hse.ru.
//
// Пока saveStore писал переданный массив как есть, одно нажатие «Сохранить
// в каталог» обнуляло эти поля у всех программ разом, а страницы программ
// пересобирались с заглушками вида «Описание пока не заполнено. Запустите
// node scripts/fetch-program-descriptions.js» – технической инструкцией
// для разработчика на витрине.
//
// mergeWithRemote переносил эти поля из локальной копии при обновлении с
// hse.ru, но ручной PUT из админки шёл мимо него.

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dpo-catalog-'));
process.env.CATALOG_DATA_FILE = path.join(DIR, 'catalog.json');

const { saveStore, loadStore } = require('../../lib/catalog-store');

/** Программа со всем, что подтягивается скриптами со страниц hse.ru. */
function richProgram() {
  return {
    id: '905186485',
    title: 'Нейроправо',
    url: 'https://www.hse.ru/edu/dpo/905186485',
    type: 'ПК',
    studyFormat: 'Очный',
    startDate: '2026-11-30',
    price: 50000,
    tagline: 'Готовим востребованных специалистов области нейроправа',
    about: 'На потребительском рынке появляется всё больше нейротехнологических устройств.',
    audience: { intro: null, items: ['Юристы', 'Предприниматели'] },
    results: ['Изучите правовой режим нейроданных', 'Разберёте судебную практику'],
    modules: [{ title: 'Введение в нейроправо', hours: 8 }],
    teachers: [{ name: 'Будник Руслан Александрович', about: 'Ведущий научный сотрудник' }],
    image: 'images/programs/905186485.png',
  };
}

/** Ровно то, что отдаёт редактор админки: programToEditorRow + обратный разбор. */
function editorRow(p) {
  return {
    id: p.id,
    title: p.title,
    url: p.url,
    type: 'ПК',
    studyFormat: 'Очный',
    duration: '',
    startDate: '2026-11-30',
    price: 50000,
    locked: false,
    source: 'hse',
  };
}

const CONTENT_FIELDS = ['tagline', 'about', 'audience', 'results', 'modules', 'teachers', 'image'];

test('сохранение из админки не стирает описания, преподавателей и обложки', async () => {
  await saveStore({ programs: [richProgram()], source: 'hse' });

  // Нажатие «Сохранить в каталог»: приходит только то, что есть в редакторе.
  await saveStore({ programs: [editorRow(richProgram())], source: 'manual' });

  const store = await loadStore();
  const p = store.programs.find((x) => x.id === '905186485');
  assert.ok(p, 'программа исчезла из хранилища');

  for (const field of CONTENT_FIELDS) {
    const value = p[field];
    const empty = value == null || (Array.isArray(value) && value.length === 0);
    assert.ok(!empty, `поле ${field} потеряно при сохранении из админки`);
  }
  assert.strictEqual(p.about, richProgram().about, 'описание изменилось');
  assert.strictEqual(p.teachers.length, 1, 'преподаватели потеряны');
  assert.strictEqual(p.image, 'images/programs/905186485.png', 'обложка потеряна');
});

test('поля редактора при этом обновляются, а не залипают', async () => {
  await saveStore({ programs: [richProgram()], source: 'hse' });
  const row = editorRow(richProgram());
  row.title = 'Нейроправо и права человека';
  row.price = 60000;
  await saveStore({ programs: [row], source: 'manual' });

  const p = (await loadStore()).programs.find((x) => x.id === '905186485');
  assert.strictEqual(p.title, 'Нейроправо и права человека', 'название не обновилось');
  assert.strictEqual(p.discountPrice, 60000, 'цена не обновилась');
  assert.strictEqual(p.about, richProgram().about, 'описание должно было сохраниться');
});

test('новая программа без описаний сохраняется как есть, ничего не подставляется', async () => {
  await saveStore({ programs: [richProgram()], source: 'hse' });
  await saveStore({
    programs: [richProgram(), { id: 'local-new', title: 'Ручная запись', type: 'ПК' }],
    source: 'manual',
  });

  const fresh = (await loadStore()).programs.find((x) => x.id === 'local-new');
  assert.ok(fresh, 'новая программа не сохранилась');
  assert.strictEqual(fresh.about, null, 'у новой программы не должно взяться чужое описание');
  const noTeachers = fresh.teachers == null || fresh.teachers.length === 0;
  assert.ok(noTeachers, 'у новой программы не должно взяться чужих преподавателей');
});

test('удалённая программа не воскресает из старого хранилища', async () => {
  await saveStore({ programs: [richProgram()], source: 'hse' });
  await saveStore({ programs: [], source: 'manual' });
  const store = await loadStore();
  assert.strictEqual(store.programs.length, 0, 'программа вернулась после удаления');
});

// ── Тот же перенос на пути «Актуализировать с hse.ru» ─────────────────────
// Выдача каталога hse.ru не содержит описаний, модулей, преподавателей и
// обложек: они приходят отдельными скриптами со страниц программ. Значит,
// обновление списка обязано переносить их из локальной копии.

const { mergeWithRemote } = require('../../lib/catalog-store');

test('обновление с hse.ru не стирает описания и обложки', () => {
  const local = [
    {
      ...richProgram(),
      type: { shortTitle: 'ПК', title: 'ПК' },
      studyFormat: { title: 'Очный' },
      locked: false,
      source: 'hse',
    },
  ];
  // Ровно то, что отдаёт выдача каталога: ни описаний, ни обложки.
  const remote = [
    {
      id: '905186485',
      title: 'Нейроправо',
      url: 'https://www.hse.ru/edu/dpo/905186485',
      type: { shortTitle: 'ПК', title: 'ПК' },
      studyFormat: { title: 'Очный' },
      educationPricing: 50000,
    },
  ];

  const merged = mergeWithRemote(local, remote);
  const p = merged.find((x) => x.id === '905186485');
  assert.ok(p, 'программа пропала при слиянии');
  for (const field of CONTENT_FIELDS) {
    const value = p[field];
    const empty = value == null || (Array.isArray(value) && value.length === 0);
    assert.ok(!empty, `поле ${field} потеряно при обновлении с hse.ru`);
  }
  assert.strictEqual(p.image, 'images/programs/905186485.png', 'обложка потеряна');
});

test('обновление с hse.ru обновляет то, что пришло из выдачи', () => {
  const local = [
    { ...richProgram(), type: { shortTitle: 'ПК', title: 'ПК' }, locked: false, source: 'hse' },
  ];
  const remote = [
    {
      id: '905186485',
      title: 'Нейроправо. Новая редакция',
      url: 'https://www.hse.ru/edu/dpo/905186485',
      type: { shortTitle: 'ПК', title: 'ПК' },
      educationPricing: 70000,
    },
  ];
  const p = mergeWithRemote(local, remote).find((x) => x.id === '905186485');
  assert.strictEqual(p.title, 'Нейроправо. Новая редакция', 'название не обновилось');
  assert.strictEqual(p.discountPrice, 70000, 'цена не обновилась');
  assert.strictEqual(p.about, richProgram().about, 'описание должно было сохраниться');
});
