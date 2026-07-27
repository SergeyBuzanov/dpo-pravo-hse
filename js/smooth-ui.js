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
`.trim();

  const injectCss = () => {
    if (document.getElementById('dpo-smooth-ui-css')) return;
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
    if (reduce) {
      document.querySelectorAll('.dpo-reveal').forEach((el) => el.classList.add('dpo-in'));
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
      { root: null, rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
    );
    document.querySelectorAll('.dpo-reveal:not(.dpo-in)').forEach((el) => io.observe(el));
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

  const start = () => {
    injectCss();
    bindAnchors();
    markRevealTargets();
    observeReveals();
    bindActiveNav();
  };

  // React / bundler shell may mount late — retry a few times
  const boot = () => {
    start();
    let n = 0;
    const t = setInterval(() => {
      n += 1;
      const hasHeader = document.querySelector('header');
      const hasSection = document.querySelector('section, main');
      if (hasHeader || hasSection) {
        markRevealTargets();
        observeReveals();
        bindActiveNav();
      }
      if (n > 25) clearInterval(t);
    }, 300);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
