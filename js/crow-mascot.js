/* Ворона Шерлок — маскот Центра ДПО факультета права НИУ ВШЭ.
   Слои вырезаны из исходного файла ворона_шерлок_новые_ботинки.pdf попиксельно;
   форма не перерисована, движение задаётся только поворотами и сдвигами.

   Файл перенесён из пакета design_handoff_crow_mascot почти без изменений
   (README пакета это прямо разрешает). Отличия от присланной версии —
   задача 9 (08.09.2026):
     - слои .png заменены на .webp (images/crow/*.webp, задача 8: 11 файлов,
       82 КБ вместо ~750 КБ у PNG-исходников); версии в query ?vNN убраны –
       build() всё равно отрезает их через split('?')[0] до подстановки
       assetPath, они не выполняли функцию кэш-бастинга в этом проекте;
     - prefers-reduced-motion: при включённой настройке цикл кадров вообще
       не запускается (ни requestAnimationFrame, ни слежение за курсором) –
       ворона показывается один раз в позе покоя (кадр t=0 анимации idle);
     - версия для слабовидящих (html.vi-mode): маскот скрывается целиком
       (см. build()) – он декоративен (alt="" у всех слоёв), а 11
       перекрывающихся слоёв под чёрной обводкой в режиме высокой
       контрастности читались бы хуже, чем их отсутствие; функциональность
       не теряется – рядом всегда стоит настоящая кнопка «Подать заявку»
       (создаётся вызывающим кодом, не этим файлом);
     - реплика простоя («Есть вопросы?») ограничена ОДНИМ разом за все
       посещения (решение владельца): после первого показа в localStorage
       ставится отметка (см. ASKQ_KEY/ASKQ_DAYS ниже, по образцу
       channel-invite-closed из js/channel-invite.js) – дальше автоматический
       idle-таймер молчит;
     - ленивая загрузка: этот файл только объявляет CrowMascot.mount – САМ
       вызов mount() (а значит и создание <img>, из-за которого грузятся
       слои) остаётся за вызывающим кодом. В index.html он отложен до
       события window.load, чтобы 11 картинок не спорили за полосу с
       ресурсами первого экрана;
     - выход в содержимое (задача 13, 08.09.2026): маскот выбегает из-за
       края блока и останавливается у его края с репликой «Подсказать?» –
       см. instance.walkIn() и CrowMascot.mountWalkIn() ниже. Каталог –
       слот у панели поиска/фильтров, лента «Топ-5» на лендинге – слот у
       правого края ленты; срабатывает КАЖДЫЙ раз, когда слот попадает в
       кадр (решение владельца), не один раз за визит.

   Использование:
     <script src="crow-mascot.js"></script>
     <script>CrowMascot.mount({ assetPath: '/assets/crow/' })</script>

   API:
     CrowMascot.mount(options) -> instance
       assetPath   путь к папке со слоями (по умолчанию 'parts/')
       anchor      'bottom-right' | 'bottom-left' | HTMLElement  (куда монтировать)
                   HTMLElement – маскот встаёт В ПОТОК этого элемента, по
                   центру (иллюстрация внутри блока, не помощник в углу
                   экрана); см. пустой результат фильтров каталога, задача 10
       align       'center' (по умолчанию) | 'right' – при HTMLElement-анкоре
                   и 'right' маскот стоит у ПРАВОГО края слота, не по центру
                   (задача 13: так walkAcross останавливается у края блока)
       width       ширина маскота в px (по умолчанию 260)
       speed       множитель скорости (0.5–1.5, по умолчанию 1)
       followCursor следить за курсором (по умолчанию true)
       idleSeconds через сколько секунд бездействия сказать «Есть вопросы?» (14; 0 — выключить)
       onClick     функция; если задана, вызывается по клику вместо реплики
       zIndex      z-index контейнера (по умолчанию 40; на лендинге – 920,
                   см. index.html: угол принадлежит вороне, бейдж канала MAX
                   и мобильная полоса-CTA подвинуты в своих файлах)
     instance.play('runIn' | 'idle' | 'walk' | 'walkAcross' | 'nod' | 'shake' | 'wave'
                   | 'inspect' | 'point' | 'jump' | 'think' | 'leave' | 'helpQ' | 'askQ' | 'invite')
     instance.walkIn(skipWalk)  выход в содержимое (задача 13): walkAcross,
                   затем реплика «Подсказать?», которая не гаснет сама
                   (invite); skipWalk – true пропускает пробег, сразу поза
                   приглашения (телефон: 390px мало для пробега)
     instance.destroy()

     CrowMascot.mountWalkIn(slot, options) – выход в содержимое целиком:
       слот (HTMLElement, data-crow-walk в разметке) одновременно и «блок»
       для наблюдателя пересечения, и anchor для mount(); инстанс
       создаётся при входе слота в кадр и уничтожается при выходе (задача
       13, КАЖДЫЙ раз, не один раз за визит); клик по маскоту открывает
       окно бота ([data-bot-open], делегировано в js/support-bot.js).
       options: assetPath, width (по умолчанию 120)
*/
(function (global) {
'use strict';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const ease = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const outCubic = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const bell = t => Math.sin(Math.PI * clamp(t, 0, 1));

function blinkAt(t, period) {
  const p = ((t % period) + period) % period, d = 0.12;
  if (p < d) return Math.sin(Math.PI * (p / d));
  if (p > 0.26 && p < 0.26 + d && Math.floor(t / period) % 3 === 0) return Math.sin(Math.PI * ((p - 0.26) / d));
  return 0;
}
function talk(t, dur) {
  if (t < 0 || t > dur) return 0;
  const env = Math.min(1, t / 0.1) * Math.min(1, (dur - t) / 0.12);
  const s = 0.5 + 0.5 * Math.sin(t * 15.5);
  return Math.pow(s, 0.75) * (0.55 + 0.45 * Math.abs(Math.sin(t * 3.4))) * env;
}
function rest() {
  return { rx: 0, ry: 0, flip: 1, op: 1, cy: 0, crot: 0, csx: 1, csy: 1, hx: 0, hy: 0, hrot: 0,
    ax: 0, ay: 0, arot: 0, llrot: 0, lrrot: 0, ex: 0, ey: 0, blink: 0, beak: 0, track: 1 };
}

const A = {};
A.idle = { dur: 6, loop: 1, fn(t, p) {
  p.cy = Math.sin(t * 1.7) * 3.5;
  p.csy = 1 + Math.sin(t * 1.7) * 0.007; p.csx = 1 - Math.sin(t * 1.7) * 0.007;
  p.crot = Math.sin(t * 0.75) * 0.5;
  p.hrot = Math.sin(t * 0.72 + 1.1) * 1.3;
  p.hy = Math.sin(t * 1.7 + 0.4) * 2.6;
  p.arot = Math.sin(t * 0.95) * 1.6;
  p.blink = blinkAt(t, 4.1);
} };
A.walk = { dur: 0.92, loop: 1, fn(t, p) {
  const ph = t / 0.92 * TAU;
  const step = Math.abs(Math.sin(ph));
  p.cy = -step * 9 + 3;
  p.crot = Math.sin(ph) * 2.2;
  p.llrot = Math.sin(ph) * 10;
  p.lrrot = Math.sin(ph + Math.PI) * 10;
  p.csx = 1 + step * 0.006; p.csy = 1 - step * 0.006;
  p.hy = -Math.abs(Math.sin(ph + 0.45)) * 4 + 1.5;
  p.hrot = Math.sin(ph + 0.85) * 3;
  p.hx = Math.sin(ph) * 4;
  p.arot = Math.sin(ph + Math.PI) * 10;
  p.blink = blinkAt(t, 3.3);
} };
A.walkAcross = { dur: 5.4, loop: 1, track: 0, fn(t, p) {
  A.walk.fn(t, p);
  p.rx = 300 - (t / 5.4) * 900;
} };
A.runIn = { dur: 2.5, loop: 0, fn(t, p) {
  const run = clamp(t / 1.1, 0, 1);
  const ph = t / 0.36 * TAU;
  p.rx = -640 * (1 - outCubic(run));
  if (t < 1.1) {
    p.llrot = Math.sin(ph) * 15; p.lrrot = Math.sin(ph + Math.PI) * 15;
    p.cy = -Math.abs(Math.sin(ph)) * 15;
    p.crot = -7 + Math.sin(ph) * 2.4;
    p.arot = -15 + Math.sin(ph + Math.PI) * 20;
    p.hrot = -2.5; p.hy = -3;
  } else {
    const b = clamp((t - 1.1) / 1.0, 0, 1), s = 1 - ease(b);
    p.rx = 30 * bell(clamp((t - 1.1) / 0.55, 0, 1));
    p.crot = -7 * s + 7 * bell(clamp((t - 1.1) / 0.7, 0, 1)) * s;
    p.llrot = 14 * s; p.lrrot = -11 * s;
    p.cy = -5 * s + Math.sin(t * 12) * 2 * s;
    p.arot = -12 * s;
    p.hrot = -2.5 * s + Math.sin((t - 1.1) * 10) * 2 * s;
    p.blink = blinkAt(t - 1.5, 2.2);
  }
} };
A.nod = { dur: 1.9, loop: 0, fn(t, p) {
  A.idle.fn(t, p);
  const env = t < 1.35 ? Math.pow(bell(t / 1.35), 0.55) : 0;
  const s = (1 - Math.cos(t * 8.6)) / 2;
  p.hy += s * 17 * env;
  p.hrot += -s * 2 * env;
  p.cy += s * 3 * env;
} };
A.shake = { dur: 2.1, loop: 0, fn(t, p) {
  A.idle.fn(t, p);
  const env = t < 1.5 ? Math.pow(bell(t / 1.5), 0.5) : 0;
  p.hrot += Math.sin(t * 10.5) * 2.4 * env;
  p.hx += Math.sin(t * 10.5) * 11 * env;
  p.ex += Math.sin(t * 10.5) * 2 * env;
} };
A.wave = { dur: 2.6, loop: 0, fn(t, p) {
  A.idle.fn(t, p);
  const u = ease(t / 0.34) - ease((t - 1.95) / 0.45);
  p.arot += -26 * u + Math.sin(t * 9.5) * 11 * u;
  p.ay += -16 * u; p.ax += 8 * u;
  p.hrot += -3 * u; p.crot += -1.3 * u;
} };
A.inspect = { dur: 4.2, loop: 1, track: 0, fn(t, p) {
  A.idle.fn(t * 0.6, p);
  const u = ease(t / 0.65) - ease((t - 3.4) / 0.6);
  const scan = Math.sin(t * 1.5);
  p.arot += (-11 + scan * 3) * u;
  p.ay += -54 * u; p.ax += 40 * u;
  p.hrot += (-9 + scan * 1.8) * u; p.hx += -16 * u; p.hy += 18 * u;
  p.ex += -4 * u; p.ey += 3 * u;
} };
A.point = { dur: 3, loop: 0, fn(t, p) {
  A.idle.fn(t * 0.7, p);
  const u = ease(t / 0.42) - ease((t - 2.3) / 0.5);
  const jab = (t > 0.5 && t < 1.7) ? Math.sin((t - 0.5) * 8) : 0;
  p.arot += (-38 + jab * 5) * u;
  p.ay += -26 * u; p.ax += -8 * u;
  p.hrot += -7 * u; p.crot += -2 * u; p.ex += -2 * u;
} };
A.jump = { dur: 2, loop: 0, fn(t, p) {
  let sq = 0, h = 0;
  if (t < 0.34) sq = bell(t / 0.34);
  if (t >= 0.34 && t < 1.08) h = bell((t - 0.34) / 0.74);
  if (t >= 1.08 && t < 1.5) sq = bell((t - 1.08) / 0.42) * 0.8;
  p.ry = -h * 155;
  p.csy = 1 - sq * 0.11 + h * 0.05; p.csx = 1 + sq * 0.09 - h * 0.04;
  p.cy = sq * 15;
  p.llrot = -h * 13 + sq * 6; p.lrrot = h * 13 - sq * 6;
  p.arot = -h * 32 + sq * 13;
  p.hy = -h * 9 + sq * 6; p.hrot = h * 4;
  p.beak = h * 0.55;
  p.blink = blinkAt(t + 1.4, 3);
} };
A.think = { dur: 4.6, loop: 1, fn(t, p) {
  A.idle.fn(t * 0.55, p);
  const u = ease(t / 0.7) - ease((t - 3.8) / 0.7);
  p.hrot += 8.5 * u; p.hx += 5 * u;
  p.arot += -11 * u; p.ay += -32 * u; p.ax += 30 * u;
  p.ey += -5 * u; p.ex += 3 * u;
  p.cy += Math.sin(t * 1.25) * 2.2 * u;
} };
A.leave = { dur: 3.5, loop: 0, fn(t, p) {
  if (t < 0.8) {
    A.idle.fn(t, p);
    const u = bell(t / 0.8);
    p.arot += -25 * u; p.ay += -13 * u; p.hrot += -3 * u;
  } else {
    A.walk.fn(t - 0.8, p);
    p.rx = -600 * ease((t - 0.8) / 2.1);
    p.op = 1 - clamp((t - 2.4) / 0.9, 0, 1);
  }
} };
A.helpQ = { dur: 4.6, loop: 0, bubble: [0.5, 3.9], text: 'Чем помочь?', fn(t, p) {
  A.idle.fn(t, p);
  const u = ease((t - 0.15) / 0.32) - ease((t - 2.3) / 0.45);
  p.arot += -20 * u + Math.sin(t * 8.4) * 6 * u;
  p.ay += -11 * u;
  p.beak = talk(t - 0.55, 1.15);
  p.hy += Math.sin((t - 0.55) * 14) * 2 * (t > 0.55 && t < 1.7 ? 1 : 0);
  p.hrot += -2.2 * u;
} };
A.askQ = { dur: 4.6, loop: 0, bubble: [0.45, 3.9], text: 'Есть вопросы?', fn(t, p) {
  A.idle.fn(t, p);
  const u = ease((t - 0.1) / 0.35) - ease((t - 2.5) / 0.5);
  p.hrot += 7 * u; p.hx += 4 * u;
  p.beak = talk(t - 0.5, 1.25);
  p.arot += -9 * u; p.ay += -8 * u;
  p.cy += -3 * u;
  p.ey += -3 * u;
} };
/**
 * Приглашение после выхода в содержимое (задача 13): реплика «Подсказать?»
 * не гаснет сама, как у askQ/helpQ (там короткий цикл, дальше маскот
 * возвращается к простому ожиданию) – она держится, пока слот на экране
 * или пока по маскоту не кликнут, поэтому dur нарочно огромный и loop:0
 * (кадр просто перестаёт когда-либо доходить до конца). Тело живёт
 * обычным idle – дыхание и моргание, чтобы поза не читалась приклеенной.
 */
A.invite = { dur: 999, loop: 0, bubble: [0.15, 998], text: 'Подсказать?', fn: A.idle.fn };

var LAYERS = ['torso','neck','head','eyeL','eyeR','arm','legR','legL','body','mouth','beak'];

/** prefers-reduced-motion: проверяется один раз при монтировании (см. конструктор). */
var REDUCED_MOTION = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Одна реплика простоя за все посещения (решение владельца, задача 9).
 * Ключ и срок – по образцу channel-invite-closed (js/channel-invite.js):
 * отметка живёт 30 дней, дальше idle-таймер снова может заговорить один раз.
 */
var ASKQ_KEY = 'crow-askq-shown';
var ASKQ_DAYS = 30;
function askQAlreadyShown() {
  try {
    var at = Number(localStorage.getItem(ASKQ_KEY) || 0);
    return !!at && Date.now() - at < ASKQ_DAYS * 24 * 3600 * 1000;
  } catch (e) {
    return false;
  }
}
function markAskQShown() {
  try { localStorage.setItem(ASKQ_KEY, String(Date.now())); } catch (e) { /* приватный режим */ }
}

/**
 * Маскот на экране – один (задача 11.1: экран «Спасибо!» поверх угловой
 * вороны лендинга или вороны пустого результата каталога дали ДВЕ вороны
 * одновременно). У нового инстанса приоритет: все уже смонтированные к
 * этому моменту вороны мягко прячутся (hide/show ниже) и возвращаются
 * сами, когда новый инстанс перестаёт существовать (destroy). Работает
 * для любых двух CrowMascot.mount() – независимо от файла и момента вызова.
 */
var LIVE = [];
function suppressExisting(newcomer) {
  var hidden = [];
  LIVE.forEach(function (inst) {
    if (inst === newcomer || inst.hidden) return;
    inst.hide();
    hidden.push(inst);
  });
  return hidden;
}
function restoreSuppressed(list) {
  list.forEach(function (inst) {
    if (LIVE.indexOf(inst) !== -1) inst.show();
  });
}

var RIG_HTML = "<div data-part=\"bubble\" style=\"position:absolute;right:70%;bottom:82%;opacity:0;transform-origin:100% 100%;pointer-events:none;z-index:3\">\n    <div style=\"position:relative;background:#fff;border:3px solid #16181C;border-radius:20px;padding:11px 17px;font-size:16px;font-weight:600;line-height:1.15;white-space:nowrap;color:#211E1B;box-shadow:0 5px 0 rgba(22,24,28,.09);font-family:'HSE Sans',system-ui,sans-serif\">\n      <span data-part=\"bubbleText\">Чем помочь?</span>\n      <div style=\"position:absolute;right:calc(-4px * var(--crow-k,1));bottom:calc(-77px * var(--crow-k,1));width:calc(64px * var(--crow-k,1));height:calc(80px * var(--crow-k,1))\">\n        <div style=\"position:absolute;inset:0;background:#16181C;clip-path:polygon(24% 0,62% 0,100% 100%)\"></div>\n        <div style=\"position:absolute;left:3px;right:3px;top:-5px;bottom:4px;background:#fff;clip-path:polygon(29% 0,58% 0,96% 100%)\"></div>\n      </div>\n    </div>\n  </div>\n  <div data-part=\"root\" style=\"position:absolute;inset:0\">\n  <div data-part=\"shadow\" style=\"position:absolute;left:30%;top:86.5%;width:40%;height:4.4%;border-radius:50%;background:#211E1B;opacity:.16;filter:blur(3px)\"></div>\n  <div data-part=\"char\" style=\"position:absolute;inset:0;transform-origin:50% 88%\">\n  <img src=\"parts/torso.webp\" alt=\"\" style=\"position:absolute;left:0;top:0;width:100%;display:block\"><img src=\"parts/neck.webp\" alt=\"\" style=\"position:absolute;left:0;top:0;width:100%;display:block\">\n  <div data-part=\"head\" style=\"position:absolute;inset:0;transform-origin:51.43% 53.93%\">\n  <img src=\"parts/head.webp\" alt=\"\" style=\"position:absolute;left:28.786%;top:13.652%;width:47.786%;display:block\">\n  <img data-part=\"eyeL\" src=\"parts/eyeL.webp\" alt=\"\" style=\"position:absolute;left:38.143%;top:26.962%;width:6.5%;display:block;transform-origin:48.4% 46%\">\n  <img data-part=\"eyeR\" src=\"parts/eyeR.webp\" alt=\"\" style=\"position:absolute;left:53.143%;top:26.962%;width:6.286%;display:block;transform-origin:50% 48%\">\n  </div>\n  <div data-part=\"arm\" style=\"position:absolute;left:17.07%;top:41.71%;width:18.5%;height:29.28%;transform-origin:108.5% 60.8%\">\n  <img src=\"parts/arm.webp\" alt=\"\" style=\"position:absolute;left:0;top:0;width:101.158%;display:block\">\n  </div>\n  <img data-part=\"legR\" src=\"parts/legR.webp\" alt=\"\" style=\"position:absolute;left:48.357%;top:72.969%;width:23.786%;display:block;transform-origin:38.44% 36.02%\">\n  <img data-part=\"legL\" src=\"parts/legL.webp\" alt=\"\" style=\"position:absolute;left:33.643%;top:72.082%;width:16.929%;display:block;transform-origin:54.43% 42.92%\">\n  <img src=\"parts/body.webp\" alt=\"\" style=\"position:absolute;left:33.571%;top:48.669%;width:49.643%;display:block\">\n  <div data-part=\"jaw\" style=\"position:absolute;inset:0;transform-origin:51.43% 53.93%\">\n  <img src=\"parts/mouth.webp\" alt=\"\" style=\"position:absolute;left:32.5%;top:49.42%;width:18.214%;display:block\">\n  <img data-part=\"beak\" src=\"parts/beak.webp\" alt=\"\" style=\"position:absolute;left:32.5%;top:49.42%;width:18.214%;display:block;transform-origin:98.43% 3.06%\">\n  </div>\n  </div>\n  </div>";

function CrowMascot(opts) {
  opts = opts || {};
  this.opt = {
    assetPath: opts.assetPath || 'parts/',
    anchor: opts.anchor || 'bottom-right',
    align: opts.align || 'center',
    width: opts.width || 260,
    speed: opts.speed || 1,
    followCursor: opts.followCursor !== false,
    idleSeconds: opts.idleSeconds == null ? 14 : opts.idleSeconds,
    onClick: opts.onClick || null,
    zIndex: opts.zIndex || 40,
    // solo по умолчанию true: маскот, смонтированный без оговорки, прячет
    // уже стоящих (историческое правило «маскот на экране один»).
    solo: opts.solo !== false
  };
  this.mouse = null;
  this.reducedMotion = REDUCED_MOTION;
  // prefers-reduced-motion: без раннего забега слева ('runIn' – само по себе
  // движение), сразу поза покоя.
  this.anim = this.reducedMotion ? 'idle' : 'runIn';
  this.t0 = null;
  this.queue = ['idle'];
  this.build();
  this.bind();
  // Маскот на экране – один: новый инстанс сразу же прячет тех, что уже
  // смонтированы (см. suppressExisting выше), и вернёт их сам при destroy().
  LIVE.push(this);
  // solo:false – новый маскот НЕ прячет уже стоящих. Так монтируются
  // ворона в содержимом (walkIn) и ворона в пустом результате каталога:
  // угловая обязана оставаться на месте всегда (решение владельца
  // 08.09.2026 – «не пропадать оттуда»). Правило «маскот на экране один»
  // остаётся для окна бота и модальных окон: там маскот прячет
  // js/support-bot.js и js/application-form.js, и оба возвращают его сами.
  this.suppressedByMe = this.opt.solo === false ? [] : suppressExisting(this);
  if (this.reducedMotion) {
    // Цикл кадров не запускается вовсе: ни requestAnimationFrame, ни
    // слежение за курсором, ни автоматическая реплика простоя. Поза
    // считается один раз (кадр t=0 анимации idle – нейтральный, все
    // синусоиды дают 0) и применяется статично.
    var restPose = rest();
    A.idle.fn(0, restPose);
    this.apply(restPose);
  } else {
    this.frame = this.frame.bind(this);
    this.raf = requestAnimationFrame(this.frame);
  }
}

/**
 * Версия для слабовидящих (html.vi-mode): маскот скрывается целиком, а не
 * обводится/обесцвечивается, как у бейджа канала или опроса. Причина –
 * ворона декоративна (alt="" у всех 11 слоёв, ничего не сообщает диктору),
 * и 11 перекрывающихся слоёв под чёрной обводкой и grayscale в режиме
 * высокого контраста читались бы кучей тёмных пятен, а не фигурой. Кнопка
 * «Подать заявку» рядом с маскотом (создаёт вызывающий код) в vi-mode не
 * скрывается – функциональность не теряется.
 */
function ensureViModeStyle() {
  if (document.getElementById('crow-vi-mode-style')) return;
  var style = document.createElement('style');
  style.id = 'crow-vi-mode-style';
  style.textContent = 'html.vi-mode .crow-mascot{display:none!important}';
  (document.head || document.documentElement).appendChild(style);
}

CrowMascot.prototype.build = function () {
  ensureViModeStyle();
  var o = this.opt;
  var host = document.createElement('div');
  host.className = 'crow-mascot';
  var w = o.width, h = Math.round(w * 1465 / 1400);
  // Переход на opacity/transform – только для hide()/show() (маскот на
  // экране один, ниже): свойства позиции и размера сами по себе никогда не
  // меняются после монтирования, transition на них не сыграет.
  var fade = 'transition:opacity .22s cubic-bezier(.22,1,.36,1),transform .22s cubic-bezier(.22,1,.36,1);';
  if (o.anchor instanceof HTMLElement) {
    // В потоке контейнера, не углом экрана: обычный блок с явными
    // width/height, отцентрован полями (задача 10 – иллюстрация в пустом
    // результате фильтров каталога, не помощник поверх контента).
    // align:'right' (задача 13, выход в содержимое): маскот стоит у ПРАВОГО
    // края слота, а не по центру – так после walkAcross он останавливается
    // у края блока, а не посередине пустого слота.
    var margin = o.align === 'right' ? '0 0 0 auto' : '0 auto';
    host.style.cssText = 'position:relative;width:' + w + 'px;height:' + h + 'px;margin:' + margin + ';z-index:' + o.zIndex + ';' + fade;
    o.anchor.appendChild(host);
  } else {
    var side = o.anchor === 'bottom-left' ? 'left:24px' : 'right:24px';
    host.style.cssText = 'position:fixed;' + side + ';bottom:0;width:' + w + 'px;height:' + h + 'px;cursor:pointer;z-index:' + o.zIndex + ';' + fade;
    document.body.appendChild(host);
  }
  // Хвостик реплики тянется от угла пузыря к КЛЮВУ, а место клюва задано в
  // процентах от маскота – значит и длина хвостика обязана считаться от
  // ширины маскота, иначе на вороне в содержимом (120px) хвостик от угловой
  // (200px) ложится через всю голову. Живой дефект 09.09.2026.
  host.style.setProperty('--crow-k', (w / 200).toFixed(4));

  var stage = document.createElement('div');
  stage.setAttribute('data-rig', 'crow');
  stage.style.cssText = 'position:absolute;left:0;bottom:-4%;width:100%;aspect-ratio:1400/1465';
  stage.innerHTML = RIG_HTML;
  host.appendChild(stage);
  stage.querySelectorAll('img').forEach(function (im) {
    var s = im.getAttribute('src').replace(/^parts\//, '').split('?')[0];
    im.setAttribute('src', o.assetPath + s);
    im.setAttribute('draggable', 'false');
  });
  this.host = host;
  this.stage = stage;
  this.parts = {};
  var self = this;
  stage.querySelectorAll('[data-part]').forEach(function (n) { self.parts[n.dataset.part] = n; });
};

CrowMascot.prototype.bind = function () {
  var self = this;
  this.lastActive = performance.now() / 1000;
  this.onMove = function (e) { self.mouse = { x: e.clientX, y: e.clientY }; self.lastActive = performance.now() / 1000; };
  this.onAct = function () { self.lastActive = performance.now() / 1000; };
  window.addEventListener('pointermove', this.onMove, { passive: true });
  window.addEventListener('scroll', this.onAct, { passive: true });
  window.addEventListener('keydown', this.onAct, { passive: true });
  this.onClick = function () {
    if (self.opt.onClick) { self.opt.onClick(self); return; }
    self.play(Math.random() < 0.5 ? 'nod' : 'askQ');
  };
  this.host.addEventListener('click', this.onClick);
  this.io = new IntersectionObserver(function (es) {
    es.forEach(function (e) { self.visible = e.isIntersecting; });
  }, { rootMargin: '120px' });
  this.io.observe(this.stage);
  this.visible = true;
};

CrowMascot.prototype.play = function (name) {
  if (!A[name]) return;
  this.anim = name; this.t0 = null; this.queue = ['idle'];
};

/**
 * Выход в содержимое (задача 13): пробег через слот и остановка у края с
 * репликой «Подсказать?». Вызывается сразу после mount() у инстанса,
 * смонтированного В СЛОТ (anchor – HTMLElement, не угол экрана).
 *
 *   skipWalk – true, когда сама анимация выхода не нужна (телефон: 390px
 *              мало для пробега; узкий экран решает вызывающий код) –
 *              маскот сразу встаёт в позу приглашения с репликой.
 *
 * prefers-reduced-motion уже решён в конструкторе: RAF не запускается,
 * поза статична (кадр t=0 idle), tick()/bubble() не вызываются никогда –
 * поэтому play()/queue здесь бессмысленны, и вместо анимации реплика
 * проставляется на разметку напрямую, без перехода прозрачности.
 *
 * ЛОВУШКА (нашлась в браузере, не по коду): A.walkAcross зациклена
 * (loop:1, из пакета – так же зациклен A.idle/A.think и другие). Очередь
 * this.queue, которой play() пользуется для перехода к следующей
 * анимации, читается ТОЛЬКО в нецикличной ветке tick() – у зацикленной
 * walkAcross её никто не проверяет, и она крутилась бы вечно, если просто
 * положить туда 'invite'. Переход делает явный таймер на длительность
 * самого пробега (A.walkAcross.dur, с поправкой на speed).
 */
CrowMascot.prototype.walkIn = function (skipWalk) {
  if (this.reducedMotion) {
    if (this.parts.bubbleText) this.parts.bubbleText.textContent = A.invite.text;
    if (this.parts.bubble) this.parts.bubble.style.opacity = '1';
    return;
  }
  if (skipWalk) { this.play('invite'); return; }
  this.play('walkAcross');
  var self = this;
  clearTimeout(this.walkInTimer);
  this.walkInTimer = setTimeout(function () {
    if (self.anim !== 'walkAcross') return;
    // ГДЕ ВСТАЛА – ТАМ И СТОИТ (решение владельца 08.09.2026). walkAcross
    // ведёт ворону смещением p.rx от +300 до -600, а поза приглашения
    // (invite = idle) горизонтального смещения не задаёт вовсе – значит,
    // при переключении rest() возвращал бы rx к нулю, и ворона прыгала бы
    // назад, к месту старта. Запоминаем конечное смещение пробега и держим
    // его дальше (см. holdRx в tick).
    self.holdRx = 300 - 900;
    self.play('invite');
  }, A.walkAcross.dur * 1000 / (this.opt.speed || 1));
};

CrowMascot.prototype.frame = function (now) {
  this.tick(now / 1000);
  this.raf = requestAnimationFrame(this.frame);
};

CrowMascot.prototype.tick = function (now) {
  if (!this.visible) return;
  var speed = this.opt.speed;
  if (this.anim === 'idle' && this.opt.idleSeconds > 0 && now - this.lastActive > this.opt.idleSeconds) {
    this.lastActive = now;
    // Одна реплика простоя за визит (решение владельца): дальше idle-таймер
    // молчит, пока отметка ASKQ_KEY не истечёт (30 дней, как у бейджа канала).
    if (!askQAlreadyShown()) {
      markAskQShown();
      this.play('askQ');
    }
  }
  if (this.t0 === null) this.t0 = now;
  var name = this.anim, t = (now - this.t0) * speed, def = A[name] || A.idle;
  if (!def.loop && t > def.dur) {
    this.anim = this.queue.shift() || 'idle';
    this.t0 = now; t = 0; name = this.anim; def = A[name] || A.idle;
  } else if (def.loop && t > def.dur) {
    this.t0 = now - (t % def.dur) / speed; t = t % def.dur;
  }
  var p = rest();
  // Смещение, на котором ворона остановилась после пробега (см. walkIn).
  var holdRx = this.holdRx || 0;
  def.fn(t, p);
  // Пробег сам ведёт rx, остальным позам смещение добавляется здесь –
  // иначе ворона после реплики вернулась бы к месту старта.
  if (holdRx && name !== 'walkAcross') p.rx += holdRx;

  if (this.opt.followCursor && def.track !== 0 && this.mouse) {
    if (!this.rect || now - (this.rectT || 0) > 0.4) { this.rect = this.stage.getBoundingClientRect(); this.rectT = now; }
    var r = this.rect;
    var cx = r.left + r.width * 0.52, cy = r.top + r.height * 0.33;
    var dx = clamp((this.mouse.x - cx) / 320, -1, 1), dy = clamp((this.mouse.y - cy) / 280, -1, 1);
    p.ex += dx * 7; p.ey += dy * 6;
    p.hrot += dx * 4.2; p.hx += dx * 15; p.hy += dy * 9;
  }

  if (this.prev !== name) {
    this.blendFrom = this.lastPose ? Object.assign({}, this.lastPose) : null;
    this.blendT = now; this.prev = name;
  }
  var pose = p;
  if (this.blendFrom) {
    var k = ease((now - this.blendT) / 0.28);
    if (k >= 1) this.blendFrom = null;
    else { pose = {}; for (var key in p) pose[key] = this.blendFrom[key] * (1 - k) + p[key] * k; }
  }
  this.lastPose = pose;
  this.apply(pose);
  this.bubble(def, t);
};

CrowMascot.prototype.apply = function (p) {
  var q = this.parts, pc = function (v, d) { return (v / d * 100).toFixed(3); };
  // Реплика едет за вороной. Горизонтальное смещение позы (p.rx – пробег
  // walkAcross и запомненное holdRx) висит на [data-part=root], а пузырь
  // ему НЕ потомок: внутри root он ловил бы scaleX(-1) и текст читался бы
  // зеркально. Поэтому то же смещение переводится в пиксели и добавляется
  // пузырю отдельно – иначе хвостик, наведённый на клюв, оставался бы на
  // месте старта (живой дефект 09.09.2026 на вороне в содержимом: она
  // добегает до края блока, а реплика висит там, откуда она вышла).
  this.rxPx = p.rx / 1400 * this.opt.width;
  if (q.root) {
    q.root.style.transform = 'translate(' + pc(p.rx, 1400) + '%,' + pc(p.ry, 1465) + '%) scaleX(' + p.flip + ')';
    q.root.style.opacity = p.op;
  }
  if (q.char) q.char.style.transform = 'translate(0,' + pc(p.cy, 1465) + '%) rotate(' + p.crot.toFixed(2) + 'deg) scale(' + p.csx.toFixed(4) + ',' + p.csy.toFixed(4) + ')';
  var headT = 'translate(' + pc(p.hx, 1400) + '%,' + pc(p.hy, 1465) + '%) rotate(' + p.hrot.toFixed(2) + 'deg)';
  if (q.head) q.head.style.transform = headT;
  if (q.jaw) q.jaw.style.transform = headT;
  if (q.arm) q.arm.style.transform = 'translate(' + pc(p.ax, 259) + '%,' + pc(p.ay, 429) + '%) rotate(' + p.arot.toFixed(2) + 'deg)';
  if (q.legL) q.legL.style.transform = 'rotate(' + p.llrot.toFixed(2) + 'deg)';
  if (q.legR) q.legR.style.transform = 'rotate(' + p.lrrot.toFixed(2) + 'deg)';
  var es = 'translate(' + pc(p.ex, 88) + '%,' + pc(p.ey, 135) + '%) scaleY(' + (1 - p.blink * 0.92).toFixed(3) + ')';
  if (q.eyeL) q.eyeL.style.transform = es;
  if (q.eyeR) q.eyeR.style.transform = es;
  if (q.beak) q.beak.style.transform = 'rotate(' + (p.beak * -6.5).toFixed(2) + 'deg)';
  if (q.shadow) {
    var s = 1 - clamp(-p.ry / 420, 0, 0.45);
    q.shadow.style.transform = 'scale(' + s.toFixed(3) + ')';
    q.shadow.style.opacity = (0.16 * s * p.op).toFixed(3);
  }
};

CrowMascot.prototype.bubble = function (def, t) {
  var b = this.parts.bubble;
  if (!b) return;
  var v = 0;
  if (def.bubble) v = ease((t - def.bubble[0]) / 0.26) - ease((t - def.bubble[1]) / 0.3);
  if (def.text && this.parts.bubbleText && v > 0.01 && this.parts.bubbleText.textContent !== def.text) {
    this.parts.bubbleText.textContent = def.text;
  }
  b.style.opacity = v.toFixed(3);
  b.style.transform = 'translateX(' + (this.rxPx || 0).toFixed(2) + 'px) translateY(' +
    ((1 - v) * 10).toFixed(2) + 'px) scale(' + (0.72 + 0.28 * v).toFixed(3) + ')';
};

/**
 * Мягкое скрытие/возврат (маскот на экране – один, см. suppressExisting
 * выше). display:none после угасания – намеренно тот же результат, что и
 * прокрутка вне экрана: IntersectionObserver из bind() перестаёт считать
 * стадию видимой, tick() перестаёт продвигать кадры анимации, пока маскот
 * спрятан, – второй способ не понадобился.
 */
CrowMascot.prototype.hide = function () {
  if (this.hidden) return;
  this.hidden = true;
  clearTimeout(this.hideTimer);
  var host = this.host;
  if (this.reducedMotion) {
    // Без перехода – тем же приёмом, что и статичная поза при монтировании.
    host.style.display = 'none';
    return;
  }
  host.style.opacity = '0';
  host.style.transform = 'translateY(10px) scale(.94)';
  var self = this;
  this.hideTimer = setTimeout(function () {
    if (self.hidden) host.style.display = 'none';
  }, 240);
};

CrowMascot.prototype.show = function () {
  if (!this.hidden) return;
  this.hidden = false;
  clearTimeout(this.hideTimer);
  var host = this.host;
  host.style.display = '';
  if (this.reducedMotion) return;
  // Перерасчёт стилей между снятием display:none и сменой opacity – иначе
  // браузер схлопывает оба шага в один кадр, и переход не проигрывается.
  void host.offsetWidth;
  host.style.opacity = '1';
  host.style.transform = '';
};

CrowMascot.prototype.destroy = function () {
  // reducedMotion: цикл кадров не запускался, this.raf не назначался.
  if (this.raf) cancelAnimationFrame(this.raf);
  window.removeEventListener('pointermove', this.onMove);
  window.removeEventListener('scroll', this.onAct);
  window.removeEventListener('keydown', this.onAct);
  if (this.io) this.io.disconnect();
  clearTimeout(this.hideTimer);
  clearTimeout(this.walkInTimer);
  if (this.host && this.host.parentNode) this.host.parentNode.removeChild(this.host);
  var idx = LIVE.indexOf(this);
  if (idx !== -1) LIVE.splice(idx, 1);
  if (this.suppressedByMe) {
    restoreSuppressed(this.suppressedByMe);
    this.suppressedByMe = null;
  }
};

/**
 * Выход в содержимое (задача 13): каталог (слот у панели поиска/фильтров)
 * и лента «Топ-5» на лендинге. Слот, переданный сюда (data-crow-walk в
 * разметке страницы), служит СРАЗУ двум ролям – это и «блок», за
 * появлением которого в кадре следит наблюдатель пересечения, и место,
 * куда встаёт сам маскот (anchor у mount) – одна граница вместо двух
 * вложенных друг в друга, отдельный wrapper не заводим.
 *
 * КАЖДЫЙ раз, когда слот попадает в кадр (решение владельца 08.09.2026, а
 * не один раз за визит): инстанс создаётся заново при входе в кадр и
 * уничтожается при выходе – тот же приём, что у зациклённой inspect в
 * пустом результате каталога (js/../Каталог программ.html, задача 10):
 * кадры вхолостую не считаются, пока слота нет на экране.
 *
 * По клику открывает окно бота: кнопка-хит несёт [data-bot-open] – тот же
 * делегированный на document слушатель, что у угловой вороны лендинга
 * (js/support-bot.js, комментарий в начале файла). Слушатель на самой
 * кнопке срабатывает раньше, чем событие успевает дойти по пузырьку до
 * document (кнопка ближе к месту клика), поэтому teardown() (он же
 * crow.destroy(), а значит и restoreSuppressed любого подавленного этим
 * маскотом инстанса – угловой вороны лендинга) отрабатывает ДО того, как
 * support-bot.js спрячет её на время открытого окна – порядок совпадает,
 * лишнего мигания нет.
 *
 * vi-mode: маскот и так скрыт целиком глобальным правилом (см.
 * ensureViModeStyle), а кнопка-хит – своим (ensureWalkStyle ниже);
 * проверка здесь просто экономит 11 картинок и цикл кадров, если
 * html.vi-mode уже стоит на момент показа слота.
 */
function ensureWalkStyle() {
  if (document.getElementById('crow-walk-style')) return;
  var style = document.createElement('style');
  style.id = 'crow-walk-style';
  style.textContent = '.crow-walk-hit:focus-visible{outline:none;box-shadow:0 0 0 2px #fff,0 0 0 4px rgb(var(--accent,22 88 218))}' +
    'html.vi-mode .crow-walk-hit{display:none!important}';
  (document.head || document.documentElement).appendChild(style);
}

function mountWalkIn(slot, opts) {
  opts = opts || {};
  var assetPath = opts.assetPath || 'images/crow/';
  var width = opts.width || 120;
  slot.style.position = 'relative';
  var current = null;

  function teardown() {
    if (!current) return;
    current.crow.destroy();
    if (current.hit.parentNode) current.hit.parentNode.removeChild(current.hit);
    current = null;
    document.documentElement.classList.remove('crow-inline-live');
  }

  function spawn() {
    if (current || document.documentElement.classList.contains('vi-mode')) return;
    ensureWalkStyle();
    var crow = new CrowMascot({
      assetPath: assetPath,
      anchor: slot,
      align: 'right',
      width: width,
      followCursor: false,
      idleSeconds: 0,
      solo: false,
      onClick: function () {} // клики ловит .crow-walk-hit поверх, см. ниже
    });
    var hit = document.createElement('button');
    hit.type = 'button';
    hit.className = 'crow-walk-hit';
    hit.setAttribute('data-bot-open', '');
    hit.setAttribute('aria-label', 'Открыть поддержку');
    // z-index ВЫШЕ маскота (у него z-index:40 по умолчанию, см. build()) –
    // тот же порядок, что у угловой .crow-hit-btn поверх .crow-mascot
    // (index.html: 921 против 920): иначе клик ловит сам рисунок маскота
    // (data-part="jaw" и подобные слои лежат выше по DOM) и до кнопки не
    // доходит вовсе.
    hit.style.cssText = 'position:absolute;inset:0;background:transparent;border:0;padding:0;margin:0;cursor:pointer;z-index:41';
    hit.addEventListener('click', teardown);
    slot.appendChild(hit);
    current = { crow: crow, hit: hit };
    // Пока ворона стоит в содержимом, УГЛОВАЯ остаётся видимой (решение
    // владельца: она не должна пропадать), но перестаёт ловить клики –
    // иначе её прозрачная кнопка 200×209 в правом нижнем углу накрывает
    // то, что оказалось под ней при этой прокрутке. Замер поймал стрелки
    // ленты «Топ-5»: по ним нельзя было нажать. Вход в бота при этом не
    // теряется – рядом стоит ворона в содержимом с той же кнопкой, а выше
    // кнопка в шапке.
    document.documentElement.classList.add('crow-inline-live');
    // Телефон: 390px мало для пробега на всю длину walkAcross – маскот
    // появляется сразу в позе приглашения, без бега.
    var narrow = typeof matchMedia === 'function' && matchMedia('(max-width:600px)').matches;
    crow.walkIn(narrow);
  }

  if (typeof IntersectionObserver !== 'function') { spawn(); return; }
  new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) { if (entry.isIntersecting) spawn(); else teardown(); });
  }, { threshold: 0.3 }).observe(slot);
}

global.CrowMascot = {
  mount: function (o) { return new CrowMascot(o); },
  mountWalkIn: mountWalkIn,
  animations: Object.keys(A)
};
})(window);
