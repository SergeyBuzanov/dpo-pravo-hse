'use strict';

/**
 * Московское время как единственная точка отсчёта для всего проекта.
 *
 * Зачем модуль вместо `new Date()`: и сервер, и контейнер, и машина разработчика
 * живут в разных зонах, а сайт говорит про московские программы московским
 * посетителям. Пока время брали «локальное», оно означало время дата-центра:
 *
 *   • hse.ru отдаёт старт программы меткой полуночи ПО МОСКВЕ. В UTC-контейнере
 *     та же метка форматировалась как предыдущий день — все 25 дат на сайте
 *     оказывались на сутки раньше настоящих;
 *   • ежедневное обновление каталога, заданное в админке как «03:00», в
 *     UTC-контейнере срабатывало в 06:00 по Москве.
 *
 * Поэтому зона прибита, а не берётся из окружения.
 */

const MOSCOW_TZ = 'Europe/Moscow';

const PARTS_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: MOSCOW_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/**
 * Компоненты московского календаря для момента времени.
 * @returns {{year:number, month:number, day:number, hour:number, minute:number, second:number}|null}
 */
function moscowParts(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const out = {};
  for (const { type, value } of PARTS_FORMAT.formatToParts(d)) {
    if (type in { year: 1, month: 1, day: 1, hour: 1, minute: 1, second: 1 }) {
      // hour24 отдаёт «24» для полуночи в части реализаций — приводим к 0
      out[type] = type === 'hour' && value === '24' ? 0 : Number(value);
    }
  }
  return out.year ? out : null;
}

/**
 * Ключ московских суток «YYYY-MM-DD». Нужен, чтобы «уже запускались сегодня»
 * означало московские сутки, а не UTC-сутки: иначе задание, назначенное на
 * 02:00 по Москве, попадает во вчерашний UTC-день и может отработать дважды.
 */
function moscowDayKey(date = new Date()) {
  const p = moscowParts(date);
  if (!p) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Минуты с начала московских суток — для сравнения с расписанием. */
function moscowMinutesOfDay(date = new Date()) {
  const p = moscowParts(date);
  return p ? p.hour * 60 + p.minute : null;
}

module.exports = { MOSCOW_TZ, moscowParts, moscowDayKey, moscowMinutesOfDay };
