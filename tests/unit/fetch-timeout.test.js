const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { fetchProgramItems } = require('../../lib/hse-catalog');

test('зависший сервер не держит запрос вечно', async () => {
  // Сервер принимает соединение и молчит — ровно тот случай, который сейчас
  // подвешивает админку навсегда.
  const server = http.createServer(() => { /* никогда не отвечаем */ });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  try {
    await assert.rejects(
      () => fetchProgramItems(url),
      (err) => /не ответил|timeout|aborted/i.test(err.message),
    );
  } finally {
    server.close();
  }
});
