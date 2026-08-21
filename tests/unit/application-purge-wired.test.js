/**
 * Уборка старых заявок должна быть ПОДКЛЮЧЕНА, а не просто написана.
 *
 * Ровно так этот дефект и жил: `purgeOld()` существовал в
 * lib/application-store.js с 16.08.2026, был покрыт юнит-тестом – и не
 * вызывался ниоткуда. Оба сервера подключали однофамильца из
 * lib/analytics-store.js, поэтому и код, и тест выглядели зелёными, а
 * заявки с ФИО, телефоном и почтой не удалялись никогда, вопреки прямому
 * обещанию privacy.html. Найдено критикой 21.08.2026.
 *
 * Тест намеренно смотрит в исходники: поднимать оба сервера ради одной
 * строки дороже, а важно здесь именно наличие вызова у того, кто принимает
 * заявки.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

for (const file of ['admin-server.js', 'scripts/static-server.js']) {
  test(`${file} подключает уборку заявок`, () => {
    const src = read(file);
    assert.match(src, /require\([^)]*application-store[^)]*\)/, 'нет обращения к lib/application-store');

    // Вызов purgeOld именно у хранилища заявок, а не у аналитики: имена
    // функций совпадают, и глазами их легко перепутать. Обращений к
    // хранилищу в файле несколько (список и смена статуса в админке),
    // поэтому годится любое, рядом с которым есть уборка.
    const lines = src.split('\n');
    const wired = lines.some(
      (l, i) => /application-store/.test(l) && /purgeOld\s*\(/.test(lines.slice(i, i + 14).join('\n')),
    );
    assert.ok(wired, 'application-store подключён, но purgeOld рядом не вызывается');
  });
}

test('обещание из privacy.html и срок в коде – одно и то же число', () => {
  const { RETENTION_DAYS } = require('../../lib/application-store');
  assert.equal(RETENTION_DAYS, 365);
  assert.match(read('privacy.html'), /год/, 'в политике больше не сказано про год – срок разошёлся с кодом');
});
