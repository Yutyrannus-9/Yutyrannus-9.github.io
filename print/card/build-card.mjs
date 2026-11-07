// Business card: print-ready PDF (front + back) and PNG previews.
//
//   node print/card/build-card.mjs            # QR → SITE_URL or https://yutyrannus-9.github.io
//   SITE_URL=https://example.com node print/card/build-card.mjs
//
// Format: US standard 3.5 × 2 in, plus 0.125 in bleed on every side
// (3.75 × 2.25 in pages). Text stays inside a 0.125 in safe margin within the
// trim. This is the layout Vistaprint, MOO, Staples, and most print shops ask for.
// Art is Joel's own brain (cortical surface poster + Desikan–Killiany atlas),
// so there are no third-party image licenses on the card.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import sharp from 'sharp';
import * as L from 'lucide-static';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const OUT = path.join(HERE, 'out');
mkdirSync(OUT, { recursive: true });
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const SITE = process.env.SITE_URL ?? 'https://yutyrannus-9.github.io';
const card = {
  name: 'Joel Jaramillo',
  title: ['Biomedical Engineering Student', 'Neural Engineering · Neuroimaging Research'],
  contacts: [
    ['mail', 'Jjarami001@citymail.cuny.edu'],
    ['globe', SITE.replace(/^https?:\/\//, '')],
    ['linkedin', 'linkedin.com/in/joelj52'],
    ['pin', 'New York, NY'],
  ],
  affiliations: [
    ['The City College of New York', 'Grove School of Engineering · Bikson Lab'],
    ['University of Rochester', 'ZVR Lab · NEUROCITY Scholar'],
  ],
  headline: ['Engineering Tools', 'to Read and Shape', 'the Brain'],
  focus: [
    ['zap', 'Neuromodulation'],
    ['brain', 'Neuroimaging'],
    ['wave', 'Neural Data Analysis'],
    ['chart', 'Data Analysis & AI'],
    ['chip', 'Medical Devices'],
  ],
  tagline: ['From MRI pipelines', 'to stimulation models'],
};

const icon = (svg, color) =>
  svg
    .replace(/<!--.*?-->/s, '')
    .replace('stroke="currentColor"', `stroke="${color}"`)
    .replace('stroke-width="2"', 'stroke-width="1.6"')
    .replace(/width="24"\s+height="24"/, 'width="100%" height="100%"')
    .trim();
const ICONS = { mail: L.Mail, globe: L.Globe, pin: L.MapPin, zap: L.Zap, brain: L.Brain, wave: L.Activity, chart: L.ChartColumn, chip: L.Cpu };
const linkedin = (color) =>
  `<svg viewBox="0 0 24 24" width="100%" height="100%"><rect x="2.5" y="2.5" width="19" height="19" rx="3" fill="none" stroke="${color}" stroke-width="1.6"/><text x="12" y="16.6" text-anchor="middle" font-family="IBM Plex Sans" font-weight="500" font-size="11" fill="${color}">in</text></svg>`;
const iconFor = (k, color) => (k === 'linkedin' ? linkedin(color) : icon(ICONS[k], color));

const dataUri = (buf, type) => `data:${type};base64,${buf.toString('base64')}`;
const qr = await QRCode.toString(SITE, { type: 'svg', errorCorrectionLevel: 'Q', margin: 0, color: { dark: '#0e1730', light: '#ffffff' } });
const brain = dataUri(await sharp(path.join(ROOT, 'public/brain/poster-surface.webp')).png().toBuffer(), 'image/png');
// Left-hemisphere half of the build-time atlas SVG.
const atlasSvg = readFileSync(path.join(ROOT, 'public/brain/atlas-lateral.svg'), 'utf8').replace(/viewBox="[^"]*"/, 'viewBox="40 90 450 330"');
const atlas = dataUri(Buffer.from(atlasSvg), 'image/svg+xml');
const fontDir = path.join(ROOT, 'public/fonts');
const font = (family, weight, file) =>
  `@font-face{font-family:'${family}';font-weight:${weight};src:url('file://${path.join(fontDir, file)}') format('woff2')}`;

const css = `
${font('IBM Plex Sans', 400, 'ibm-plex-sans-latin-400-normal.woff2')}
${font('IBM Plex Sans', 500, 'ibm-plex-sans-latin-500-normal.woff2')}
${font('IBM Plex Sans Condensed', 500, 'ibm-plex-sans-condensed-latin-500-normal.woff2')}
${font('IBM Plex Mono', 400, 'ibm-plex-mono-latin-400-normal.woff2')}
@page { size: 3.75in 2.25in; margin: 0; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: 'IBM Plex Sans', sans-serif; }
.page { position: relative; width: 3.75in; height: 2.25in; overflow: hidden; page-break-after: always; }
.page:last-child { page-break-after: auto; }
.guides .page::after { /* trim (solid) and safe (dashed) lines: previews only */
  content: ''; position: absolute; inset: 0.125in; outline: 0.5px solid rgba(255,0,80,.7);
}
.guides .page::before { content: ''; position: absolute; inset: 0.25in; outline: 0.5px dashed rgba(0,160,255,.7); z-index: 9; }

/* FRONT: light, contact side */
.front { background: #fbfcfe; color: #0e1730; }
.front .art { position: absolute; right: 0; top: 0; bottom: 0; width: 1.62in;
  background: radial-gradient(circle at 60% 40%, #16264d 0%, #070d1f 70%);
  clip-path: path('M 42 0 C 0 70, 0 150, 44 216 L 170 216 L 170 0 Z'); }
.front .art img { position: absolute; left: 0.16in; top: 0.4in; width: 1.27in; }
.front .art .cap { position: absolute; right: 0.27in; bottom: 0.26in; font: 400 3.6pt/1.3 'IBM Plex Mono', monospace; color: #8fa0c2; text-align: right; }
.front .id { position: absolute; left: 0.27in; top: 0.24in; width: 2.1in; }
.front h1 { font: 500 15.5pt/1 'IBM Plex Sans Condensed', sans-serif; letter-spacing: -0.1pt; }
.front .title { margin-top: 3pt; font-size: 6.4pt; line-height: 1.32; color: #4a5878; }
.front .rule { width: 0.55in; height: 1.4pt; background: #0a6e9e; margin: 5pt 0 5pt; }
.front ul { list-style: none; display: grid; gap: 2.3pt; }
.front li { display: flex; align-items: center; gap: 4pt; font-size: 6pt; color: #24345c; white-space: nowrap; }
.front li .i { width: 7.5pt; height: 7.5pt; flex: none; }
.front .bottom { position: absolute; left: 0.27in; bottom: 0.25in; display: flex; align-items: center; gap: 6pt; }
.front .qr { width: 0.56in; height: 0.56in; }
.front .bar { width: 0.6pt; align-self: stretch; background: #c9d1e3; }
.front .aff { display: grid; gap: 3pt; }
.front .aff b { display: block; font: 500 5.3pt/1.15 'IBM Plex Sans', sans-serif; color: #0e1730; }
.front .aff span { display: block; font-size: 4.6pt; line-height: 1.2; color: #4a5878; }

/* BACK: dark, focus side */
.back { background: radial-gradient(ellipse at 75% 70%, #12224a 0%, #070d1f 62%); color: #e4eaf6; }
.back .atlas { position: absolute; right: -0.18in; bottom: -0.2in; width: 1.7in; opacity: .55; }
.back .glow { position: absolute; right: 0.3in; bottom: 0.25in; width: 1.4in; height: 1in; background: radial-gradient(#5cc8f233, transparent 70%); }
.back h2 { position: absolute; left: 0.27in; top: 0.24in; font: 500 10.6pt/1.12 'IBM Plex Sans Condensed', sans-serif; }
.back h2 em { font-style: normal; color: #5cc8f2; }
.back .rule { position: absolute; left: 0.27in; top: 0.86in; width: 0.55in; height: 1.4pt; background: #5cc8f2; }
.back ul { position: absolute; left: 0.27in; top: 0.95in; list-style: none; display: grid; gap: 2.4pt; }
.back li { display: flex; align-items: center; gap: 5pt; font-size: 6.2pt; }
.back li .i { width: 8pt; height: 8pt; flex: none; }
.back .tag { position: absolute; left: 0.27in; bottom: 0.24in; font: 400 4.6pt/1.35 'IBM Plex Mono', monospace; letter-spacing: 0.9pt; text-transform: uppercase; color: #8fa0c2; }
.back .tag b { font-weight: 400; color: #5cc8f2; }
.back .qrbox { position: absolute; right: 0.27in; top: 0.25in; width: 0.68in; height: 0.68in; padding: 0.05in; background: #fff; border-radius: 2pt; }
.back .qrbox svg, .front .qr svg { width: 100%; height: 100%; display: block; }
.back .scan { position: absolute; right: 0.27in; top: 0.96in; width: 0.68in; text-align: center; font: 400 4.2pt/1.2 'IBM Plex Mono', monospace; color: #e4eaf6; letter-spacing: .4pt; }
`;

const front = `
<section class="page front">
  <div class="art"><img src="${brain}" alt=""><p class="cap">My cortex · FreeSurfer<br>reconstruction</p></div>
  <div class="id">
    <h1>${card.name}</h1>
    <p class="title">${card.title.join('<br>')}</p>
    <div class="rule"></div>
    <ul>${card.contacts.map(([k, v]) => `<li><span class="i">${iconFor(k, '#0a6e9e')}</span>${v}</li>`).join('')}</ul>
  </div>
  <div class="bottom">
    <div class="qr">${qr}</div>
    <div class="bar"></div>
    <div class="aff">${card.affiliations.map(([a, b]) => `<p><b>${a}</b><span>${b}</span></p>`).join('')}</div>
  </div>
</section>`;

const back = `
<section class="page back">
  <div class="glow"></div>
  <img class="atlas" src="${atlas}" alt="">
  <h2>${card.headline[0]}<br>${card.headline[1]}<br><em>${card.headline[2]}</em></h2>
  <div class="rule"></div>
  <ul>${card.focus.map(([k, v]) => `<li><span class="i">${iconFor(k, '#5cc8f2')}</span>${v}</li>`).join('')}</ul>
  <p class="tag">${card.tagline[0]}<br><b>${card.tagline[1]}</b></p>
  <div class="qrbox">${qr}</div>
  <p class="scan">Scan · portfolio</p>
</section>`;

const doc = (body, guides = false) =>
  `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body class="${guides ? 'guides' : ''}">${body}</body></html>`;

const files = {
  print: path.join(OUT, 'card.html'),
  front: path.join(OUT, 'front.html'),
  back: path.join(OUT, 'back.html'),
  frontGuides: path.join(OUT, 'front-guides.html'),
  backGuides: path.join(OUT, 'back-guides.html'),
};
writeFileSync(files.print, doc(front + back));
writeFileSync(files.front, doc(front));
writeFileSync(files.back, doc(back));
writeFileSync(files.frontGuides, doc(front, true));
writeFileSync(files.backGuides, doc(back, true));

const profile = path.join(process.env.TMPDIR || '/tmp', `card-chrome-${Date.now()}`);
const chrome = (args) =>
  execFileSync(CHROME, ['--headless=new', '--no-first-run', '--disable-gpu', `--user-data-dir=${profile}`, '--allow-file-access-from-files', ...args], { stdio: 'ignore' });

chrome([`--print-to-pdf=${path.join(OUT, 'joel-jaramillo-card-print.pdf')}`, '--no-pdf-header-footer', `file://${files.print}`]);
// 3.75 in = 360 CSS px; scale 6.25 → 2250 × 1350 px (600 dpi) previews.
for (const [name, file] of Object.entries({ front: files.front, back: files.back, 'front-guides': files.frontGuides, 'back-guides': files.backGuides })) {
  const png = path.join(OUT, `${name}.png`);
  chrome(['--hide-scrollbars', '--window-size=360,216', '--force-device-scale-factor=6.25', `--screenshot=${png}`, `file://${file}`]);
  // Trimmed preview at 300 dpi (what the cut card looks like): 1050 × 600.
  if (!name.includes('guides')) {
    await sharp(png).extract({ left: 75, top: 75, width: 2100, height: 1200 }).resize(1050, 600).png().toFile(path.join(OUT, `${name}-trimmed.png`));
  }
}
console.log(`QR → ${SITE}\nwrote ${OUT}/joel-jaramillo-card-print.pdf and PNG previews`);
