// Тонкая обёртка над CDP: одна вкладка, evaluate + screenshot.
const http = require('node:http');

function httpJson(path) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: 9222, path }, r => {
      let b = ''; r.on('data', c => b += c); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}

class Session {
  constructor(ws) { this.ws = ws; this.id = 0; this.waiting = new Map(); this.listeners = new Map();
    ws.addEventListener('message', ev => {
      const m = JSON.parse(ev.data);
      if (m.id && this.waiting.has(m.id)) {
        const { res, rej } = this.waiting.get(m.id); this.waiting.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      } else if (m.method) {
        (this.listeners.get(m.method) || []).forEach(f => f(m.params));
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => { this.waiting.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  on(method, fn) { if (!this.listeners.has(method)) this.listeners.set(method, []); this.listeners.get(method).push(fn); }
  async eval(expr, awaitPromise = true) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails));
    return r.result.value;
  }
}

async function connect() {
  const tabs = await httpJson('/json/list');
  let tab = tabs.find(t => t.type === 'page');
  if (!tab) tab = await httpJson('/json/new?about:blank');
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const s = new Session(ws);
  await s.send('Page.enable'); await s.send('Runtime.enable'); await s.send('Network.enable');
  return s;
}

async function goto(s, url, { width = 1440, height = 900, dpr = 2 } = {}) {
  await s.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile: false });
  const loaded = new Promise(res => s.on('Page.loadEventFired', res));
  await s.send('Page.navigate', { url });
  await loaded;
  await s.eval(`new Promise(r => setTimeout(r, 1200))`);
  // vi-mode переживает перезагрузки и портит все замеры
  await s.eval(`(()=>{ try{ localStorage.removeItem('vi-mode'); }catch(e){} return 1 })()`);
  await s.eval(`new Promise(r => setTimeout(r, 200))`);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
module.exports = { connect, goto, sleep };
