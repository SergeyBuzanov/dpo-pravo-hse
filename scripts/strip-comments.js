#!/usr/bin/env node
/**
 * Сжатие наших js для публичной выкладки: снимаются комментарии и отступы.
 *
 *   node scripts/strip-comments.js js/nav-menu.js     # напечатать результат
 *   node scripts/strip-comments.js --report           # что даст по всем файлам
 *
 * Зачем именно так
 * ----------------
 * Код проекта прокомментирован плотно и по делу – это его свойство, менять
 * его ради веса нельзя. Но посетителю комментарии не нужны: в js/ лендинга
 * их больше половины байт.
 *
 * Настоящий минификатор (переименование, склейка выражений) сюда не годится:
 * это была бы npm-зависимость в проекте, где их нет, либо свой компилятор,
 * который однажды тихо сломает страницу. Снятие комментариев и отступов –
 * преобразование, которое можно проверить целиком: набор литералов до и
 * после обязан совпасть до символа, а результат – разбираться как JS.
 *
 * Разбор
 * ------
 * Наивная регулярка на комментарии режет строки и регулярные выражения
 * («http://…» внутри строки, CSS `/* … *\/` внутри шаблонной строки – в
 * channel-invite.js их полно). Поэтому здесь честный посимвольный проход по
 * состояниям: строки, шаблонные строки со вложенными ${}, регулярные
 * выражения. Деление от начала регулярного выражения отличается по
 * ПРЕДЫДУЩЕЙ значащей лексеме – после `)`, `]`, имени, числа и `}` идёт
 * деление, во всех остальных случаях регулярное выражение.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** Символы, после которых `/` – это деление, а не начало регулярки. */
const DIV_AFTER = /[\w$)\]]/;
/** Ключевые слова, после которых `/` всё-таки начинает регулярное выражение. */
const KEYWORDS_BEFORE_REGEX = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'case', 'do', 'else', 'yield', 'await', 'throw',
]);

/**
 * Разбирает исходник на куски: код, комментарии и литералы. Литералы
 * возвращаются отдельно – по ним сверяется, что разбор не поехал.
 */
function scan(src) {
  const out = [];
  const literals = [];
  let i = 0;
  let chunk = '';
  // Последняя значащая лексема – по ней отличается деление от регулярки.
  let prev = '';

  const flush = () => {
    if (chunk) out.push({ type: 'code', text: chunk });
    chunk = '';
  };
  // Литерал – отдельный кусок: отступы внутри строки трогать нельзя,
  // а в общем куске кода они снимаются.
  const pushLiteral = (text) => {
    flush();
    out.push({ type: 'literal', text });
    literals.push(text);
    prev = 'литерал';
  };
  const takeUntil = (end, escaped) => {
    const start = i;
    i += end.length === 1 ? 1 : end.length;
    while (i < src.length) {
      if (escaped && src[i] === '\\') { i += 2; continue; }
      if (src.startsWith(end, i)) { i += end.length; return src.slice(start, i); }
      i++;
    }
    return src.slice(start);
  };

  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];

    if (c === '/' && next === '/') {
      flush();
      const start = i;
      while (i < src.length && src[i] !== '\n') i++;
      out.push({ type: 'comment', text: src.slice(start, i) });
      continue;
    }
    if (c === '/' && next === '*') {
      flush();
      const start = i;
      i += 2;
      while (i < src.length && !src.startsWith('*/', i)) i++;
      i += 2;
      out.push({ type: 'comment', text: src.slice(start, i) });
      continue;
    }
    if (c === '"' || c === "'") {
      const text = takeUntil(c, true);
      pushLiteral(text);
      continue;
    }
    if (c === '`') {
      // Шаблонная строка. Внутри ${…} снова обычный код: там бывают строки
      // с фигурными скобками и вложенные шаблонные строки, поэтому состояние
      // держится стопкой, а не счётчиком.
      const start = i;
      i++;
      const stack = [{ tpl: true, depth: 0 }];
      while (i < src.length && stack.length) {
        const top = stack[stack.length - 1];
        const ch = src[i];
        if (ch === '\\') { i += 2; continue; }
        if (top.tpl) {
          if (ch === '`') { stack.pop(); i++; continue; }
          if (ch === '$' && src[i + 1] === '{') { stack.push({ tpl: false, depth: 1 }); i += 2; continue; }
          i++;
          continue;
        }
        if (ch === '`') { stack.push({ tpl: true, depth: 0 }); i++; continue; }
        if (ch === '"' || ch === "'") {
          i++;
          while (i < src.length && src[i] !== ch) i += src[i] === '\\' ? 2 : 1;
          i++;
          continue;
        }
        if (ch === '{') { top.depth++; i++; continue; }
        if (ch === '}') { top.depth--; if (top.depth === 0) stack.pop(); i++; continue; }
        i++;
      }
      pushLiteral(src.slice(start, i));
      continue;
    }
    if (c === '/') {
      const word = /[\w$]+$/.exec(prev);
      const isRegex = !DIV_AFTER.test(prev.slice(-1)) || (word && KEYWORDS_BEFORE_REGEX.has(word[0]));
      if (isRegex) {
        const start = i;
        i++;
        let inClass = false;
        while (i < src.length) {
          if (src[i] === '\\') { i += 2; continue; }
          if (src[i] === '[') inClass = true;
          else if (src[i] === ']') inClass = false;
          else if (src[i] === '/' && !inClass) { i++; break; }
          else if (src[i] === '\n') break; // не регулярка – спасаемся
          i++;
        }
        while (i < src.length && /[a-z]/.test(src[i])) i++; // флаги
        pushLiteral(src.slice(start, i));
        continue;
      }
    }
    chunk += c;
    if (!/\s/.test(c)) prev += c;
    if (prev.length > 40) prev = prev.slice(-20);
    i++;
  }
  flush();
  return { parts: out, literals };
}

/**
 * Снимает комментарии и отступы. Переводы строк СОХРАНЯЮТСЯ: без них
 * пришлось бы расставлять точки с запятой за автоподстановкой, а это уже
 * компилятор, а не чистка.
 */
function strip(src) {
  if (src.includes('\u0000')) throw new Error('в исходнике есть \\u0000 – метка литерала занята');
  const { parts } = scan(src);
  const kept = [];
  let out = '';
  for (const p of parts) {
    // Комментарий превращается в перевод строки, если он его содержал:
    // иначе `a = b // c\n + d` склеится в одну строку и сменит смысл.
    if (p.type === 'comment') { if (p.text.includes('\n')) out += '\n'; continue; }
    // Литерал уходит под метку: снятие отступов не должно менять текст
    // внутри многострочной строки (в smooth-ui.js там лежит CSS).
    if (p.type === 'literal') { out += '\u0000' + kept.push(p.text) + '\u0000'; continue; }
    out += p.text;
  }
  return out
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, '').replace(/^[ \t]+/, ''))
    .filter((line) => line !== '')
    .join('\n')
    .replace(/\u0000(\d+)\u0000/g, (_, n) => kept[n - 1]) + '\n';
}

/** Сверка: литералы обязаны совпасть до символа, иначе разбор поехал. */
function sameLiterals(a, b) {
  const la = scan(a).literals;
  const lb = scan(b).literals;
  if (la.length !== lb.length) return `литералов было ${la.length}, стало ${lb.length}`;
  for (let n = 0; n < la.length; n++) {
    if (la[n] !== lb[n]) return `литерал ${n} изменился: ${la[n].slice(0, 60)}`;
  }
  return null;
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  if (argv[0] === '--report') {
    const dir = path.join(__dirname, '..', 'js');
    let was = 0;
    let now = 0;
    for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort()) {
      const src = fs.readFileSync(path.join(dir, name), 'utf8');
      const out = strip(src);
      const err = sameLiterals(src, out);
      was += Buffer.byteLength(src);
      now += Buffer.byteLength(out);
      const kb = (n) => (n / 1024).toFixed(1);
      console.log(
        `${name.padEnd(22)} ${kb(Buffer.byteLength(src)).padStart(6)} → ${kb(Buffer.byteLength(out)).padStart(6)} КБ` +
        (err ? `   РАЗБОР ПОЕХАЛ: ${err}` : '')
      );
    }
    console.log(`${'ИТОГО'.padEnd(22)} ${(was / 1024).toFixed(1).padStart(6)} → ${(now / 1024).toFixed(1).padStart(6)} КБ`);
  } else if (argv[0]) {
    process.stdout.write(strip(fs.readFileSync(argv[0], 'utf8')));
  } else {
    console.error('Укажите файл или --report');
    process.exit(1);
  }
}

module.exports = { strip, scan, sameLiterals };
