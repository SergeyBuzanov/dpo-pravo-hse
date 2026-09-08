'use strict';

/**
 * Логика подбора ответа бота поддержки (js/bot-reply.js) – независимое
 * ревью 08.09.2026 живыми прогонами в браузере нашло то, что живые прогоны
 * без теста пропускали: три кнопки-подсказки из пяти отвечали «Такого не
 * нашла», программы шли впереди готового ответа («персональные данные»
 * уходило в программу вместо цитаты политики), а слабое совпадение
 * («банкротство» -> 2 из 3 карточек про налоги и исламские финансы)
 * подавалось как уверенное «Вот что нашла». Этот файл держит логику под
 * тестом на настоящих данных проекта, а не на выдуманных примерах.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const DpoBotReply = require(path.join(ROOT, 'js', 'bot-reply.js'));
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'bot-catalog.json'), 'utf8'));
const faq = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'bot-faq.json'), 'utf8'));

const data = { programs: catalog.programs, answers: faq.answers, gaps: faq.gaps, duration: faq.duration };

const NOT_FOUND_KINDS = ['none'];

test('данные каталога и faq заряжены (проверка самого фикстура)', () => {
  assert.ok(data.programs.length > 20);
  assert.ok(data.answers.length > 0);
});

// ---- CRITICAL 1: пять кнопок-подсказок не отвечают «не нашла» ----------

test('«Подобрать программу»: сферы и типы каталога дают непустой выбор и непустой результат', () => {
  const spheres = DpoBotReply.sphereList(data.programs);
  assert.ok(spheres.length >= 2, 'сфер меньше двух – выбирать не из чего');
  for (const sphere of spheres) {
    assert.ok(DpoBotReply.pickBy(data.programs, 'sphere', sphere).length > 0, sphere);
  }
  assert.ok(DpoBotReply.pickBy(data.programs, 'type', 'ПК').length > 0);
  assert.ok(DpoBotReply.pickBy(data.programs, 'type', 'ПП').length > 0);
});

test('«Онлайн»: подбор программ, не готовый ответ, не пусто', () => {
  const out = DpoBotReply.reply('Онлайн', data);
  assert.equal(out.kind, 'programs');
  assert.ok(out.programs.length > 0);
  assert.equal(
    catalog.programs.filter((p) => p.format === 'online').length,
    15,
    'если каталог изменился, поправь сам ассерт, а не просто число здесь',
  );
});

test('«Какой документ выдают»: готовый ответ, не пусто', () => {
  const out = DpoBotReply.reply('Какой документ выдают', data);
  assert.equal(out.kind, 'answer');
  assert.equal(out.answer.id, 'document');
});

test('«Ближайшие старты»: пять ближайших по датам, не пусто', () => {
  const list = DpoBotReply.upcoming(data.programs, 5).filter((p) => p.startIso || p.start);
  assert.ok(list.length > 0, 'ни у одной программы нет даты старта – проверь фикстуру');
  for (let i = 1; i < list.length; i++) {
    if (list[i - 1].startIso && list[i].startIso) {
      assert.ok(list[i - 1].startIso <= list[i].startIso, 'даты не по возрастанию');
    }
  }
});

test('«Сколько стоит»: диапазон цен посчитан из каталога, не выдуман', () => {
  const range = DpoBotReply.priceRange(data.programs);
  assert.ok(range, 'диапазон не посчитан');
  assert.ok(range.min > 0 && range.max > range.min);
  assert.equal(DpoBotReply.formatPrice(22000), '22 000 ₽');
});

test('ни одна из пяти подсказок не даёт пустой/отвергающий результат', () => {
  assert.notEqual(DpoBotReply.reply('Онлайн', data).kind, 'none');
  assert.notEqual(DpoBotReply.reply('Какой документ выдают', data).kind, 'none');
  assert.ok(DpoBotReply.sphereList(data.programs).length > 0);
  assert.ok(DpoBotReply.upcoming(data.programs, 5).some((p) => p.startIso || p.start));
  assert.ok(DpoBotReply.priceRange(data.programs));
});

// ---- IMPORTANT 6: готовый ответ раньше подбора программ + порог силы ---

test('«персональные данные» -> цитата политики, программа – вторым планом', () => {
  const out = DpoBotReply.reply('персональные данные', data);
  assert.equal(out.kind, 'answer');
  assert.equal(out.answer.id, 'privacy');
  assert.ok(out.extra && out.extra.length, 'программа должна остаться – но не вместо цитаты');
});

test('«пк и пп в чём разница» -> готовый ответ, без случайного списка ПК-программ', () => {
  const out = DpoBotReply.reply('пк и пп в чём разница', data);
  assert.equal(out.kind, 'answer');
  assert.equal(out.answer.id, 'pk-vs-pp');
  assert.ok(!out.extra, 'filter-совпадение (спутанный тип из аббревиатуры) не должно цепляться довеском');
});

test('«можно без юридического образования» -> готовый ответ', () => {
  const out = DpoBotReply.reply('можно без юридического образования', data);
  assert.equal(out.kind, 'answer');
  assert.equal(out.answer.id, 'no-legal-background');
});

test('«банкротство»: слабые совпадения (налоги, исламские финансы) не подаются как «вот что нашла»', () => {
  const out = DpoBotReply.reply('банкротство', data);
  assert.equal(out.kind, 'programs');
  assert.equal(out.programs.length, 1);
  assert.match(out.programs[0].title, /банкротств/i);
});

test('«налоги»: то же самое', () => {
  const out = DpoBotReply.reply('налоги', data);
  assert.equal(out.kind, 'programs');
  assert.equal(out.programs.length, 1);
  assert.match(out.programs[0].title, /налог/i);
});

test('«договор»: ни у одной программы нет слова в названии – честно «близкое по теме»', () => {
  const out = DpoBotReply.reply('договор', data);
  assert.equal(out.kind, 'programs-weak');
  assert.ok(out.programs.length > 0);
});

test('«права»: сильных совпадений много – «вот что нашла» остаётся', () => {
  const out = DpoBotReply.reply('права', data);
  assert.equal(out.kind, 'programs');
  assert.equal(out.intro, 'Вот что нашла:');
});

test('оплата остаётся честным пробелом (gap), не программой', () => {
  const out = DpoBotReply.reply('оплата', data);
  assert.equal(out.kind, 'gap');
  assert.equal(out.gap.id, 'payment');
});

// ---- CRITICAL 2 / IMPORTANT 3: очередь действий до прихода данных ------

test('очередь: действие до resolve не выполняется и не падает', () => {
  const q = DpoBotReply.createActionQueue();
  let ran = false;
  const status = q.run(() => { ran = true; }, null);
  assert.equal(status, 'queued');
  assert.equal(ran, false);
  assert.equal(q.isEmpty(), false);
});

test('очередь: resolve выполняет все накопленные действия с данными', () => {
  const q = DpoBotReply.createActionQueue();
  const seen = [];
  q.run((d) => seen.push(d), null);
  q.run((d) => seen.push(d), null);
  const n = q.resolve({ ok: true });
  assert.equal(n, 2);
  assert.deepEqual(seen, [{ ok: true }, { ok: true }]);
  assert.equal(q.isEmpty(), true);
});

test('очередь: run после resolve выполняется сразу же, без повторной очереди', () => {
  const q = DpoBotReply.createActionQueue();
  q.resolve({ ok: true });
  let seen = null;
  const status = q.run((d) => { seen = d; }, { ok: true });
  assert.equal(status, 'ran');
  assert.deepEqual(seen, { ok: true });
});

test('очередь: reject не роняет очередь, дальнейшие run честно отвечают «failed»', () => {
  const q = DpoBotReply.createActionQueue();
  q.run(() => { throw new Error('не должно вызваться'); }, null);
  assert.doesNotThrow(() => q.reject());
  const status = q.run(() => { throw new Error('тоже не должно вызваться'); }, null);
  assert.equal(status, 'failed');
  assert.equal(q.status(), false);
});
