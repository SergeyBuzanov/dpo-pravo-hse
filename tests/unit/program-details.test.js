'use strict';

/**
 * Разбор страницы программы hse.ru: то, чего у нас не было до 09.09.2026.
 *
 * Разведка по всем 26 страницам показала, что у нас не хранится: подтемы
 * модулей (880 строк на 19 программах), объём в академических часах
 * (22/26), язык обучения (22/26), график занятий (4/26), документы для
 * приёма (25/26), преимущества (~25/26), скидки, сумма налогового вычета
 * и приложенные файлы – учебный план (26/26) и расписание (12/26).
 *
 * Тест разбирает УРЕЗАННУЮ КОПИЮ настоящей страницы
 * (tests/fixtures/hse-program-page.html, программа «Цифровое право для
 * бизнеса»), а не выдуманную разметку: на выдуманных страницах разбор
 * всегда зелёный, а на живых ломается – этот урок уже стоил дня на боте.
 *
 * Фикстуру обновлять, когда hse.ru сменит вёрстку: она и есть контракт.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const { extractDetails } = require(path.join(ROOT, 'scripts', 'fetch-program-descriptions.js'));
const FIXTURE = fs.readFileSync(path.join(ROOT, 'tests/fixtures/hse-program-page.html'), 'utf8');

const d = extractDetails(FIXTURE);

test('подтемы модулей разбираются вместе с названиями и часами', () => {
  assert.ok(d.modules && d.modules.length >= 2, 'модули не найдены');
  const first = d.modules[0];
  assert.match(first.title, /Общие вопросы цифрового права/);
  assert.equal(first.hours, '10 ак. часов');
  assert.deepEqual(first.topics.slice(0, 2), ['Что такое цифровое право', 'Основные источники цифрового права']);
  assert.ok(d.modules.some((m) => m.topics && m.topics.length), 'подтемы потеряны');
});

test('блок «Формат обучения»: часы, язык и график занятий', () => {
  assert.equal(d.hours, '68 часов');
  assert.equal(d.language, 'русский');
  assert.match(d.schedule, /среда, пятница 18:30/);
});

test('стоимость: сумма налогового вычета и скидки', () => {
  assert.match(d.taxRefund, /7\s?150/);
  assert.ok(d.discounts.length >= 2, 'скидки не разобраны');
  assert.ok(d.discounts.some((s) => /студентам/.test(s)), 'скидка студентам потеряна');
  assert.ok(d.discounts.some((s) => /юридических лиц/.test(s)), 'скидка юрлицам потеряна');
  // Кнопки внутри блока в текст скидки попадать не должны.
  assert.ok(!d.discounts.some((s) => /Подать заявку|Задать вопрос/.test(s)), 'в скидку затекла кнопка');
});

test('документы для приёма и преимущества', () => {
  assert.ok(d.admissionDocs.length >= 3, 'документы для приёма не разобраны');
  assert.ok(d.admissionDocs.some((s) => /Паспорт/.test(s)));
  // Окно разбора добирало до блока контактов, и в документы для приёма
  // попадали адрес центра и почта (16 и 14 раз по каталогу).
  assert.ok(!d.admissionDocs.some((s) => /@hse\.ru|переулок|Москва/.test(s)), 'в документы затекли контакты');
  assert.ok(d.advantages.length >= 2, 'преимущества не разобраны');
  assert.ok(d.advantages.every((s) => !/^\d\d$/.test(s)), 'нумерация 01/02 попала в текст как отдельный пункт');
  // На живом каталоге разбор по слову «Преимущества» приносил из шапки
  // «Преподаватели» и «Старт курса»: слово стоит ещё и в оглавлении
  // страницы. Фикстура содержит оглавление, чтобы ловушка повторилась.
  assert.match(d.advantages[0], /Экспертные знания/);
  assert.ok(!d.advantages.some((s) => /^(Преподаватели|Старт курса)/.test(s)), 'в преимущества затекло оглавление страницы');
});

test('файлы программы: учебный план и расписание с размером', () => {
  const kinds = d.files.map((f) => f.kind).sort();
  assert.deepEqual(kinds, ['plan', 'schedule'], 'разобраны не оба файла');
  const plan = d.files.find((f) => f.kind === 'plan');
  assert.match(plan.url, /^https:\/\/www\.hse\.ru\//, 'ссылка на файл не с hse.ru');
  assert.match(plan.url, /\.pdf$/);
  assert.equal(plan.size, '90,7 Кб');
  assert.equal(plan.title, 'Учебный план');
  // Руководства пользователя личного кабинета – общие для всего сайта,
  // к программе отношения не имеют и попадать в файлы не должны.
  assert.ok(!d.files.some((f) => /Руководство пользователя/.test(f.title)));
});

test('блок «Важно»: дата, текст и ссылка на запись', () => {
  assert.ok(d.notice, 'блок «Важно» не разобран');
  assert.equal(d.notice.date, '10.04.2026');
  assert.match(d.notice.text, /Запись вебинара Елены Авакян/);
  // Ссылка ведёт на ЧУЖОЙ домен (площадка вебинара), и это законно: адрес
  // хранится только если он https, а на странице рядом с ним показывается
  // хост – человек видит, куда уходит.
  assert.match(d.notice.url, /^https:\/\//);
});

test('вопросы и ответы страницы разбираются отдельно от учебного плана', () => {
  assert.ok(d.faq.length >= 2, 'FAQ не разобран');
  assert.match(d.faq[0].q, /В каком формате организованы занятия\?/);
  assert.match(d.faq[0].a, /iSpring|доступ/);
  // Тот же аккордеон, что у плана, но с модификатором _faq: вопросы не
  // должны попадать в модули, а модули – в вопросы.
  assert.ok(!d.modules.some((m) => /\?$/.test(m.title)), 'вопрос затёк в учебный план');
  assert.ok(d.faq.every((x) => x.q && x.a), 'вопрос без ответа');
});

