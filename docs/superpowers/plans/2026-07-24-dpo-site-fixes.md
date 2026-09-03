# План правок сайта Центра ДПО факультета права

> **Для агентов:** ОБЯЗАТЕЛЬНЫЙ САБ-СКИЛЛ: используйте superpowers:subagent-driven-development (рекомендуется) или superpowers:executing-plans для выполнения этого плана задача за задачей. Шаги размечены чекбоксами (`- [ ]`).

**Цель:** Закрыть находки аудита от 2026-07-24 и довести репозиторий до состояния, в котором сайт можно публиковать: достоверные данные, работающая админка, доступный каталог и главная страница без 2,7-мегабайтного бандла.

**Архитектура:** Сайт остается статикой без сборки и без npm-зависимостей. Главная переписывается из экспортного бандла Claude Design в обычный HTML по образцу каталога: разметку снимаем из отрендеренного DOM автоматически, затем чистим. Node-скрипты (`update-catalog.js`, `admin-server.js`, `lib/hse-catalog.js`) остаются на голом Node без зависимостей, тесты к ним пишем на встроенном `node --test`.

**Стек:** статический HTML/CSS/JS, Node 18+ (только для админки и обновления каталога), Python 3.13 + uv + Playwright (смоук-тесты), встроенный `node:test` (юнит-тесты).

## Глобальные ограничения

- **Никаких npm-зависимостей.** В репозитории нет `package.json` и он не появляется. Юнит-тесты — только на встроенных `node:test` и `node:assert`.
- **Никаких внешних CDN.** Все ресурсы локальные (152-ФЗ). Единственное исключение — Яндекс.Метрика, и только после согласия пользователя.
- **Node 18+** обязателен (нативные `fetch`, `AbortSignal.timeout`, `node --test`). Установлен портативный **Node v24.18.0** в `C:\work\tools\node-v24.18.0-win-x64`, вызывается через шимы `node`/`npm`/`npx` в `C:\Users\Vova\.local\bin`.
- **`SITE_URL`** — плейсхолдер `https://example.com` до Задачи 18. Реальный домен на момент написания плана не выбран. Не разбрасывайте домен по файлам вручную: все места перечислены в Задаче 18.
- **Кодировка файлов — UTF-8 без BOM.** Внимание: в Windows PowerShell 5.1 `Out-File -Encoding utf8` пишет BOM — использовать его нельзя. Создавайте файлы из Git Bash (`cat > файл <<'EOF'`) либо в PowerShell через `[IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding $false))`. Проверка: `head -c 3 файл | od -A n -t x1` не должно дать `ef bb bf`.
- **Команда юнит-тестов — `node --test tests/unit/*.test.js`.** Форма с каталогом (`node --test tests/unit/`) на этой машине не работает: Node пытается выполнить каталог как модуль и падает. Проверено на Node v24.18.0 в Git Bash и PowerShell.
- **`tests/run.sh` экспортирует `PYTHONIOENCODING=utf-8`.** Без этого смоук-тест падает с `UnicodeEncodeError` на символе «≥»: Python берёт кодировку stdout из системной локали (cp1251). Не убирайте эту строку.
- **Страница `Клуб выпускников (standalone).html` вне объема этого плана** — по решению владельца остается как есть. Не переименовывать, не трогать, в sitemap не добавлять.
- **Каждая задача заканчивается коммитом.** Сообщения на русском, в стиле существующей истории репозитория.
- Проверка после каждой задачи: `tests/run.sh` должен оставаться зеленым (после Задачи 1 он работает и на Windows).

## Предусловия (выполнить до Задачи 1)

- [ ] **P1. Установить Node 18+**

```powershell
winget install OpenJS.NodeJS.LTS
```

Перезапустить терминал, проверить:

```bash
node -v    # ожидается v18.x или новее
```

Без Node не выполняются Задачи 2-8 и 11.

- [ ] **P2. Проверить, что uv на месте**

```bash
uv --version
```

- [ ] **P3. Клонировать репозиторий в постоянную папку**

```bash
git clone https://github.com/Bogolubov-creator/dpo-pravo-hse.git C:/work/dpo-pravo-hse
cd C:/work/dpo-pravo-hse
git checkout -b fix/audit-2026-07
```

Вся работа идет в ветке `fix/audit-2026-07`, не в `main`.

---

## Этап A. Тестовая база

### Задача 1: Кроссплатформенный запуск тестов

Сейчас `tests/run.sh` падает на Windows: `uv venv` создает `.venv-tests/Scripts/`, а скрипт активирует `.venv-tests/bin/activate`. Пока тесты не запускаются, TDD в остальных задачах невозможен, поэтому это первая задача.

**Файлы:**
- Изменить: `tests/run.sh:20-22`
- Создать: `tests/unit/.gitkeep`
- Изменить: `tests/README.md` (раздел «Запуск»)

**Интерфейсы:**
- Производит: рабочую команду `tests/run.sh` на Windows/Linux/macOS и каталог `tests/unit/` для юнит-тестов на `node --test`, которым пользуются Задачи 2-8.

- [ ] **Шаг 1: Убедиться, что скрипт сейчас падает**

Run: `tests/run.sh`
Expected: FAIL, `.venv-tests/bin/activate: No such file or directory`

- [ ] **Шаг 2: Починить активацию venv**

В `tests/run.sh` заменить блок активации:

```bash
if [ ! -d "$VENV" ]; then
  echo "→ создаю окружение $VENV"
  uv venv "$VENV" -q
fi
# shellcheck disable=SC1091
source "$VENV/bin/activate"
```

на:

```bash
if [ ! -d "$VENV" ]; then
  echo "→ создаю окружение $VENV"
  uv venv "$VENV" -q
fi
# uv кладёт скрипты в bin/ на Unix и в Scripts/ на Windows.
if [ -f "$VENV/bin/activate" ]; then
  # shellcheck disable=SC1091
  source "$VENV/bin/activate"
elif [ -f "$VENV/Scripts/activate" ]; then
  # shellcheck disable=SC1091
  source "$VENV/Scripts/activate"
else
  echo "Не найден activate ни в $VENV/bin, ни в $VENV/Scripts" >&2
  exit 1
fi
```

- [ ] **Шаг 3: Прогнать тесты**

Run: `tests/run.sh`
Expected: PASS, `ИТОГ: 28/28 проверок пройдено, провалов: 0`

- [ ] **Шаг 4: Завести каталог для юнит-тестов и проверить раннер**

```bash
mkdir -p tests/unit
touch tests/unit/.gitkeep
```

Проверять раннер нужно с тестом внутри: на пустом каталоге `node --test` завершается ошибкой. Первый постоянный тест появится в Задаче 2, поэтому здесь используем временный файл и удаляем его.

```bash
cat > tests/unit/probe.test.js <<'EOF'
const test = require('node:test');
const assert = require('node:assert');
test('раннер node --test работает', () => { assert.strictEqual(1 + 1, 2); });
EOF
node --test tests/unit/*.test.js
```

Expected: `# pass 1`, `# fail 0`, код возврата 0

```bash
rm tests/unit/probe.test.js
```

Временный файл не коммитится.

- [ ] **Шаг 5: Дописать раздел в `tests/README.md`**

После раздела «Запуск» добавить:

```markdown
## Юнит-тесты Node-скриптов

```bash
node --test tests/unit/*.test.js
```

Встроенный раннер Node 18+, зависимостей не требует. Покрывает чистые функции
`lib/hse-catalog.js` и `update-catalog.js` (цены, даты, микроразметка) —
то, что смоук-тест увидеть не может, потому что каталог обновляется вручную.
```

Также поправить строку «Требуется только uv»: теперь для юнит-тестов нужен еще Node 18+.

- [ ] **Шаг 6: Коммит**

```bash
git add tests/run.sh tests/README.md tests/unit/.gitkeep
git commit -m "Тесты: запуск на Windows и каркас юнит-тестов на node --test"
```

---

## Этап B. Достоверность данных каталога

### Задача 2: Отсутствующая цена не должна показываться как «Бесплатно»

`lib/hse-catalog.js:53-57` возвращает «Бесплатно» для любого ложного значения, включая `null` и `undefined`. Программа, у которой hse.ru не отдал цену, объявляется бесплатной. Для платного ДПО это худший из дефолтов.

**Файлы:**
- Изменить: `lib/hse-catalog.js:53-57`
- Создать: `tests/unit/price.test.js`

**Интерфейсы:**
- Производит: `formatPrice(item)` возвращает `'Цена по запросу'` при отсутствующей цене, `'Бесплатно'` только при явном нуле, иначе форматированную сумму. Задача 3 полагается на неизменную сигнатуру.

- [ ] **Шаг 1: Написать падающий тест**

Создать `tests/unit/price.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert');
const { formatPrice } = require('../../lib/hse-catalog');

test('цена задана — форматируется с рублём', () => {
  assert.strictEqual(formatPrice({ educationPricing: 50000 }), '50 000 ₽');
});

test('есть скидочная цена — она в приоритете', () => {
  assert.strictEqual(formatPrice({ educationPricing: 50000, discountPrice: 40000 }), '40 000 ₽');
});

test('явный ноль — Бесплатно', () => {
  assert.strictEqual(formatPrice({ educationPricing: 0 }), 'Бесплатно');
});

test('цена отсутствует — Цена по запросу, а не Бесплатно', () => {
  assert.strictEqual(formatPrice({}), 'Цена по запросу');
  assert.strictEqual(formatPrice({ educationPricing: null }), 'Цена по запросу');
  assert.strictEqual(formatPrice({ educationPricing: undefined }), 'Цена по запросу');
});
```

- [ ] **Шаг 2: Запустить и убедиться, что падает**

Run: `node --test tests/unit/price.test.js`
Expected: FAIL — тест «цена отсутствует» получает `'Бесплатно'` вместо `'Цена по запросу'`

- [ ] **Шаг 3: Починить `formatPrice`**

В `lib/hse-catalog.js` заменить:

```javascript
function formatPrice(item) {
  const price = item.discountPrice ?? item.educationPricing;
  if (!price) return 'Бесплатно';
  return `${new Intl.NumberFormat('ru-RU').format(price)} ₽`;
}
```

на:

```javascript
function formatPrice(item) {
  const price = item.discountPrice ?? item.educationPricing;
  // Различаем «цена равна нулю» и «цены нет». Раньше оба случая давали
  // «Бесплатно», из-за чего платная программа без цены в выдаче hse.ru
  // объявлялась бесплатной.
  if (price === 0) return 'Бесплатно';
  if (price === null || price === undefined || Number.isNaN(Number(price))) return 'Цена по запросу';
  return `${new Intl.NumberFormat('ru-RU').format(price)} ₽`;
}
```

- [ ] **Шаг 4: Запустить тесты**

Run: `node --test tests/unit/price.test.js`
Expected: PASS, `# pass 4`

- [ ] **Шаг 5: Коммит**

```bash
git add lib/hse-catalog.js tests/unit/price.test.js
git commit -m "Каталог: отсутствующая цена больше не выдаётся за «Бесплатно»"
```

---

### Задача 3: Дата в микроразметке не должна уезжать на день назад

В закоммиченном каталоге JSON-LD говорит `"startDate":"2026-08-02"`, а карточка той же программы — `3 августа 2026 г.`, и так во всех 20 записях. Причина: `update-catalog.js:105` использует `toISOString()` (UTC), а `lib/hse-catalog.js:65` форматирует в местной зоне. Полночь по Москве — это 21:00 предыдущих суток по UTC.

**Файлы:**
- Изменить: `lib/hse-catalog.js` (добавить экспорт `isoDate`)
- Изменить: `update-catalog.js:105`
- Создать: `tests/unit/date.test.js`

**Интерфейсы:**
- Потребляет: ничего из предыдущих задач.
- Производит: `isoDate(value)` из `lib/hse-catalog.js` — возвращает строку `'YYYY-MM-DD'` по локальным компонентам даты или `null`, если дата некорректна. Задача 4 использует ту же функцию.

- [ ] **Шаг 1: Написать падающий тест**

Создать `tests/unit/date.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert');
const { isoDate } = require('../../lib/hse-catalog');

test('дата берётся по локальным компонентам, без сдвига в UTC', () => {
  // Полночь 3 августа 2026 в местной зоне. При toISOString() в любой зоне
  // восточнее Гринвича это превратилось бы во 2 августа.
  const local = new Date(2026, 7, 3, 0, 0, 0);
  assert.strictEqual(isoDate(local), '2026-08-03');
});

test('однозначные месяц и день дополняются нулём', () => {
  assert.strictEqual(isoDate(new Date(2026, 0, 5, 12, 0, 0)), '2026-01-05');
});

test('некорректная дата даёт null, а не исключение', () => {
  assert.strictEqual(isoDate('не дата'), null);
  assert.strictEqual(isoDate(null), null);
  assert.strictEqual(isoDate(undefined), null);
});
```

- [ ] **Шаг 2: Запустить и убедиться, что падает**

Run: `node --test tests/unit/date.test.js`
Expected: FAIL — `isoDate is not a function`

- [ ] **Шаг 3: Добавить `isoDate` в `lib/hse-catalog.js`**

Перед `formatDate` вставить:

```javascript
// Дата для микроразметки Schema.org. Собирается из ЛОКАЛЬНЫХ компонент:
// toISOString() переводит в UTC и для полуночи по Москве отдаёт предыдущие
// сутки — из-за этого JSON-LD расходился с датой на карточке на один день.
function isoDate(value) {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
```

И расширить экспорт в конце файла:

```javascript
module.exports = { CATALOG_URL, fetchProgramItems, formatPrice, formatDate, isoDate };
```

- [ ] **Шаг 4: Запустить тесты**

Run: `node --test tests/unit/date.test.js`
Expected: PASS, `# pass 3`

- [ ] **Шаг 5: Использовать `isoDate` в генераторе микроразметки**

В `update-catalog.js` заменить строку импорта:

```javascript
const { fetchProgramItems, formatPrice, formatDate, CATALOG_URL } = require('./lib/hse-catalog');
```

на:

```javascript
const { fetchProgramItems, formatPrice, formatDate, isoDate, CATALOG_URL } = require('./lib/hse-catalog');
```

и в `buildJsonLd` заменить:

```javascript
    if (item.startDate) instance.startDate = new Date(item.startDate).toISOString().slice(0, 10);
```

на:

```javascript
    const start = isoDate(item.startDate);
    if (start) instance.startDate = start;
```

- [ ] **Шаг 6: Проверить смоук-тестом, что каталог цел**

Run: `tests/run.sh`
Expected: PASS, 28/28

- [ ] **Шаг 7: Коммит**

```bash
git add lib/hse-catalog.js update-catalog.js tests/unit/date.test.js
git commit -m "Микроразметка: дата старта больше не уезжает на сутки назад"
```

---

### Задача 4: Одна битая дата не должна ронять всё обновление

`formatDate` в `lib/hse-catalog.js:59-66` зовет `Intl.DateTimeFormat().format(d)` без проверки. На `Invalid Date` это бросает `RangeError`, и обновление каталога падает целиком из-за одной программы с испорченным `startDate` в ответе hse.ru.

**Файлы:**
- Изменить: `lib/hse-catalog.js:59-66`
- Изменить: `tests/unit/date.test.js` (дописать тесты)

**Интерфейсы:**
- Потребляет: `isoDate` из Задачи 3.
- Производит: `formatDate(item)` возвращает `null` вместо исключения на некорректной дате.

- [ ] **Шаг 1: Дописать падающие тесты**

В конец `tests/unit/date.test.js` добавить:

```javascript
const { formatDate } = require('../../lib/hse-catalog');

test('formatDate: корректная дата форматируется по-русски', () => {
  const item = { startDate: new Date(2026, 7, 3).getTime() };
  assert.match(formatDate(item), /3 августа 2026/);
});

test('formatDate: без дня месяца — только месяц и год', () => {
  const item = { startDate: new Date(2026, 7, 3).getTime(), isStartDateWithoutDay: true };
  assert.match(formatDate(item), /август 2026/);
});

test('formatDate: битая дата даёт null, а не RangeError', () => {
  assert.strictEqual(formatDate({ startDate: 'мусор' }), null);
  assert.strictEqual(formatDate({ startDate: NaN }), null);
});

test('formatDate: даты нет — null', () => {
  assert.strictEqual(formatDate({}), null);
});
```

- [ ] **Шаг 2: Запустить и убедиться, что падает**

Run: `node --test tests/unit/date.test.js`
Expected: FAIL — тест «битая дата» падает с `RangeError: Invalid time value`

- [ ] **Шаг 3: Защитить `formatDate`**

Заменить в `lib/hse-catalog.js`:

```javascript
function formatDate(item) {
  if (!item.startDate) return null;
  const d = new Date(item.startDate);
  const opts = item.isStartDateWithoutDay
    ? { month: 'long', year: 'numeric' }
    : { day: 'numeric', month: 'long', year: 'numeric' };
  return new Intl.DateTimeFormat('ru-RU', opts).format(d);
}
```

на:

```javascript
function formatDate(item) {
  if (!item.startDate) return null;
  const d = new Date(item.startDate);
  // Одна испорченная дата в выдаче hse.ru не должна ронять обновление всего
  // каталога: Intl бросает RangeError на Invalid Date.
  if (Number.isNaN(d.getTime())) return null;
  const opts = item.isStartDateWithoutDay
    ? { month: 'long', year: 'numeric' }
    : { day: 'numeric', month: 'long', year: 'numeric' };
  return new Intl.DateTimeFormat('ru-RU', opts).format(d);
}
```

- [ ] **Шаг 4: Запустить тесты**

Run: `node --test tests/unit/*.test.js`
Expected: PASS, все тесты зелёные

- [ ] **Шаг 5: Коммит**

```bash
git add lib/hse-catalog.js tests/unit/date.test.js
git commit -m "Каталог: битая дата от hse.ru больше не роняет обновление"
```

---

### Задача 5: Таймаут запроса к hse.ru

`lib/hse-catalog.js:22` вызывает нативный `fetch` без таймаута. Если hse.ru примет соединение и замолчит, кнопка «Обновить» в админке будет крутиться бесконечно.

**Файлы:**
- Изменить: `lib/hse-catalog.js:21-39`
- Создать: `tests/unit/fetch-timeout.test.js`

**Интерфейсы:**
- Производит: `fetchProgramItems(url)` прерывается через 25 секунд и бросает `Error` с текстом `hse.ru не ответил за 25 с`.

- [ ] **Шаг 1: Написать падающий тест**

Создать `tests/unit/fetch-timeout.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { fetchProgramItems } = require('../../lib/hse-catalog');

test('зависший сервер не держит запрос вечно', async () => {
  // Сервер принимает соединение и молчит — ровно тот случай, который сейчас
  // подвешивает админку навсегда.
  const server = http.createServer(() => { /* никогда не отвечаем */ });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  try {
    await assert.rejects(
      () => fetchProgramItems(url),
      (err) => /не ответил|timeout|aborted/i.test(err.message),
    );
  } finally {
    server.close();
  }
});
```

Тест намеренно ждёт до 25 секунд. Запускать с запасом по таймауту раннера.

- [ ] **Шаг 2: Запустить и убедиться, что падает**

Run: `node --test --test-timeout=60000 tests/unit/fetch-timeout.test.js`
Expected: FAIL по таймауту теста — запрос висит, отказа нет

- [ ] **Шаг 3: Добавить таймаут**

В `lib/hse-catalog.js` заменить начало `fetchProgramItems`:

```javascript
async function fetchProgramItems(url = CATALOG_URL) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    },
  });
  if (!res.ok) throw new Error(`hse.ru responded with HTTP ${res.status}`);
```

на:

```javascript
const FETCH_TIMEOUT_MS = 25_000;

async function fetchProgramItems(url = CATALOG_URL) {
  let res;
  try {
    res = await fetch(url, {
      // Без таймаута зависшее соединение вешает кнопку «Обновить» в админке
      // навсегда: у нативного fetch дефолтного таймаута нет.
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      },
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new Error(`hse.ru не ответил за ${FETCH_TIMEOUT_MS / 1000} с — обновление отменено`);
    }
    throw new Error(`Не удалось связаться с hse.ru: ${err.message}`);
  }
  if (!res.ok) throw new Error(`hse.ru responded with HTTP ${res.status}`);
```

- [ ] **Шаг 4: Запустить тест**

Run: `node --test --test-timeout=60000 tests/unit/fetch-timeout.test.js`
Expected: PASS

- [ ] **Шаг 5: Проверить, что живой запрос по-прежнему работает**

Run: `node update-catalog.js`
Expected: `Done: wrote 20 programs into "Каталог программ.html"` (число может отличаться)

- [ ] **Шаг 6: Откатить изменения каталога, если данные не менялись**

```bash
git checkout -- "Каталог программ.html"
```

- [ ] **Шаг 7: Коммит**

```bash
git add lib/hse-catalog.js tests/unit/fetch-timeout.test.js
git commit -m "Каталог: таймаут 25 с на запрос к hse.ru"
```

---

### Задача 6: Атомарная запись каталога

`update-catalog.js:158` пишет `writeFileSync` поверх исходного файла. Падение посреди записи оставит обрезанный каталог — а он же служит шаблоном для следующего обновления: пропадут маркеры `<!-- CATALOG:* -->` и апдейтер больше не запустится.

**Файлы:**
- Изменить: `update-catalog.js:152-158`
- Создать: `tests/unit/atomic-write.test.js`

**Интерфейсы:**
- Производит: `writeFileAtomic(filePath, content)` в `update-catalog.js`, экспортируется для тестов.

- [ ] **Шаг 1: Написать падающий тест**

Создать `tests/unit/atomic-write.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { writeFileAtomic } = require('../../update-catalog');

test('запись перезаписывает существующий файл', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dpo-'));
  const file = path.join(dir, 'catalog.html');
  fs.writeFileSync(file, 'старое', 'utf8');
  writeFileAtomic(file, 'новое');
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'новое');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('после записи временных файлов не остаётся', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dpo-'));
  const file = path.join(dir, 'catalog.html');
  writeFileAtomic(file, 'содержимое');
  assert.deepStrictEqual(fs.readdirSync(dir), ['catalog.html']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('исходный файл цел, если запись во временный не удалась', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dpo-'));
  const file = path.join(dir, 'catalog.html');
  fs.writeFileSync(file, 'важные данные', 'utf8');
  // Каталога больше нет — writeFileSync во временный файл упадёт.
  fs.rmSync(path.join(dir), { recursive: true, force: true });
  fs.mkdirSync(dir);
  fs.writeFileSync(file, 'важные данные', 'utf8');
  assert.throws(() => writeFileAtomic(path.join(dir, 'нет', 'catalog.html'), 'x'));
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'важные данные');
  fs.rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Шаг 2: Запустить и убедиться, что падает**

Run: `node --test tests/unit/atomic-write.test.js`
Expected: FAIL — `writeFileAtomic is not a function`

- [ ] **Шаг 3: Реализовать атомарную запись**

В `update-catalog.js` после `replaceBetween` добавить:

```javascript
// Пишем во временный файл рядом и переименовываем: rename в пределах одной
// файловой системы атомарен, поэтому обрыв посреди записи не оставит
// обрезанный каталог. А каталог — ещё и шаблон для следующего обновления:
// потеряв маркеры CATALOG:*, апдейтер больше не запустится.
function writeFileAtomic(filePath, content) {
  const tmp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content, 'utf8');
  try {
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* временный файл уже убран */ }
    throw err;
  }
}
```

Заменить в `main`:

```javascript
  fs.writeFileSync(CATALOG_FILE, html, 'utf8');
```

на:

```javascript
  writeFileAtomic(CATALOG_FILE, html);
```

И расширить экспорт в конце файла:

```javascript
module.exports = { main, writeFileAtomic };
```

- [ ] **Шаг 4: Запустить тесты**

Run: `node --test tests/unit/*.test.js`
Expected: PASS, все зелёные

- [ ] **Шаг 5: Коммит**

```bash
git add update-catalog.js tests/unit/atomic-write.test.js
git commit -m "Каталог: атомарная запись файла через временный + rename"
```

---

### Задача 6б: Надёжный разбор данных hse.ru

`lib/hse-catalog.js:16` навешивает кавычки на ключи регуляркой `/([{,])\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g`. Регулярка не отличает ключ объекта от текста внутри строкового литерала, поэтому название программы вида `Legal Tech, compliance: практика` она превратит в `,"compliance":` посреди строки и сломает `JSON.parse`. Кириллица под шаблон `[A-Za-z_$]` не подпадает, так что сломается именно на англоязычных названиях — а их в каталоге уже пять.

Решение: не трогать содержимое строковых литералов. Идём по тексту посимвольно, отслеживая, находимся ли мы внутри строки, и подставляем кавычки только снаружи.

**Файлы:**
- Изменить: `lib/hse-catalog.js:9-19`
- Создать: `tests/unit/parse-state.test.js`

**Интерфейсы:**
- Производит: `parseInitialState(html)` из `lib/hse-catalog.js` — экспортируется для тестов, разбирает объектный литерал со страницы hse.ru, не искажая строковые значения.

- [ ] **Шаг 1: Написать падающий тест**

Создать `tests/unit/parse-state.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert');
const { parseInitialState } = require('../../lib/hse-catalog');

const wrap = (obj) => `<script>window.__INITIAL_STATE__ = ${obj};window.__URQL_DATA__ = {}</script>`;

test('обычный литерал разбирается', () => {
  const s = parseInitialState(wrap('{items:[{title:"Морской арбитраж",educationPricing:60000}]}'));
  assert.strictEqual(s.items[0].title, 'Морской арбитраж');
  assert.strictEqual(s.items[0].educationPricing, 60000);
});

test('new Date(...) превращается в число', () => {
  const s = parseInitialState(wrap('{items:[{startDate:new Date(1690000000000)}]}'));
  assert.strictEqual(s.items[0].startDate, 1690000000000);
});

test('__proto__: null отбрасывается в любой позиции', () => {
  // Прежняя версия оставляла висячую запятую, когда ключ шёл первым.
  assert.strictEqual(parseInitialState(wrap('{items:[{__proto__:null,title:"Х"}]}')).items[0].title, 'Х');
  assert.strictEqual(parseInitialState(wrap('{items:[{title:"Х",__proto__:null}]}')).items[0].title, 'Х');
  const mid = parseInitialState(wrap('{items:[{a:1,__proto__:null,title:"Х"}]}')).items[0];
  assert.strictEqual(mid.title, 'Х');
  assert.strictEqual(mid.a, 1);
});

test('null и true как значения не принимаются за ключи', () => {
  const s = parseInitialState(wrap('{items:[{title:"Х",duration:null,flag:true}]}'));
  assert.strictEqual(s.items[0].duration, null);
  assert.strictEqual(s.items[0].flag, true);
});

test('латиница с запятой и двоеточием внутри названия не ломает разбор', () => {
  // Именно этот случай ломал прежнюю регулярку: ", compliance:" внутри строки
  // она принимала за ключ объекта и вставляла кавычки посреди значения.
  const s = parseInitialState(wrap('{items:[{title:"Legal Tech, compliance: практика",educationPricing:1}]}'));
  assert.strictEqual(s.items[0].title, 'Legal Tech, compliance: практика');
});

test('экранированная кавычка внутри строки не сбивает разбор', () => {
  const s = parseInitialState(wrap('{items:[{title:"Курс \\"Право\\" и bar: baz",educationPricing:2}]}'));
  assert.ok(s.items[0].title.includes('bar: baz'));
});

test('отсутствие маркера — понятная ошибка', () => {
  assert.throws(() => parseInitialState('<html>ничего нет</html>'), /__INITIAL_STATE__/);
});
```

- [ ] **Шаг 2: Запустить и убедиться, что падает**

Run: `node --test tests/unit/parse-state.test.js`
Expected: FAIL — `parseInitialState is not a function`, а после добавления экспорта падает тест про `Legal Tech, compliance:`

- [ ] **Шаг 3: Переписать разбор с учётом строковых литералов**

В `lib/hse-catalog.js` заменить `parseInitialState` на:

```javascript
// Каталог hse.ru отдаёт данные не как JSON, а как JS-литерал:
//   window.__INITIAL_STATE__ = {items:[...new Date(169...), __proto__:null...]}
// Приводим его к валидному JSON, ничего не исполняя. Ключевое требование:
// не трогать содержимое строк — прежняя версия навешивала кавычки одной
// регуляркой и ломалась на названиях вида «Legal Tech, compliance: практика».
function quoteKeysOutsideStrings(src) {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; out += ch; continue; }
    // Снаружи строк: идентификатор, за которым следует двоеточие, — это ключ.
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_$]/.test(src[j])) j++;
      let k = j;
      while (k < src.length && /\s/.test(src[k])) k++;
      if (src[k] === ':') {
        out += `"${src.slice(i, j)}"`;
        i = j - 1;
        continue;
      }
      out += src.slice(i, j);
      i = j - 1;
      continue;
    }
    out += ch;
  }
  return out;
}

function parseInitialState(html) {
  const m = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});\s*window\.__URQL_DATA__/);
  if (!m) throw new Error('window.__INITIAL_STATE__ not found in page — hse.ru markup may have changed');

  let s = m[1];
  s = s.replace(/new Date\((\d+)\)/g, '$1');
  // Порядок двух замен важен: сначала пара с ведущей запятой, потом ключ,
  // стоящий первым в объекте, — вместе с хвостовой запятой. Прежняя версия
  // делала это одной заменой `,?\s*__proto__...` и на `{__proto__:null,title:…}`
  // оставляла висячую запятую `{,title:…}`, то есть невалидный JSON.
  s = s.replace(/,\s*__proto__\s*:\s*null/g, '');
  s = s.replace(/__proto__\s*:\s*null\s*,?/g, '');
  s = quoteKeysOutsideStrings(s);

  return JSON.parse(s);
}
```

Алгоритм проверен на всех шести случаях теста, включая три положения `__proto__` в объекте (первым, последним, в середине).

Расширить экспорт:

```javascript
module.exports = { CATALOG_URL, fetchProgramItems, formatPrice, formatDate, isoDate, parseInitialState };
```

- [ ] **Шаг 4: Запустить тесты**

Run: `node --test tests/unit/parse-state.test.js`
Expected: PASS, `# pass 7`

- [ ] **Шаг 5: Проверить на живых данных**

```bash
node update-catalog.js
```

Expected: `Done: wrote N programs into "Каталог программ.html"`, где N совпадает с числом до правки

```bash
git diff --stat "Каталог программ.html"
```

Expected: изменений нет либо только дата обновления

```bash
git checkout -- "Каталог программ.html"
```

- [ ] **Шаг 6: Коммит**

```bash
git add lib/hse-catalog.js tests/unit/parse-state.test.js
git commit -m "Каталог: разбор данных hse.ru не ломается на названиях с запятой и двоеточием"
```

---

## Этап C. Админка

### Задача 7: Защита от CSRF и починка CSP

`admin-server.js:268` — `POST /api/update` защищен только Basic-auth. Браузер подставляет закешированные учетные данные сам, поэтому сторонняя страница может заставить админку перезаписать каталог. Ответ заблокирует CORS, но запись на диск уже произойдет. Заодно чиним CSP: серверный заголовок (`admin-server.js:274-276`) содержит `default-src 'none'` без `img-src`, из-за чего favicon админки блокируется собственной политикой.

**Файлы:**
- Изменить: `admin-server.js` (добавить `isSameOriginRequest`, применить в обработчике, дополнить CSP)
- Создать: `tests/unit/admin-csrf.test.js`

**Интерфейсы:**
- Производит: `isSameOriginRequest(req, port)` в `admin-server.js`, экспортируется для тестов. Возвращает `true`, если запрос не является межсайтовым.

- [ ] **Шаг 1: Написать падающий тест**

Создать `tests/unit/admin-csrf.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert');
const { isSameOriginRequest } = require('../../admin-server');

const PORT = 5178;
const req = (headers) => ({ headers });

test('запрос со своей же страницы пропускается', () => {
  assert.strictEqual(isSameOriginRequest(req({ 'sec-fetch-site': 'same-origin' }), PORT), true);
});

test('межсайтовый запрос отклоняется', () => {
  assert.strictEqual(isSameOriginRequest(req({ 'sec-fetch-site': 'cross-site' }), PORT), false);
  assert.strictEqual(isSameOriginRequest(req({ 'sec-fetch-site': 'same-site' }), PORT), false);
});

test('чужой Origin отклоняется даже без Sec-Fetch-Site', () => {
  assert.strictEqual(isSameOriginRequest(req({ origin: 'https://evil.example' }), PORT), false);
});

test('свой Origin пропускается', () => {
  assert.strictEqual(isSameOriginRequest(req({ origin: `http://127.0.0.1:${PORT}` }), PORT), true);
});

test('curl без заголовков пропускается — это не браузер', () => {
  assert.strictEqual(isSameOriginRequest(req({}), PORT), true);
});
```

- [ ] **Шаг 2: Запустить и убедиться, что падает**

Run: `node --test tests/unit/admin-csrf.test.js`
Expected: FAIL — `isSameOriginRequest is not a function`

- [ ] **Шаг 3: Реализовать проверку**

В `admin-server.js` после `checkAuth` добавить:

```javascript
// Basic-auth от CSRF не защищает: браузер сам подставляет закешированные
// учётные данные, поэтому чужая вкладка может заставить админку
// перезаписать каталог. Ответ заблокирует CORS — но запись уже произойдёт.
// Отсекаем межсайтовые запросы по Sec-Fetch-Site (его шлют все актуальные
// браузеры) и по Origin. Отсутствие обоих заголовков означает не-браузерного
// клиента вроде curl — его пропускаем.
function isSameOriginRequest(req, port) {
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = req.headers['origin'];
  if (origin) {
    const allowed = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
    if (!allowed.includes(origin)) return false;
  }
  return true;
}
```

- [ ] **Шаг 4: Применить проверку к изменяющему запросу**

В обработчике заменить:

```javascript
    if (req.method === 'POST' && url === '/api/update') {
      handleUpdate(res);
      return;
    }
```

на:

```javascript
    if (req.method === 'POST' && url === '/api/update') {
      if (!isSameOriginRequest(req, PORT)) {
        console.warn(`[csrf] ${new Date().toISOString()} ${ip}: межсайтовый POST /api/update отклонён`);
        res.writeHead(403, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Межсайтовый запрос отклонён');
        return;
      }
      handleUpdate(res);
      return;
    }
```

- [ ] **Шаг 5: Дополнить CSP админки**

Заменить:

```javascript
        'Content-Security-Policy':
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
          "font-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'",
```

на:

```javascript
        'Content-Security-Policy':
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
          "font-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'self'; " +
          "form-action 'none'; frame-ancestors 'none'",
```

Без `img-src` favicon.svg блокировался директивой `default-src 'none'`.

- [ ] **Шаг 6: Сделать файл безопасным для `require` и добавить экспорт**

Сейчас `server.listen(...)` вызывается на верхнем уровне модуля. Это значит, что `require('../../admin-server')` из теста поднимет настоящий сервер на порту 5178 и оставит открытый хендл — процесс тестов не завершится. Поэтому запуск нужно закрыть проверкой «файл запущен напрямую».

Заменить в конце `admin-server.js`:

```javascript
server.listen(PORT, HOST, () => {
  console.log(`Admin panel: http://${HOST}:${PORT}/admin.html`);
  console.log(`Логин: ${credentials.username}  Пароль: ${credentials.password}`);
  console.log(`(хранится в .admin-credentials.json — поменяйте пароль, отредактировав этот файл)`);
});
```

на:

```javascript
// Слушаем порт только при прямом запуске: при require из тестов сервер
// поднимать нельзя — открытый хендл не даст процессу тестов завершиться.
if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`Admin panel: http://${HOST}:${PORT}/admin.html`);
    console.log(`Логин: ${credentials.username}  Пароль: ${credentials.password}`);
    console.log(`(хранится в .admin-credentials.json — поменяйте пароль, отредактировав этот файл)`);
  });
}

module.exports = { isSameOriginRequest };
```

Побочный эффект, который остаётся допустимым: `loadOrCreateCredentials()` по-прежнему выполняется при импорте и создаст `.admin-credentials.json`, если его нет. Файл в `.gitignore`, на тесты не влияет.

Проверить, что прямой запуск не сломан:

```bash
node admin-server.js
```

Expected: в терминале печатается адрес админки, логин и пароль (остановить по Ctrl+C)

- [ ] **Шаг 7: Запустить тесты**

Run: `node --test tests/unit/admin-csrf.test.js`
Expected: PASS, `# pass 5`

- [ ] **Шаг 8: Проверить вручную**

```bash
node admin-server.js
```

В другом терминале (подставьте пароль из вывода):

```bash
curl -s -o /dev/null -w "%{http_code}\n" -u admin:ПАРОЛЬ -X POST -H "Sec-Fetch-Site: cross-site" http://127.0.0.1:5178/api/update
```

Expected: `403`

```bash
curl -s -o /dev/null -w "%{http_code}\n" -u admin:ПАРОЛЬ -X POST -H "Sec-Fetch-Site: same-origin" http://127.0.0.1:5178/api/update
```

Expected: `200`

Открыть `http://127.0.0.1:5178/admin.html`, нажать «Обновить» — должно работать, favicon в вкладке должен появиться, в консоли браузера не должно быть нарушений CSP.

- [ ] **Шаг 9: Коммит**

```bash
git add admin-server.js tests/unit/admin-csrf.test.js
git commit -m "Админка: защита от CSRF и img-src в CSP"
```

---

### Задача 8: Параллельные обновления не должны портить каталог

`admin-server.js:147-159`: `captureConsole` подменяет глобальные `console.log`/`console.error`. Два одновременных обновления сохранят подмененную функцию как «оригинал» и оставят консоль перехваченной навсегда, а логи перемешаются. Хуже другое: `update-catalog.js` делает read-modify-write одного файла без блокировки, и параллельные запуски перезапишут результат друг друга.

**Файлы:**
- Изменить: `admin-server.js:161-173` (добавить флаг занятости)
- Создать: `tests/unit/admin-lock.test.js`

**Интерфейсы:**
- Потребляет: `isSameOriginRequest` из Задачи 7 (не вызывается напрямую, просто соседний код).
- Производит: `beginUpdate()` / `endUpdate()` / `isUpdating()` в `admin-server.js`, экспортируются для тестов. `beginUpdate()` возвращает `false`, если обновление уже идет.

- [ ] **Шаг 1: Написать падающий тест**

Создать `tests/unit/admin-lock.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert');
const { beginUpdate, endUpdate, isUpdating } = require('../../admin-server');

test('второй захват блокировки не проходит, пока первый не отпущен', () => {
  assert.strictEqual(isUpdating(), false);
  assert.strictEqual(beginUpdate(), true);
  assert.strictEqual(isUpdating(), true);
  assert.strictEqual(beginUpdate(), false);
  endUpdate();
  assert.strictEqual(isUpdating(), false);
  assert.strictEqual(beginUpdate(), true);
  endUpdate();
});
```

- [ ] **Шаг 2: Запустить и убедиться, что падает**

Run: `node --test tests/unit/admin-lock.test.js`
Expected: FAIL — `beginUpdate is not a function`

- [ ] **Шаг 3: Реализовать блокировку**

В `admin-server.js` перед `handleUpdate` добавить:

```javascript
// Обновление каталога — read-modify-write одного файла плюс подмена
// глобального console в captureConsole. Два параллельных запуска перезапишут
// результат друг друга и оставят console перехваченным навсегда, поэтому
// второй запрос получает 409, а не встаёт в очередь.
let updateInProgress = false;
function beginUpdate() {
  if (updateInProgress) return false;
  updateInProgress = true;
  return true;
}
function endUpdate() { updateInProgress = false; }
function isUpdating() { return updateInProgress; }
```

Заменить `handleUpdate` на:

```javascript
async function handleUpdate(res) {
  if (!beginUpdate()) {
    respondJson(res, 409, { ...readStatus(), error: 'Обновление уже выполняется' });
    return;
  }
  try {
    const { main } = require('./update-catalog');
    const { result, log } = await captureConsole(() => main());
    const status = { updated: result.updated, count: result.count, error: null, log };
    writeStatus(status);
    respondJson(res, 200, status);
  } catch (err) {
    const status = { ...readStatus(), error: err.message, log: err.log || err.message };
    writeStatus(status);
    respondJson(res, 500, status);
  } finally {
    endUpdate();
  }
}
```

- [ ] **Шаг 4: Дополнить экспорт**

```javascript
module.exports = { isSameOriginRequest, beginUpdate, endUpdate, isUpdating };
```

- [ ] **Шаг 5: Запустить тесты**

Run: `node --test tests/unit/*.test.js`
Expected: PASS, все зелёные

- [ ] **Шаг 6: Показать состояние в интерфейсе админки**

В `admin.html` в обработчике клика заменить:

```javascript
      const res = await fetch(`${API_BASE}/api/update`, { method: 'POST' });
      const data = await res.json();
      logEl.textContent = data.log || '';
```

на:

```javascript
      const res = await fetch(`${API_BASE}/api/update`, { method: 'POST' });
      const data = await res.json();
      if (res.status === 409) {
        logEl.textContent = 'Обновление уже выполняется в другой вкладке — дождитесь окончания.';
        logEl.classList.add('visible');
        return;
      }
      logEl.textContent = data.log || '';
```

- [ ] **Шаг 7: Проверить вручную**

Запустить `node admin-server.js`, открыть админку в двух вкладках, нажать «Обновить» в обеих подряд. Вторая должна показать сообщение про параллельное обновление, а не сломать каталог.

- [ ] **Шаг 8: Коммит**

```bash
git add admin-server.js admin.html tests/unit/admin-lock.test.js
git commit -m "Админка: одно обновление за раз, повторный запрос получает 409"
```

---

## Этап D. Доступность каталога

### Задача 9: Контраст текста до нормы WCAG AA

Токен `--ink-mute: #6B7A99` в `Каталог программ.html:47` дает 4,31:1 на белой карточке и 4,08:1 на фоне страницы при норме 4,5:1. Им покрашены мета-строки карточек (формат, длительность, дата), футер и подпись логотипа. Формально «версия для слабовидящих» не отменяет требований к основной версии.

Замена: `#5C6A86` — 5,44:1 на белом и 5,15:1 на `#F7F9FA`, тот же оттенок, запас по норме.

**Файлы:**
- Изменить: `Каталог программ.html:47`
- Изменить: `tests/smoke_test.py` (добавить проверку в `test_catalog`)

**Интерфейсы:**
- Производит: функцию `contrast_ratio(page, selector)` в `tests/smoke_test.py` — переиспользуемую проверку контраста для любой страницы.

- [ ] **Шаг 1: Написать падающую проверку**

В `tests/smoke_test.py` перед `def test_index(context):` добавить функцию:

```python
def contrast_ratio(page, selector):
    """Контраст текста элемента к его фактическому фону по формуле WCAG."""
    return page.evaluate("""(sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const parse = (c) => c.match(/\\d+(\\.\\d+)?/g).slice(0, 3).map(Number);
        const lum = (rgb) => {
            const [r, g, b] = rgb.map(v => {
                v /= 255;
                return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
            });
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        // Ищем ближайшего предка с непрозрачным фоном.
        let bgEl = el, bg = null;
        while (bgEl) {
            const c = getComputedStyle(bgEl).backgroundColor;
            if (c && !c.startsWith('rgba(0, 0, 0, 0)')) { bg = parse(c); break; }
            bgEl = bgEl.parentElement;
        }
        if (!bg) bg = [255, 255, 255];
        const fg = parse(getComputedStyle(el).color);
        const l1 = lum(fg), l2 = lum(bg);
        const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
        return (hi + 0.05) / (lo + 0.05);
    }""", selector)
```

В `test_catalog` перед `check(lbl, "нет ошибок в консоли", ...)` добавить:

```python
    meta_contrast = contrast_ratio(page, "#grid .card .meta")
    check(lbl, "контраст мета-строки карточки ≥ 4.5 (WCAG AA)",
          meta_contrast is not None and meta_contrast >= 4.5,
          f"got {meta_contrast:.2f}:1" if meta_contrast else "элемент не найден")

    footer_contrast = contrast_ratio(page, "footer > span")
    check(lbl, "контраст футера ≥ 4.5 (WCAG AA)",
          footer_contrast is not None and footer_contrast >= 4.5,
          f"got {footer_contrast:.2f}:1" if footer_contrast else "элемент не найден")
```

- [ ] **Шаг 2: Запустить и убедиться, что падает**

Run: `tests/run.sh`
Expected: FAIL — `контраст мета-строки карточки ≥ 4.5 (WCAG AA) → got 4.31:1`

- [ ] **Шаг 3: Заменить цвет**

В `Каталог программ.html:47` заменить:

```css
    --ink-mute: #6B7A99;
```

на:

```css
    --ink-mute: #5C6A86;  /* 5.44:1 на белом, 5.15:1 на --bg — WCAG AA */
```

- [ ] **Шаг 4: Запустить тесты**

Run: `tests/run.sh`
Expected: PASS, 30/30

- [ ] **Шаг 5: Коммит**

```bash
git add "Каталог программ.html" tests/smoke_test.py
git commit -m "Каталог: контраст вспомогательного текста доведён до WCAG AA"
```

---

### Задача 10: Фильтры каталога для скринридеров

Чипы фильтров — это `<button>` без `aria-pressed`, группы без `role="group"`, а сообщение «программ не найдено» появляется без `aria-live`. Пользователь скринридера не узнает ни какой фильтр активен, ни что выдача опустела. Чипы генерируются в `update-catalog.js`, поэтому правка нужна и в генераторе, и в самом HTML.

**Файлы:**
- Изменить: `update-catalog.js:63-65` (функция `renderChip`)
- Изменить: `Каталог программ.html:184-199` (разметка групп фильтров), `:386` (`#empty`), `:416-425` (обработчик)
- Изменить: `tests/smoke_test.py` (`test_catalog`)

**Интерфейсы:**
- Производит: `renderChip(label, value, count, active)` добавляет `aria-pressed`; обработчик клика синхронизирует `aria-pressed` при переключении.

- [ ] **Шаг 1: Написать падающие проверки**

В `test_catalog` после проверки фильтра добавить:

```python
    aria = page.eval_on_selector_all(
        ".filters .chip", "els => els.map(e => e.getAttribute('aria-pressed'))")
    check(lbl, "у чипов есть aria-pressed",
          all(v in ("true", "false") for v in aria) and aria.count("true") >= 1, str(aria))

    groups = page.eval_on_selector_all(
        ".filters[data-group]", "els => els.map(e => [e.getAttribute('role'), e.getAttribute('aria-label')])")
    check(lbl, "группы фильтров помечены role=group с подписью",
          all(r == "group" and lab for r, lab in groups), str(groups))

    check(lbl, "пустая выдача объявляется скринридеру",
          page.eval_on_selector("#empty", "el => el.getAttribute('aria-live')") == "polite")

    # aria-pressed переключается вместе с активным чипом
    page.click('#filtersFormat .chip:nth-child(2)')
    pressed = page.eval_on_selector(
        '#filtersFormat .chip:nth-child(2)', "el => el.getAttribute('aria-pressed')")
    first = page.eval_on_selector(
        '#filtersFormat .chip:first-child', "el => el.getAttribute('aria-pressed')")
    check(lbl, "aria-pressed переключается при выборе фильтра",
          pressed == "true" and first == "false", f"выбранный={pressed}, «все»={first}")
    page.click('#filtersFormat .chip:first-child')
```

- [ ] **Шаг 2: Запустить и убедиться, что падает**

Run: `tests/run.sh`
Expected: FAIL — `у чипов есть aria-pressed → [None, None, ...]`

- [ ] **Шаг 3: Добавить `aria-pressed` в генератор**

В `update-catalog.js` заменить:

```javascript
function renderChip(label, value, count, active) {
  return `  <button class="chip${active ? ' active' : ''}" data-value="${escapeHtml(value)}">${escapeHtml(label)} (${count})</button>`;
}
```

на:

```javascript
function renderChip(label, value, count, active) {
  return `  <button class="chip${active ? ' active' : ''}" type="button" aria-pressed="${active ? 'true' : 'false'}" data-value="${escapeHtml(value)}">${escapeHtml(label)} (${count})</button>`;
}
```

- [ ] **Шаг 4: Обновить разметку в каталоге**

В `Каталог программ.html` заменить открывающие теги групп:

```html
<div class="filters" id="filters" data-group="type">
```

на:

```html
<div class="filters" id="filters" data-group="type" role="group" aria-label="Фильтр по типу программы">
```

и:

```html
<div class="filters" id="filtersFormat" data-group="format">
```

на:

```html
<div class="filters" id="filtersFormat" data-group="format" role="group" aria-label="Фильтр по формату обучения">
```

Заменить пустое состояние:

```html
  <div class="empty" id="empty">По выбранному фильтру программ не найдено.</div>
```

на:

```html
  <div class="empty" id="empty" role="status" aria-live="polite">По выбранному фильтру программ не найдено.</div>
```

В блоках между маркерами `<!-- CATALOG:FILTERS_TYPE -->` и `<!-- CATALOG:FILTERS_FORMAT -->` дописать в каждую кнопку `type="button"` и `aria-pressed` — `"true"` у кнопки с классом `active`, `"false"` у остальных. Например:

```html
  <button class="chip active" type="button" aria-pressed="true" data-value="all">Все программы (20)</button>
  <button class="chip" type="button" aria-pressed="false" data-value="ПК">ПК (17)</button>
```

- [ ] **Шаг 5: Синхронизировать `aria-pressed` в обработчике**

Заменить:

```javascript
      row.querySelectorAll('.chip').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
```

на:

```javascript
      row.querySelectorAll('.chip').forEach((b) => {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
```

- [ ] **Шаг 6: Запустить тесты**

Run: `tests/run.sh`
Expected: PASS, 34/34

- [ ] **Шаг 7: Проверить, что генератор даёт ту же разметку**

```bash
node update-catalog.js
tests/run.sh
```

Expected: тесты остаются зелёными после регенерации каталога

- [ ] **Шаг 8: Коммит**

```bash
git add update-catalog.js "Каталог программ.html" tests/smoke_test.py
git commit -m "Каталог: фильтры доступны скринридерам (aria-pressed, role=group, aria-live)"
```

---

## Этап E. Переименование файлов

### Задача 11: `Каталог программ.html` → `catalog.html`

Сейчас адрес страницы выглядит как `/%D0%9A%D0%B0%D1%82%D0%B0%D0%BB%D0%BE%D0%B3%20%D0%BF%D1%80%D0%BE%D0%B3%D1%80%D0%B0%D0%BC%D0%BC.html`. Это же имя мешает привести sitemap и canonical к реальности (Задача 18). Переименование затрагивает ссылки на всех страницах, оба Node-скрипта и смоук-тест.

Страница клуба выпускников по решению владельца вне объема плана и НЕ переименовывается.

**Файлы:**
- Переименовать: `Каталог программ.html` → `catalog.html`
- Изменить: `update-catalog.js:13`, `admin-server.js:284-287`, `admin.html:69`
- Изменить: `index.html` (ссылки в `<noscript>` и внутри шаблона бандла), `privacy.html`, `Клуб выпускников (standalone).html` — только если в них есть ссылка на каталог
- Изменить: `tests/smoke_test.py:30`
- Изменить: `README.md` (упоминания файла)

**Интерфейсы:**
- Производит: файл `catalog.html` в корне. Задача 18 использует путь `/catalog.html` в sitemap и canonical.

- [ ] **Шаг 1: Найти все упоминания**

```bash
grep -rn "Каталог программ" --include="*.html" --include="*.js" --include="*.py" --include="*.md" --include="*.xml" .
```

Выписать список — по нему проверяется полнота правок на Шаге 5.

- [ ] **Шаг 2: Переименовать файл через git**

```bash
git mv "Каталог программ.html" catalog.html
```

- [ ] **Шаг 3: Обновить смоук-тест**

В `tests/smoke_test.py` заменить:

```python
CATALOG = f"{BASE}/{urllib.parse.quote('Каталог программ.html')}"
```

на:

```python
CATALOG = f"{BASE}/catalog.html"
```

и в `test_catalog` заменить `lbl = "Каталог программ.html"` на `lbl = "catalog.html"`.

- [ ] **Шаг 4: Запустить тесты и убедиться, что они падают на ссылках**

Run: `tests/run.sh`
Expected: FAIL — битые ресурсы или неверные ссылки на страницах, которые ещё указывают на старое имя

- [ ] **Шаг 5: Обновить все ссылки**

- `update-catalog.js:13`:

```javascript
const CATALOG_FILE = path.join(__dirname, 'catalog.html');
```

- `admin-server.js`: заменить блок

```javascript
    if (req.method === 'GET' && url === '/Каталог программ.html') {
      serveFile(res, path.join(ROOT, 'Каталог программ.html'));
      return;
    }
```

на:

```javascript
    if (req.method === 'GET' && url === '/catalog.html') {
      serveFile(res, path.join(ROOT, 'catalog.html'));
      return;
    }
```

- `admin.html:69`:

```html
      <a href="catalog.html" target="_blank">Открыть каталог →</a>
```

- В `index.html` заменить `href="Каталог программ.html"` на `href="catalog.html"` в двух местах: в блоке `<noscript>` и внутри JSON-строки шаблона бандла (там строка экранирована как `href=\"Каталог программ.html\"`). Внимание: файл 2,7 МБ, правьте точечной заменой, а не переписыванием файла.

Проверить, что замен ровно столько, сколько нашлось на Шаге 1:

```bash
grep -c "Каталог программ.html" index.html
```

Expected: `0`

- [ ] **Шаг 6: Запустить тесты**

Run: `tests/run.sh`
Expected: PASS, 34/34

- [ ] **Шаг 7: Проверить, что обновление каталога по-прежнему работает**

```bash
node update-catalog.js
git diff --stat catalog.html
```

Expected: файл обновился, маркеры на месте

```bash
git checkout -- catalog.html
```

- [ ] **Шаг 8: Обновить README**

В `README.md` в таблице страниц и в разделах заменить `Каталог программ.html` на `catalog.html`.

- [ ] **Шаг 9: Коммит**

```bash
git add -A
git commit -m "Каталог: латинское имя файла catalog.html вместо кириллического"
```

---

## Этап F. Главная страница

Общая идея: сейчас `index.html` — это самораспаковывающийся бандл (2716 КБ), который в браузере декодирует base64, распаковывает gzip, подменяет весь документ и транспилирует JSX через Babel. Измерено: 14,76 с до появления текста на Slow 4G + CPU 4x против 0,43 с у каталога. Плюс подмена документа стирает canonical, og:url и JSON-LD.

Переписывать разметку руками не нужно: отрендеренный DOM уже содержит финальный HTML с инлайновыми стилями. Замер показал, что из 3060 КБ снятого DOM 3024 КБ — это один `<style>` с 48 шрифтами в виде `data:font`, а собственно разметка занимает 33 КБ. Значит достаточно снять DOM, выбросить шрифтовый блок в пользу уже существующих `fonts/*.css`, убрать скрипты рантайма и вернуть мета-теги в `<head>`.

### Задача 12: Снять отрендеренную разметку главной

**Файлы:**
- Создать: `tools/snapshot-index.py`
- Создать: `build/index-rendered.html` (артефакт, в git не коммитится)
- Изменить: `.gitignore`

**Интерфейсы:**
- Производит: `build/index-rendered.html` — снимок отрендеренного DOM главной. Задача 13 работает с этим файлом.

- [ ] **Шаг 1: Добавить артефакт в `.gitignore`**

В `.gitignore` после блока про тестовое окружение добавить:

```
# Промежуточные артефакты пересборки главной
build/
```

- [ ] **Шаг 2: Написать скрипт снятия снимка**

Создать `tools/snapshot-index.py`:

```python
#!/usr/bin/env python3
"""Снимает отрендеренный DOM главной в build/index-rendered.html.

Главная сейчас — самораспаковывающийся бандл: разметку он собирает в
браузере. Скрипт открывает страницу в headless Chromium, дожидается
рендера и сохраняет получившийся HTML как заготовку для статической
версии (см. docs/superpowers/plans/2026-07-24-dpo-site-fixes.md, Задача 13).

Запуск:  python tools/snapshot-index.py
Требует: playwright из окружения .venv-tests (tests/run.sh его ставит).
"""

import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "build" / "index-rendered.html"
PORT = 6201
BASE = f"http://127.0.0.1:{PORT}"


def start_server():
    proc = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"],
        cwd=str(ROOT), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    for _ in range(50):
        try:
            urllib.request.urlopen(f"{BASE}/index.html", timeout=1)
            return proc
        except Exception:
            time.sleep(0.1)
    proc.terminate()
    raise RuntimeError("Статический сервер не поднялся")


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    server = start_server()
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            page = browser.new_page(viewport={"width": 1440, "height": 900})
            page.goto(f"{BASE}/index.html", wait_until="load", timeout=90000)
            page.wait_for_selector("header nav", timeout=60000)
            page.wait_for_timeout(5000)  # добить пост-рендер аддоны
            html = page.evaluate("() => document.documentElement.outerHTML")
            browser.close()
    finally:
        server.terminate()

    OUT.write_text(html, encoding="utf-8")
    print(f"Снимок: {OUT} — {len(html) // 1024} КБ")
    print(f"  data:font вхождений : {html.count('data:font')}")
    print(f"  blob: вхождений     : {html.count('blob:')}")
    print(f"  <script> тегов      : {html.count('<script')}")


if __name__ == "__main__":
    main()
```

- [ ] **Шаг 3: Запустить снятие снимка**

```bash
source .venv-tests/Scripts/activate   # или .venv-tests/bin/activate на Unix
python tools/snapshot-index.py
```

Expected: примерно

```
Снимок: .../build/index-rendered.html — 3060 КБ
  data:font вхождений : 48
  blob: вхождений     : 6
  <script> тегов      : 5
```

- [ ] **Шаг 4: Убедиться, что разметка без шрифтового блока укладывается в ~35 КБ**

```bash
python -c "import re,io; h=io.open('build/index-rendered.html',encoding='utf-8').read(); s=sum(len(m.group(1)) for m in re.finditer(r'<style[^>]*>(.*?)</style>', h, re.S)); print('всего', len(h)//1024, 'КБ; в <style>', s//1024, 'КБ; разметка', (len(h)-s)//1024, 'КБ')"
```

Expected: `всего 3060 КБ; в <style> 3027 КБ; разметка 33 КБ`

- [ ] **Шаг 5: Коммит**

```bash
git add tools/snapshot-index.py .gitignore
git commit -m "Инструмент: снятие отрендеренной разметки главной в build/"
```

---

### Задача 13: Собрать статический `index.html` из снимка

**Файлы:**
- Создать: `index-static.html` (временное имя; в Задаче 16 заменит `index.html`)
- Читать: `build/index-rendered.html`

**Интерфейсы:**
- Потребляет: `build/index-rendered.html` из Задачи 12.
- Производит: `index-static.html` — валидный статический HTML без скриптов рантайма, с полным `<head>`. Задачи 14-16 правят этот файл.

- [ ] **Шаг 1: Скопировать снимок в рабочий файл**

```bash
cp build/index-rendered.html index-static.html
```

- [ ] **Шаг 2: Выбросить шрифтовый `<style>` (3024 КБ)**

Найти в `index-static.html` блок `<style>`, начинающийся с `/* cyrillic-ext */ @font-face {   font-family: 'IBM Plex Sans';` — это самый большой элемент файла. Удалить его целиком вместе с тегами `<style>...</style>`.

Проверить:

```bash
grep -c "data:font" index-static.html
```

Expected: `0`

- [ ] **Шаг 3: Удалить служебные стили дизайн-рантайма**

Удалить три небольших блока `<style>`, содержащих соответственно:
- `.sc-placeholder{background:color-mix(...)` (около 2 КБ)
- `x-dc{display:none!important}`
- `html,body{height:100%;margin:0}#dc-root,#dc-root>.sc-host{height:100%}`

Оставить блоки со стилями `body { margin: 0; background: #FBF9F5; }` и `#viToggle{...}` — они относятся к самой странице (кнопка станет статической в Задаче 15).

- [ ] **Шаг 4: Убрать куки-баннер из разметки**

Снимок делался спустя 5 секунд после загрузки, поэтому в него попал баннер, который `js/cookie-consent.js` рисует на лету: элемент `<div id="cookieBanner" role="dialog">…</div>` и блок `<style>` с правилами `#cookieBanner{ position: fixed; …}`. Удалить и то, и другое.

Оставлять их нельзя: баннер должен показываться только тем, кто ещё не сделал выбор, а вшитый в разметку он будет висеть у всех и без обработчиков кнопок.

```bash
grep -c "cookieBanner" index-static.html
```

Expected: `0`

- [ ] **Шаг 5: Удалить все `<script>`**

Удалить все пять тегов `<script>` вместе с содержимым: три с `src="blob:..."` (React, ReactDOM, рантайм), инлайновый загрузчик и `<script type="text/x-dc">` с данными. Отрендеренный DOM уже финальный — ни React, ни Babel странице больше не нужны.

Вместе с загрузчиком со страницы уходят два артефакта отладки, отмеченные в аудите: глобальный обработчик `error`, рисовавший поверх страницы красную панель с текстом исключения и номером строки, и индикатор с англоязычными надписями `Unpacking...` / `Rendering...`.

Проверить:

```bash
grep -c "<script" index-static.html
```

Expected: `0`

- [ ] **Шаг 6: Собрать `<head>`**

Заменить содержимое `<head>` целиком на:

```html
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Образование для профессионалов права · Центр ДПО НИУ ВШЭ</title>

<!-- SEO. Замените https://example.com на реальный домен после публикации сайта. -->
<meta name="description" content="Центр ДПО факультета права НИУ ВШЭ: повышение квалификации и профессиональная переподготовка для юристов, in-house counsel и руководителей правовых департаментов — с преподавателями-практиками.">
<meta name="robots" content="index, follow">
<link rel="canonical" href="https://example.com/">
<meta property="og:type" content="website">
<meta property="og:locale" content="ru_RU">
<meta property="og:site_name" content="Центр ДПО · Факультет права НИУ ВШЭ">
<meta property="og:title" content="Образование для профессионалов права · Центр ДПО НИУ ВШЭ">
<meta property="og:description" content="Повышение квалификации и профессиональная переподготовка для юристов — с преподавателями-практиками.">
<meta property="og:url" content="https://example.com/">
<meta property="og:image" content="https://example.com/images/hero-justice.jpg">
<meta property="og:image:width" content="1380">
<meta property="og:image:height" content="789">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Образование для профессионалов права · Центр ДПО НИУ ВШЭ">
<meta name="twitter:description" content="Повышение квалификации и профессиональная переподготовка для юристов НИУ ВШЭ.">
<meta name="twitter:image" content="https://example.com/images/hero-justice.jpg">
<link rel="icon" type="image/svg+xml" href="favicon.svg">
<meta name="theme-color" content="#1658DA">

<script type="application/ld+json">{"@context":"https://schema.org","@type":"EducationalOrganization","name":"Центр ДПО факультета права НИУ ВШЭ","url":"https://example.com/","sameAs":"https://pravo.hse.ru/dpo","parentOrganization":{"@type":"CollegeOrUniversity","name":"НИУ ВШЭ","url":"https://www.hse.ru/"}}</script>

<!-- Шрифты размещены локально (fonts/) — данные посетителей не уходят на внешние CDN (152-ФЗ). -->
<link rel="preload" as="font" type="font/woff2" href="fonts/HSESans-Regular.woff2" crossorigin>
<link rel="stylesheet" href="fonts/fonts-hse.css">
<link rel="stylesheet" href="fonts/fonts-main.css">

<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'unsafe-inline' https://mc.yandex.ru; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: https://mc.yandex.ru; connect-src 'self' https://mc.yandex.ru; base-uri 'self'; form-action 'none'">
<meta name="referrer" content="strict-origin-when-cross-origin">
```

Точное содержимое JSON-LD сверьте с текущим `index.html:24` — там уже лежит блок `EducationalOrganization`; перенесите его как есть, заменив только `url`.

После `<head>` не должно остаться `<title>` или `<meta>` внутри `<body>`: удалите остатки элементов `<helmet>` и `<x-dc>`, если снимок их сохранил (по замеру их быть не должно — рантайм их убирает).

- [ ] **Шаг 7: Проверить, что страница открывается**

```bash
python -m http.server 6202 --bind 127.0.0.1 &
curl -s -o /dev/null -w "%{http_code} %{size_download}\n" http://127.0.0.1:6202/index-static.html
```

Expected: `200` и размер в районе 35-45 КБ

Открыть в браузере, сверить с текущей главной: шапка, hero, секции, футер на месте, шрифты HSE подхватились. Кнопка «Версия для слабовидящих» пока не работает, а куки-баннера нет — скрипты возвращаются в Задаче 15, это ожидаемо.

- [ ] **Шаг 8: Коммит**

```bash
git add index-static.html
git commit -m "Главная: статическая разметка из снимка бандла (без React и Babel)"
```

---

### Задача 14: Hero-фото как `<img>` вместо CSS-фона

В снимке hero-фото подключено как `background-image: url("blob:...")` — эта ссылка мертва вне бандла. Плюс на всех страницах сайта сейчас ноль элементов `<img>`, то есть у главного изображения нет ни `alt`, ни шанса попасть в поиск по картинкам. Файл `images/hero-justice.jpg` (180 КБ) уже лежит в репозитории и используется как `og:image`.

**Файлы:**
- Изменить: `index-static.html`

**Интерфейсы:**
- Производит: hero с элементом `<img src="images/hero-justice.jpg" alt="...">`. Задача 16 проверяет его в смоук-тесте.

- [ ] **Шаг 1: Найти элемент с мёртвой ссылкой**

```bash
grep -o 'background-image:[^;"]*blob:[^;"]*' index-static.html
grep -c "blob:" index-static.html
```

Expected: одна строка с `background-image` и суммарно 6 вхождений `blob:`

- [ ] **Шаг 2: Заменить фон на настоящий файл**

В найденном элементе заменить `url("blob:http://127.0.0.1:6201/...")` на `url("images/hero-justice.jpg")`.

Убрать оставшиеся вхождения `blob:` — это ссылки на удалённые скрипты в атрибутах, они больше ни на что не влияют, но мусор в разметке оставлять не нужно.

```bash
grep -c "blob:" index-static.html
```

Expected: `0`

- [ ] **Шаг 3: Добавить настоящий `<img>` с alt**

Внутри hero-секции, первым потомком контейнера с фоном, вставить:

```html
<img src="images/hero-justice.jpg" alt="Статуя Фемиды — символ правосудия"
     width="1380" height="789" decoding="async"
     style="position:absolute; inset:0; width:100%; height:100%; object-fit:cover; z-index:0;">
```

Контейнеру, у которого был `background-image`, убрать это свойство и убедиться, что у него `position: relative`, а текстовый блок поверх фото лежит с `position: relative; z-index: 1`.

Атрибуты `width`/`height` обязательны — без них браузер не зарезервирует место и при загрузке страницу дёрнет (Cumulative Layout Shift).

- [ ] **Шаг 4: Проверить визуально**

Открыть `index-static.html` через локальный сервер, сверить hero с текущей главной: фото на месте, текст читается поверх, при сужении окна ничего не разъезжается.

- [ ] **Шаг 5: Проверить, что в vi-режиме фото скрывается**

Стили `html.vi-mode` скрывают `svg`, но не `img`. Дописать в блок стилей vi-режима:

```css
html.vi-mode img{ display: none !important; }
```

Это соответствует уже принятому на других страницах решению «без декора».

- [ ] **Шаг 6: Коммит**

```bash
git add index-static.html
git commit -m "Главная: hero-фото как <img> с alt вместо мёртвой blob-ссылки"
```

---

### Задача 15: Убрать polling-костыли переключателя и куки-баннера

Костыли существовали ради React-рантайма, который пересобирал шапку и терял слушатели: `index.html:288-292` дёргает `ensure()` каждые 200 мс шестьдесят секунд, `js/cookie-consent.js:120-128` каждые 150 мс ждёт появления `<header>`. В статической странице шапка есть сразу, и оба таймера превращаются в холостую нагрузку.

**Файлы:**
- Изменить: `index-static.html` (заменить vi-mode аддон на обычный обработчик)
- Изменить: `js/cookie-consent.js:118-128`

**Интерфейсы:**
- Потребляет: разметку из Задач 13-14.
- Производит: `js/cookie-consent.js` показывает баннер сразу после готовности DOM на любой странице; главная использует ту же схему vi-режима, что каталог и privacy.

- [ ] **Шаг 1: Добавить кнопку vi-режима прямо в разметку**

В `index-static.html` в блоке `<header> ... <nav>` заменить кнопку, вставленную рантаймом, на статическую (если её нет — добавить перед последним элементом nav):

```html
<button id="viToggle" class="vi-btn" type="button" aria-pressed="false" title="Версия для слабовидящих">Версия для слабовидящих</button>
```

- [ ] **Шаг 2: Вернуть скрипты страницы**

Скрипты были вырезаны в Задаче 13 вместе с рантаймом, включая аддон с `setInterval`/`ensure`. Вставить перед `</body>` обычные обработчики:

```html
<script>
  // Версия для слабовидящих: переключатель с сохранением выбора (функциональное
  // хранение настройки — согласия по 152-ФЗ не требует, ПДн не содержит).
  const viBtn = document.getElementById('viToggle');
  function setVi(on) {
    document.documentElement.classList.toggle('vi-mode', on);
    viBtn.setAttribute('aria-pressed', String(on));
    try { localStorage.setItem('vi-mode', on ? '1' : '0'); } catch (e) {}
  }
  viBtn.addEventListener('click', () => setVi(!document.documentElement.classList.contains('vi-mode')));
  try { if (localStorage.getItem('vi-mode') === '1') setVi(true); } catch (e) {}
</script>
<script src="js/cookie-consent.js" defer></script>
```

Это дословно та же схема, что в `catalog.html` и `privacy.html`, — один механизм на все страницы.

- [ ] **Шаг 3: Написать падающую проверку на отсутствие таймеров**

В `tests/smoke_test.py` в `test_index` заменить проверку «переключатель работает и после ре-рендеров» на:

```python
    # После перехода на статику пересборки шапки нет, поэтому и polling не нужен.
    check(lbl, "нет бесконечного polling в разметке",
          "setInterval" not in page.content(), "в разметке остался setInterval")
```

- [ ] **Шаг 4: Убрать ожидание шапки из куки-баннера**

В `js/cookie-consent.js` заменить хвост файла:

```javascript
  // На главной (React-бандл) содержимое страницы дорисовывается рантаймом —
  // ждём появления шапки, чтобы баннер не был затёрт при загрузке.
  var tries = 0;
  var timer = setInterval(function () {
    if (!document.body || !document.querySelector('header')) {
      if (++tries > 100) clearInterval(timer);
      return;
    }
    clearInterval(timer);
    showBanner();
  }, 150);
})();
```

на:

```javascript
  // Все страницы статические — ждать нечего, показываем баннер как только
  // готов DOM. Скрипт подключается с defer, поэтому в норме сюда попадаем
  // уже с готовым документом.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', showBanner, { once: true });
  } else {
    showBanner();
  }
})();
```

- [ ] **Шаг 5: Проверить, что баннер по-прежнему показывается на всех страницах**

Run: `tests/run.sh`
Expected: PASS — проверки «куки-баннер показан» и «отказ от cookie запомнен» зелёные на index и остальных страницах

- [ ] **Шаг 6: Коммит**

```bash
git add index-static.html js/cookie-consent.js tests/smoke_test.py
git commit -m "Главная: обычные обработчики вместо polling; баннер по DOMContentLoaded"
```

---

### Задача 16: Заменить главную и удалить бандл

**Файлы:**
- Удалить: `index.html` (бандл), заменить на `index-static.html`
- Изменить: `tests/smoke_test.py` (`test_index`)
- Изменить: `README.md` (описание главной)

**Интерфейсы:**
- Потребляет: `index-static.html` из Задач 13-15.
- Производит: `index.html` — статическая главная. Задача 18 прописывает ей canonical.

- [ ] **Шаг 1: Зафиксировать эталон текста старой главной**

```bash
python -c "import io,re; h=io.open('build/index-rendered.html',encoding='utf-8').read(); t=re.sub(r'<[^>]+>',' ',h); t=re.sub(r'\s+',' ',t).strip(); io.open('build/index-text-before.txt','w',encoding='utf-8').write(t); print(len(t),'символов')"
```

Это эталон для сверки: после подмены текстовое содержимое не должно потерять смысловые блоки.

- [ ] **Шаг 2: Подменить файл**

```bash
git rm index.html
git mv index-static.html index.html
```

- [ ] **Шаг 3: Обновить проверки главной в смоук-тесте**

В `tests/smoke_test.py` в `test_index`:

Заменить заголовок раздела:

```python
    lbl = "index.html"
    print(f"\n{lbl} (главная, Claude Design)")
```

на:

```python
    lbl = "index.html"
    print(f"\n{lbl} (главная, статика)")
```

Заменить проверку hero-фото:

```python
    check(lbl, "hero-фото отрисовано",
          page.evaluate("""() => [...document.querySelectorAll('div')].some(d => {
              const bg = getComputedStyle(d).backgroundImage;
              return bg && bg !== 'none' && (bg.includes('blob:') || bg.includes('data:') || bg.includes('.jpg') || bg.includes('.png'));
          })"""))
```

на:

```python
    check(lbl, "hero-фото — настоящий <img> с alt и размерами",
          page.evaluate("""() => {
              const img = document.querySelector('img[src*="hero-justice"]');
              return !!img && !!img.alt && !!img.getAttribute('width') && !!img.getAttribute('height');
          }"""))
```

Добавить после проверки `theme-color` новые проверки — именно они сторожат баг, из-за которого бандл стирал мета-теги:

```python
    check(lbl, "canonical на месте после рендера",
          page.eval_on_selector('link[rel=canonical]', "el => el.getAttribute('href')") is not None)
    check(lbl, "og:url на месте после рендера",
          page.eval_on_selector('meta[property="og:url"]', "el => el.content") is not None)
    check(lbl, "микроразметка организации на месте",
          page.eval_on_selector_all('script[type="application/ld+json"]', "els => els.length") >= 1)
    check(lbl, "description лежит в <head>, а не в <body>",
          page.evaluate('!!document.head.querySelector(\'meta[name="description"]\')'))
    check(lbl, "документ меньше 200 КБ",
          len(page.content()) < 200 * 1024, f"got {len(page.content()) // 1024} КБ")
```

Заменить `wait_selector="#viToggle"` на `wait_selector="header"` — кнопка теперь в разметке сразу, ждать нечего.

- [ ] **Шаг 4: Прогнать тесты**

Run: `tests/run.sh`
Expected: PASS, все проверки зелёные

- [ ] **Шаг 5: Сверить текст с эталоном**

```bash
python tools/snapshot-index.py
python -c "import io,re; h=io.open('build/index-rendered.html',encoding='utf-8').read(); t=re.sub(r'<[^>]+>',' ',h); t=re.sub(r'\s+',' ',t).strip(); before=io.open('build/index-text-before.txt',encoding='utf-8').read(); print('до:',len(before),'после:',len(t)); missing=[w for w in ('Центр ДПО','Каталог программ','Политика обработки','профессиональная переподготовка') if w not in t]; print('пропало:', missing or 'ничего')"
```

Expected: `пропало: ничего`

- [ ] **Шаг 6: Замерить выигрыш**

```bash
ls -la index.html
```

Expected: примерно 40 КБ вместо 2716 КБ

Прогнать замер загрузки (скрипт из аудита, при желании положить в `tools/`):

Expected: время до появления `h1` на Slow 4G + CPU 4x падает с ~14,8 с до менее 1 с

- [ ] **Шаг 7: Обновить README**

В `README.md`:

- в таблице страниц заменить описание `index.html` с «Единственный лендинг ДПО (Design-версия, React-бандл из Claude Design)» на «Главная страница ДПО — статический HTML»;
- удалить примечание, начинающееся с «Примечание: контент `index.html` рендерится через JavaScript…», — оно перестало быть верным (и в прежней формулировке было неточным: подмена документа стирала canonical и JSON-LD);
- в разделе «Осознанные решения релиза» удалить пункты про фото в бандле (2,65 МБ) и про отсутствие CSP на главной — оба сняты.

- [ ] **Шаг 8: Коммит**

```bash
git add -A
git commit -m "Главная: статический HTML вместо 2,7-МБ бандла (14,8 с → 0,4 с до контента)"
```

---

## Этап G. Публикация

### Задача 17: Заголовки хостинга

CSP задан через `<meta http-equiv>`, а директива `frame-ancestors` в meta игнорируется по спецификации — значит защиты от встраивания в чужой iframe сейчас нет ни на одной публичной странице. Это закрывается только заголовками на стороне хостинга.

**Файлы:**
- Создать: `docs/hosting-headers.md`
- Изменить: `README.md` (раздел «Замечания по деплою»)

**Интерфейсы:**
- Производит: документ с готовыми конфигурациями, на который ссылается README.

- [ ] **Шаг 1: Создать `docs/hosting-headers.md`**

```markdown
# Заголовки, которые нужно включить на хостинге

Статические страницы сами по себе часть защит выставить не могут: директива
`frame-ancestors` игнорируется в `<meta http-equiv>`, а `X-Frame-Options`
существует только как HTTP-заголовок. Поэтому после публикации на реальном
хостинге настройте следующее.

## Обязательный минимум

| Заголовок | Значение | Зачем |
|---|---|---|
| `X-Frame-Options` | `DENY` | запрет встраивания в чужой iframe (кликджекинг) |
| `Content-Security-Policy` | `frame-ancestors 'none'` | то же, современный вариант |
| `X-Content-Type-Options` | `nosniff` | запрет угадывания MIME-типа |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | не утекает полный URL на внешние сайты |
| `Strict-Transport-Security` | `max-age=31536000` | только HTTPS (включать после проверки сертификата) |

## nginx

```nginx
add_header X-Frame-Options "DENY" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Content-Security-Policy "frame-ancestors 'none'" always;
add_header Strict-Transport-Security "max-age=31536000" always;

# Шрифты и картинки кешируются надолго, HTML — нет: каталог обновляется.
location ~* \.(woff2|jpg|png|svg)$ { add_header Cache-Control "public, max-age=31536000, immutable"; }
location ~* \.html$             { add_header Cache-Control "public, max-age=300"; }
```

## Apache (.htaccess)

```apache
Header always set X-Frame-Options "DENY"
Header always set X-Content-Type-Options "nosniff"
Header always set Referrer-Policy "strict-origin-when-cross-origin"
Header always set Content-Security-Policy "frame-ancestors 'none'"
Header always set Strict-Transport-Security "max-age=31536000"
```

## Проверка после публикации

```bash
curl -sI https://ВАШ-ДОМЕН/ | grep -i "x-frame\|content-security\|referrer\|nosniff"
```

Все пять заголовков должны присутствовать.

## Чего заголовки не заменяют

Защита от DDoS и ботов уровня сети (WAF, Cloudflare, DDoS-Guard, защита
хостера) включается отдельно на стороне хостинга.
```

- [ ] **Шаг 2: Сослаться на документ из README**

В `README.md` в разделе «Замечания по деплою» добавить пункт:

```markdown
- **Заголовки хостинга обязательны**: защита от кликджекинга задаётся только
  HTTP-заголовками (в `<meta>` директива `frame-ancestors` не работает).
  Готовые конфигурации nginx и Apache — в `docs/hosting-headers.md`.
```

- [ ] **Шаг 3: Коммит**

```bash
git add docs/hosting-headers.md README.md
git commit -m "Документация: заголовки безопасности для хостинга"
```

---

### Задача 18: Подставить домен и привести sitemap к реальности

Сейчас `https://example.com` стоит в canonical, og:url, twitter:image, sitemap.xml и robots.txt. Canonical, указывающий на чужой домен, — это прямая команда поисковику не индексировать страницу. Плюс sitemap обещает адреса `/catalog` и `/privacy`, которых на статическом хостинге не существует.

**Файлы:**
- Изменить: `index.html`, `catalog.html`, `privacy.html`, `sitemap.xml`, `robots.txt`
- Изменить: `tests/smoke_test.py` (новая проверка `test_seo_consistency`)

**Интерфейсы:**
- Потребляет: имя `catalog.html` из Задачи 11, статическую главную из Задачи 16.
- Производит: согласованные canonical/og:url/sitemap, указывающие на существующие адреса.

**Предусловие:** домен должен быть выбран. Если на момент выполнения он ещё не известен — выполните всё, кроме подстановки домена, и оставьте `https://example.com`; тогда Шаг 5 остаётся невыполненным до появления домена.

- [ ] **Шаг 1: Написать падающую проверку**

В `tests/smoke_test.py` добавить функцию перед `main()`:

```python
def test_seo_consistency():
    """canonical/og:url и sitemap должны указывать на существующие файлы."""
    lbl = "SEO"
    print(f"\n{lbl}")
    import re
    sitemap = (ROOT / "sitemap.xml").read_text(encoding="utf-8")
    locs = re.findall(r"<loc>([^<]+)</loc>", sitemap)

    def exists(loc):
        path = urllib.parse.urlparse(loc).path.lstrip("/")
        return path == "" or (ROOT / urllib.parse.unquote(path)).exists()

    check(lbl, "все адреса из sitemap соответствуют файлам",
          all(exists(l) for l in locs), str([l for l in locs if not exists(l)]))

    hosts = {urllib.parse.urlparse(l).netloc for l in locs}
    for name in ("index.html", "catalog.html", "privacy.html"):
        html = (ROOT / name).read_text(encoding="utf-8")
        m = re.search(r'<link rel="canonical" href="([^"]+)"', html)
        check(lbl, f"{name}: canonical задан", m is not None)
        if m:
            check(lbl, f"{name}: домен canonical совпадает с sitemap",
                  urllib.parse.urlparse(m.group(1)).netloc in hosts,
                  f"{m.group(1)} против {hosts}")

    check(lbl, "sitemap указан в robots.txt",
          "Sitemap:" in (ROOT / "robots.txt").read_text(encoding="utf-8"))
```

И зарегистрировать её в `main()`: после цикла по страницам, до подсчёта итога, добавить `test_seo_consistency()`.

- [ ] **Шаг 2: Запустить и убедиться, что падает**

Run: `tests/run.sh`
Expected: FAIL — адреса `/catalog` и `/privacy` из sitemap не соответствуют файлам, а у `privacy.html` нет canonical

- [ ] **Шаг 3: Привести sitemap к реальным адресам**

Заменить содержимое `sitemap.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!-- Карта сайта для поисковых систем.
     ЗАМЕНИТЕ https://example.com на реальный домен после публикации. -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://example.com/</loc>
    <lastmod>2026-07-24</lastmod>
    <changefreq>monthly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://example.com/catalog.html</loc>
    <lastmod>2026-07-24</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>
  <url>
    <loc>https://example.com/privacy.html</loc>
    <lastmod>2026-07-24</lastmod>
    <changefreq>yearly</changefreq>
    <priority>0.2</priority>
  </url>
</urlset>
```

Страница клуба выпускников в sitemap не входит — она вне объёма плана.

- [ ] **Шаг 4: Починить canonical на страницах**

- `catalog.html`: заменить `href="https://example.com/catalog"` на `href="https://example.com/catalog.html"`, там же поправить `og:url`.
- `privacy.html`: добавить в `<head>` после строки с `og:image`:

```html
<link rel="canonical" href="https://example.com/privacy.html">
<meta property="og:type" content="website">
<meta property="og:title" content="Политика обработки персональных данных · Центр ДПО НИУ ВШЭ">
<meta property="og:url" content="https://example.com/privacy.html">
```

- `index.html`: убедиться, что canonical и og:url равны `https://example.com/`.

- [ ] **Шаг 5: Подставить реальный домен**

Когда домен известен, заменить его во всех файлах разом:

```bash
grep -rln "https://example.com" --include="*.html" --include="*.xml" --include="*.txt" .
```

Заменить в каждом найденном файле `https://example.com` на реальный адрес без завершающего слэша. После замены проверить, что не осталось ни одного вхождения:

```bash
grep -rn "example.com" --include="*.html" --include="*.xml" --include="*.txt" . | grep -v "^./docs/"
```

Expected: пусто

- [ ] **Шаг 6: Прогнать тесты**

Run: `tests/run.sh`
Expected: PASS, все проверки зелёные

- [ ] **Шаг 7: Коммит**

```bash
git add sitemap.xml robots.txt index.html catalog.html privacy.html tests/smoke_test.py
git commit -m "SEO: canonical и sitemap указывают на реально существующие адреса"
```

---

## Этап H. Гигиена

### Задача 19: Мелкие правки по списку аудита

Собраны в одну задачу: каждая — одна-две строки, отдельного цикла ревью не стоит.

**Файлы:**
- Изменить: `update-catalog.js:26-32`, `admin-server.js:318-322`, `lib/hse-catalog.js:41-51`, `robots.txt`, `catalog.html`
- Удалить: неиспользуемые шрифты из `fonts/`

- [ ] **Шаг 1: Экранировать апостроф в `escapeHtml`**

В `update-catalog.js` в конец цепочки `.replace` добавить:

```javascript
    .replace(/'/g, '&#39;');
```

Сейчас безопасно только потому, что все атрибуты в двойных кавычках — защита держится на договорённости, которую легко нарушить будущей правкой.

- [ ] **Шаг 2: Убрать удержание процесса при необработанном исключении**

В `admin-server.js` заменить:

```javascript
process.on('uncaughtException', (err) => {
  // Last-resort net: log and keep the server alive rather than let Node exit
  // and silently take the whole admin panel offline.
  console.error('Uncaught exception (server kept alive):', err.stack || err.message);
});
```

на:

```javascript
process.on('uncaughtException', (err) => {
  // Продолжать работу после необработанного исключения нельзя: состояние
  // процесса неопределённое, а незакрытая блокировка обновления оставит
  // админку в режиме «обновление уже идёт» навсегда. Логируем и выходим —
  // локальный инструмент проще перезапустить.
  console.error('Необработанное исключение, сервер остановлен:', err.stack || err.message);
  process.exit(1);
});
```

- [ ] **Шаг 3: Не подменять битую ссылку программы на общий каталог**

В `lib/hse-catalog.js` функция `safeHseUrl` при неразобранном URL возвращает `CATALOG_URL`, из-за чего карточка молча ведёт не туда. Заменить возврат на `null` и отфильтровать такие программы в `fetchProgramItems`:

```javascript
  for (const item of items) {
    item.url = safeHseUrl(item.url);
  }
  return items;
```

на:

```javascript
  const safe = [];
  for (const item of items) {
    const url = safeHseUrl(item.url);
    if (!url) {
      console.warn(`Пропущена программа с неразобранной ссылкой: ${item.title || '(без названия)'}`);
      continue;
    }
    item.url = url;
    safe.push(item);
  }
  if (safe.length === 0) throw new Error('Ни одной программы с корректной ссылкой — обновление отменено');
  return safe;
```

и в `safeHseUrl` заменить `return CATALOG_URL;` на `return null;`.

- [ ] **Шаг 4: Убрать бесполезную строку из robots.txt**

Удалить из `robots.txt`:

```
# Служебная админ-панель — не для индексации
Disallow: /admin.html
```

Админка работает только локально и в интернет не попадает, а строка лишь сообщает роботам о существовании пути.

- [ ] **Шаг 5: Учесть prefers-reduced-motion**

В `catalog.html` и `index.html` в конец блока `<style>` добавить:

```css
  @media (prefers-reduced-motion: reduce) {
    html{ scroll-behavior: auto; }
    *{ animation-duration: 0.01ms !important; animation-iteration-count: 1 !important;
       transition-duration: 0.01ms !important; }
  }
```

- [ ] **Шаг 6: Убрать утечку длины пароля из сравнения**

`safeEqual` в `admin-server.js:40-44` заявлен константным по времени, но выходит раньше при разной длине строк, то есть длину пароля утечь может. Для локального инструмента это не критично, но комментарий обещает больше, чем делает код. Заменить на сравнение хешей фиксированной длины:

```javascript
// Сравнение постоянного времени. Хешируем перед сравнением, чтобы разница
// в длине строк не измерялась по времени ответа: timingSafeEqual требует
// равной длины буферов и на разной длине выходит мгновенно.
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
```

- [ ] **Шаг 7: Поправить смещение липкой панели фильтров**

В `catalog.html` у `.filters:first-of-type` задано `top: 61px` — высота шапки зашита числом. В режиме для слабовидящих `body` масштабируется через `zoom: 1.25`, шапка становится выше, и панель фильтров с ней перекрывается. Заменить фиксированное значение на переменную и пересчитывать её:

```css
  :root{ --header-h: 61px; }
  .filters:first-of-type{ top: var(--header-h); }
```

и в скрипт страницы, сразу после `setVi`, добавить:

```javascript
  // Высота шапки зависит от загруженных шрифтов и масштаба vi-режима,
  // поэтому её нельзя зашивать числом — пересчитываем.
  function syncHeaderHeight() {
    const h = document.querySelector('header');
    if (h) document.documentElement.style.setProperty('--header-h', h.offsetHeight + 'px');
  }
  syncHeaderHeight();
  window.addEventListener('resize', syncHeaderHeight);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(syncHeaderHeight);
```

Вызвать `syncHeaderHeight()` в конце `setVi`, чтобы переключение режима сразу пересчитывало отступ.

- [ ] **Шаг 8: Добавить второй уровень заголовков в каталог**

В `catalog.html` иерархия идёт `h1` → `h3` (карточки), уровень `h2` пропущен — это ломает навигацию по заголовкам у скринридеров. Добавить перед сеткой карточек:

```html
  <h2 class="visually-hidden">Список программ</h2>
```

и стиль скрытия, доступного для скринридера:

```css
  .visually-hidden{ position:absolute; width:1px; height:1px; padding:0; margin:-1px;
    overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; border:0; }
```

- [ ] **Шаг 9: Удалить неиспользуемые шрифты**

В `fonts/` лежит около 4 МБ файлов, из которых страницы реально загружают около 90 КБ: HSE Sans и HSE Slab подхватываются первыми, а IBM Plex Sans, Inter, Source Serif 4 и PT Serif объявлены фолбэками и не скачиваются никогда.

Определить, какие файлы реально запрашиваются:

```bash
python - <<'PY'
import subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright
srv = subprocess.Popen([sys.executable,"-m","http.server","6203","--bind","127.0.0.1"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
used=set()
with sync_playwright() as pw:
    b=pw.chromium.launch(headless=True)
    for page_url in ("index.html","catalog.html","privacy.html"):
        p=b.new_page()
        p.on("response", lambda r: used.add(r.url.split("/")[-1]) if r.url.endswith(".woff2") else None)
        p.goto(f"http://127.0.0.1:6203/{page_url}", wait_until="networkidle"); p.wait_for_timeout(2000); p.close()
    b.close()
srv.terminate()
print("используются:", sorted(used))
PY
```

Удалить `.woff2`, которых нет в списке, и соответствующие блоки `@font-face` из `fonts/*.css`. Начертания, объявленные в CSS, но не скачанные ни на одной странице, — это ровно те фолбэки, до которых очередь не доходит.

После удаления обязательно:

Run: `tests/run.sh`
Expected: PASS, проверка «шрифты HSE Sans/Slab загружены» зелёная, битых ресурсов нет

- [ ] **Шаг 10: Прогнать все тесты**

Run: `node --test tests/unit/*.test.js && bash tests/run.sh`
Expected: PASS в обоих случаях

- [ ] **Шаг 11: Коммит**

```bash
git add -A
git commit -m "Гигиена: экранирование, поведение при сбоях, reduced-motion, заголовки, чистка шрифтов"
```

**Сознательно не делаем:**
- **Обфускация email через `data-u`/`data-d`** остаётся как есть. Защита слабая (любой современный харвестер исполняет JS), но и вреда не приносит; замена на честный `mailto:` — отдельное продуктовое решение владельца, а не техдолг.
- **Фолбэк `favicon.ico`** не добавляем: SVG-иконку понимают все браузеры, которые вообще стоит поддерживать. Если понадобится — сгенерировать из `favicon.svg` и добавить `<link rel="icon" sizes="any" href="favicon.ico">`.

---

## Приложение: что нужно сделать вне кода

Эти пункты кодом не закрываются, но без них публиковать сайт нельзя. Ответственный — владелец сайта, не разработчик.

- [ ] **A1. Сверить контактные данные с факультетом.** Координатор клуба (ФИО и добавочные номера изъяты из репозитория, см. audit-2026-08-full), канал `t.me/pravo_alumni`. Публикация имени и прямого номера конкретного сотрудника без подтверждения — репутационный риск.
- [ ] **A2. Подтвердить цифры.** «4300+ выпускников в базе клуба», «30+ стран», «25 лет истории», «ТОП-150 в рейтингах THE и QS по праву», два блока «50+». Похоже на заглушки из макета.
- [ ] **A3. Отдать `privacy.html` в юрслужбу НИУ ВШЭ.** В самом файле есть комментарий, что документ типовой и требует утверждения. Отдельно проверить: юридический адрес оператора (в файле указан адрес корпуса факультета, а не юрлица), формулировку про «обезличенную статистику» Яндекс.Метрики, отсутствующие сроки обработки и хранения и срок ответа на обращение.
- [ ] **A4. Проверить права на шрифты и бренд.** `fonts/HSESans-*.woff2` и `HSESlab-*.woff2` — фирменные шрифты НИУ ВШЭ, раздаются с сайта. На всех страницах стоит «© НИУ ВШЭ». Если проект не является официальным ресурсом университета, использование нужно согласовать.
- [ ] **A5. Решить с доменом** — от этого зависит Задача 18.
- [ ] **A6. Вписать номер счётчика Яндекс.Метрики** в `js/cookie-consent.js` (переменная `METRIKA_ID`), если аналитика нужна. Сейчас `null`: баннер работает, счётчик не грузится.

---

## Порядок выполнения и оценка

| Этап | Задачи | Можно параллелить | Комментарий |
|---|---|---|---|
| A | 1 | нет | блокирует всё остальное |
| B | 2-6б | да, между собой | правки данных, независимы |
| C | 7-8 | нет (общий файл) | 8 меняет `handleUpdate`, задетый в 7 |
| D | 9-10 | да | 10 меняет и генератор, и HTML |
| E | 11 | нет | делать до Задачи 18 |
| F | 12-16 | нет, строго по порядку | самый крупный этап |
| G | 17-18 | 17 в любой момент | 18 — после 11 и 16 |
| H | 19 | в конце | |

Быстрый выигрыш без риска — Задачи 2, 3, 4, 5, 9: правки на несколько строк, каждая закрывает недостоверные данные или нарушение нормы. Их разумно собрать в один заход и выпустить отдельно от переписывания главной.

## Соответствие находкам аудита

| Находка аудита | Где закрывается |
|---|---|
| 1. `example.com` в canonical/og/sitemap/robots | Задача 18 |
| 2. Адреса sitemap не существуют | Задачи 11, 18 |
| 3. Главная теряет canonical/og/JSON-LD | Задачи 13, 16 |
| 4. Непроверяемые имена и цифры | Приложение A1, A2 |
| 5. Юридический блок | Приложение A3, A4 |
| 6. 14,8 с до контента | Этап F |
| 7. Главную нельзя поддерживать | Этап F |
| 8. «Бесплатно» вместо «цена по запросу» | Задача 2 |
| 9. Дата в JSON-LD на день раньше | Задача 3 |
| 10. CSRF в админке | Задача 7 |
| 11. Гонка при параллельном обновлении | Задача 8 |
| 12. Нет таймаута у запроса к hse.ru | Задача 5 |
| 13. Битая дата роняет обновление | Задача 4 |
| 14. Неатомарная запись каталога | Задача 6 |
| 15. Контраст ниже WCAG AA | Задача 9 |
| 16. Страница клуба — сирота | вне объёма по решению владельца |
| 17. Красная плашка ошибок, «Unpacking…» | Задача 13, шаг 5 |
| 18. Хрупкий разбор данных hse.ru | Задача 6б |
| 19. Нет `frame-ancestors` | Задача 17 |
| 20. Favicon админки блокируется CSP | Задача 7, шаг 5 |
| 21. `escapeHtml` не экранирует апостроф | Задача 19, шаг 1 |
| 22. `safeEqual` утекает длину | Задача 19, шаг 6 |
| 23. Обфускация email — театр | сознательно не делаем, см. Задачу 19 |
| 24. `uncaughtException` удерживает процесс | Задача 19, шаг 2 |
| 25. `tests/run.sh` не работает на Windows | Задача 1 |
| 26. 4 МБ неиспользуемых шрифтов | Задача 19, шаг 9 |
| 27. Нет `lastmod` в sitemap | Задача 18, шаг 3 |
| 28. Шрифты и бренд НИУ ВШЭ | Приложение A4 |
| 29. Фильтры недоступны скринридерам, пропущен `h2` | Задачи 10 и 19, шаг 8 |
| 30. `prefers-reduced-motion` не учтён | Задача 19, шаг 5 |
| 31. Нет фолбэка `favicon.ico` | сознательно не делаем, см. Задачу 19 |
| Битая ссылка программы ведёт в общий каталог | Задача 19, шаг 3 |
| Перекрытие липких фильтров в vi-режиме | Задача 19, шаг 7 |
| Hero-фото без `<img>` и `alt` | Задача 14 |
