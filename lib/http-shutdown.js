/**
 * Корректное завершение HTTP-сервера по SIGTERM/SIGINT.
 * K8s и docker stop шлют SIGTERM; без close() обрывается запись заявки.
 */

'use strict';

function attachShutdown(server, { name = 'server', timeoutMs = 8000 } = {}) {
  let stopping = false;
  function stop(signal) {
    if (stopping) return;
    stopping = true;
    console.log(`${name}: ${signal}, закрываем соединения`);
    const killer = setTimeout(() => {
      console.error(`${name}: не успели закрыться за ${timeoutMs} мс`);
      process.exit(1);
    }, timeoutMs);
    killer.unref();
    server.close((err) => {
      clearTimeout(killer);
      process.exit(err ? 1 : 0);
    });
  }
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}

module.exports = { attachShutdown };
