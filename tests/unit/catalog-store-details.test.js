'use strict';

/**
 * Новые поля программы переживают запись в хранилище (09.09.2026).
 *
 * normalizeProgram собирает объект программы ПОИМЁННО и всё лишнее
 * отбрасывает: поле, которого нет в её списке, исчезает молча при первом
 * же обновлении каталога – из админки, из планировщика или из
 * `update-catalog.js`. Поэтому подтемы модулей, часы, язык, график,
 * условия оплаты, документы для приёма, преимущества и файлы обязаны
 * иметь свой нормализатор, а тест – ловить их пропажу.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const { normalizeProgram } = require(path.join(ROOT, 'lib', 'catalog-store.js'));

/** Прогоняет программу через ту же нормализацию, что и saveStore. */
function roundtrip(raw) {
  return normalizeProgram({ id: '123', title: 'Тестовая программа', url: 'https://www.hse.ru/edu/dpo/123', ...raw });
}

test('подтемы модулей не теряются при записи', () => {
  const p = roundtrip({ modules: [{ title: 'Модуль', hours: '10 ак. часов', topics: ['Первая тема', 'Вторая тема'] }] });
  assert.deepEqual(p.modules[0].topics, ['Первая тема', 'Вторая тема']);
});

test('часы, язык и график занятий не теряются', () => {
  const p = roundtrip({ hours: '68 часов', language: 'русский', schedule: 'среда, пятница 18:30 – 21:40' });
  assert.equal(p.hours, '68 часов');
  assert.equal(p.language, 'русский');
  assert.equal(p.schedule, 'среда, пятница 18:30 – 21:40');
});

test('условия оплаты, документы для приёма и преимущества не теряются', () => {
  const p = roundtrip({
    taxRefund: '7 150 рублей',
    discounts: ['Скидки 5-10% студентам', 'Скидки для юридических лиц'],
    admissionDocs: ['Паспорт', 'Диплом об образовании'],
    advantages: ['Экспертные знания', 'Практика на кейсах'],
  });
  assert.equal(p.taxRefund, '7 150 рублей');
  assert.equal(p.discounts.length, 2);
  assert.equal(p.admissionDocs.length, 2);
  assert.equal(p.advantages.length, 2);
});

test('файлы: свой путь обязателен, чужой отбрасывается', () => {
  const p = roundtrip({
    files: [
      { kind: 'plan', title: 'Учебный план', size: '90,7 Кб', url: 'https://www.hse.ru/pubs/share/folder/aa/1.pdf', path: 'files/123-plan.pdf' },
      { kind: 'schedule', title: 'Расписание', size: '299,6 Кб', url: 'https://www.hse.ru/pubs/share/folder/bb/2.pdf', path: '../../etc/passwd' },
      { kind: 'plan', title: 'Второй план', url: 'https://example.com/x.pdf', path: 'files/123-plan2.pdf' },
    ],
  });
  assert.equal(p.files.length, 1, 'чужой домен или путь вне files/ пропускать нельзя');
  assert.equal(p.files[0].path, 'files/123-plan.pdf');
  assert.equal(p.files[0].kind, 'plan');
});

test('пустое остаётся пустым, а не превращается в пустые списки', () => {
  const p = roundtrip({});
  assert.equal(p.hours, null);
  assert.equal(p.discounts, null);
  assert.equal(p.files, null);
});

test('«Важно» и вопросы-ответы переживают запись', () => {
  const p = roundtrip({
    notice: { date: '10.04.2026', text: 'Запись вебинара', url: 'https://my.mts-link.ru/j/1/2/record' },
    faq: [{ q: 'В каком формате занятия?', a: 'Доступ к курсу на платформе' }],
  });
  assert.equal(p.notice.date, '10.04.2026');
  assert.equal(p.notice.url, 'https://my.mts-link.ru/j/1/2/record');
  assert.equal(p.faq.length, 1);
});

test('ссылка «Важно» только по https, мусор отбрасывается', () => {
  const insecure = roundtrip({ notice: { text: 'Объявление', url: 'http://example.com/x' } });
  assert.equal(insecure.notice.url, null, 'http-ссылка не должна сохраняться');
  const broken = roundtrip({ notice: { text: 'Объявление', url: 'javascript:alert(1)' } });
  assert.equal(broken.notice.url, null, 'схема javascript: не должна сохраняться');
  const empty = roundtrip({ notice: { date: '01.01.2026', url: 'https://ok.example/1' } });
  assert.equal(empty.notice, null, 'объявление без текста бессмысленно');
});

