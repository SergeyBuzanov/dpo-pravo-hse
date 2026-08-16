const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Чистота текста на собранных страницах программ. Скрап с hse.ru приносил
// дважды экранированные сущности («&amp;rarr;» показывался посетителю как
// текст «&rarr;») и декоративные стрелки из ссылок «подробнее». Генератор
// scripts/build-program-pages.js обязан вычищать их при сборке – тест
// проверяет результат по всем programs/*.html.

const DIR = path.join(__dirname, '..', '..', 'programs');

const pages = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith('.html'))
  .sort();

test('страницы программ собраны', () => {
  assert.ok(pages.length > 0, 'в programs/ нет ни одной страницы – запустите node scripts/build-program-pages.js');
});

test('нет литеральных HTML-сущностей (след двойного экранирования)', () => {
  for (const f of pages) {
    const html = fs.readFileSync(path.join(DIR, f), 'utf8');
    // «&amp;rarr;» в исходнике браузер показывает как текст «&rarr;».
    const doubled = html.match(/&amp;[a-zA-Z]+;/g);
    assert.strictEqual(doubled, null, `${f}: видимая сущность ${doubled && doubled[0]}`);
  }
});

test('нет видимых декоративных стрелок в тексте', () => {
  for (const f of pages) {
    const html = fs.readFileSync(path.join(DIR, f), 'utf8');
    // → (U+2192) и блок ➔–➿: стрелки скрапа. ← из «← В каталог» легальна.
    const arrows = html.match(/[→➔-➿]/g);
    assert.strictEqual(arrows, null, `${f}: видимая стрелка ${arrows && arrows[0]}`);
  }
});
