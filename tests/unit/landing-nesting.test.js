const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { bounds } = require('../../scripts/landing-template');

// Вложенность разметки лендинга: <div> должны закрываться в том же порядке,
// в каком открылись, а все секции обязаны лежать ВНУТРИ .dpo-scope.
//
// Зачем отдельная проверка. Переменные темы (--dpo-accent, --dpo-radius-*)
// объявлены инлайновым стилем на .dpo-scope, и наследуются вниз по дереву.
// Один лишний </div> закрывает контейнер раньше времени, секции оказываются
// СНАРУЖИ scope, и каждое `var(--dpo-accent)` без запасного значения молча
// превращается в ничто: заливная кнопка становится белым текстом на белом
// фоне, рамка исчезает. Ровно это произошло 25.08.2026 при замене карточек
// преимуществ на список – страница выглядела целой, высоты мерились
// правильно, обе тестовые команды были зелёными, а кнопка «Пройти опрос»
// и обе кнопки блока «Помогите нам стать лучше» стали невидимы.
//
// Браузер такую разметку молча чинит своим разбором, поэтому дефект и не
// виден до замера вычисленных стилей. Проверка идёт по исходному тексту.

const INDEX = path.join(__dirname, '..', '..', 'index.html');

/** Разметка лендинга лежит JSON-строкой внутри <script type="__bundler/template">. */
function landingMarkup() {
  const src = fs.readFileSync(INDEX, 'utf8');
  const { start, end } = bounds(src);
  return JSON.parse(src.slice(start, end));
}

/**
 * Убирает то, внутри чего «теги» тегами не являются: комментарии, стили и
 * скрипты. В блоке данных лендинга лежат тексты заказчика, в комментариях –
 * названия тегов, и без вычистки они попадут в разбор.
 */
function stripNonMarkup(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
}

/** Открывающие и закрывающие div/section по порядку появления. */
function tagStream(html) {
  const re = /<(\/?)(div|section)\b([^>]*)>/gi;
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    out.push({ closing: m[1] === '/', tag: m[2].toLowerCase(), attrs: m[3] || '', at: m.index });
  }
  return out;
}

test('div и section лендинга закрываются в правильном порядке', () => {
  const html = stripNonMarkup(landingMarkup());
  const stack = [];
  for (const t of tagStream(html)) {
    if (!t.closing) {
      stack.push(t);
      continue;
    }
    const open = stack.pop();
    assert.ok(open, `лишний </${t.tag}> на позиции ${t.at}: закрывать нечего`);
    assert.strictEqual(
      open.tag,
      t.tag,
      `</${t.tag}> на позиции ${t.at} закрывает <${open.tag}>, открытый на ${open.at}`,
    );
  }
  assert.deepStrictEqual(
    stack.map((t) => `<${t.tag}> на ${t.at}`),
    [],
    'остались незакрытые элементы',
  );
});

test('все секции лежат внутри .dpo-scope – иначе переменные темы не наследуются', () => {
  const html = stripNonMarkup(landingMarkup());
  const stack = [];
  let sections = 0;
  let outside = [];
  for (const t of tagStream(html)) {
    if (t.closing) {
      stack.pop();
      continue;
    }
    if (t.tag === 'section') {
      sections += 1;
      const inScope = stack.some((o) => /class="[^"]*\bdpo-scope\b/.test(o.attrs));
      if (!inScope) outside.push(t.at);
    }
    stack.push(t);
  }
  assert.ok(sections >= 10, `секций найдено ${sections}, ожидалось не меньше десяти`);
  assert.deepStrictEqual(outside, [], `секции вне .dpo-scope на позициях: ${outside.join(', ')}`);
});
