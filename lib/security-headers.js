/**
 * Общие заголовки безопасности публичной витрины и админки.
 *
 * HTTP-заголовки, которые meta CSP выставить не может (frame-ancestors,
 * COOP, CORP, HSTS), живут здесь текстом для серверов и комментарием
 * для docker/nginx.conf — чтобы два места не разъехались молча.
 */

'use strict';

const SECURITY_HEADERS = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy':
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=(), browsing-topics=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Origin-Agent-Cluster': '?1',
  'X-DNS-Prefetch-Control': 'off',
  'X-Permitted-Cross-Domain-Policies': 'none',
});

/** Дополнительные директивы к meta CSP страниц. frame-ancestors в meta игнорируется. */
const PUBLIC_CSP_EXTRAS = "object-src 'none'; base-uri 'self'";

const ADMIN_CSP =
  "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
  "font-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'self'; " +
  "form-action 'none'; frame-ancestors 'none'; object-src 'none'";

function applySecurityHeaders(extra = {}) {
  return { ...SECURITY_HEADERS, ...extra };
}

module.exports = {
  SECURITY_HEADERS,
  PUBLIC_CSP_EXTRAS,
  ADMIN_CSP,
  applySecurityHeaders,
};
