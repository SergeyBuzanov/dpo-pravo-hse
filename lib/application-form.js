/**
 * Заявка на программу: разбор и проверка того, что прислала форма.
 *
 * Модуль намеренно ничего не знает ни про HTTP, ни про хранение, ни про
 * почту. Он превращает присланный объект в ЛИБО набор ошибок для показа
 * человеку, ЛИБО очищенную запись, которую уже безопасно писать на диск и
 * пересылать. Это единственное место, где решается, что считать
 * допустимыми персональными данными.
 *
 * Состав полей повторяет форму маркетплейса ВШЭ (см. APPLICATION-FORM.md),
 * чтобы заявка, поданная у нас, была той же заявкой по содержанию.
 *
 * Два правила, которые здесь важнее остальных:
 *
 *   1. Согласие на обработку персональных данных — ОБЯЗАТЕЛЬНОЕ поле, и
 *      галочка не может быть предустановлена. Заявка без него не является
 *      заявкой: без согласия у нас нет основания обрабатывать эти данные.
 *   2. Лишние поля не сохраняются вовсе. Всё, чего нет в схеме,
 *      отбрасывается: сохранить «на всякий случай» — это ровно тот случай,
 *      когда данные потом невозможно объяснить проверяющему.
 */

'use strict';

/** Ограничения длины. Значения не отбрасываются, а обрезаются. */
const LIMITS = Object.freeze({
  firstName: 80,
  lastName: 80,
  phone: 40,
  email: 160,
  position: 120,
  company: 160,
  sourceOther: 200,
  comment: 1000,
  programId: 40,
  programTitle: 300,
  programUrl: 500,
});

/**
 * «Как Вы узнали о нас?» — те же девять вариантов, что у маркетплейса.
 * Хранится ключ, а не подпись: подпись живёт в разметке и может меняться.
 */
const SOURCES = Object.freeze([
  'hse-site',
  'telegram',
  'search',
  'ad',
  'social',
  'mailing',
  'board',
  'recommendation',
  'other',
]);

const SOURCE_SET = new Set(SOURCES);

/**
 * Телефон не приводится к единому виду и не проверяется по стране: у нас
 * учатся в том числе иностранные слушатели, а «умная» нормализация чаще
 * ломает верный номер, чем чинит неверный. Проверяем ровно одно — что цифр
 * достаточно, чтобы по номеру можно было позвонить.
 */
const PHONE_ALLOWED = /^[0-9+()\-\s.]+$/;
const PHONE_MIN_DIGITS = 10;
const PHONE_MAX_DIGITS = 15;

/**
 * Проверка адреса нарочно грубая. Единственный надёжный способ узнать, что
 * адрес рабочий, — отправить на него письмо; строгая регулярка же
 * отбраковывает верные адреса (например с апострофом или доменом в UTF-8)
 * и создаёт у человека тупик, из которого он не выйдет.
 */
const EMAIL_SHAPE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/;

function str(value, max) {
  if (value == null) return '';
  const s = String(value).replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max) : s;
}

/** Многострочное поле: переводы строк сохраняются, лишние пробелы — нет. */
function text(value, max) {
  if (value == null) return '';
  const s = String(value)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return s.length > max ? s.slice(0, max) : s;
}

function bool(value) {
  return value === true || value === 'true' || value === 'on' || value === 1 || value === '1';
}

function digitsOf(phone) {
  return phone.replace(/\D/g, '');
}

/**
 * Разбирает заявку.
 * @param {object} raw — тело запроса, как пришло
 * @param {object} [opts]
 * @param {number} [opts.now] — отметка времени (для тестов)
 * @returns {{ok: true, application: object} | {ok: false, errors: Array<{field: string, message: string}>}}
 */
function parseApplication(raw, opts = {}) {
  const now = opts.now ?? Date.now();
  const errors = [];
  const add = (field, message) => errors.push({ field, message });

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: [{ field: 'form', message: 'Заявка не распознана.' }] };
  }

  const firstName = str(raw.firstName, LIMITS.firstName);
  const lastName = str(raw.lastName, LIMITS.lastName);
  const phone = str(raw.phone, LIMITS.phone);
  const email = str(raw.email, LIMITS.email);

  if (!firstName) add('firstName', 'Укажите имя.');
  if (!lastName) add('lastName', 'Укажите фамилию.');

  if (!phone) {
    add('phone', 'Укажите телефон.');
  } else if (!PHONE_ALLOWED.test(phone)) {
    add('phone', 'В телефоне допустимы только цифры, пробелы и знаки + ( ) -');
  } else {
    const digits = digitsOf(phone);
    if (digits.length < PHONE_MIN_DIGITS || digits.length > PHONE_MAX_DIGITS) {
      add('phone', 'Проверьте телефон: нужен номер с кодом страны или города.');
    }
  }

  if (!email) add('email', 'Укажите электронную почту.');
  else if (!EMAIL_SHAPE.test(email)) add('email', 'Проверьте адрес почты: похоже, в нём опечатка.');

  // Согласие. Отдельная галочка, не предустановленная разметкой; без неё
  // обрабатывать данные нельзя, поэтому это ошибка, а не пропуск поля.
  if (!bool(raw.consent)) {
    add('consent', 'Без согласия на обработку персональных данных заявку принять нельзя.');
  }

  const sources = Array.isArray(raw.sources)
    ? [...new Set(raw.sources.map((s) => String(s)).filter((s) => SOURCE_SET.has(s)))]
    : [];
  const sourceOther = sources.includes('other') ? str(raw.sourceOther, LIMITS.sourceOther) : '';

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    application: {
      receivedAt: new Date(now).toISOString(),
      firstName,
      lastName,
      phone,
      email,
      position: str(raw.position, LIMITS.position),
      company: str(raw.company, LIMITS.company),
      sources,
      sourceOther,
      comment: text(raw.comment, LIMITS.comment),
      // Отказ от рассылки: согласие по умолчанию, как на маркетплейсе.
      // Хранится именно отказ, а не согласие, — тогда пустое значение
      // означает то же, что и отсутствие галочки у человека.
      noAnnouncements: bool(raw.noAnnouncements),
      program: {
        id: str(raw.programId, LIMITS.programId),
        title: str(raw.programTitle, LIMITS.programTitle),
        url: str(raw.programUrl, LIMITS.programUrl),
      },
    },
  };
}

/** Имя человека одной строкой — для темы письма и списка в админке. */
function displayName(application) {
  return [application.lastName, application.firstName].filter(Boolean).join(' ');
}

module.exports = { parseApplication, displayName, SOURCES, LIMITS };
