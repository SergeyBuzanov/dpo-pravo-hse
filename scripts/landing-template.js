#!/usr/bin/env node
/**
 * Правка лендинга: извлечение и обратная упаковка шаблона из index.html.
 *
 *   node scripts/landing-template.js extract            # достать шаблон
 *   node scripts/landing-template.js inject             # упаковать обратно
 *   node scripts/landing-template.js verify             # проверить цикл, ничего не меняя
 *
 * Зачем это нужно
 * ---------------
 * У лендинга нет отдельного исходника. Вся разметка и стили первого экрана
 * лежат внутри index.html (~1,3 МБ) одной строкой: это вывод визуального
 * сборщика, где шаблон закодирован как JSON-строка внутри
 * <script type="__bundler/template">. Править его в таком виде нельзя.
 *
 * Скрипт достаёт шаблон в обычный HTML-файл, который можно читать и
 * редактировать, и упаковывает обратно ровно так, как это делает сборщик.
 *
 * Главная тонкость экранирования
 * ------------------------------
 * Шаблон живёт внутри элемента <script>, поэтому literal "</script" закрыл
 * бы его раньше времени. Сборщик экранирует ТОЛЬКО эту последовательность.
 * Если экранировать каждый "</" (как напрашивается), цикл перестаёт быть
 * обратимым: файл меняется без единой смысловой правки. Проверяется
 * командой verify.
 *
 * Осторожно
 * ---------
 * inject перезаписывает index.html. Перед записью делается резервная копия
 * .index.html.bak. Реальный сценарий отказа здесь не «плохая разметка»
 * (JSON-кодирование переживает любую), а подсунутый не тот файл: пустой,
 * обрезанный редактором или просто чужой. Поэтому inject отказывается
 * записывать шаблон, резко меньше нынешнего, пока не передан --force.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'index.html');
const BACKUP = path.join(ROOT, '.index.html.bak');
const DEFAULT_WORK = path.join(ROOT, '.landing-template.html');

const OPEN = '<script type="__bundler/template">\n';
const CLOSE = '\n  </script>';

/** Границы закодированного шаблона внутри index.html. */
function bounds(src) {
  const open = src.indexOf(OPEN);
  if (open < 0) throw new Error('в index.html не найден <script type="__bundler/template">');
  const start = open + OPEN.length;
  const end = src.indexOf(CLOSE, start);
  if (end < 0) throw new Error('не найден конец блока шаблона');
  return { start, end };
}

/**
 * Теги, ради которых браузер лезет в сеть, ещё не разобрав документ.
 * Спекулятивный препарсер Chrome читает СЫРЫЕ байты внутри
 * <script type="__bundler/template"> – ему всё равно, что это JSON-строка,
 * а не разметка. Наткнувшись на `src=\"images/teachers/x.jpg\"`, он берёт
 * значение вместе с обратными слэшами и кавычками и просит
 * `/%22images/teachers/x.jpg/%22`. На каждой загрузке лендинга так уходило
 * 47 запросов, все с ответом 404 (замер 21.08.2026): мусор в логах nginx и
 * лишние round-trip у посетителя.
 *
 * Лечится тем, что препарсер перестаёт видеть сам тег: `<` у этих
 * элементов кодируется как <. JSON.parse в рантайме вернёт его
 * обратно, разметка не меняется. Экранируем только загружающие теги, а не
 * все `<` подряд: сплошное экранирование раздуло бы index.html примерно на
 * 75 КБ ради того же эффекта.
 */
const FETCHING_TAGS = /<(?=\/?(img|link|script|source|video|audio|iframe|embed|track|input|object)\b)/gi;

/**
 * Кодирует шаблон так же, как сборщик: экранируется "</script" (иначе
 * элемент закроется раньше времени) и открывающие скобки загружающих
 * тегов. Экранировать КАЖДОЕ "</" нельзя – цикл перестаёт быть обратимым,
 * это проверяет команда verify.
 */
function encode(html) {
  return JSON.stringify(html)
    .replace(/<\/script/gi, '<\\u002Fscript')
    .replace(FETCHING_TAGS, '\\u003C');
}

function readIndex() {
  if (!fs.existsSync(INDEX)) throw new Error('нет index.html');
  return fs.readFileSync(INDEX, 'utf8');
}

function extract(target) {
  const src = readIndex();
  const { start, end } = bounds(src);
  const html = JSON.parse(src.slice(start, end));
  fs.writeFileSync(target, html, 'utf8');
  console.log(`Шаблон извлечён: ${html.length} символов -> ${path.relative(ROOT, target)}`);
  return html;
}

/** Ниже этой доли от нынешнего размера шаблон считается подозрительным. */
const SHRINK_LIMIT = 0.5;

function inject(source, { force = false } = {}) {
  if (!fs.existsSync(source)) throw new Error('нет файла шаблона: ' + source);
  const src = readIndex();
  const { start, end } = bounds(src);
  const html = fs.readFileSync(source, 'utf8');

  if (!html.trim()) throw new Error('файл шаблона пуст, запись отменена');

  // Защита от подсунутого не того файла. Правки лендинга бывают крупными,
  // но вдвое шаблон не худеет – это признак обрезки или чужого файла.
  const current = JSON.parse(src.slice(start, end));
  if (!force && html.length < current.length * SHRINK_LIMIT) {
    throw new Error(
      `шаблон вдвое короче нынешнего (${html.length} против ${current.length} символов). ` +
        'Похоже на обрезанный или чужой файл. Если это правда задумано, добавьте --force',
    );
  }

  const next = src.slice(0, start) + encode(html) + src.slice(end);

  // Страховка от ошибки в самом кодировщике: результат обязан читаться назад.
  const check = bounds(next);
  try {
    const back = JSON.parse(next.slice(check.start, check.end));
    if (back !== html) throw new Error('содержимое после упаковки не совпало с исходным');
  } catch (err) {
    throw new Error('упаковка испорчена, запись отменена: ' + err.message);
  }

  fs.copyFileSync(INDEX, BACKUP);
  fs.writeFileSync(INDEX, next, 'utf8');
  console.log(
    `Шаблон упакован обратно. index.html: ${fs.statSync(INDEX).size} байт. ` +
      `Резервная копия: ${path.relative(ROOT, BACKUP)}`,
  );
}

/** Извлечь и упаковать без правок: результат обязан совпасть побайтово. */
function verify() {
  const before = readIndex();
  const { start, end } = bounds(before);
  const html = JSON.parse(before.slice(start, end));
  const after = before.slice(0, start) + encode(html) + before.slice(end);
  if (after === before) {
    console.log('Цикл обратим: извлечение и упаковка не меняют index.html.');
    return true;
  }
  let i = 0;
  while (i < Math.min(after.length, before.length) && after[i] === before[i]) i++;
  console.error('ЦИКЛ НЕ ОБРАТИМ: расхождение на позиции ' + i);
  console.error('  было:  ' + JSON.stringify(before.slice(i - 40, i + 40)));
  console.error('  стало: ' + JSON.stringify(after.slice(i - 40, i + 40)));
  process.exitCode = 1;
  return false;
}

function main() {
  const argv = process.argv.slice(2);
  const force = argv.includes('--force');
  const [mode, file] = argv.filter((a) => a !== '--force');
  const target = file ? path.resolve(process.cwd(), file) : DEFAULT_WORK;

  // Ошибки здесь ожидаемы и адресованы человеку: стек-трейс только мешает.
  const run = (fn) => {
    try {
      fn();
    } catch (err) {
      console.error('Ошибка: ' + err.message);
      process.exitCode = 1;
    }
  };

  if (mode === 'extract') run(() => extract(target));
  else if (mode === 'inject') run(() => inject(target, { force }));
  else if (mode === 'verify') run(verify);
  else {
    console.error('Использование: node scripts/landing-template.js extract|inject|verify [файл] [--force]');
    console.error('По умолчанию файл шаблона: ' + path.relative(ROOT, DEFAULT_WORK));
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { extract, inject, verify, encode, bounds };
