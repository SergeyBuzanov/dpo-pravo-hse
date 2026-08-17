/**
 * Доставка заявки: сначала в журнал на диске, потом письмом менеджеру.
 *
 * Порядок здесь — не деталь реализации, а обещание посетителю. Нажав
 * «Отправить», человек должен получить ответ «заявка принята» тогда и
 * только тогда, когда она уже сохранена. Почта — уведомление поверх
 * записи: почтовый сервер может быть недоступен, пароль просрочен, ящик
 * переполнен, и ни один из этих случаев не должен превращаться для
 * посетителя в «отправьте ещё раз».
 *
 * Поэтому:
 *   запись не удалась  -> заявка НЕ принята, человек видит ошибку;
 *   письмо не ушло     -> заявка принята, в журнал сервера пишется отказ
 *                         почты, менеджер видит заявку в админке.
 *
 * Отсюда же следует, что письмо не ждут: ответ уходит сразу после записи,
 * а отправка живёт своей жизнью.
 */

'use strict';

const store = require('./application-store');
const { displayName, SOURCES } = require('./application-form');
const { sendMail, configFromEnv } = require('./smtp');

/**
 * Подписи тем обращения — для темы письма и первой строки текста.
 * Тема письма начинается с них: менеджер сортирует почту по префиксу,
 * не открывая письмо.
 */
const TOPIC_LABELS = Object.freeze({
  program: 'Заявка ДПО',
  'course-idea': 'Идея курса',
  teaching: 'Заявка преподавателя',
  feedback: 'Отзыв о работе центра',
});

/** Подписи источников для письма — те же формулировки, что в форме. */
const SOURCE_LABELS = Object.freeze({
  'hse-site': 'сайт НИУ ВШЭ',
  telegram: 'телеграм-канал',
  search: 'поисковые системы',
  ad: 'рекламное объявление или баннер',
  social: 'социальные сети',
  mailing: 'почтовая рассылка',
  board: 'стенд объявлений',
  recommendation: 'по рекомендации',
  other: 'другое',
});

function mailConfig(env = process.env) {
  const to = String(env.APPLICATION_MAIL_TO || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!to.length) return null;
  const smtp = configFromEnv(env);
  if (!smtp) return null;
  return {
    to,
    // Отправитель по умолчанию — учётная запись SMTP: письмо от чужого
    // адреса почтовые серверы кладут в спам, если вообще принимают.
    from: env.APPLICATION_MAIL_FROM || smtp.user,
    smtp,
  };
}

/**
 * Текст письма. Обычный текст, а не HTML: письмо читают в почтовом
 * клиенте менеджера, и здесь важна разборчивость, а не оформление.
 */
function formatLetter(application, id) {
  const sources = application.sources.map((s) => SOURCE_LABELS[s] || s);
  if (application.sourceOther) sources[sources.indexOf('другое')] = `другое: ${application.sourceOther}`;

  const topic = application.topic || 'program';
  const firstLine =
    topic === 'program'
      ? `Заявка на программу: ${application.program.title || 'программа не указана'}`
      : `Тема обращения: ${TOPIC_LABELS[topic] || topic}`;

  const lines = [
    firstLine,
    '',
    `Имя и фамилия: ${displayName(application)}`,
    `Телефон:       ${application.phone}`,
    `Почта:         ${application.email}`,
  ];
  if (application.position) lines.push(`Должность:     ${application.position}`);
  if (application.company) lines.push(`Место работы:  ${application.company}`);
  lines.push('');
  if (sources.length) lines.push(`Узнал(а) о нас: ${sources.join(', ')}`);
  lines.push(
    application.noAnnouncements
      ? 'Анонсы новых программ получать ОТКАЗАЛСЯ(ЛАСЬ).'
      : 'Согласен(на) получать анонсы новых программ.',
  );
  if (application.comment) lines.push('', 'Комментарий:', application.comment);
  if (application.program.url) lines.push('', `Страница программы: ${application.program.url}`);
  lines.push(
    '',
    '— — —',
    `Заявка № ${id}`,
    `Получена: ${new Date(application.receivedAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} (Москва)`,
    'Согласие на обработку персональных данных получено вместе с заявкой.',
    'Письмо отправлено сайтом Центра ДПО автоматически, отвечать на него не нужно —',
    'чтобы ответить заявителю, пишите на адрес из поля «Почта».',
  );
  return lines.join('\n');
}

/**
 * Принимает заявку.
 * @param {object} application — результат parseApplication
 * @param {object} [opts]
 * @param {boolean} [opts.waitForMail] — дождаться отправки письма (для тестов)
 * @returns {Promise<{id: string, duplicate: boolean, mail: 'sent'|'skipped'|'failed'|'queued'}>}
 */
async function deliver(application, opts = {}) {
  const saved = await store.save(application);

  const config = mailConfig(opts.env);
  if (!config) return { ...saved, mail: 'skipped' };
  // Повтор — это второй клик по кнопке. Заявка уже сохранена и письмо по
  // ней уже уходило; второе письмо только запутает менеджера.
  if (saved.duplicate) return { ...saved, mail: 'skipped' };

  // Тема письма начинается с темы обращения; у заявки на программу после
  // имени стоит название программы – как и раньше.
  const topic = application.topic || 'program';
  const subject =
    topic === 'program'
      ? `${TOPIC_LABELS.program}: ${displayName(application)} — ${application.program.title || 'без программы'}`
      : `${TOPIC_LABELS[topic] || topic}: ${displayName(application)}`;

  const letter = {
    from: config.from,
    to: config.to,
    // Ответ на письмо уходит заявителю, а не в никуда.
    replyTo: application.email,
    subject,
    text: formatLetter(application, saved.id),
  };

  const send = sendMail(letter, config.smtp).then(
    () => 'sent',
    (err) => {
      console.error(`заявка ${saved.id}: письмо не ушло — ${err.message}`);
      return 'failed';
    },
  );

  if (opts.waitForMail) return { ...saved, mail: await send };
  return { ...saved, mail: 'queued' };
}

module.exports = { deliver, formatLetter, mailConfig, SOURCE_LABELS, TOPIC_LABELS, SOURCES };
