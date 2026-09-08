# Бот поддержки – план реализации

> **Для агентов:** ОБЯЗАТЕЛЬНЫЙ СУБ-СКИЛЛ: выполнять по одной задаче через
> superpowers:subagent-driven-development (рекомендуется) или
> superpowers:executing-plans. Шаги отмечаются чекбоксами `- [ ]`.

**Цель:** помощник в углу страницы, который подбирает программы поиском по
данным каталога и отвечает готовыми цитатами с сайта – без сервера, без ИИ,
целиком в браузере.

**Устройство:** данные собираются генератором в два публичных файла
`content/*.json`; логика подбора живёт в `js/bot-match.js` и читается и
браузером, и Node (поэтому проверяется настоящими тестами); виджет
`js/support-bot.js` самодостаточен – разметка и стили внутри файла, как у
`js/quiz.js` и `js/application-form.js`.

**Инструменты:** Node 18+ без зависимостей, `node --test`, Playwright для
смоук-тестов. Сборки js нет – файлы подключаются тегом `<script>`.

**Спека:** `docs/superpowers/specs/2026-09-08-podderzhka-bot-design.md`

## Общие ограничения

- **Зависимостей не добавлять.** В проекте нет ни одной npm-зависимости и
  нет lockfile. Ни одной новой – ни в браузер, ни в Node.
- **Em dash «—» запрещён** во всех видимых текстах и в коде. Только en dash
  «–». В `update-catalog.js` для этого есть `enDash()`.
- **Кавычки в текстах – «ёлочки».**
- **Правки лендинга: только через шаблон.** `npm run template:extract` →
  правка `.landing-template.html` → `npm run template:inject` → и только
  потом `node scripts/build-landing.js`. Иначе правки затираются.
- **`programs/program.css` и страницы `programs/*.html` генерируются**
  `scripts/build-program-pages.js`. Править источник, не результат.
- **Прогон тестов – двумя частями:** `ls tests/unit/*.test.js | grep -v smtp
  | xargs node --test`, затем `node --test tests/unit/smtp.test.js`.
  Вместе они вешают прогон.
- **Комментарии не должны содержать закрывающий тег скрипта:** внутри
  `<script>` он обрывает скрипт при HTML-разборе, страница не собирается,
  а консоль молчит.
- **Рантайм сборщика клонирует разметку лендинга** после загрузки: слушатели
  вешать делегированием на `document`, отметки хранить свойством узла, а не
  атрибутом (атрибут переживает `cloneNode`).

---

### Задача 1: `formatBucket` переезжает в общий модуль

Коды форматов (`online | offline | mixed | hybrid | other`) считает
`formatBucket` в `update-catalog.js`. Генератору страниц он тоже нужен, но
взять его напрямую нельзя: `update-catalog.js:727` сам требует
`scripts/build-program-pages`, и обратный require замкнёт круг. Функция
переезжает в `lib/program-labels.js` – модуль, заведённый ровно для того,
чтобы каталог и лендинг не разъезжались в формулировках.

**Файлы:**
- Изменить: `lib/program-labels.js` (добавить `formatBucket`)
- Изменить: `update-catalog.js:87` (убрать определение, брать из модуля)
- Тест: `tests/unit/format-bucket.test.js`

**Интерфейсы:**
- Отдаёт: `formatBucket(title: string) -> { value: 'online'|'offline'|'mixed'|'hybrid'|'other', label: string }`

- [ ] **Шаг 1: написать падающий тест**

```js
// tests/unit/format-bucket.test.js
'use strict';

/**
 * Коды форматов – общий словарь каталога, фильтров и бота. Разъедутся –
 * переход «показать в каталоге» приведёт в пустой список.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { formatBucket } = require('../../lib/program-labels');
const updateCatalog = require('../../update-catalog');

test('порядок проверок: составной формат не считается онлайном', () => {
  assert.equal(formatBucket('Смешанный (онлайн + очно)').value, 'mixed');
  assert.equal(formatBucket('Гибридный онлайн').value, 'hybrid');
});

test('основные форматы каталога', () => {
  assert.equal(formatBucket('Онлайн асинхронный').value, 'online');
  assert.equal(formatBucket('Очный').value, 'offline');
});

test('незнакомый формат не выдаётся за известный', () => {
  const out = formatBucket('Индивидуальные консультации');
  assert.equal(out.value, 'other');
  assert.equal(out.label, 'Индивидуальные консультации');
});

test('update-catalog отдаёт ту же функцию, а не свою копию', () => {
  assert.equal(updateCatalog.formatBucket, formatBucket);
});
```

- [ ] **Шаг 2: убедиться, что тест падает**

Запуск: `node --test tests/unit/format-bucket.test.js`
Ожидание: FAIL – `formatBucket is not a function` (в `lib/program-labels.js`
её ещё нет).

- [ ] **Шаг 3: перенести функцию**

В `lib/program-labels.js` добавить перед `module.exports`:

```js
/**
 * Код формата обучения: общий словарь каталога, фильтров, страниц программ
 * и бота. Переехал сюда из update-catalog.js 08.09.2026 – генератору
 * страниц он тоже нужен, а обратный require замкнул бы круг
 * (update-catalog.js сам требует scripts/build-program-pages).
 *
 * Порядок проверок важен: составные форматы часто содержат слово «онлайн»,
 * поэтому гибрид и смешанный проверяются раньше.
 */
function formatBucket(title = '') {
  if (/гибрид/i.test(title)) return { value: 'hybrid', label: 'Гибридный' };
  if (/смешан/i.test(title)) return { value: 'mixed', label: 'Смешанный' };
  if (/онлайн/i.test(title)) return { value: 'online', label: 'Онлайн' };
  if (/очн/i.test(title)) return { value: 'offline', label: 'Очно' };
  return { value: 'other', label: title || 'Другое' };
}
```

Строку экспорта заменить на:

```js
module.exports = { docBadge, shortFormat, formatTip, formatBucket };
```

В `update-catalog.js` удалить определение `formatBucket` целиком (вместе с
комментарием над ним) и добавить её в существующий require модуля:

```js
const { docBadge, shortFormat, formatTip, formatBucket } = require('./lib/program-labels');
```

Строку `formatBucket,` в `module.exports` файла НЕ трогать: она остаётся
ре-экспортом, на неё ссылаются существующие тесты.

- [ ] **Шаг 4: прогон**

Запуск: `node --test tests/unit/format-bucket.test.js`, затем весь корпус:
`ls tests/unit/*.test.js | grep -v smtp | xargs node --test`
Ожидание: PASS, число тестов выросло на 4, ни один старый не упал.

- [ ] **Шаг 5: коммит**

```bash
git add lib/program-labels.js update-catalog.js tests/unit/format-bucket.test.js
git commit -m "formatBucket переехал в lib/program-labels.js"
```

---

### Задача 2: данные бота – `content/bot-catalog.json`

**Файлы:**
- Изменить: `scripts/build-program-pages.js` (рядом с `writeProgramIndex`)
- Тест: `tests/unit/bot-data.test.js`

**Интерфейсы:**
- Потребляет: `formatBucket` из задачи 1; `groupBySphere` из
  `lib/program-spheres`; `formatPrice`, `upcomingStartLabel` из
  `lib/hse-catalog`; `programHref` из `lib/program-slug`.
- Отдаёт: файл `content/bot-catalog.json` вида
  `{ programs: [{ id, title, url, sphere, type, format, formatLabel, price, priceLabel, duration, start, keywords }] }`,
  где `price` – число или `null`, `start` – строка подписи или `null`,
  `keywords` – массив строк.

- [ ] **Шаг 1: написать падающий тест**

```js
// tests/unit/bot-data.test.js
'use strict';

/**
 * Данные бота. Бот не считает ни цену, ни дату старта – он показывает то,
 * что посчитали общие функции каталога. Тест сводит файл с хранилищем:
 * разойдутся – бот начнёт называть цену, которой нет на сайте.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { formatPrice, upcomingStartLabel } = require('../../lib/hse-catalog');
const { formatBucket } = require('../../lib/program-labels');
const { isAllowedStatic } = require('../../lib/static-http');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));

test('файл собран и содержит все программы каталога', () => {
  const bot = read('content/bot-catalog.json');
  const store = read('.catalog-data.json');
  assert.ok(Array.isArray(bot.programs));
  assert.equal(bot.programs.length, store.programs.length);
});

test('цена и старт совпадают с общими функциями каталога', () => {
  const bot = read('content/bot-catalog.json');
  const byId = new Map(read('.catalog-data.json').programs.map((p) => [String(p.id), p]));
  for (const item of bot.programs) {
    const source = byId.get(item.id);
    assert.ok(source, `программы ${item.id} нет в хранилище`);
    assert.equal(item.priceLabel, formatPrice(source));
    assert.equal(item.start, upcomingStartLabel(source) || null);
    assert.equal(item.format, formatBucket(source.studyFormat && source.studyFormat.title).value);
  }
});

test('адреса относительные – сайт живёт и в подкаталоге зеркала', () => {
  for (const item of read('content/bot-catalog.json').programs) {
    assert.ok(!/^https?:/.test(item.url), `абсолютный адрес: ${item.url}`);
  }
});

test('у каждой программы есть слова для поиска', () => {
  for (const item of read('content/bot-catalog.json').programs) {
    assert.ok(item.keywords.length > 0, `пустые keywords у ${item.title}`);
  }
});

test('белый список статики пускает файл наружу', () => {
  assert.equal(isAllowedStatic('content/bot-catalog.json'), true);
  assert.equal(isAllowedStatic('.catalog-data.json'), false);
});

test('коды форматов совпадают с чипами фильтров каталога', () => {
  // Разойдутся – переход «показать в каталоге» приведёт в пустой список.
  const catalog = fs.readFileSync(path.join(ROOT, 'Каталог программ.html'), 'utf8');
  const chips = new Set(
    [...catalog.matchAll(/data-group="format"[^>]*data-value="([^"]*)"/g)].map((m) => m[1]),
  );
  for (const item of read('content/bot-catalog.json').programs) {
    if (item.format === 'other') continue;
    assert.ok(chips.has(item.format), `код ${item.format} не встречается среди чипов каталога`);
  }
});
```

- [ ] **Шаг 2: убедиться, что тест падает**

Запуск: `node --test tests/unit/bot-data.test.js`
Ожидание: FAIL – `ENOENT: content/bot-catalog.json`.

- [ ] **Шаг 3: научить генератор собирать файл**

В `scripts/build-program-pages.js` дополнить require:

```js
const { formatPrice, formatDate, isoDate, upcomingStartLabel } = require('../lib/hse-catalog');
const { formatBucket } = require('../lib/program-labels');
```

Сразу после `writeProgramIndex` добавить:

```js
/**
 * Данные для бота поддержки (js/support-bot.js).
 *
 * Отдельный файл, а не расширение content/programs-index.json: тот читает
 * форма заявки, он намеренно узкий, и его состав стережёт отдельный тест.
 *
 * Цену и ближайший старт считают ОБЩИЕ функции каталога: четвёртого места,
 * где цена может разойтись с сайтом, в проекте быть не должно.
 */
function writeBotCatalog(programs, spheres) {
  const sphereOfId = new Map();
  for (const s of spheres) for (const p of s.items) sphereOfId.set(String(p.id), s.title);

  const items = programs.map((p) => {
    const bucket = formatBucket((p.studyFormat && p.studyFormat.title) || '');
    // Слова для поиска: модули, аудитория и подводка. Названия программ
    // ищутся отдельно, поэтому здесь их нет.
    const keywords = [
      ...(Array.isArray(p.modules) ? p.modules.map((m) => m && m.title) : []),
      ...((p.audience && Array.isArray(p.audience.items)) ? p.audience.items : []),
      p.tagline || '',
    ]
      .map((s) => String(s || '').trim())
      .filter(Boolean);

    return {
      id: String(p.id || ''),
      title: String(p.title || ''),
      url: programHref(p),
      sphere: sphereOfId.get(String(p.id)) || 'Другие программы',
      type: String((p.type && (p.type.shortTitle || p.type.title)) || ''),
      format: bucket.value,
      formatLabel: (p.studyFormat && p.studyFormat.title) || bucket.label,
      price: typeof p.discountPrice === 'number' ? p.discountPrice
        : typeof p.educationPricing === 'number' ? p.educationPricing : null,
      priceLabel: formatPrice(p),
      duration: p.duration || null,
      start: upcomingStartLabel(p) || null,
      keywords,
    };
  });

  fs.mkdirSync(path.join(ROOT, 'content'), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, 'content', 'bot-catalog.json'),
    JSON.stringify({ programs: items }, null, 2) + '\n',
    'utf8',
  );
  return items.length;
}
```

Вызвать её там же, где вызывается `writeProgramIndex` (найти вызов в
`build()` и добавить строкой ниже), и добавить число в итоговую печать
рядом с «справочник для формы: N записей».

- [ ] **Шаг 4: собрать и прогнать**

Запуск: `node scripts/build-program-pages.js && node --test tests/unit/bot-data.test.js`
Ожидание: генератор печатает число записей, тест PASS.

- [ ] **Шаг 5: коммит**

```bash
git add scripts/build-program-pages.js content/bot-catalog.json tests/unit/bot-data.test.js
git commit -m "данные бота: content/bot-catalog.json из хранилища каталога"
```

---

### Задача 3: ядро поиска `js/bot-match.js`

**Файлы:**
- Создать: `js/bot-match.js`
- Тест: `tests/unit/bot-match.test.js`

**Интерфейсы:**
- Отдаёт (и в браузере как `window.DpoBotMatch`, и в Node как
  `module.exports`):
  - `stem(word: string) -> string`
  - `parseQuery(query: string) -> { stems: string[], priceMax: number|null, priceMin: number|null, format: string|null, type: string|null }`
  - `search(query: string, programs: Program[]) -> { reason: 'empty'|'title'|'keywords'|'filter'|'none', programs: Program[] }`
- Потребляет: массив `programs` из `content/bot-catalog.json` (задача 2).

- [ ] **Шаг 1: написать падающий тест**

```js
// tests/unit/bot-match.test.js
'use strict';

/**
 * Подбор программ. Проверяется поведение, а не текст файла: это
 * единственная часть бота, где ошибка не видна глазом – список просто
 * окажется не тем.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { stem, parseQuery, search } = require('../../js/bot-match');

const PROGRAMS = [
  {
    id: '1', title: 'Актуальные вопросы налогового администрирования',
    sphere: 'Финансовое право', type: 'ПК', format: 'online',
    price: 22000, start: 'Старт: 5 октября', keywords: ['Налоговые споры', 'Юристы'],
  },
  {
    id: '2', title: 'Английское контрактное право',
    sphere: 'Международное право', type: 'ПК', format: 'offline',
    price: 60000, start: null, keywords: ['Договорная работа', 'Юристы'],
  },
  {
    id: '3', title: 'Банкротство юридических лиц',
    sphere: 'Корпоративное и договорное право', type: 'ПП', format: 'mixed',
    price: 45000, start: 'Старт: 1 ноября', keywords: ['Несостоятельность', 'Предприниматели'],
  },
];

test('основа слова сводит словоформы к одной', () => {
  const base = stem('налоги');
  assert.equal(stem('налоговый').startsWith(base) || base.startsWith(stem('налоговый')), true);
  assert.equal(stem('налогообложение').startsWith(base), true);
});

test('основа не склеивает разные слова', () => {
  assert.notEqual(stem('право'), stem('практика'));
});

test('слово из названия находит программу', () => {
  const out = search('банкротство', PROGRAMS);
  assert.equal(out.reason, 'title');
  assert.deepEqual(out.programs.map((p) => p.id), ['3']);
});

test('слово из ключевых слов находит программу', () => {
  const out = search('несостоятельность', PROGRAMS);
  assert.equal(out.reason, 'keywords');
  assert.deepEqual(out.programs.map((p) => p.id), ['3']);
});

test('цена и формат читаются как ограничение', () => {
  const q = parseQuery('онлайн дешевле 30 тысяч');
  assert.equal(q.priceMax, 30000);
  assert.equal(q.format, 'online');
  const out = search('онлайн дешевле 30 тысяч', PROGRAMS);
  assert.equal(out.reason, 'filter');
  assert.deepEqual(out.programs.map((p) => p.id), ['1']);
});

test('пустой запрос возвращает подсказки, а не пустоту', () => {
  const out = search('   ', PROGRAMS);
  assert.equal(out.reason, 'empty');
  assert.deepEqual(out.programs, []);
});

test('несуществующее слово даёт «не нашёл» и программы с ближайшим стартом', () => {
  const out = search('криптовалюта', PROGRAMS);
  assert.equal(out.reason, 'none');
  assert.equal(out.programs.length, 3);
  // Сперва те, у кого старт назначен: программа без старта уходит вниз.
  assert.equal(out.programs[0].id, '1');
  assert.equal(out.programs[2].id, '2');
});

test('порядок выдачи устойчив: совпадение в названии выше совпадения в словах', () => {
  const out = search('юристы налоговых', PROGRAMS);
  assert.equal(out.programs[0].id, '1');
});
```

- [ ] **Шаг 2: убедиться, что тест падает**

Запуск: `node --test tests/unit/bot-match.test.js`
Ожидание: FAIL – `Cannot find module '../../js/bot-match'`.

- [ ] **Шаг 3: написать ядро**

```js
// js/bot-match.js
/**
 * Подбор программ для бота поддержки.
 *
 * Файл читают ОБА мира: браузер берёт его тегом <script> и получает
 * window.DpoBotMatch, Node требует его в тестах. Так поведение поиска
 * проверяется настоящими тестами, а не сверкой строк, и остаётся одно
 * место, где оно описано.
 *
 * Ни одной зависимости: в проекте их нет вовсе.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DpoBotMatch = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Окончания снимаются по одному разу, от длинных к коротким. */
  var ENDINGS = [
    'ниями', 'ениям', 'ования', 'ование', 'ением', 'ения', 'ение',
    'ями', 'ами', 'ого', 'ому', 'ыми', 'ими', 'ей', 'ов', 'ев',
    'ый', 'ий', 'ая', 'яя', 'ое', 'ее', 'ые', 'ие', 'ых', 'их',
    'ой', 'ом', 'ам', 'ах', 'ям', 'ях', 'ы', 'и', 'а', 'я', 'о', 'е', 'у', 'ю', 'ь',
  ];

  var MIN_STEM = 4;

  function normalize(word) {
    return String(word || '').toLowerCase().replace(/ё/g, 'е');
  }

  function stem(word) {
    var w = normalize(word);
    for (var i = 0; i < ENDINGS.length; i++) {
      var end = ENDINGS[i];
      if (w.length - end.length >= MIN_STEM && w.slice(-end.length) === end) {
        return w.slice(0, w.length - end.length);
      }
    }
    return w;
  }

  /** Две основы считаются одним словом, если одна начинает другую. */
  function sameStem(a, b) {
    if (a.length < MIN_STEM || b.length < MIN_STEM) return a === b;
    return a.indexOf(b) === 0 || b.indexOf(a) === 0;
  }

  var FORMATS = [
    [/онлайн|дистанц|удал/, 'online'],
    [/очн(?!ый онлайн)|офлайн|аудитор/, 'offline'],
    [/смешан/, 'mixed'],
    [/гибрид/, 'hybrid'],
  ];

  function parseQuery(query) {
    var text = normalize(query);
    var out = { stems: [], priceMax: null, priceMin: null, format: null, type: null };
    if (!text.trim()) return out;

    // Цена: «до 30 000», «дешевле 30 тысяч», «от 20 тысяч».
    var price = text.match(/(до|дешевле|не дороже|от|дороже)\s+(\d[\d\s]*)\s*(тыс\w*)?/);
    if (price) {
      var value = parseInt(price[2].replace(/\s/g, ''), 10);
      if (price[3]) value *= 1000;
      if (/от|дороже/.test(price[1])) out.priceMin = value;
      else out.priceMax = value;
    }

    for (var i = 0; i < FORMATS.length; i++) {
      if (FORMATS[i][0].test(text)) { out.format = FORMATS[i][1]; break; }
    }
    if (/переподготовк|новая профессия|пп\b/.test(text)) out.type = 'ПП';
    else if (/повышение квалификац|пк\b/.test(text)) out.type = 'ПК';

    out.stems = text
      .replace(/[^а-яa-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(function (w) { return w.length >= 3 && !/^\d+$/.test(w); })
      .map(stem);

    return out;
  }

  function hits(stems, text) {
    var words = normalize(text).replace(/[^а-яa-z0-9\s]/g, ' ').split(/\s+/).map(stem);
    var n = 0;
    for (var i = 0; i < stems.length; i++) {
      for (var j = 0; j < words.length; j++) {
        if (sameStem(stems[i], words[j])) { n++; break; }
      }
    }
    return n;
  }

  function byStart(a, b) {
    if (!!a.start === !!b.start) return 0;
    return a.start ? -1 : 1;
  }

  function search(query, programs) {
    var list = Array.isArray(programs) ? programs.slice() : [];
    var q = parseQuery(query);
    if (!q.stems.length && q.priceMax === null && q.priceMin === null && !q.format) {
      return { reason: 'empty', programs: [] };
    }

    var filtered = list.filter(function (p) {
      if (q.format && p.format !== q.format) return false;
      if (q.type && p.type !== q.type) return false;
      if (q.priceMax !== null && !(typeof p.price === 'number' && p.price <= q.priceMax)) return false;
      if (q.priceMin !== null && !(typeof p.price === 'number' && p.price >= q.priceMin)) return false;
      return true;
    });

    var scored = filtered
      .map(function (p) {
        var inTitle = hits(q.stems, p.title);
        var inWords = hits(q.stems, (p.keywords || []).join(' '));
        var inSphere = hits(q.stems, p.sphere || '');
        return { p: p, score: inTitle * 3 + inWords * 2 + inSphere, inTitle: inTitle };
      })
      .filter(function (row) { return row.score > 0; })
      .sort(function (a, b) { return b.score - a.score; });

    if (scored.length) {
      return {
        reason: scored[0].inTitle > 0 ? 'title' : 'keywords',
        programs: scored.map(function (row) { return row.p; }),
      };
    }
    // Слова не совпали, но ограничения есть – это осмысленный отбор.
    if (!q.stems.length || (filtered.length && filtered.length < list.length)) {
      return { reason: 'filter', programs: filtered };
    }
    // Не нашлось ничего: показываем те, что стартуют ближе всего. Это
    // честнее, чем притворяться, будто они «по смыслу» подходят.
    return { reason: 'none', programs: list.slice().sort(byStart).slice(0, 3) };
  }

  return { stem: stem, parseQuery: parseQuery, search: search };
});
```

- [ ] **Шаг 4: прогон**

Запуск: `node --test tests/unit/bot-match.test.js`
Ожидание: PASS, 8 тестов. Если тест «порядок выдачи устойчив» падает –
править веса в `scored`, а не тест: контракт задан тестом.

- [ ] **Шаг 5: коммит**

```bash
git add js/bot-match.js tests/unit/bot-match.test.js
git commit -m "ядро поиска бота: js/bot-match.js"
```

---

### Задача 4: готовые ответы `content/bot-faq.json`

**Ворота задачи:** список вопросов и текстов **утверждает владелец** до
реализации. Собрать кандидатов (вопрос – цитата с сайта – якорь раздела),
показать владельцу, дождаться «да», и только потом писать файл. Ответов,
которых нет на сайте, не сочинять: бот на такой вопрос отвечает, что это к
учебному офису, и открывает форму заявки.

**Файлы:**
- Создать: `content/bot-faq.json`
- Тест: `tests/unit/bot-faq.test.js`

**Интерфейсы:**
- Отдаёт: `{ answers: [{ id, triggers: string[], text: string, anchor: string }] }`,
  где `text` – дословная цитата из `index.html` или `privacy.html`,
  `anchor` – адрес раздела вида `index.html#document`.

- [ ] **Шаг 1: написать падающий тест**

```js
// tests/unit/bot-faq.test.js
'use strict';

/**
 * Готовые ответы бота. Правило одно: бот цитирует сайт, а не пересказывает
 * его. Тест ловит расхождение – поменяли текст на сайте, ответ остался
 * старым.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

/** Разметка index.html лежит JSON-строкой: кавычки и переводы экранированы. */
function plainText(file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8')
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n');
  return src
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');
}

const CORPUS = plainText('index.html') + ' ' + plainText('privacy.html');
const FAQ = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'bot-faq.json'), 'utf8'));

test('ответы есть и у каждого свой устойчивый id', () => {
  assert.ok(FAQ.answers.length > 0);
  const ids = FAQ.answers.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('каждый ответ – дословная цитата с сайта', () => {
  for (const answer of FAQ.answers) {
    const needle = answer.text.replace(/\s+/g, ' ').trim();
    assert.ok(CORPUS.includes(needle), `нет на сайте слово в слово: «${needle.slice(0, 60)}…»`);
  }
});

test('у каждого ответа есть якорь на раздел сайта', () => {
  for (const answer of FAQ.answers) {
    assert.match(answer.anchor, /^(index\.html|privacy\.html|Каталог программ\.html)(#[\w-]+)?$/);
  }
});

test('слова-триггеры заданы и не пусты', () => {
  for (const answer of FAQ.answers) {
    assert.ok(Array.isArray(answer.triggers) && answer.triggers.length > 0, answer.id);
  }
});

test('em dash в текстах ответов запрещён типографикой проекта', () => {
  for (const answer of FAQ.answers) {
    assert.equal(answer.text.includes('—'), false, answer.id);
  }
});
```

- [ ] **Шаг 2: убедиться, что тест падает**

Запуск: `node --test tests/unit/bot-faq.test.js`
Ожидание: FAIL – `ENOENT: content/bot-faq.json`.

- [ ] **Шаг 3: собрать файл из утверждённого списка**

Каждая запись – цитата, найденная в разметке, а не сочинённая. Образец
формата (тексты заменить на утверждённые):

```json
{
  "answers": [
    {
      "id": "document",
      "triggers": ["документ", "удостоверение", "диплом", "свидетельство", "корочка"],
      "text": "Все документы об окончании обучения выдаёт непосредственно НИУ ВШЭ – они действительны на всей территории России и высоко ценятся работодателями.",
      "anchor": "index.html#document"
    }
  ]
}
```

- [ ] **Шаг 4: прогон**

Запуск: `node --test tests/unit/bot-faq.test.js`
Ожидание: PASS. Падение теста дословности означает, что цитата набрана
руками с опечаткой – копировать из разметки, а не перепечатывать.

- [ ] **Шаг 5: коммит**

```bash
git add content/bot-faq.json tests/unit/bot-faq.test.js
git commit -m "готовые ответы бота: цитаты с сайта под сторожем дословности"
```

---

### Задача 5: виджет `js/support-bot.js`

> **Обновлено 08.09.2026.** Пусковой элемент уже сделан и работает – это
> ворона в углу (задача 9), отдельного слота с картинкой заводить не нужно:
> окно открывается по клику по маскоту, а на время открытого окна маскот
> прячется правилом «на экране один». Тексты берутся из
> `docs/тексты-бота-черновик.md` – девять ответов там дословно с сайта,
> реплики черновые, владелец их ещё не вычитал. Файл `content/bot-faq.json`
> собирается из этого черновика (задача 4) и живёт отдельно от кода, чтобы
> правка формулировок не требовала правки виджета.


Самодостаточный виджет: разметка и стили внутри файла. Пусковой элемент –
слот под ворону: пока в нём нейтральный знак, замена картинки не требует
правок кода.

**Файлы:**
- Создать: `js/support-bot.js`
- Создать: `images/bot-launcher.svg` (временный нейтральный знак)
- Тест: смоук в задаче 7

**Интерфейсы:**
- Потребляет: `window.DpoBotMatch.search` (задача 3),
  `content/bot-catalog.json` (задача 2), `content/bot-faq.json` (задача 4).
- Отдаёт: разметку `#dpoBotLauncher` (кнопка) и `#dpoBotPanel` (окно) в
  `document.body`.

- [ ] **Шаг 1: каркас файла**

```js
// js/support-bot.js
/**
 * Бот поддержки: подбор программ и готовые ответы с сайта.
 *
 * Самодостаточный виджет по образцу js/quiz.js и js/application-form.js –
 * разметка и стили внутри файла: лендинг собирается визуальным сборщиком, и
 * разложенный по источникам виджет разъехался бы при первой пересборке.
 *
 * Данные тянутся ПРИ ПЕРВОМ ОТКРЫТИИ окна, а не при загрузке страницы:
 * первый экран за бота не платит.
 */
(function () {
  'use strict';

  var CATALOG_URL = 'content/bot-catalog.json';
  var FAQ_URL = 'content/bot-faq.json';
  var LAUNCHER_IMAGE = 'images/bot-launcher.svg';

  // Тексты утверждает владелец (задача 4). Здесь – рабочие заготовки,
  // заменяются на утверждённые до выкладки.
  var GREETING = 'Спрашивайте про программы: тему, формат, цену или ближайший старт.';
  var HINTS = ['Подобрать программу', 'Онлайн', 'Какой документ выдают', 'Ближайшие старты', 'Сколько стоит'];

  /** Страницы программ лежат уровнем ниже – тот же приём, что в форме заявки. */
  function href(file) {
    return /\/programs\//.test(location.pathname) ? '../' + file : file;
  }

  var data = null;
  var loading = false;
  var panel = null;
  var launcher = null;
  var lastFocused = null;
})();
```

- [ ] **Шаг 2: стили с обоими режимами**

Добавить внутрь замыкания строку стилей и вставить её в `<head>` одним
`<style>`. Обязательные правила:

```css
#dpoBotLauncher{position:fixed;right:16px;bottom:calc(16px + env(safe-area-inset-bottom,0px));
  z-index:920;width:64px;height:64px;border-radius:50%;border:1px solid rgb(var(--ink)/.12);
  background:rgb(var(--surface));box-shadow:0 10px 30px rgb(var(--ink)/.18);cursor:pointer;
  display:grid;place-items:center;padding:0}
#dpoBotLauncher img{width:44px;height:44px;pointer-events:none}
#dpoBotPanel{position:fixed;right:16px;bottom:calc(92px + env(safe-area-inset-bottom,0px));
  z-index:930;width:min(380px,calc(100vw - 32px));max-height:min(70vh,560px);
  display:flex;flex-direction:column;background:rgb(var(--surface));
  border:1px solid rgb(var(--ink)/.12);border-radius:18px;overflow:hidden}
/* Версия для слабовидящих: глобальное html.vi-mode * снимает фоны и делает
   окно прозрачным – на этом уже спотыкались опрос и приглашение в канал. */
html.vi-mode #dpoBotPanel{background:#fff!important;border:2px solid #000!important}
html.vi-mode #dpoBotLauncher{background:#fff!important;border:2px solid #000!important}
html.vi-mode #dpoBotLauncher img{filter:grayscale(1) contrast(1.2)!important}
@media (prefers-reduced-motion: reduce){
  #dpoBotPanel,#dpoBotLauncher{transition:none!important;animation:none!important}
}
@media (max-width: 700px){
  /* Телефон: лист снизу, жест «смахнуть вниз» – js/sheet-gesture.js. */
  #dpoBotPanel{left:0;right:0;bottom:0;width:100%;max-height:82vh;border-radius:18px 18px 0 0}
}
```

Слои: модальные окна 9000 > баннер cookies 1000 > мобильная полоса-CTA 940 >
бот 920/930 > бейдж канала 900. Значения не менять.

- [ ] **Шаг 3: разметка и загрузка данных**

```js
  function build() {
    launcher = document.createElement('button');
    launcher.type = 'button';
    launcher.id = 'dpoBotLauncher';
    launcher.setAttribute('aria-expanded', 'false');
    launcher.setAttribute('aria-controls', 'dpoBotPanel');
    // Подпись для читалок: картинка декоративна, смысл несёт имя кнопки.
    launcher.setAttribute('aria-label', 'Спросить у бота');
    var img = document.createElement('img');
    img.src = href(LAUNCHER_IMAGE);
    img.alt = '';
    launcher.appendChild(img);
    document.body.appendChild(launcher);
  }

  function load(done) {
    if (data || loading) { done(data); return; }
    loading = true;
    Promise.all([
      fetch(href(CATALOG_URL), { credentials: 'omit' }).then(function (r) { return r.ok ? r.json() : null; }),
      fetch(href(FAQ_URL), { credentials: 'omit' }).then(function (r) { return r.ok ? r.json() : null; }),
    ]).then(function (parts) {
      data = { programs: (parts[0] && parts[0].programs) || [], answers: (parts[1] && parts[1].answers) || [] };
      loading = false;
      done(data);
    }).catch(function () {
      loading = false;
      done(null);
    });
  }
```

При неудачной загрузке окно показывает одну строку: «Не получилось
загрузить программы. Напишите нам – ответим», и кнопку заявки
(`[data-application]` открывает существующую форму).

- [ ] **Шаг 4: ответ на запрос**

Порядок ровно как в спеке: сперва программы, потом готовый ответ, потом
честное «не нашёл». Реплики бота – голосом вороны, от первого лица; тексты
утверждает владелец вместе со списком готовых ответов.

```js
  /** Кнопки-подсказки: каждая – готовый запрос, отдельной ветки диалога нет. */
  function hints(log, list) {
    var row = document.createElement('div');
    row.className = 'dpo-bot-hints';
    list.forEach(function (text) {
      var button = document.createElement('button');
      button.type = 'button';
      button.textContent = text;
      button.addEventListener('click', function () { ask(log, text); });
      row.appendChild(button);
    });
    log.appendChild(row);
  }

  /** Запрос от посетителя: своя реплика, затем ответ бота. */
  function ask(log, query) {
    var mine = document.createElement('p');
    mine.className = 'dpo-bot-mine';
    mine.textContent = query;
    log.appendChild(mine);
    var out = reply(query);
    if (out.kind === 'answer') {
      say(log, out.answer.text);
      var more = document.createElement('a');
      more.href = href(out.answer.anchor);
      more.textContent = 'Подробнее на сайте';
      log.appendChild(more);
      return;
    }
    if (out.kind === 'none') say(log, 'Такого не нашла. Вот что стартует ближе всего:');
    out.programs.forEach(function (p) { log.appendChild(programCard(p)); });
  }

  /** Готовый ответ по словам-триггерам: сравнение по основам слов. */
  function faqAnswer(query, answers) {
    var stems = window.DpoBotMatch.parseQuery(query).stems;
    if (!stems.length) return null;
    for (var i = 0; i < answers.length; i++) {
      var triggers = answers[i].triggers.map(window.DpoBotMatch.stem);
      for (var j = 0; j < stems.length; j++) {
        if (triggers.indexOf(stems[j]) !== -1) return answers[i];
      }
    }
    return null;
  }

  /**
   * Ответ на запрос. Программы вперёд ответа: человек, назвавший тему,
   * ищет программу, а не определение.
   */
  function reply(query) {
    var found = window.DpoBotMatch.search(query, data.programs);
    if (found.reason !== 'empty' && found.reason !== 'none') {
      return { kind: 'programs', programs: found.programs.slice(0, 5) };
    }
    var answer = faqAnswer(query, data.answers);
    if (answer) return { kind: 'answer', answer: answer };
    return { kind: 'none', programs: found.programs };
  }

  /**
   * Первый экран окна: приветствие вороны, кнопки-подсказки и строка ввода.
   * Вызывается из open() после загрузки данных; loaded === null означает,
   * что файлы не доехали.
   */
  function render(log, loaded) {
    log.textContent = '';
    if (!loaded) {
      var fail = document.createElement('p');
      fail.textContent = 'Не получилось загрузить программы. Напишите нам – ответим.';
      log.appendChild(fail);
      var apply = document.createElement('button');
      apply.type = 'button';
      apply.setAttribute('data-application', '');
      apply.textContent = 'Подать заявку';
      log.appendChild(apply);
      return;
    }
    say(log, GREETING);
    hints(log, HINTS);
  }

  /** Реплика бота отдельным блоком: их читает aria-live контейнера. */
  function say(log, text) {
    var line = document.createElement('p');
    line.className = 'dpo-bot-say';
    line.textContent = text;
    log.appendChild(line);
    return line;
  }

  /** Карточка программы: только те поля, что пришли в данных. */
  function programCard(p) {
    var card = document.createElement('article');
    card.className = 'dpo-bot-card';
    var link = document.createElement('a');
    link.href = href(p.url);
    link.textContent = p.title;
    card.appendChild(link);
    var meta = [p.formatLabel, p.priceLabel, p.start].filter(Boolean).join(' · ');
    var line = document.createElement('p');
    line.className = 'dpo-bot-meta';
    line.textContent = meta;
    card.appendChild(line);
    return card;
  }
```

- [ ] **Шаг 5: доступность**

Окно **не открывается само** – ни по таймеру, ни при уходе курсора: обработчик
есть только у кнопки.

```js
  /** Фокус заперт внутри окна, пока оно открыто. */
  function trapFocus(event) {
    if (event.key !== 'Tab' || !panel) return;
    var items = panel.querySelectorAll(
      'a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])',
    );
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function close() {
    if (!panel) return;
    panel.remove();
    panel = null;
    launcher.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', onKeydown, true);
    // Фокус обязан вернуться туда, откуда ушёл: иначе после закрытия он
    // оказывается в начале страницы.
    (lastFocused || launcher).focus();
  }

  function onKeydown(event) {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    trapFocus(event);
  }

  function open() {
    if (panel) { close(); return; }
    lastFocused = document.activeElement;
    panel = document.createElement('div');
    panel.id = 'dpoBotPanel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    panel.setAttribute('aria-label', 'Бот поддержки');
    // Ответы объявляются читалкой по мере появления.
    var log = document.createElement('div');
    log.className = 'dpo-bot-log';
    log.setAttribute('aria-live', 'polite');
    panel.appendChild(log);
    document.body.appendChild(panel);
    launcher.setAttribute('aria-expanded', 'true');
    document.addEventListener('keydown', onKeydown, true);
    load(function (loaded) { render(log, loaded); });
  }
```

Мишени – от 44px: у кнопок-подсказок и кнопки отправки задать
`min-height: 44px`, проверить в смоуке задачи 7.

- [ ] **Шаг 6: коммит**

```bash
git add js/support-bot.js images/bot-launcher.svg
git commit -m "виджет бота поддержки: окно, слот пускового знака, загрузка данных"
```

---

### Задача 6: подключение на всех страницах

**Файлы:**
- Изменить: `.landing-template.html` (теги `<script>` рядом с `js/quiz.js`)
- Изменить: `Каталог программ.html`
- Изменить: `scripts/build-program-pages.js` (врезка скриптов на страницы программ)
- Тест: `tests/unit/bot-wired.test.js`

- [ ] **Шаг 1: написать падающий тест**

```js
// tests/unit/bot-wired.test.js
'use strict';

/**
 * Виджет подключён на всех трёх типах страниц. Пропустить одну легко:
 * лендинг, каталог и страницы программ собираются по-разному.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const PAGES = ['index.html', 'Каталог программ.html', 'programs/angliyskoe-kontraktnoe-pravo-856421092.html'];

test('bot-match и support-bot подключены на всех страницах', () => {
  for (const page of PAGES) {
    const html = read(page);
    assert.ok(html.includes('bot-match.js'), `нет bot-match.js: ${page}`);
    assert.ok(html.includes('support-bot.js'), `нет support-bot.js: ${page}`);
  }
});

test('порядок обязателен: ядро поиска раньше виджета', () => {
  for (const page of PAGES) {
    const html = read(page);
    assert.ok(html.indexOf('bot-match.js') < html.indexOf('support-bot.js'), page);
  }
});
```

- [ ] **Шаг 2: убедиться, что тест падает**

Запуск: `node --test tests/unit/bot-wired.test.js`
Ожидание: FAIL на первой же странице.

- [ ] **Шаг 3: подключить**

Лендинг – только через шаблон:

```bash
npm run template:extract
# добавить рядом с <script src="js/quiz.js" defer></script>:
#   <script src="js/bot-match.js" defer></script>
#   <script src="js/support-bot.js" defer></script>
npm run template:inject
node scripts/build-landing.js
```

Каталог – теми же двумя строками рядом с остальными скриптами.
Страницы программ – в шаблоне страницы внутри `scripts/build-program-pages.js`,
пути с `../`, затем `node scripts/build-program-pages.js`.

- [ ] **Шаг 4: прогон**

Запуск: `node --test tests/unit/bot-wired.test.js`, затем весь корпус без
smtp.
Ожидание: PASS, старые тесты целы (особенно `landing-nesting`).

- [ ] **Шаг 5: коммит**

```bash
git add .landing-template.html index.html "Каталог программ.html" programs/ scripts/build-program-pages.js tests/unit/bot-wired.test.js
git commit -m "бот подключён на лендинге, в каталоге и на страницах программ"
```

---

### Задача 7: смоук в браузере

**Файлы:**
- Изменить: `tests/smoke_test.py`

- [ ] **Шаг 1: добавить проверки**

```python
# tests/smoke_test.py, новый раздел «Бот поддержки»
def check_support_bot(page, base):
    page.goto(f"{base}/index.html", wait_until="load")
    launcher = page.locator("#dpoBotLauncher")
    check("пусковой знак бота на месте", launcher.count() == 1)
    check("окно закрыто до нажатия", page.locator("#dpoBotPanel").count() == 0)

    launcher.click()
    page.wait_for_selector("#dpoBotPanel")
    check("окно открылось", page.locator("#dpoBotPanel").is_visible())

    page.keyboard.press("Escape")
    check("Esc закрывает окно", page.locator("#dpoBotPanel").count() == 0)
    check("фокус вернулся на знак", page.evaluate("document.activeElement.id") == "dpoBotLauncher")
```

Отдельно на 390×844: пусковой знак не накрывает мобильную полосу-CTA –
сравнить прямоугольники `#dpoBotLauncher` и `.dpo-mobile-cta` через
`bounding_box()`, пересечения быть не должно.

Отдельно в vi-режиме: включить версию для слабовидящих, открыть окно,
проверить `background-color` – не `rgba(0, 0, 0, 0)`.

- [ ] **Шаг 2: прогон**

Запуск: `source .venv-tests/bin/activate && python tests/smoke_test.py`
Ожидание: все проверки пройдены, счётчик вырос.

- [ ] **Шаг 3: коммит**

```bash
git add tests/smoke_test.py
git commit -m "смоук: бот открывается, закрывается по Esc, не спорит с полосой CTA"
```

---

### Задача 8: слои вороны в репозиторий

Маскот получен 08.09.2026: `Маскот ворона для сайта.zip`, внутри пакет
`design_handoff_crow_mascot` (12 слоёв PNG, `crow-mascot.js`, README с
таблицей позиций, демо-страница, галерея анимаций).

**Файлы:**
- Создать: `images/crow/*.webp` (11 слоёв; `rest.png` НЕ берём – это
  исходник для повторной нарезки, в рантайме не нужен)
- Создать: `scripts/build-crow-assets.js` – пережатие слоёв
- Тест: `tests/unit/crow-assets.test.js`

- [ ] **Шаг 1: тест на вес и состав**

```js
// tests/unit/crow-assets.test.js
'use strict';

/**
 * Слои маскота. Ворона – самая тяжёлая картинка сайта, и она лежит на
 * пути к кнопке заявки: если вес уедет, посетитель на телефоне будет
 * ждать её вместо того, чтобы подать заявку.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const DIR = path.join(ROOT, 'images', 'crow');
const LAYERS = ['torso', 'neck', 'head', 'eyeL', 'eyeR', 'beak', 'mouth', 'arm', 'legL', 'legR', 'body'];

test('все слои на месте и ни одного лишнего', () => {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.webp')).sort();
  assert.deepEqual(files, LAYERS.map((n) => n + '.webp').sort());
});

test('исходник целиком в репозиторий не попал', () => {
  assert.equal(fs.existsSync(path.join(DIR, 'rest.webp')), false);
  assert.equal(fs.existsSync(path.join(DIR, 'rest.png')), false);
});

test('маскот целиком не тяжелее 250 КБ', () => {
  const total = fs.readdirSync(DIR)
    .filter((f) => f.endsWith('.webp'))
    .reduce((sum, f) => sum + fs.statSync(path.join(DIR, f)).size, 0);
  assert.ok(total <= 250 * 1024, `слои весят ${Math.round(total / 1024)} КБ`);
});
```

- [ ] **Шаг 2: убедиться, что тест падает** – каталога `images/crow` ещё нет.

- [ ] **Шаг 3: пережать слои**

`sips` и `cwebp` в системе есть (`/usr/local/bin/cwebp`). Рабочая ширина
маскота 260px при сцене 1400×1465, слои приведены к 1400×1465 – значит
масштаб 0,4 от исходных размеров хватает с запасом на экраны 2x. Скрипт
пережимает каждый слой в WebP с сохранением альфы и печатает вес до и
после. Пропорции и взаимные позиции менять НЕЛЬЗЯ: вся геометрия в
`crow-mascot.js` задана в процентах от сцены, любое кадрирование сдвинет
маскот. Масштабировать все слои одним коэффициентом.

- [ ] **Шаг 4: прогон** – `node --test tests/unit/crow-assets.test.js`

- [ ] **Шаг 5: коммит**

```bash
git add images/crow scripts/build-crow-assets.js tests/unit/crow-assets.test.js
git commit -m "слои маскота: ворона Шерлок в images/crow"
```

---

### Задача 9: маскот вместо кружка

**Файлы:**
- Создать: `js/crow-mascot.js` (из пакета, с нашими правками)
- Изменить: `js/support-bot.js` (пусковой элемент)
- Изменить: `js/channel-invite.js` (бейдж уходит из угла)
- Изменить: `js/smooth-ui.js` (мобильная полоса-CTA укорачивается)
- Изменить: `DESIGN.md`

- [ ] **Шаг 1: перенести маскот и подчинить его правилам проекта**

Файл берётся из пакета почти как есть (README прямо это разрешает), но
дописываются три вещи, которых в нём нет – проверено поиском по файлу:
`prefers-reduced-motion` (неподвижный кадр вместо анимации), поведение в
версии для слабовидящих и ленивая загрузка слоёв (маскот собирается при
первом появлении в кадре, а не при загрузке страницы).

- [ ] **Шаг 2: одна реплика за визит**

Штатный `idleSeconds: 14` даёт облачко «Есть вопросы?» на каждом простое.
Решение владельца – одна реплика за визит: после первой ставится отметка
в localStorage (ключ по образцу `channel-invite-closed`), и дальше ворона
молчит, пока на неё не нажмут. Окно бота само не открывается никогда.

- [ ] **Шаг 3: перестроить угол**

Ворона занимает правый нижний угол. Бейдж канала MAX уходит левее,
мобильная полоса-CTA укорачивается справа настолько, чтобы не проходить
под маскотом. Порядок слоёв прежний: модальные окна 9000 > баннер cookies
1000 > полоса-CTA 940 > окно бота 930 > ворона 920 > бейдж канала 900.

- [ ] **Шаг 4: смоук на 390×844**

Проверка обязательна и именно на телефоне: прямоугольники вороны, полосы
и бейджа не пересекаются (`bounding_box()`), кнопка «Подать заявку»
кликабельна в своём центре (`elementFromPoint`). Полоса с единственной
кнопкой заявки – главный путь к цели на телефоне.

- [ ] **Шаг 5: записать в DESIGN.md**

Маскот, его размеры, слои нижнего края, поведение в обоих режимах и
правило «одна реплика за визит».

- [ ] **Шаг 6: коммит**

```bash
git add js/ DESIGN.md
git commit -m "ворона Шерлок вместо кружка бота"
```

---

### Задача 10: ворона в пустом результате каталога

Сейчас при фильтре без совпадений в каталоге показывается одна серая
строка «По выбранному фильтру программ не найдено» – самое пустое место
сайта. Ворона с лупой (`inspect`) объясняет, что искали и не нашли, и
даёт выход.

**Файлы:**
- Изменить: `Каталог программ.html` (блок `.empty#empty`, разметка :1620,
  стили :642-652, переключение :1743)
- Изменить: `js/crow-mascot.js` (монтирование внутрь контейнера)
- Тест: `tests/unit/catalog-empty-crow.test.js`

**Интерфейсы:**
- Потребляет: `CrowMascot.mount({ anchor: HTMLElement })` – README пакета
  разрешает якорем произвольный элемент, а не только угол экрана.
- Отдаёт: разметку внутри `.empty`, кнопку «Сбросить фильтры».

- [ ] **Шаг 1: тест на состав пустого состояния**

```js
// tests/unit/catalog-empty-crow.test.js
'use strict';

/**
 * Пустой результат фильтров. Проверяется не картинка, а то, что человек
 * не остаётся в тупике: есть объяснение и есть выход.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const HTML = fs.readFileSync(path.join(ROOT, 'Каталог программ.html'), 'utf8');

test('в пустом состоянии есть маскот, объяснение и выход', () => {
  const block = HTML.slice(HTML.indexOf('class="empty"'), HTML.indexOf('</main>'));
  assert.match(block, /data-crow-slot/, 'нет места под маскота');
  assert.match(block, /не найдено/, 'нет объяснения');
  assert.match(block, /data-reset-filters/, 'нет кнопки сброса фильтров');
});

test('маскот в пустом состоянии декоративен для читалок', () => {
  const block = HTML.slice(HTML.indexOf('class="empty"'), HTML.indexOf('</main>'));
  assert.match(block, /aria-hidden="true"/, 'слот маскота не спрятан от читалок');
});
```

- [ ] **Шаг 2: убедиться, что тест падает.**

- [ ] **Шаг 3: разметка и монтирование**

В `.empty` добавляется контейнер `<div data-crow-slot aria-hidden="true">`
(маскот декоративен: смысл несёт текст рядом) и кнопка
`<button type="button" data-reset-filters>Сбросить фильтры</button>`.
Маскот монтируется ОДИН РАЗ при первом появлении пустого состояния и
играет `inspect`; при скрытии – `destroy()` либо пауза, чтобы кадры не
считались впустую. Ширина 160px: это не помощник в углу, а иллюстрация.

- [ ] **Шаг 4: сброс фильтров**

Кнопка снимает все выбранные чипы и возвращает полный список – та же
функция, что уже применяет фильтры, вызванная с пустым набором.

- [ ] **Шаг 5: оба режима**

`prefers-reduced-motion` – неподвижная поза; `html.vi-mode` – маскот
скрыт, текст и кнопка остаются (в углу это решено так же).

- [ ] **Шаг 6: проверка в браузере и коммит**

На http://127.0.0.1:5180/ выбрать заведомо пустое сочетание фильтров,
убедиться: маскот появился, лупа играет, кнопка сбрасывает фильтры,
ошибок в консоли нет. Снимок 1440×900 – владельцу.

```bash
git add "Каталог программ.html" js/crow-mascot.js tests/unit/catalog-empty-crow.test.js
git commit -m "каталог: ворона с лупой в пустом результате фильтров"
```

---

### Задача 11: ворона кивает на экране «Спасибо»

Экран после отправки заявки (`js/application-form.js`, функция строит
`.dpo-app-done`, заголовок «Спасибо!», короткая вибрация) – момент, ради
которого сделана вся форма. Ворона кивает: подтверждение получает лицо.

**Файлы:**
- Изменить: `js/application-form.js` (сборка `.dpo-app-done`)
- Тест: `tests/unit/application-done-crow.test.js`

- [ ] **Шаг 1: тест-контракт**

```js
// tests/unit/application-done-crow.test.js
'use strict';

/**
 * Экран «Спасибо!» строится в браузере, поэтому проверяется контракт:
 * маскот вызывается там же, где заголовок «Спасибо!», и только один раз.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'js', 'application-form.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ');

test('экран «Спасибо!» зовёт маскота с кивком', () => {
  const done = SRC.slice(SRC.indexOf("'Спасибо!'"), SRC.indexOf("'Спасибо!'") + 1200);
  assert.match(done, /CrowMascot/, 'маскот на экране «Спасибо!» не вызывается');
  assert.match(done, /nod/, 'играет не кивок');
});

test('кивок под гейтом reduced-motion, как и вибрация', () => {
  assert.match(SRC, /prefers-reduced-motion[\s\S]{0,400}nod|nod[\s\S]{0,400}prefers-reduced-motion/,
    'кивок не проверяет режим без движения');
});
```

- [ ] **Шаг 2: убедиться, что тест падает.**

- [ ] **Шаг 3: вставка**

Маскот 140px над текстом «Заявка принята…», играет `nod` один раз и
остаётся в покое. Отсутствие файла маскота не должно ронять экран: нет
`window.CrowMascot` – экран строится как сейчас.

- [ ] **Шаг 4: оба режима и коммит**

`prefers-reduced-motion` – неподвижная поза (по тому же правилу, что
гасит вибрацию); `html.vi-mode` – без маскота. Проверить живой отправкой
формы на локальном сервере, снимок владельцу.

```bash
git add js/application-form.js tests/unit/application-done-crow.test.js
git commit -m "экран «Спасибо»: ворона кивает"
```

---

### Задача 13: ворона выходит в каталоге и в ленте «Топ-5»

Решение владельца 08.09.2026: маскот не только сидит в углу, но и выходит в
содержимое – в каталоге программ и в ленте «Топ-5» на лендинге. Появляется
КАЖДЫЙ раз, когда блок попадает в кадр, говорит «Подсказать?» и по клику
открывает окно бота (задача 5, делается раньше этой).

**Файлы:**
- Изменить: `js/crow-mascot.js` (выход в содержимое, анимация `walkAcross`)
- Изменить: `.landing-template.html` (лента «Топ-5» – слот) и
  `Каталог программ.html`
- Тест: `tests/unit/crow-inline.test.js`

**Как это устроено:**

- слот с `data-crow-walk` ставится в блок; наблюдатель пересечения запускает
  выход, когда блок попадает в кадр;
- ворона выходит сбоку (`walkAcross` из пакета, 5,4 с) и останавливается у
  края блока, не перекрывая карточки: проверять хит-тестом, что ни одна
  карточка программы и ни одна кнопка под ней не оказались недоступны;
- реплика «Подсказать?» – облачко маскота; по клику открывается окно бота;
- «маскот на экране один» продолжает действовать: пока идёт выход в
  содержимом, угловая ворона спрятана;
- `prefers-reduced-motion` – выхода нет вовсе, ворона просто появляется на
  месте; `html.vi-mode` – маскота нет;
- на телефоне выход не проигрывается: 390px мало для прохода на 900px,
  ворона появляется сразу на месте.

**Риск, о котором предупредить владельца после сборки:** «каждый раз» на
длинной странице каталога означает повтор при каждом возврате к блоку.
Посмотреть на живой странице и, если назойливо, предложить ограничение
одним разом за визит.

## Очередь после маскота

**Сверка шкалы кеглей DESIGN.md с кодом.** Проверка дизайна раз за разом
находит литеральные размеры вне задокументированной шкалы – в
`js/application-form.js` (0.875rem, 0.75rem), в генераторе страниц программ
(пятнадцать значений), в `js/channel-invite.js`, `js/compare.js`. Ни одно
из них не введено работой по боту и маскоту: счётчики до и после совпадают,
это давнее расхождение, отмеченное ещё прогоном 03.09.2026 («DESIGN.md: 10
расхождений с кодом»). Лечится одним заходом: пройти все места, решить по
каждому – привести к ступени шкалы или внести ступень в DESIGN.md, – и
закрыть тему целиком, а не глушить по одному значению. Глушить нельзя:
находки настоящие.

## Что в этот план НЕ входит

**Журнал вопросов** (`POST /api/collect`, вкладка админки, правка privacy) –
отдельная работа со своим планом. Ей нужен развёрнутый сервер, которого
пока нет, и решение о том, что именно хранится: строка ввода – место, куда
человек может напечатать что угодно, включая телефон.
