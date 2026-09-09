'use strict';

/**
 * Готовые ответы бота. Правило одно: бот цитирует сайт, а не пересказывает
 * его. Тест ловит расхождение – поменяли текст на сайте, ответ остался
 * старым.
 *
 * Составной ответ (`pk-vs-pp`) склеен из двух подписей переключателя
 * документов – они лежат в разных узлах разметки, а не в одном предложении.
 * Поэтому дословность проверяется по КАЖДОЙ строке `text` (перевод строки –
 * граница цитаты), а не по всей склейке разом: как есть, склейка целиком
 * никогда не встретится сайту одной подстрокой.
 *
 * `duration` не входит в `answers` и не хранит `text` вовсе – числа
 * считаются из `content/bot-catalog.json` в рантайме (js/support-bot.js) и
 * дословной цитаты, которую можно было бы сверить с разметкой, здесь просто
 * нет.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

/** Разметка index.html/privacy.html лежит JSON-строкой: кавычки и переводы экранированы. */
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

/**
 * Корпус сверки. С 09.09.2026 в него входят и СТРАНИЦЫ ПРОГРАММ: скидки,
 * налоговый вычет и документы для приёма перенесены с маркетплейса и
 * живут именно там, а не на лендинге. Ответ бота обязан оставаться
 * дословной цитатой сайта – меняется источник, а не правило.
 */
const PROGRAM_PAGES = fs
  .readdirSync(path.join(ROOT, 'programs'))
  .filter((f) => f.endsWith('.html'))
  .map((f) => plainText(path.join('programs', f)))
  .join(' ');

const CORPUS = plainText('index.html') + ' ' + plainText('privacy.html') + ' ' + PROGRAM_PAGES;
const FAQ = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'bot-faq.json'), 'utf8'));

const ANCHOR_RE = /^(index\.html|privacy\.html|Каталог программ\.html)(#[\w-]+)?$/;

test('ответы, пробелы в ответах и гейты заданы', () => {
  assert.ok(Array.isArray(FAQ.answers) && FAQ.answers.length > 0);
  assert.ok(Array.isArray(FAQ.gaps) && FAQ.gaps.length > 0);
  assert.ok(FAQ.duration && typeof FAQ.duration === 'object');
});

test('у каждого ответа, пробела и duration – свой устойчивый id', () => {
  const ids = FAQ.answers.map((a) => a.id)
    .concat(FAQ.gaps.map((g) => g.id))
    .concat([FAQ.duration.id]);
  assert.equal(new Set(ids).size, ids.length, 'id повторяются: ' + ids.join(', '));
});

test('каждый ответ – дословная цитата с сайта (по каждой строке text)', () => {
  for (const answer of FAQ.answers) {
    assert.equal(typeof answer.text, 'string', answer.id + ': нет text');
    const lines = answer.text.split('\n');
    for (const line of lines) {
      const needle = line.replace(/\s+/g, ' ').trim();
      assert.ok(needle.length > 0, answer.id + ': пустая строка цитаты');
      assert.ok(CORPUS.includes(needle), `${answer.id}: нет на сайте слово в слово: «${needle.slice(0, 60)}…»`);
    }
  }
});

test('duration не хранит текст строкой – он собирается из каталога в рантайме', () => {
  assert.equal(FAQ.duration.text, undefined, 'duration.text не должен существовать: числа устареют вместе с каталогом');
});

test('у каждого ответа и у duration есть якорь на существующую страницу', () => {
  for (const answer of FAQ.answers.concat([FAQ.duration])) {
    assert.match(answer.anchor, ANCHOR_RE, answer.id);
    const file = answer.anchor.split('#')[0];
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${answer.id}: нет файла ${file}`);
  }
});

test('слова-триггеры заданы и не пусты у ответов, пробелов и duration', () => {
  for (const answer of FAQ.answers.concat(FAQ.gaps).concat([FAQ.duration])) {
    assert.ok(Array.isArray(answer.triggers) && answer.triggers.length > 0, answer.id);
    for (const trigger of answer.triggers) {
      assert.ok(String(trigger).trim().length > 0, answer.id);
    }
  }
});

test('em dash в текстах и триггерах запрещён типографикой проекта', () => {
  for (const answer of FAQ.answers) {
    assert.equal(answer.text.includes('—'), false, answer.id);
  }
  for (const group of [FAQ.answers, FAQ.gaps, [FAQ.duration]]) {
    for (const answer of group) {
      for (const trigger of answer.triggers) {
        assert.equal(String(trigger).includes('—'), false, answer.id + ': ' + trigger);
      }
    }
  }
});

test('пробелы (gaps) не хранят цитату – бот честно отвечает «на сайте не написано»', () => {
  for (const gap of FAQ.gaps) {
    assert.equal(gap.text, undefined, gap.id);
  }
});

test('пояснение к ответу (note) выводится ботом и не притворяется цитатой', () => {
  const withNote = FAQ.answers.filter((a) => a.note);
  assert.ok(withNote.length > 0, 'ни у одного ответа нет пояснения – поле осталось мёртвым');
  const bot = fs.readFileSync(path.join(ROOT, 'js', 'support-bot.js'), 'utf8');
  assert.match(bot, /answer\.note/, 'бот не показывает пояснение – поле мёртвое');
  for (const a of withNote) {
    // Пояснение – НАША строка, а не цитата сайта: в корпусе её быть не
    // обязано, но и в text ей не место, иначе сверка цитат станет ложью.
    assert.ok(!a.text.includes(a.note), a.id + ': пояснение затекло в цитату');
  }
});

