/**
 * Modern motion polish for landing pages:
 * - smooth in-page scroll (sticky header offset)
 * - scroll-reveal for sections / cards
 * - subtle press feedback on buttons & nav
 * respects prefers-reduced-motion
 */
(() => {
  'use strict';

  if (window.__dpoSmoothUi) return;
  window.__dpoSmoothUi = true;

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const CSS = `
/* ── smooth-ui (injected) ───────────────────────────────── */
html{ scroll-behavior: ${reduce ? 'auto' : 'smooth'}; }
/* Частотный гейт (см. DESIGN.md, «Правило частотного гейта»).
   Общий переход намеренно не трогает transform и box-shadow: ссылки
   навигации наводят десятки раз за сессию, и движение на таком частом
   действии читается как задержка. Цвет и граница остаются — они
   объясняют состояние, а не двигают элемент. Движение живёт там, где
   действие редкое: карточки, карусель, появление секций.

   Отклик на нажатие под гейт не попадает: это обратная связь, а не
   украшение. Поэтому transform в списке остался, но на 140 мс, вдвое
   короче цветового перехода. Всё держим одним правилом сознательно:
   у общего перехода стоит !important, и отдельное правило для transform
   он бы перебил. */
a, button, .btn, [role="button"]{
  transition:
    color .28s cubic-bezier(.22,1,.36,1),
    background .28s cubic-bezier(.22,1,.36,1),
    border-color .28s cubic-bezier(.22,1,.36,1),
    opacity .28s cubic-bezier(.22,1,.36,1),
    transform .14s cubic-bezier(.22,1,.36,1) !important;
}
/* Раньше отклик висел на классе .btn, которого нет ни на одном элементе
   лендинга: 22 ссылки и 2 кнопки не отзывались на нажатие вообще. */
a[href]:active, button:not(:disabled):active, [role="button"]:active{
  transform: scale(0.97);
}
/* nav:not(.dpo-mobile-nav) – не косметика. Правило весит (0,3,3) и
   перебивало раскладку строк мобильного меню: у .dpo-mobile-apply
   оставался display: inline-block с padding 0, и подпись «Подать заявку»
   стояла в левом верхнем углу синей пилюли, вылезая за кромку. Заодно
   четыре строки меню из шести прижимались к верху своей 56px строки, а
   две были отцентрованы. Найдено контрольной критикой 21.08.2026 – первая
   попытка починки в тот же день подняла вес селектора кнопки, но не
   победила этот. Подчёркивание-индикатор мобильному меню и не нужно. */
header nav a.link,
header a.link,
header nav:not(.dpo-mobile-nav) a[href^="#"]:not(.btn):not([class*="btn-"]){
  position: relative;
  display: inline-block;
}
header nav a.link::after,
header a.link::after,
header nav:not(.dpo-mobile-nav) a[href^="#"]:not(.btn):not([class*="btn-"])::after{
  content: '';
  position: absolute;
  left: 0; right: 0; bottom: -4px;
  height: 2px;
  border-radius: 2px;
  background: currentColor;
  transform: scaleX(0);
  transform-origin: left center;
  transition: transform .32s cubic-bezier(.22,1,.36,1);
  opacity: 0.9;
  pointer-events: none;
}
/* Подчёркивание активного раздела остаётся всегда: это индикатор состояния
   при скролл-навигации, а не украшение. А вот подчёркивание по наведению
   живёт только там, где есть настоящий курсор. */
header nav a.link.is-active::after,
header a.link.is-active::after,
header nav:not(.dpo-mobile-nav) a.is-active[href^="#"]:not(.btn):not([class*="btn-"])::after{
  transform: scaleX(1);
}
@media (hover: hover) and (pointer: fine){
  header nav a.link:hover::after,
  header a.link:hover::after,
  header nav:not(.dpo-mobile-nav) a[href^="#"]:not(.btn):not([class*="btn-"]):hover::after{
    transform: scaleX(1);
  }
}
/* CTA «Записаться» — без нижнего подчёркивания */
header nav a.btn::after,
header a.btn::after,
header a[class*="btn-"]::after{
  content: none !important;
  display: none !important;
}

/* Scroll reveal */
.dpo-reveal{
  opacity: 0;
  transform: translateY(16px);
  filter: blur(4px);
  transition:
    opacity .7s cubic-bezier(.22,1,.36,1),
    transform .7s cubic-bezier(.22,1,.36,1),
    filter .7s cubic-bezier(.22,1,.36,1);
  transition-delay: var(--dpo-delay, 0ms);
}
.dpo-reveal.dpo-in{
  opacity: 1;
  transform: translateY(0);
  filter: blur(0);
}
.dpo-reveal-left{ transform: translateX(-24px); }
.dpo-reveal-left.dpo-in{ transform: translateX(0); }
.dpo-reveal-scale{ transform: scale(0.96); }
.dpo-reveal-scale.dpo-in{ transform: scale(1); }
/* Карточный каскад (заказчик выбрал вариант с движением, 18.08.2026):
   карточки внутри секции догоняют её со ступенчатой задержкой. У карточки
   нет собственного blur и сдвиг меньше секционного: родительская секция
   уже даёт и размытие, и подъём – дубль давал 32px хода и 8px блюра. */
.dpo-reveal.dpo-reveal-card{ filter: none; transform: translateY(10px); }
.dpo-reveal.dpo-reveal-card.dpo-in{ filter: none; transform: translateY(0); }

@media (prefers-reduced-motion: reduce){
  .dpo-reveal, .dpo-reveal.dpo-in{
    opacity: 1 !important;
    transform: none !important;
    filter: none !important;
    transition: none !important;
  }
  a, button, .btn{ transition: none !important; }
  .btn:hover, a.btn:hover{ transform: none !important; }
}
html.vi-mode .dpo-reveal{
  opacity: 1 !important;
  transform: none !important;
  filter: none !important;
  transition: none !important;
}

/* «Чему мы учим» — Анонсы / Все программы / Предложить идею */
#explore a.explore-card,
section#explore a[href]{
  display: block !important;
  transition:
    border-color .32s cubic-bezier(.22,1,.36,1),
    box-shadow .35s cubic-bezier(.22,1,.36,1),
    transform .32s cubic-bezier(.22,1,.36,1),
    background .32s ease !important;
  will-change: transform, box-shadow;
  box-shadow: 0 0 0 rgb(var(--ink) / 0);
}
/* Подъём и тень — только на устройствах с настоящим курсором. На тач-экране
   :hover срабатывает по тапу и залипает: карточка остаётся поднятой, пока
   не тронут соседнюю. */
@media (hover: hover) and (pointer: fine){
  #explore a.explore-card:hover,
  section#explore a[href]:hover{
    /* Акцент берётся из --dpo-accent, которую лендинг выставляет на своей
       обёртке из props.accentColor. Захардкоженный хекс оставлял подсветку
       синей при смене темы. */
    border-color: var(--dpo-accent, #1658DA) !important;
    transform: translateY(-3px) !important;
    box-shadow: 0 12px 28px rgb(var(--ink) / 0.1) !important;
    background: #FFFEFB !important;
  }
  #explore a:hover .explore-arrow{
    transform: translateX(6px);
  }
}
#explore a .explore-arrow{
  display: inline-block;
  transition: transform .32s cubic-bezier(.22,1,.36,1);
}
@media (prefers-reduced-motion: reduce){
  #explore a.explore-card:hover,
  section#explore a[href]:hover{
    transform: none !important;
  }
}

/* Sticky mobile CTA (injected if page has no .mobile-cta) */
.dpo-mobile-cta{
  display: none;
  /* Слои нижнего края: модальные окна 9000 > баннер cookies 1000 > эта
     панель > приглашение в канал 900 (js/channel-invite.js). Панель обязана
     лежать ВЫШЕ приглашения: на 390×844 карточка канала накрывала её
     целиком, и телефон оставался без единственной кнопки заявки. Само
     приглашение при этом приподнимается над панелью, см. keepAboveBottomBars
     там же. */
  position: fixed; left: 12px; right: 12px; bottom: 12px; z-index: 940;
  gap: 8px; padding: 10px;
  background: rgba(251,249,245,0.94);
  backdrop-filter: blur(12px);
  border: 1px solid rgb(var(--ink) / 0.1);
  border-radius: 18px;
  box-shadow: 0 12px 40px rgb(var(--ink) / 0.16);
}
.dpo-mobile-cta a{
  flex: 1; text-align: center; font-weight: 600; font-size: 15px;
  /* Панель вставляется в body, а не внутрь вёрстки страницы, поэтому
     фирменный шрифт задаём здесь: наследовать его неоткуда. */
  font-family: 'HSE Sans', 'IBM Plex Sans', system-ui, sans-serif;
  padding: 13px 10px; border-radius: 999px; text-decoration: none; /* мишень 44px+, WCAG 2.5.5 */
  color: rgb(var(--accent)); background: rgb(var(--surface)); border: 1px solid rgb(var(--accent) / 0.3);
}
.dpo-mobile-cta a.primary{ background: rgb(var(--accent)); color: rgb(var(--surface)); border-color: rgb(var(--accent)); }
/* Порог совпадает с мобильной шапкой-капсулой. С 21.08.2026 это <1024px,
   а не <900: строка шапки требует 1047px и на 900–1075 обрезала кнопку
   «Подать заявку» кромкой окна. Ниже порога CTA живёт в этой панели, из
   шапки кнопка убрана – значения обязаны совпадать, иначе на промежуточной
   ширине заявку подать негде. */
@media (max-width: 1023px){
  body.dpo-has-mobile-cta{ padding-bottom: 84px; }
  .dpo-mobile-cta{ display: flex; }
}
html.vi-mode .dpo-mobile-cta{ display: none !important; }
`.trim();

  const injectCss = () => {
    // Design bundler does document.documentElement.replaceWith(...) which wipes
    // any earlier <style>. Always re-attach if missing after the swap.
    if (document.getElementById('dpo-smooth-ui-css')) return;
    if (!document.head) return;
    const style = document.createElement('style');
    style.id = 'dpo-smooth-ui-css';
    style.textContent = CSS;
    document.head.appendChild(style);
  };

  const headerOffset = () => {
    const h = document.querySelector('header');
    return (h ? h.offsetHeight : 0) + 12;
  };

  const smoothScrollTo = (el) => {
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - headerOffset();
    window.scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' });
  };

  const bindAnchors = () => {
    document.addEventListener(
      'click',
      (e) => {
        const a = e.target.closest && e.target.closest('a[href^="#"]');
        if (!a) return;
        const id = a.getAttribute('href');
        if (!id || id === '#' || id.length < 2) return;
        let target;
        try {
          target = document.querySelector(id);
        } catch {
          return;
        }
        if (!target) return;
        e.preventDefault();
        smoothScrollTo(target);
        // preventDefault() отменяет и штатный перенос точки навигации:
        // без focus() следующий Tab возвращал в шапку, скип-ссылка не
        // работала (WCAG 2.4.1, 2.4.3).
        if (!/^(a|button|input|select|textarea)$/i.test(target.tagName) && !target.hasAttribute('tabindex')) {
          target.tabIndex = -1;
        }
        target.focus({ preventScroll: true });
        history.pushState(null, '', id);
      },
      { capture: true },
    );
  };

  const markRevealTargets = () => {
    const selectors = [
      'section',
      '.card',
      '.stat',
      '.quote-card',
      '.cta-banner',
      '.contact-card',
      '.contact-row',
      '.section-head',
      '.intro > div',
      '.teachers-text',
      '.dark-cta > *',
      'main section',
      '[data-reveal]',
    ];
    // Карточный каскад поверх секционного появления (заказчик выбрал
    // вариант с движением, 18.08.2026): карточки в сетках догоняют свою
    // секцию со ступенчатой задержкой. Задержка считается от позиции в
    // родителе (а не сквозным счётчиком): сетки разной длины, сквозной
    // i%6 давал бы случайные ступени между соседями.
    const CARD_CASCADE = [
      '.dpo-top5-grid .dpo-tile',
      '.dpo-sphere',
      '.dpo-explore-grid .explore-card',
      '.dpo-why-card',
      '.dpo-start',
      '.dpo-review',
    ].join(', ');
    const seen = new Set();
    let i = 0;
    for (const sel of selectors) {
      document.querySelectorAll(sel).forEach((el) => {
        if (seen.has(el) || el.closest('header') || el.classList.contains('hero')) return;
        // skip nested if parent already marked as same type
        if (el.parentElement && el.parentElement.classList.contains('dpo-reveal') && el.matches('.card, .stat')) {
          // still mark cards for stagger
        }
        seen.add(el);
        el.classList.add('dpo-reveal');
        if (el.matches('.card, .stat, .contact-row')) {
          el.style.setProperty('--dpo-delay', `${(i % 6) * 36}ms`);
          i += 1;
        }
        if (el.matches('.quote-card, .contact-card')) el.classList.add('dpo-reveal-scale');
      });
    }
    document.querySelectorAll(CARD_CASCADE).forEach((el) => {
      if (seen.has(el)) return;
      seen.add(el);
      el.classList.add('dpo-reveal', 'dpo-reveal-card');
      const idx = el.parentElement
        ? Array.prototype.indexOf.call(el.parentElement.children, el)
        : 0;
      el.style.setProperty('--dpo-delay', `${Math.min(idx * 70, 280)}ms`);
    });

    // Hero children: gentle entrance without waiting for scroll
    const hero = document.querySelector('.hero, [class*="hero"]');
    if (hero) {
      const kids = hero.querySelectorAll('h1, h2, p, .lead, .eyebrow, .hero-ctas, .btn, .stats');
      kids.forEach((el, idx) => {
        if (el.classList.contains('dpo-reveal')) return;
        el.classList.add('dpo-reveal');
        el.style.setProperty('--dpo-delay', `${idx * 50}ms`);
      });
      // show hero after paint
      requestAnimationFrame(() => {
        kids.forEach((el) => el.classList.add('dpo-in'));
      });
    }
  };

  // Функция вызывается из boot-цикла повторно (бандлер может подменить DOM),
  // поэтому прежние observer и failsafe-таймер обязательно гасим — иначе за
  // 10 секунд цикла накапливались десятки живых IntersectionObserver.
  let revealObserver = null;
  let revealFailsafe = null;

  const observeReveals = () => {
    const nodes = document.querySelectorAll('.dpo-reveal:not(.dpo-in)');
    if (reduce) {
      nodes.forEach((el) => el.classList.add('dpo-in'));
      return;
    }
    // Наблюдатель пересобирается только когда появились НОВЫЕ цели. Раньше
    // boot-цикл дёргал эту функцию каждые 250 мс, и каждый раз наблюдатель
    // сносился и строился заново – около 40 пересборок за десять секунд,
    // на каждой все нераскрытые узлы переподписывались заново. Утечки не
    // было (disconnect вызывался), но работа делалась вхолостую.
    //
    // Отметка живёт СВОЙСТВОМ узла, а не атрибутом, и это принципиально:
    // атрибут переживает cloneNode, и рантайм, строящий список из узла-
    // образца, разнёс бы отметку по всем клонам. Ровно так когда-то
    // погибли обложки «Топ-5». Свойство клонирование не переживает, поэтому
    // узлы, построенные рантаймом заново, честно считаются новыми.
    const fresh = Array.prototype.filter.call(nodes, (el) => !el.__dpoRevealWatched);
    if (revealObserver && !fresh.length) return;

    if (revealObserver) revealObserver.disconnect();
    if (revealFailsafe) window.clearInterval(revealFailsafe);
    revealObserver = null;
    revealFailsafe = null;
    if (!nodes.length) return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('dpo-in');
            io.unobserve(entry.target);
          }
        }
      },
      { root: null, rootMargin: '0px 0px -6% 0px', threshold: 0.08 },
    );
    nodes.forEach((el) => {
      el.__dpoRevealWatched = true;
      io.observe(el);
    });
    revealObserver = io;
    // Failsafe: never leave content invisible if IO misses a frame after
    // the Design bundler swaps documentElement.
    // Прежний вариант через 1.8с раскрывал ВСЁ разом, включая секции ниже
    // экрана, – к моменту, когда посетитель начинал прокручивать, анимации
    // появления уже не оставалось (заказчик её попросту не видел, 18.08.2026).
    // Теперь страховка принудительно раскрывает только то, что УЖЕ в
    // видимой области (защита от пропущенного кадра IO), а остальное ждёт
    // прокрутки. Поллер постоянный и дешёвый: даже если наблюдатель умер
    // вместе с подменённым documentElement, скрытый элемент оживёт не
    // позднее 0.7с после попадания в кадр – CSS-переход сработает так же.
    revealFailsafe = window.setInterval(() => {
      const rest = document.querySelectorAll('.dpo-reveal:not(.dpo-in)');
      if (!rest.length) {
        window.clearInterval(revealFailsafe);
        revealFailsafe = null;
        return;
      }
      rest.forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.top < window.innerHeight && r.bottom > 0) el.classList.add('dpo-in');
      });
    }, 700);
  };

  // Функция вызывается из boot-цикла повторно; без снятия прежних листенеров
  // каждый вызов добавлял бы новую пару scroll/resize — к концу цикла на
  // каждый кадр скролла выполнялись бы десятки одинаковых обработчиков.
  let activeNavCleanup = null;

  const bindActiveNav = () => {
    // Only text nav links — exclude CTA buttons like «Записаться» (same #contacts href)
    // so active underline lands on «Контакты», not the pill button.
    const links = [
      ...document.querySelectorAll(
        'header nav a.link[href^="#"], header nav:not(.dpo-mobile-nav) a[href^="#"]:not(.btn):not([class*="btn-"])',
      ),
    ]
      .filter((a, i, arr) => arr.indexOf(a) === i)
      // Мобильное меню дублирует якоря капсулы внутри той же шапки; без
      // фильтра is-active доставался последнему дублю в DOM – невидимому.
      .filter((a) => !a.closest('.dpo-mobile-panel'));

    if (!links.length) return;

    const map = links
      .map((a) => {
        try {
          const el = document.querySelector(a.getAttribute('href'));
          return el ? { a, el } : null;
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    if (!map.length) return;

    if (activeNavCleanup) activeNavCleanup();

    const sync = () => {
      const y = window.scrollY + headerOffset() + 48;
      const nearBottom =
        window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 24;

      // null, а не map[0]: наверху страницы (герой) ни одна секция ещё не
      // достигнута, и подчёркивать первый пункт («Форматы») нечестно –
      // посетитель находится не там. Замечание заказчика 19.08.2026.
      let current = null;
      for (const item of map) {
        if (item.el.offsetTop <= y) current = item;
      }
      // Last section (Контакты) is short — pin it when user is at page end
      if (nearBottom) current = map[map.length - 1];

      links.forEach((a) => a.classList.remove('is-active'));
      if (current) current.a.classList.add('is-active');
    };

    // sync читает offsetTop/scrollHeight (форсированный layout) — на каждое
    // событие скролла это лишнее. Схлопываем в один вызов на кадр через rAF.
    let frame = 0;
    const onScrollOrResize = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        sync();
      });
    };

    window.addEventListener('scroll', onScrollOrResize, { passive: true });
    window.addEventListener('resize', onScrollOrResize, { passive: true });
    activeNavCleanup = () => {
      window.removeEventListener('scroll', onScrollOrResize);
      window.removeEventListener('resize', onScrollOrResize);
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
    };
    sync();
  };

  const ensureMobileCta = () => {
    if (document.querySelector('.mobile-cta, .dpo-mobile-cta')) return;
    // Only on landing-like pages with a header
    if (!document.querySelector('header')) return;
    const nav = document.createElement('nav');
    nav.className = 'dpo-mobile-cta';
    nav.setAttribute('aria-label', 'Быстрые действия');
    const catalogHref = encodeURI('Каталог программ.html');
    // Первичный слот открывает форму заявки (делегированный слушатель
    // [data-application] в js/application-form.js) – ярлык «Подать заявку»
    // единый на весь сайт, решение заказчика 19.08.2026.
    nav.innerHTML =
      `<a class="secondary" href="${catalogHref}">Программы</a>` +
      `<a class="primary" href="#contacts" data-application>Подать заявку</a>`;
    // Fallback if no #contacts
    if (!document.querySelector('#contacts')) {
      nav.querySelector('.primary').href = catalogHref;
      nav.querySelector('.primary').removeAttribute('data-application');
      nav.querySelector('.primary').textContent = 'Каталог';
    }
    document.body.appendChild(nav);
    document.body.classList.add('dpo-has-mobile-cta');
  };

  /**
   * Обложки тайлов «Топ-5»: путь лежит в data-dpo-cover, а background-image
   * ставится отсюда. Инлайновый url('{{ p.image }}') в разметке нельзя:
   * в placeholder-фазе рантайм отдаёт шаблонную строку буквально, и браузер
   * ходил за «/%7B%7B p.image %7D%7D» — 404 в консоли на каждой загрузке.
   */
  const paintCover = (el) => {
    const src = el.getAttribute('data-dpo-cover') || '';
    if (!src || src.indexOf('{{') !== -1) return;
    const want = `url("${src}")`;
    if (el.style.backgroundImage !== want) el.style.backgroundImage = want;
  };

  /**
   * Обложки ставятся фоном, а фон нативная ленивость (loading="lazy") не
   * берёт: она работает только у тега картинки. Поэтому свой наблюдатель с
   * запасом в 400px – картинка успевает приехать до того, как тайл войдёт
   * в кадр. Без IntersectionObserver (старый браузер) красим сразу: лучше
   * лишний трафик, чем пустые карточки.
   */
  let coverObserver = null;
  const applyCovers = () => {
    // Узлы с ещё не подставленным путём ПРОПУСКАЕМ, не отмечая.
    // Иначе так: в placeholder-фазе <sc-for> держит один узел-образец,
    // ему ставится data-cover-watched, а рантайм строит 15 тайлов
    // КЛОНИРОВАНИЕМ образца – и отметка едет в каждый клон. Дальше селектор
    // :not([data-cover-watched]) не видит ни одного настоящего тайла,
    // наблюдатель к ним не привязывается, и обложки не появляются никогда:
    // краска шла только на образец, у которого путь был «{{ p.image }}»
    // и paintCover честно отказывался её ставить.
    const nodes = Array.prototype.filter.call(
      document.querySelectorAll('[data-dpo-cover]:not([data-cover-watched])'),
      (el) => {
        const src = el.getAttribute('data-dpo-cover') || '';
        return src && src.indexOf('{{') === -1;
      },
    );
    if (!nodes.length) return;
    if (!('IntersectionObserver' in window)) {
      nodes.forEach((el) => {
        el.setAttribute('data-cover-watched', '1');
        paintCover(el);
      });
      return;
    }
    if (!coverObserver) {
      coverObserver = new IntersectionObserver(
        (entries, obs) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            paintCover(entry.target);
            // Лента въехала в кадр – сразу берём и соседей за её краем,
            // не дожидаясь первой прокрутки вбок: иначе человек, доехавший
            // до «Топ-5» и нажавший стрелку, успевал увидеть пустой тайл.
            const track = entry.target.closest('.dpo-top5-track');
            if (track) paintTrackAhead(track);
            obs.unobserve(entry.target);
          });
        },
        // Поля только по вертикали. Расширять их вбок бессмысленно:
        // наблюдатель обрезает область видимости по overflow предка, а
        // rootMargin растягивает лишь корень, поэтому тайл, уехавший за
        // край ленты, не станет «видимым» ни при каком запасе. Боковую
        // догрузку делает bindTrackCovers ниже.
        { rootMargin: '400px 0px' },
      );
    }
    nodes.forEach((el) => {
      el.setAttribute('data-cover-watched', '1');
      coverObserver.observe(el);
    });
  };

  /**
   * Боковая догрузка обложек в горизонтальных лентах. Наблюдатель их не
   * берёт (см. комментарий к rootMargin), а грузить все 15 сразу нельзя:
   * тайловые обложки весят ~69 КБ штука, это лишний мегабайт на первый
   * заход. Поэтому красим тайлы, попавшие в видимую часть ленты плюс
   * запас, по её собственной прокрутке – её же двигают стрелки «влево»
   * и «вправо».
   */
  const TRACK_LOOKAHEAD = 600;
  const paintTrackAhead = (track) => {
    const box = track.getBoundingClientRect();
    track.querySelectorAll('[data-dpo-cover]').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.right > box.left - TRACK_LOOKAHEAD && r.left < box.right + TRACK_LOOKAHEAD) {
        paintCover(el);
      }
    });
  };

  const bindTrackCovers = () => {
    document.querySelectorAll('.dpo-top5-track').forEach((track) => {
      // Отметку ставим только когда в ленте есть тайлы с настоящими путями:
      // иначе повторится ловушка placeholder-фазы, из-за которой обложек
      // не было вовсе.
      const ready = Array.prototype.some.call(
        track.querySelectorAll('[data-dpo-cover]'),
        (el) => (el.getAttribute('data-dpo-cover') || '').indexOf('{{') === -1,
      );
      if (!ready || track.hasAttribute('data-cover-track')) return;
      track.setAttribute('data-cover-track', '1');
      let ticking = false;
      track.addEventListener(
        'scroll',
        () => {
          if (ticking) return;
          ticking = true;
          requestAnimationFrame(() => {
            ticking = false;
            paintTrackAhead(track);
          });
        },
        { passive: true },
      );
    });
  };

  const start = () => {
    injectCss();
    bindAnchors();
    markRevealTargets();
    observeReveals();
    bindActiveNav();
    ensureMobileCta();
    applyCovers();
    bindTrackCovers();
  };

  // React / bundler shell may mount late — retry a few times
  const boot = () => {
    start();
    let n = 0;
    let lastHtml = null;
    const t = setInterval(() => {
      n += 1;
      // Bundler replaces <html> — re-inject CSS whenever head is new.
      injectCss();
      applyCovers();
      bindTrackCovers();
      const hasHeader = document.querySelector('header');
      const hasSection = document.querySelector('section, main, #explore');
      const htmlNow = document.documentElement;
      if (htmlNow !== lastHtml) {
        lastHtml = htmlNow;
        // Fresh document after replaceWith — re-bind chrome
        markRevealTargets();
        observeReveals();
        bindActiveNav();
        ensureMobileCta();
      } else if (hasHeader || hasSection) {
        markRevealTargets();
        observeReveals();
        bindActiveNav();
        ensureMobileCta();
      }
      if (n > 40) clearInterval(t);
    }, 250);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
