// Link check over the built site (brief §11): every internal href/src in
// dist/**/*.html must resolve to a built file. External links are listed, not
// fetched, so CI stays offline and deterministic.
//
//   npm run build:draft && node scripts/check-links.mjs

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(path.join(d, f)).isDirectory() ? walk(path.join(d, f)) : [path.join(d, f)]));
const pages = walk(DIST).filter((f) => f.endsWith('.html'));

const resolves = (url) => {
  const clean = decodeURI(url.split('#')[0].split('?')[0]);
  if (clean === '' || clean === '/') return existsSync(path.join(DIST, 'index.html'));
  const p = path.join(DIST, clean);
  return existsSync(p) || existsSync(`${p}.html`) || existsSync(path.join(p, 'index.html'));
};

const broken = [];
const external = new Set();
for (const page of pages) {
  const html = readFileSync(page, 'utf8');
  for (const [, attr, url] of html.matchAll(/\s(href|src|srcset)="([^"]+)"/g)) {
    for (const u of attr === 'srcset' ? url.split(',').map((s) => s.trim().split(/\s+/)[0]) : [url]) {
      if (/^(mailto:|tel:|data:|#)/.test(u)) continue;
      if (/^https?:\/\//.test(u)) {
        external.add(u);
        continue;
      }
      if (u.startsWith('/') && !resolves(u)) broken.push(`${path.relative(DIST, page)} → ${u}`);
    }
  }
}

console.log(`Checked ${pages.length} pages. External links (not fetched): ${external.size}.`);
if (broken.length) {
  console.error(`\n${broken.length} broken internal link(s):`);
  for (const b of [...new Set(broken)]) console.error(`  • ${b}`);
  process.exit(1);
}
console.log('No broken internal links.');
