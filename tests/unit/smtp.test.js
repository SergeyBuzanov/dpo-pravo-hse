'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');

const { sendMail, encodeHeader, encodeBody, configFromEnv } = require('../../lib/smtp');

/**
 * Поддельный SMTP-сервер. Отвечает по сценарию и записывает весь диалог —
 * так проверяется именно протокол, а не «письмо куда-то ушло».
 *
 * @param {object} opts
 * @param {boolean} [opts.offerStartTls] — объявлять ли STARTTLS в EHLO
 * @param {string}  [opts.authMech] — 'PLAIN' | 'LOGIN' | null
 * @param {object}  [opts.failAt] — {command: 'RCPT TO', code: 550}
 */
function fakeServer(opts = {}) {
  const log = [];
  // Установленные соединения приходится помнить: server.close() перестаёт
  // слушать порт, но уже открытые сокеты держит, и процесс тестов не
  // завершается, хотя все проверки давно прошли.
  const live = new Set();
  const server = net.createServer((socket) => {
    live.add(socket);
    socket.on('close', () => live.delete(socket));
    let inData = false;
    let body = '';
    socket.setEncoding('utf8');
    socket.write('220 mail.example.org ESMTP\r\n');

    socket.on('data', (chunk) => {
      for (const line of chunk.split('\r\n')) {
        if (line === '' && !inData) continue;

        if (inData) {
          if (line === '.') {
            inData = false;
            log.push({ command: 'BODY', body });
            socket.write('250 2.0.0 принято\r\n');
          } else {
            body += `${line}\n`;
          }
          continue;
        }

        log.push({ command: line });
        const fail = opts.failAt && line.startsWith(opts.failAt.command);
        if (fail) {
          socket.write(`${opts.failAt.code} отказано\r\n`);
          continue;
        }

        if (/^EHLO/i.test(line)) {
          const caps = ['250-mail.example.org'];
          if (opts.offerStartTls) caps.push('250-STARTTLS');
          if (opts.authMech) caps.push(`250-AUTH ${opts.authMech}`);
          caps.push('250 SIZE 10240000');
          socket.write(`${caps.join('\r\n')}\r\n`);
        } else if (/^AUTH LOGIN/i.test(line)) {
          socket.write('334 VXNlcm5hbWU6\r\n');
        } else if (/^AUTH PLAIN/i.test(line)) {
          socket.write('235 2.7.0 добро пожаловать\r\n');
        } else if (/^MAIL FROM|^RCPT TO/i.test(line)) {
          socket.write('250 2.1.0 ок\r\n');
        } else if (/^DATA/i.test(line)) {
          inData = true;
          socket.write('354 давайте текст\r\n');
        } else if (/^QUIT/i.test(line)) {
          socket.write('221 пока\r\n');
          socket.end();
        } else if (/^[A-Za-z0-9+/=]+$/.test(line)) {
          // Ответ на запрос имени пользователя или пароля в AUTH LOGIN.
          const step = log.filter((l) => /^[A-Za-z0-9+/=]+$/.test(l.command)).length;
          socket.write(step === 1 ? '334 UGFzc3dvcmQ6\r\n' : '235 2.7.0 добро пожаловать\r\n');
        } else {
          socket.write('500 не понял\r\n');
        }
      }
    });
  });
  return { server, log, close: () => closeAll(server, live) };
}

function closeAll(server, live) {
  for (const socket of live) socket.destroy();
  server.close();
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

const config = (port, over = {}) => ({
  host: '127.0.0.1',
  port,
  secure: false,
  user: '',
  pass: '',
  timeoutMs: 3000,
  rejectUnauthorized: false,
  ...over,
});

const letter = {
  from: 'noreply@example.org',
  to: 'dpo@example.org',
  subject: 'Заявка на программу «Транспортное право»',
  text: 'Петрова Анна\nТелефон: +7 999 123-45-67',
};

test('письмо проходит весь диалог и доходит до сервера', async () => {
  const { server, log, close } = fakeServer();
  const port = await listen(server);
  await sendMail(letter, config(port));
  close();

  const commands = log.map((l) => l.command);
  assert.ok(commands.some((c) => /^EHLO/.test(c)), 'нет EHLO');
  assert.ok(commands.includes('MAIL FROM:<noreply@example.org>'));
  assert.ok(commands.includes('RCPT TO:<dpo@example.org>'));
  assert.ok(commands.includes('DATA'));
  assert.ok(commands.includes('QUIT'));
});

test('тема с кириллицей закодирована, тело читается обратно', async () => {
  const { server, log, close } = fakeServer();
  const port = await listen(server);
  await sendMail(letter, config(port));
  close();

  const { body } = log.find((l) => l.command === 'BODY');
  assert.ok(body.includes('Subject: =?UTF-8?B?'), 'тема не закодирована');
  assert.ok(body.includes('Content-Transfer-Encoding: base64'));

  const [, encoded] = body.split('\n\n');
  const decoded = Buffer.from(encoded.replace(/\n/g, ''), 'base64').toString('utf8');
  assert.ok(decoded.includes('Петрова Анна'));
  assert.ok(decoded.includes('+7 999 123-45-67'));
});

test('многострочный ответ EHLO разбирается целиком', async () => {
  // Сервер перечисляет возможности строками с дефисом — на этом ломаются
  // самодельные клиенты, читающие только первую строку ответа.
  const { server, log, close } = fakeServer({ authMech: 'PLAIN' });
  const port = await listen(server);
  await sendMail(letter, config(port, { user: 'u', pass: 'p', allowInsecureAuth: true }));
  close();
  assert.ok(log.some((l) => /^AUTH PLAIN /.test(l.command)));
});

test('AUTH LOGIN: имя и пароль уходят по base64', async () => {
  const { server, log, close } = fakeServer({ authMech: 'LOGIN' });
  const port = await listen(server);
  await sendMail(letter, config(port, { user: 'dpo', pass: 'секрет', allowInsecureAuth: true }));
  close();

  const b64 = log.filter((l) => /^[A-Za-z0-9+/=]+$/.test(l.command)).map((l) => l.command);
  assert.equal(Buffer.from(b64[0], 'base64').toString('utf8'), 'dpo');
  assert.equal(Buffer.from(b64[1], 'base64').toString('utf8'), 'секрет');
});

test('без STARTTLS пароль не отправляется вовсе', async () => {
  const { server, log, close } = fakeServer({ offerStartTls: false, authMech: 'LOGIN' });
  const port = await listen(server);
  await assert.rejects(
    () => sendMail(letter, config(port, { user: 'dpo', pass: 'секрет' })),
    /STARTTLS/,
  );
  close();
  assert.equal(log.some((l) => /секрет/.test(l.command)), false);
  assert.equal(log.some((l) => l.command.startsWith('AUTH')), false);
});

test('отказ сервера возвращается с кодом, а не молча', async () => {
  const { server, close } = fakeServer({ failAt: { command: 'RCPT TO', code: 550 } });
  const port = await listen(server);
  await assert.rejects(() => sendMail(letter, config(port)), (err) => {
    assert.equal(err.code, 'SMTP_REJECTED');
    assert.equal(err.smtpCode, 550);
    return true;
  });
  close();
});

test('пароль не попадает в текст ошибки', async () => {
  const { server, close } = fakeServer({ authMech: 'PLAIN', failAt: { command: 'AUTH', code: 535 } });
  const port = await listen(server);
  await assert.rejects(
    () => sendMail(letter, config(port, { user: 'dpo', pass: 'очень-секретный', allowInsecureAuth: true })),
    (err) => {
      assert.equal(err.message.includes('очень-секретный'), false, 'пароль виден в ошибке');
      assert.ok(err.message.includes('***'));
      return true;
    },
  );
  close();
});

test('молчащий сервер не подвешивает отправку навсегда', async () => {
  const live = new Set();
  const server = net.createServer((socket) => live.add(socket)); // приветствия нет вовсе
  const port = await listen(server);
  await assert.rejects(() => sendMail(letter, config(port, { timeoutMs: 300 })), /молчит/);
  closeAll(server, live);
});

test('не-ASCII в адресе отвергается до соединения', async () => {
  await assert.rejects(
    () => sendMail({ ...letter, to: 'заявки@пример.рф' }, config(1)),
    /SMTPUTF8/,
  );
});

test('тема из латиницы остаётся читаемой как есть', () => {
  assert.equal(encodeHeader('New application'), 'New application');
  assert.ok(encodeHeader('Заявка').startsWith('=?UTF-8?B?'));
});

test('строки тела не длиннее 76 символов', () => {
  const lines = encodeBody('я'.repeat(500)).split('\r\n');
  for (const line of lines) assert.ok(line.length <= 76, `строка ${line.length} символов`);
});

test('без SMTP_HOST настройки не собираются', () => {
  assert.equal(configFromEnv({}), null);
  const c = configFromEnv({ SMTP_HOST: 'mail.example.org', SMTP_PORT: '465' });
  assert.equal(c.secure, true, 'порт 465 — это TLS сразу');
});
