/**
 * Снимки разделов сайта под выгрузку текстов.
 * Раздел = кусок страницы, соответствующий заголовку раздела в docx.
 * Высокие разделы режутся на полосы, иначе на листе A4 текст нечитаем.
 */
const fs = require('node:fs');
const path = require('node:path');
const { connect, goto, sleep } = require('./cdp.js');

const OUT = path.join(__dirname, 'shots');
const CATALOG = 'http://127.0.0.1:5180/' + encodeURIComponent('Каталог программ.html');
const SLICE_MAX = 1050;   // px по высоте на одну полосу
const OVERLAP = 30;

/** page -> [{ section, find, width?, banner? }]  find возвращает элемент или массив элементов */
const MAP = {
  'Главная': { url: 'http://127.0.0.1:5180/', sections: [
    ['Шапка сайта', `document.querySelector('header.dpo-header')`],
    ['Первый экран', `document.querySelector('#top')`],
    ['Ближайшие старты', `document.querySelector('#starts')`],
    ['О центре', `[...document.querySelectorAll('section')].find(s => /Факультет права НИУ ВШЭ – признанный лидер/.test(s.textContent))`],
    ['Почему выбирают нас', `document.querySelector('#why-us')`],
    ['Форматы обучения', `document.querySelector('#formats')`],
    ['Популярные программы', `document.querySelector('#top5')`],
    ['Направления по сферам права', `document.querySelector('#spheres')`],
    ['Преподаватели', `document.querySelector('#teachers')`],
    ['Документ об окончании', `document.querySelector('#document')`],
    ['Отзывы выпускников', `document.querySelector('#reviews')`],
    ['Помогите нам стать лучше', `document.querySelector('#explore')`],
    ['Корпоративное обучение', `[...document.querySelectorAll('section')].find(s => /Корпоративное обучение юристов/.test(s.textContent))`],
    ['Контакты', `document.querySelector('#contacts')`],
    ['Подвал сайта', `document.querySelector('footer')`],
    ['Панель внизу экрана на телефоне', `document.querySelector('.dpo-mobile-cta')`, { width: 390 }],
    ['Баннер согласия на cookies', `document.querySelector('#cookieBanner')`, { banner: true }],
  ]},
  'Каталог программ': { url: CATALOG, sections: [
    ['Шапка сайта', `document.querySelector('header')`],
    ['Верх страницы', `document.querySelector('section.hero')`],
    ['Ближайшие старты', `document.querySelector('section.starts')`],
    ['Фильтры каталога', `[document.querySelector('#filters'), document.querySelector('#filtersDuration')]`],
    ['Служебные элементы страницы', `document.querySelector('.toolbar')`],
    ['Подвал сайта', `document.querySelector('footer')`],
    ['Служебные элементы страницы#2', `document.querySelector('nav.mobile-cta')`, { width: 390 }],
    ['Баннер согласия на cookies', `document.querySelector('#cookieBanner')`, { banner: true }],
  ]},
  'Рейтинги': { url: 'http://127.0.0.1:5180/ratings.html', sections: [
    ['Шапка сайта', `document.querySelector('header')`],
    ['Основной текст страницы', `document.querySelector('main#main')`],
    ['Подвал сайта', `document.querySelector('footer')`],
    ['Баннер согласия на cookies', `document.querySelector('#cookieBanner')`, { banner: true }],
  ]},
  'Политика обработки персональных данных': { url: 'http://127.0.0.1:5180/privacy.html', sections: [
    ['Шапка сайта', `document.querySelector('header')`],
    ['Основной текст страницы', `document.querySelector('main#main')`],
    ['Подвал сайта', `document.querySelector('footer')`],
    ['Баннер согласия на cookies', `document.querySelector('#cookieBanner')`, { banner: true }],
  ]},
  'Страница «Такой страницы нет» (ошибка 404)': { url: 'http://127.0.0.1:5181/404page.html', sections: [
    ['', `document.body`],
  ]},
};

const PREP = `(() => {
  document.documentElement.style.scrollBehavior = 'auto';
  const st = document.createElement('style');
  st.id = '__shotPrep';
  st.textContent = \`
    .dpo-reveal, [class*="reveal"] { opacity: 1 !important; transform: none !important; }
    * { animation-play-state: paused !important; }
    #cookieBanner { display: none !important; }
  \`;
  document.head.appendChild(st);
  document.querySelectorAll('.dpo-reveal').forEach(el => el.classList.add('dpo-in'));
  document.querySelectorAll('img[loading="lazy"]').forEach(el => el.loading = 'eager');
  return 1;
})()`;

async function scrollThrough(s) {
  const h = await s.eval(`document.documentElement.scrollHeight`);
  for (let y = 0; y < h; y += 600) { await s.eval(`(window.scrollTo(0, ${y}), 1)`); await sleep(80); }
  await s.eval(`(window.scrollTo(0, 0), 1)`);
  await sleep(600);
}

async function rectOf(s, expr) {
  return s.eval(`(() => {
    const v = ${expr};
    if (!v) return null;
    const list = Array.isArray(v) ? v.filter(Boolean) : [v];
    if (!list.length) return null;
    let t = Infinity, b = -Infinity, l = Infinity, r = -Infinity, vt = Infinity, vb = -Infinity;
    let fixed = false;
    for (const el of list) {
      const q = el.getBoundingClientRect();
      t = Math.min(t, q.top + scrollY); b = Math.max(b, q.bottom + scrollY);
      l = Math.min(l, q.left + scrollX); r = Math.max(r, q.right + scrollX);
      vt = Math.min(vt, q.top); vb = Math.max(vb, q.bottom);
      if (getComputedStyle(el).position === 'fixed') fixed = true;
    }
    return { x: Math.max(0, Math.floor(l)), y: Math.max(0, Math.floor(t)),
             w: Math.ceil(r - l), h: Math.ceil(b - t),
             vy: Math.floor(vt), vh: Math.ceil(vb - vt), fixed,
             docW: document.documentElement.scrollWidth };
  })()`);
}

async function capture(s, file, clip, scale, beyond = true) {
  const r = await s.send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: beyond,
    clip: { x: clip.x, y: clip.y, width: clip.w, height: clip.h, scale },
  });
  fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  return file;
}

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const s = await connect();
  const manifest = [];

  for (const [pageName, cfg] of Object.entries(MAP)) {
    for (const width of [1440, 390]) {
      const wanted = cfg.sections.filter(([, , o]) => (o?.width || 1440) === width);
      if (!wanted.length) continue;
      await goto(s, cfg.url, { width, height: 900, dpr: 1 });
      await s.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      await s.eval(PREP);
      await scrollThrough(s);

      for (const [section, expr, opt] of wanted) {
        if (opt?.banner) {
          await s.eval(`(document.getElementById('__shotPrep')?.remove(), window.scrollTo(0, 0), 1)`);
          await sleep(300);
        }
        const rect = await rectOf(s, expr);
        if (!rect || rect.h < 4) {
          if (opt?.banner) await s.eval(PREP);
          manifest.push({ page: pageName, section, error: 'не найден или нулевой', width }); continue;
        }
        // раздел во всю ширину страницы, а не только своей коробки
        const x = 0, w = Math.min(rect.docW, width);
        const scale = width === 390 ? 2 : 1.35;
        const slices = [];
        if (rect.fixed) {
          // элемент висит поверх страницы: берём кусок ОКНА вокруг него, с воздухом сверху
          const lift = Math.min(opt?.width === 390 ? 420 : 150, rect.vy);
          const name = `${manifest.length}-0.png`;
          const h = Math.min(rect.vh + lift + 20, 900 - (rect.vy - lift));
          await capture(s, path.join(OUT, name), { x, y: rect.vy - lift, w, h }, scale, false);
          slices.push({ file: name, w, h });
        } else {
          for (let off = 0, i = 0; off < rect.h; off += SLICE_MAX - OVERLAP, i++) {
            const h = Math.min(SLICE_MAX, rect.h - off);
            if (h < 12) break;
            const name = `${manifest.length}-${i}.png`;
            await capture(s, path.join(OUT, name), { x, y: rect.y + off, w, h }, scale);
            slices.push({ file: name, w, h });
            if (off + SLICE_MAX >= rect.h) break;
          }
        }
        if (opt?.banner) await s.eval(PREP);
        manifest.push({ page: pageName, section, width, rect, slices });
        console.log(`${pageName} / ${section} — ${rect.w}x${rect.h}, полос: ${slices.length}`);
      }
    }
  }
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
