const test = require('node:test');
const assert = require('node:assert');
const { parseApplication } = require('../../lib/application-form');
const { formatLetter, TOPIC_LABELS } = require('../../lib/application-delivery');

const valid = {
  firstName: 'Иван',
  lastName: 'Петров',
  phone: '+7 (495) 123-45-67',
  email: 'ivan@example.org',
  consent: true,
};

test('тема обращения сохраняется в заявке', () => {
  const r = parseApplication({ ...valid, topic: 'course-idea' });
  assert.ok(r.ok);
  assert.equal(r.application.topic, 'course-idea');
});

test('неизвестная или пустая тема сводится к заявке на программу', () => {
  assert.equal(parseApplication({ ...valid, topic: 'взлом' }).application.topic, 'program');
  assert.equal(parseApplication(valid).application.topic, 'program');
});

test('письмо обращения начинается с темы, а не с «программа не указана»', () => {
  const r = parseApplication({ ...valid, topic: 'feedback' });
  const letter = formatLetter(r.application, 'X-1');
  assert.match(letter, /^Тема обращения: /);
  assert.ok(letter.includes(TOPIC_LABELS.feedback));
  assert.ok(!letter.includes('программа не указана'));
});

test('письмо заявки на программу не изменилось', () => {
  const r = parseApplication({ ...valid, programTitle: 'Транспортное право' });
  const letter = formatLetter(r.application, 'X-2');
  assert.match(letter, /^Заявка на программу: Транспортное право/);
});
