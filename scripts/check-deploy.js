#!/usr/bin/env node
/**
 * Pre-publish checklist: fail if placeholder domain remains in public SEO files.
 *
 * Usage:  node scripts/check-deploy.js
 * Exit 1 when example.com (or similar placeholders) are still present.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PLACEHOLDER = /example\.com/i;

const FILES = [
  'robots.txt',
  'sitemap.xml',
  'index.html',
  'privacy.html',
  'ratings.html',
  'Каталог программ.html',
];

const hits = [];

for (const rel of FILES) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) continue;
  const text = fs.readFileSync(abs, 'utf8');
  if (!PLACEHOLDER.test(text)) continue;
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (PLACEHOLDER.test(line)) {
      hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
    }
  });
}

if (hits.length) {
  console.error('Deploy check FAILED: placeholder domain still present:\n');
  for (const h of hits.slice(0, 40)) console.error('  ' + h);
  if (hits.length > 40) console.error(`  … and ${hits.length - 40} more`);
  console.error('\nReplace https://example.com with the real public domain before publish.');
  process.exit(1);
}

console.log('Deploy check OK: no example.com placeholders in public SEO surfaces.');
