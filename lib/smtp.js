/**
 * Отправка письма по SMTP. Ровно столько протокола, сколько нужно, чтобы
 * доставить одно текстовое письмо на почтовый сервер центра.
 *
 * Почему свой клиент, а не nodemailer: у проекта НЕТ зависимостей вообще —
 * ни одной строки в `dependencies`. Это его главное эксплуатационное
 * свойство: сайт разворачивается копированием каталога, а обновлять
 * зависимости у центра некому. Ради одного письма в неделю менять это
 * свойство не стоит; здесь около двухсот строк вместо дерева из сотен
 * пакетов.
 *
 * Что поддерживается: implicit TLS (порт 465), STARTTLS (587), AUTH LOGIN и
 * AUTH PLAIN, одно письмо за соединение, UTF-8 в теме и теле.
 *
 * Чего сознательно НЕТ: вложений, HTML-части, пула соединений, очереди
 * повторов, DKIM. Заявка уже лежит в журнале на диске, письмо — лишь
 * уведомление; ставить ради него полноценную почтовую машину незачем.
 *
 * Настройки — переменные окружения (см. README):
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE, SMTP_TIMEOUT_MS
 */

'use strict';

const net = require('node:net');
const tls = require('node:tls');
const crypto = require('node:crypto');
const os = require('node:os');

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Диалог с сервером: пишем строку, ждём ответ.
 *
 * Ответ SMTP может быть многострочным: строки продолжения помечаются
 * дефисом сразу за кодом («250-STARTTLS»), и только у последней там
 * пробел. Разбор «по первой пришедшей строке» работает ровно до первого
 * сервера, который перечисляет свои возможности, — а это почти любой.
 */
class Session {
  constructor(socket, timeoutMs) {
    this.socket = socket;
    this.timeoutMs = timeoutMs;
    this.buffer = '';
    this.waiter = null;
    this.closed = null;

    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      this.buffer += chunk;
      this._drain();
    });
    socket.on('error', (err) => this._fail(err));
    socket.on('close', () => this._fail(new Error('сервер закрыл соединение')));
  }

  _fail(err) {
    this.closed = err;
    if (this.waiter) {
      const { reject, timer } = this.waiter;
      clearTimeout(timer);
      this.waiter = null;
      reject(err);
    }
  }

  _drain() {
    if (!this.waiter) return;
    const lines = this.buffer.split('\r\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Последняя строка ответа: три цифры, затем пробел.
      if (/^\d{3} /.test(line)) {
        const reply = lines.slice(0, i + 1).join('\r\n');
        this.buffer = lines.slice(i + 1).join('\r\n');
        const { resolve, timer } = this.waiter;
        clearTimeout(timer);
        this.waiter = null;
        resolve({ code: Number(line.slice(0, 3)), text: reply });
        return;
      }
    }
  }

  read() {
    if (this.closed) return Promise.reject(this.closed);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => this._fail(new Error(`сервер молчит дольше ${this.timeoutMs} мс`)),
        this.timeoutMs,
      );
      this.waiter = { resolve, reject, timer };
      this._drain();
    });
  }

  /**
   * Отправляет команду и проверяет код ответа.
   * @param {string} line — команда без CRLF (пустая строка = только чтение)
   * @param {number[]} expect — коды, которые считаются успехом
   * @param {string} [secret] — что скрыть в тексте ошибки (пароль)
   */
  async command(line, expect, secret) {
    if (line !== null) this.socket.write(`${line}\r\n`);
    const reply = await this.read();
    if (!expect.includes(reply.code)) {
      const shown = secret ? String(line).replace(secret, '***') : line;
      throw Object.assign(new Error(`SMTP ${reply.code} на «${shown}»: ${reply.text.trim()}`), {
        code: 'SMTP_REJECTED',
        smtpCode: reply.code,
      });
    }
    return reply;
  }
}

/** Тема письма: кириллица в заголовке допустима только закодированной. */
function encodeHeader(value) {
  const s = String(value);
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7E]*$/.test(s)) return s;
  return `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
}

/**
 * Тело письма кодируется целиком в base64. Так не нужно ни следить за
 * длиной строк (SMTP ограничивает 998 байтами), ни экранировать точку в
 * начале строки — а именно эта точка молча обрезает письмо на полуслове у
 * самодельных отправителей.
 */
function encodeBody(text) {
  const b64 = Buffer.from(String(text), 'utf8').toString('base64');
  return (b64.match(/.{1,76}/g) || ['']).join('\r\n');
}

function assertAscii(address, what) {
  // eslint-disable-next-line no-control-regex
  if (!/^[\x20-\x7E]+$/.test(address)) {
    throw new Error(`${what}: адрес «${address}» содержит не-ASCII, а SMTPUTF8 здесь не поддержан`);
  }
  if (!/^[^\s@]+@[^\s@]+$/.test(address)) throw new Error(`${what}: «${address}» не похож на адрес`);
}

function configFromEnv(env = process.env) {
  const host = (env.SMTP_HOST || '').trim();
  if (!host) return null;
  const port = Number(env.SMTP_PORT) || 587;
  return {
    host,
    port,
    // Implicit TLS — обычно 465. Иначе пробуем STARTTLS и не отправляем
    // пароль по открытому каналу, если сервер её не предложил.
    secure: env.SMTP_SECURE ? env.SMTP_SECURE === '1' : port === 465,
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    timeoutMs: Number(env.SMTP_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
    // Проверка сертификата отключается только осознанно и только на время
    // отладки: без неё любой, кто сидит на пути, представится вашим
    // почтовым сервером и получит пароль. Правильное решение для
    // самоподписанного сертификата — добавить его в доверенные, а не
    // выключать проверку.
    rejectUnauthorized: env.SMTP_INSECURE_TLS !== '1',
    /**
     * Разрешить пароль по НЕзашифрованному каналу. По умолчанию запрещено:
     * это единственный способ отдать учётные данные всем, кто слушает сеть.
     * Флаг существует ради внутренних почтовых серверов в закрытом контуре,
     * где TLS не поднят, а канал контролируется целиком.
     */
    allowInsecureAuth: env.SMTP_ALLOW_INSECURE_AUTH === '1',
  };
}

function connect(config) {
  return new Promise((resolve, reject) => {
    const onError = (err) => reject(err);
    const socket = config.secure
      ? tls.connect(
          {
            host: config.host,
            port: config.port,
            servername: config.host,
            rejectUnauthorized: config.rejectUnauthorized,
          },
          () => resolve(socket),
        )
      : net.createConnection({ host: config.host, port: config.port }, () => resolve(socket));
    socket.once('error', onError);
    socket.setTimeout(config.timeoutMs, () => {
      socket.destroy();
      reject(new Error(`не удалось соединиться с ${config.host}:${config.port} за ${config.timeoutMs} мс`));
    });
  });
}

function upgradeToTls(socket, config) {
  return new Promise((resolve, reject) => {
    const secured = tls.connect(
      {
        socket,
        servername: config.host,
        rejectUnauthorized: config.rejectUnauthorized,
      },
      () => resolve(secured),
    );
    secured.once('error', reject);
  });
}

/**
 * Отправляет одно письмо.
 * @param {{from: string, to: string|string[], subject: string, text: string, replyTo?: string}} message
 * @param {object} [config] — по умолчанию из переменных окружения
 */
async function sendMail(message, config = configFromEnv()) {
  if (!config) throw new Error('SMTP не настроен: нет SMTP_HOST');

  const to = Array.isArray(message.to) ? message.to : [message.to];
  assertAscii(message.from, 'отправитель');
  for (const addr of to) assertAscii(addr, 'получатель');
  if (message.replyTo) assertAscii(message.replyTo, 'адрес для ответа');

  let socket = await connect(config);
  let session = new Session(socket, config.timeoutMs);
  const ehloName = os.hostname() || 'localhost';

  try {
    await session.command(null, [220]); // приветствие
    let greeting = await session.command(`EHLO ${ehloName}`, [250]);

    if (!config.secure) {
      if (!/\bSTARTTLS\b/i.test(greeting.text)) {
        // Пароль в открытом канале — только по явному разрешению.
        if (config.user && !config.allowInsecureAuth) {
          throw new Error(
            'сервер не предлагает STARTTLS, а пароль по открытому каналу слать нельзя ' +
              '(осознанное исключение — SMTP_ALLOW_INSECURE_AUTH=1)',
          );
        }
      } else {
        await session.command('STARTTLS', [220]);
        socket = await upgradeToTls(socket, config);
        session = new Session(socket, config.timeoutMs);
        // После шифрования диалог начинается заново: возможности сервера
        // до и после STARTTLS могут отличаться, и AUTH обычно появляется
        // только здесь.
        greeting = await session.command(`EHLO ${ehloName}`, [250]);
      }
    }

    if (config.user) {
      if (/AUTH[ =-][^\n]*PLAIN/i.test(greeting.text)) {
        const token = Buffer.from(`\0${config.user}\0${config.pass}`, 'utf8').toString('base64');
        await session.command(`AUTH PLAIN ${token}`, [235], token);
      } else {
        await session.command('AUTH LOGIN', [334]);
        await session.command(Buffer.from(config.user, 'utf8').toString('base64'), [334]);
        const pass = Buffer.from(config.pass, 'utf8').toString('base64');
        await session.command(pass, [235], pass);
      }
    }

    await session.command(`MAIL FROM:<${message.from}>`, [250]);
    for (const addr of to) await session.command(`RCPT TO:<${addr}>`, [250, 251]);
    await session.command('DATA', [354]);

    const headers = [
      `From: ${message.from}`,
      `To: ${to.join(', ')}`,
      message.replyTo ? `Reply-To: ${message.replyTo}` : null,
      `Subject: ${encodeHeader(message.subject)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${crypto.randomUUID()}@${config.host}>`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
    ].filter(Boolean);

    socket.write(`${headers.join('\r\n')}\r\n\r\n${encodeBody(message.text)}\r\n.\r\n`);
    await session.command(null, [250]);
    await session.command('QUIT', [221]).catch(() => {});
    return { ok: true };
  } finally {
    socket.destroy();
  }
}

module.exports = { sendMail, configFromEnv, encodeHeader, encodeBody };
