'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseApplication, displayName, SOURCES } = require('../../lib/application-form');

const valid = () => ({
  firstName: 'Анна',
  lastName: 'Петрова',
  phone: '+7 (999) 123-45-67',
  email: 'anna@example.org',
  consent: true,
});

const fieldsOf = (res) => res.errors.map((e) => e.field);

test('полная заявка принимается', () => {
  const res = parseApplication({ ...valid(), position: 'Юрист', company: 'ООО «Ромашка»' });
  assert.equal(res.ok, true);
  assert.equal(res.application.firstName, 'Анна');
  assert.equal(res.application.position, 'Юрист');
});

test('без согласия заявка не принимается', () => {
  const res = parseApplication({ ...valid(), consent: false });
  assert.equal(res.ok, false);
  assert.deepEqual(fieldsOf(res), ['consent']);
});

test('согласие приходит строкой "on" из обычной формы', () => {
  const res = parseApplication({ ...valid(), consent: 'on' });
  assert.equal(res.ok, true);
});

test('обязательные поля перечисляются все сразу, а не по одному', () => {
  const res = parseApplication({ consent: true });
  assert.equal(res.ok, false);
  assert.deepEqual(fieldsOf(res).sort(), ['email', 'firstName', 'lastName', 'phone']);
});

test('телефон: короткий номер отвергается', () => {
  const res = parseApplication({ ...valid(), phone: '12345' });
  assert.deepEqual(fieldsOf(res), ['phone']);
});

test('телефон: буквы отвергаются', () => {
  const res = parseApplication({ ...valid(), phone: '+7 999 ЗВОНИТЕ' });
  assert.deepEqual(fieldsOf(res), ['phone']);
});

test('телефон сохраняется как ввёл человек, без нормализации', () => {
  const res = parseApplication({ ...valid(), phone: '8 (812) 555-00-11' });
  assert.equal(res.application.phone, '8 (812) 555-00-11');
});

test('иностранный номер проходит', () => {
  const res = parseApplication({ ...valid(), phone: '+49 30 901820' });
  assert.equal(res.ok, true);
});

test('почта без собаки отвергается', () => {
  const res = parseApplication({ ...valid(), email: 'anna.example.org' });
  assert.deepEqual(fieldsOf(res), ['email']);
});

test('почта с плюсом и поддоменом проходит', () => {
  const res = parseApplication({ ...valid(), email: 'anna+dpo@mail.hse.ru' });
  assert.equal(res.ok, true);
});

test('источники: чужие значения выбрасываются, дубли схлопываются', () => {
  const res = parseApplication({
    ...valid(),
    sources: ['telegram', 'telegram', 'подслушал', '__proto__'],
  });
  assert.deepEqual(res.application.sources, ['telegram']);
});

test('свободный ввод источника сохраняется только вместе с «другое»', () => {
  const withOther = parseApplication({ ...valid(), sources: ['other'], sourceOther: 'от коллеги' });
  assert.equal(withOther.application.sourceOther, 'от коллеги');

  const withoutOther = parseApplication({ ...valid(), sources: ['search'], sourceOther: 'от коллеги' });
  assert.equal(withoutOther.application.sourceOther, '');
});

test('все девять источников из формы маркетплейса распознаются', () => {
  const res = parseApplication({ ...valid(), sources: [...SOURCES] });
  assert.equal(res.application.sources.length, 9);
});

test('поля вне схемы не попадают в заявку', () => {
  const res = parseApplication({ ...valid(), salary: 300000, isAdmin: true });
  assert.equal(res.ok, true);
  assert.equal('salary' in res.application, false);
  assert.equal('isAdmin' in res.application, false);
});

test('пробелы схлопываются, длина обрезается', () => {
  const res = parseApplication({ ...valid(), firstName: '  Анна   Мария  ', company: 'К'.repeat(300) });
  assert.equal(res.application.firstName, 'Анна Мария');
  assert.equal(res.application.company.length, 160);
});

test('в комментарии переводы строк сохраняются', () => {
  const res = parseApplication({ ...valid(), comment: 'Первая строка\r\n\r\n\r\nВторая' });
  assert.equal(res.application.comment, 'Первая строка\n\nВторая');
});

test('отказ от рассылки — это отказ, а не согласие', () => {
  assert.equal(parseApplication(valid()).application.noAnnouncements, false);
  assert.equal(parseApplication({ ...valid(), noAnnouncements: true }).application.noAnnouncements, true);
});

test('контекст программы сохраняется', () => {
  const res = parseApplication({
    ...valid(),
    programId: '958734693',
    programTitle: 'Актуальные вопросы гражданского права',
    programUrl: 'https://example.com/programs/x.html',
  });
  assert.equal(res.application.program.id, '958734693');
  assert.equal(res.application.program.title, 'Актуальные вопросы гражданского права');
});

test('мусор вместо тела не роняет разбор', () => {
  for (const bad of [null, undefined, 'строка', 42, []]) {
    const res = parseApplication(bad);
    assert.equal(res.ok, false);
    assert.ok(res.errors.length > 0);
  }
});

test('время получения проставляется в ISO', () => {
  const res = parseApplication(valid(), { now: Date.UTC(2026, 7, 16, 12, 0, 0) });
  assert.equal(res.application.receivedAt, '2026-08-16T12:00:00.000Z');
});

test('имя для темы письма — фамилия и имя', () => {
  assert.equal(displayName(parseApplication(valid()).application), 'Петрова Анна');
});

// ---- Корпоративная заявка (01.09.2026, последний пункт критики 28/40) ----

test('корпоративная заявка сохраняет число сотрудников и сроки', () => {
  const res = parseApplication({
    ...valid(),
    applicantType: 'corporate',
    employeesCount: '10–15',
    timeframe: 'октябрь – декабрь 2026',
  });
  assert.equal(res.ok, true);
  assert.equal(res.application.applicantType, 'corporate');
  assert.equal(res.application.employeesCount, '10–15');
  assert.equal(res.application.timeframe, 'октябрь – декабрь 2026');
});

test('личная заявка отбрасывает корпоративные поля, даже если их прислали', () => {
  const res = parseApplication({
    ...valid(),
    applicantType: 'personal',
    employeesCount: '8',
    timeframe: 'октябрь',
  });
  assert.equal(res.application.applicantType, 'personal');
  assert.equal(res.application.employeesCount, '');
  assert.equal(res.application.timeframe, '');
});

test('неизвестный или отсутствующий тип заявителя сводится к personal', () => {
  assert.equal(parseApplication(valid()).application.applicantType, 'personal');
  assert.equal(
    parseApplication({ ...valid(), applicantType: 'martian' }).application.applicantType,
    'personal',
  );
});

test('корпоративные поля обрезаются по лимитам, а не отбрасываются', () => {
  const res = parseApplication({
    ...valid(),
    applicantType: 'corporate',
    employeesCount: '9'.repeat(100),
    timeframe: 'x'.repeat(500),
  });
  assert.equal(res.application.employeesCount.length, 40);
  assert.equal(res.application.timeframe.length, 200);
});
