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
a, button, .btn, [role="button"]{
  transition:
    color .28s cubic-bezier(.22,1,.36,1),
    background .28s cubic-bezier(.22,1,.36,1),
    border-color .28s cubic-bezier(.22,1,.36,1),
    box-shadow .32s cubic-bezier(.22,1,.36,1),
    transform .28s cubic-bezier(.22,1,.36,1),
    opacity .28s cubic-bezier(.22,1,.36,1) !important;
}
.btn, a.btn, button.btn, [class*="btn-"]{
  will-change: transform;
}
.btn:hover, a.btn:hover, button.btn:hover, a[class*="btn-"]:hover{
  transform: translateY(-2px);
}
.btn:active, a.btn:active, button.btn:active, a[class*="btn-"]:active{
  transform: translateY(0) scale(0.97);
}
header nav a.link,
header a.link,
header nav a[href^="#"]:not(.btn):not([class*="btn-"]){
  position: relative;
  display: inline-block;
}
header nav a.link::after,
header a.link::after,
header nav a[href^="#"]:not(.btn):not([class*="btn-"])::after{
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
header nav a.link:hover::after,
header a.link:hover::after,
header nav a[href^="#"]:not(.btn):not([class*="btn-"]):hover::after,
header nav a.link.is-active::after,
header a.link.is-active::after,
header nav a.is-active[href^="#"]:not(.btn):not([class*="btn-"])::after{
  transform: scaleX(1);
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
  transform: translateY(28px);
  filter: blur(4px);
  transition:
    opacity .7s cubic-bezier(.22,1,.36,1),
    transform .7s cubic-bezier(.22,1,.36,1),
    filter .7s cubic-bezier(.22,1,.36,1);
  transition-delay: var(--dpo-delay, 0ms);
  will-change: opacity, transform, filter;
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
  box-shadow: 0 0 0 rgba(33,30,27,0);
}
#explore a.explore-card:hover,
section#explore a[href]:hover{
  border-color: #1658DA !important;
  transform: translateY(-5px) !important;
  box-shadow: 0 18px 42px rgba(33,30,27,0.12) !important;
  background: #FFFEFB !important;
}
#explore a .explore-arrow{
  display: inline-block;
  transition: transform .32s cubic-bezier(.22,1,.36,1);
}
#explore a:hover .explore-arrow{
  transform: translateX(6px);
}
#explore a:hover h3{
  letter-spacing: 0.01em;
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
  position: fixed; left: 12px; right: 12px; bottom: 12px; z-index: 60;
  gap: 8px; padding: 10px;
  background: rgba(251,249,245,0.94);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(33,30,27,0.1);
  border-radius: 18px;
  box-shadow: 0 12px 40px rgba(33,30,27,0.16);
}
.dpo-mobile-cta a{
  flex: 1; text-align: center; font-weight: 600; font-size: 14px;
  padding: 12px 10px; border-radius: 999px; text-decoration: none;
  color: #1658DA; background: #fff; border: 1px solid rgba(22,88,218,0.3);
}
.dpo-mobile-cta a.primary{ background: #1658DA; color: #fff; border-color: #1658DA; }
@media (max-width: 760px){
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
          el.style.setProperty('--dpo-delay', `${(i % 6) * 60}ms`);
          i += 1;
        }
        if (el.matches('.quote-card, .contact-card')) el.classList.add('dpo-reveal-scale');
      });
    }

    // Hero children: gentle entrance without waiting for scroll
    const hero = document.querySelector('.hero, [class*="hero"]');
    if (hero) {
      const kids = hero.querySelectorAll('h1, h2, p, .lead, .eyebrow, .hero-ctas, .btn, .stats');
      kids.forEach((el, idx) => {
        if (el.classList.contains('dpo-reveal')) return;
        el.classList.add('dpo-reveal');
        el.style.setProperty('--dpo-delay', `${idx * 80}ms`);
      });
      // show hero after paint
      requestAnimationFrame(() => {
        kids.forEach((el) => el.classList.add('dpo-in'));
      });
    }
  };

  const observeReveals = () => {
    const nodes = document.querySelectorAll('.dpo-reveal:not(.dpo-in)');
    if (reduce) {
      nodes.forEach((el) => el.classList.add('dpo-in'));
      return;
    }
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
    nodes.forEach((el) => io.observe(el));
    // Failsafe: never leave content invisible if IO misses a frame after
    // the Design bundler swaps documentElement.
    window.setTimeout(() => {
      document.querySelectorAll('.dpo-reveal:not(.dpo-in)').forEach((el) => {
        el.classList.add('dpo-in');
      });
    }, 1800);
  };

  const bindActiveNav = () => {
    // Only text nav links — exclude CTA buttons like «Записаться» (same #contacts href)
    // so active underline lands on «Контакты», not the pill button.
    const links = [
      ...document.querySelectorAll(
        'header nav a.link[href^="#"], header nav a[href^="#"]:not(.btn):not([class*="btn-"])',
      ),
    ].filter((a, i, arr) => arr.indexOf(a) === i);

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

    const sync = () => {
      const y = window.scrollY + headerOffset() + 48;
      const nearBottom =
        window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 24;

      let current = map[0];
      for (const item of map) {
        if (item.el.offsetTop <= y) current = item;
      }
      // Last section (Контакты) is short — pin it when user is at page end
      if (nearBottom) current = map[map.length - 1];

      links.forEach((a) => a.classList.remove('is-active'));
      if (current) current.a.classList.add('is-active');
    };
    window.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync, { passive: true });
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
    nav.innerHTML =
      `<a class="secondary" href="${catalogHref}">Программы</a>` +
      `<a class="primary" href="#contacts">Контакты</a>`;
    // Fallback if no #contacts
    if (!document.querySelector('#contacts')) {
      nav.querySelector('.primary').href = catalogHref;
      nav.querySelector('.primary').textContent = 'Каталог';
    }
    document.body.appendChild(nav);
    document.body.classList.add('dpo-has-mobile-cta');
  };

  const start = () => {
    injectCss();
    bindAnchors();
    markRevealTargets();
    observeReveals();
    bindActiveNav();
    ensureMobileCta();
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
