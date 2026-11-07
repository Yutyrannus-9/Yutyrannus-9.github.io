// Build step: render still images from the same surfaces the 3D viewer uses.
//
//   node scripts/render-images.mjs
//
// A small software rasterizer (no GPU, no headless browser) produces:
//   public/brain/poster-surface.{avif,webp}  hero view: LCP image and no-WebGL fallback
//   public/brain/atlas-lateral.svg           2D Desikan–Killiany atlas, lateral views (Tier C)
//   public/brain/slices.json                 axial cross-sections as SVG paths (Tier B)
//   public/og.png                            Open Graph image
//   public/favicon.ico, public/apple-touch-icon.png
//
// Camera views come from src/data/brain/views.json, shared with the viewer.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { contours } from 'd3-contour';
import { ROOT, HEMIS, loadHemi, readJson, vertexNormals } from './lib/surfaces.mjs';

const meta = JSON.parse(readFileSync(path.join(ROOT, 'src/data/brain/meta.json'), 'utf8'));
const views = JSON.parse(readFileSync(path.join(ROOT, 'src/data/brain/views.json'), 'utf8'));
const OUT = path.join(ROOT, 'public');
mkdirSync(path.join(OUT, 'brain'), { recursive: true });

const manifest = readJson('manifest.json');
const hemis = HEMIS.map((h) => loadHemi(h, manifest));
const C = meta.center;
for (const h of hemis) {
  h.world = new Float32Array(h.pial.length);
  for (let i = 0; i < h.pial.length; i += 3) {
    h.world[i] = h.pial[i] - C[0];
    h.world[i + 1] = h.pial[i + 1] - C[1];
    h.world[i + 2] = h.pial[i + 2] - C[2];
  }
  h.normals = vertexNormals(h.pial, h.faces);
}

// ── Small vector helpers ─────────────────────────────────────────────────
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const hexLin = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => srgbToLin(c / 255));
};
const srgbToLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const linToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// ── Camera ───────────────────────────────────────────────────────────────
function camera(dir, radius, size) {
  const tan = Math.tan(((views.fovDeg / 2) * Math.PI) / 180);
  const dist = radius / (views.fill * tan);
  const f = norm(dir);
  const eye = [f[0] * dist, f[1] * dist, f[2] * dist];
  const fwd = norm(sub([0, 0, 0], eye));
  const right = norm(cross(fwd, [0, 1, 0]));
  const up = cross(right, fwd);
  return {
    eye,
    project(p) {
      const d = sub(p, eye);
      const z = dot(d, fwd);
      const x = dot(d, right) / (z * tan);
      const y = dot(d, up) / (z * tan);
      return [(x * 0.5 + 0.5) * size, (0.5 - y * 0.5) * size, z];
    },
  };
}

// ── Rasterizer ───────────────────────────────────────────────────────────
// shade(h, vertexIndex) → [r,g,b] linear, or flat(h, faceIndex) → id.
function rasterize({ size, cam, shade, idMode = false, only }) {
  const depth = new Float32Array(size * size).fill(Infinity);
  const color = idMode ? new Int16Array(size * size).fill(-1) : new Float32Array(size * size * 3);
  const alpha = new Uint8Array(size * size);
  for (const h of hemis) {
    if (only && h.hemi !== only) continue;
    const n = h.world.length / 3;
    const sx = new Float32Array(n), sy = new Float32Array(n), sz = new Float32Array(n);
    const cols = idMode ? null : new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const [x, y, z] = cam.project([h.world[i * 3], h.world[i * 3 + 1], h.world[i * 3 + 2]]);
      sx[i] = x; sy[i] = y; sz[i] = z;
      if (cols) cols.set(shade(h, i), i * 3);
    }
    const F = h.faces;
    for (let f = 0; f < F.length; f += 3) {
      const a = F[f], b = F[f + 1], c = F[f + 2];
      // Back-face cull (counter-clockwise front faces, y down on screen).
      const area = (sx[b] - sx[a]) * (sy[c] - sy[a]) - (sx[c] - sx[a]) * (sy[b] - sy[a]);
      if (area >= 0) continue;
      const minX = Math.max(0, Math.floor(Math.min(sx[a], sx[b], sx[c])));
      const maxX = Math.min(size - 1, Math.ceil(Math.max(sx[a], sx[b], sx[c])));
      const minY = Math.max(0, Math.floor(Math.min(sy[a], sy[b], sy[c])));
      const maxY = Math.min(size - 1, Math.ceil(Math.max(sy[a], sy[b], sy[c])));
      const id = idMode ? Math.max(0, h.region[c]) + (h.hemi === 'rh' ? 100 : 0) : 0;
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const px = x + 0.5, py = y + 0.5;
          const w0 = ((sx[b] - px) * (sy[c] - py) - (sx[c] - px) * (sy[b] - py)) / area;
          const w1 = ((sx[c] - px) * (sy[a] - py) - (sx[a] - px) * (sy[c] - py)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const z = w0 * sz[a] + w1 * sz[b] + w2 * sz[c];
          const k = y * size + x;
          if (z >= depth[k]) continue;
          depth[k] = z;
          alpha[k] = 255;
          if (idMode) color[k] = id;
          else {
            for (let ch = 0; ch < 3; ch++) color[k * 3 + ch] = w0 * cols[a * 3 + ch] + w1 * cols[b * 3 + ch] + w2 * cols[c * 3 + ch];
          }
        }
      }
    }
  }
  return { color, alpha };
}

// Approximates the viewer's material: sulc/curv ramp, key + fill + sky light, cyan rim.
const GYRUS = hexLin('#a3b3d4'), SULCUS = hexLin('#2a3a62'), RIM = hexLin('#5cc8f2');
const SKY = hexLin('#dbe6ff'), GROUNDL = hexLin('#0b1330'), FILL = hexLin('#9fb6e8');
const KEY_DIR = norm([-300, 260, -160]), FILL_DIR = norm([260, 80, 240]);
function surfaceShader(cam) {
  return (h, i) => {
    const sulc = h.sulc[i], curv = h.curv[i];
    const deep = smooth(-4, 4, sulc);
    const k = 1 - 0.5 * smooth(-0.02, 0.22, curv);
    const alb = [0, 1, 2].map((c) => (GYRUS[c] + (SULCUS[c] - GYRUS[c]) * deep) * k);
    const n = [h.normals[i * 3], h.normals[i * 3 + 1], h.normals[i * 3 + 2]];
    const p = [h.world[i * 3], h.world[i * 3 + 1], h.world[i * 3 + 2]];
    const v = norm(sub(cam.eye, p));
    const key = Math.max(0, dot(n, KEY_DIR)) * 2.1;
    const fill = Math.max(0, dot(n, FILL_DIR)) * 0.55;
    const hemi = (n[1] * 0.5 + 0.5);
    const fres = Math.pow(1 - Math.max(0, dot(n, v)), 3) * 0.22;
    return [0, 1, 2].map((c) => {
      const amb = (GROUNDL[c] + (SKY[c] - GROUNDL[c]) * hemi) * 0.6;
      return (alb[c] * (amb + key + fill * FILL[c])) / Math.PI + RIM[c] * fres;
    });
  };
}

async function writeRgba(color, alpha, size, outSize, files) {
  const buf = Buffer.alloc(size * size * 4);
  for (let k = 0; k < size * size; k++) {
    for (let ch = 0; ch < 3; ch++) {
      const aces = color[k * 3 + ch];
      const mapped = (aces * 0.82) / (1 + aces * 0.5); // exposure and gentle highlight roll-off
      buf[k * 4 + ch] = Math.round(Math.min(1, linToSrgb(Math.max(0, mapped))) * 255);
    }
    buf[k * 4 + 3] = alpha[k];
  }
  const img = sharp(buf, { raw: { width: size, height: size, channels: 4 } }).resize(outSize, outSize, { kernel: 'lanczos3' });
  const outputs = {};
  for (const f of files) {
    const p = f.endsWith('.png') ? path.join(os.tmpdir(), path.basename(f)) : path.join(OUT, f);
    if (f.endsWith('.avif')) await img.clone().avif({ quality: 55, effort: 6 }).toFile(p);
    else if (f.endsWith('.webp')) await img.clone().webp({ quality: 80, alphaQuality: 90 }).toFile(p);
    else await img.clone().png().toFile(p);
    outputs[f] = (await sharp(p).metadata()).size;
  }
  return outputs;
}

// ── 1. Poster ────────────────────────────────────────────────────────────
const POSTER = 1200;
const SS = 2;
{
  const v = views.modes.surface;
  const cam = camera(v.dir, v.radius, POSTER * SS);
  const { color, alpha } = rasterize({ size: POSTER * SS, cam, shade: surfaceShader(cam) });
  const sizes = await writeRgba(color, alpha, POSTER * SS, POSTER, ['brain/poster-surface.avif', 'brain/poster-surface.webp', 'brain/poster-surface.png']);
  console.log('poster', sizes);
}

// ── 2. 2D atlas (lateral views) ──────────────────────────────────────────
{
  const W = 520;
  const regionByKey = new Map(meta.regions.map((r) => [`${r.hemi}:${r.index}`, r]));
  const views2d = [
    { hemi: 'lh', dir: [-1, 0.08, 0], label: 'Left hemisphere, lateral view' },
    { hemi: 'rh', dir: [1, 0.08, 0], label: 'Right hemisphere, lateral view' },
  ];
  let body = '';
  views2d.forEach((vw, vi) => {
    const cam = camera(vw.dir, 92, W);
    const { color: ids } = rasterize({ size: W, cam, idMode: true, only: vw.hemi });
    const present = [...new Set(ids)].filter((x) => x >= 0).sort((a, b) => a - b);
    const gen = contours().size([W, W]).thresholds([0.5]);
    let g = `<g transform="translate(${vi * W},0)"><title>${vw.label}</title>`;
    // Silhouette first, then each region.
    const sil = new Float64Array(W * W);
    for (let k = 0; k < ids.length; k++) sil[k] = ids[k] >= 0 ? 1 : 0;
    g += `<path d="${toPath(gen(blur(sil, W))[0])}" fill="#1a2748" stroke="#1e2c50" stroke-width="1"/>`;
    for (const id of present) {
      const idx = id % 100;
      if (idx === 0) continue;
      const r = regionByKey.get(`${vw.hemi === 'lh' ? 'L' : 'R'}:${idx}`);
      if (!r) continue;
      const mask = new Float64Array(W * W);
      for (let k = 0; k < ids.length; k++) mask[k] = ids[k] === id ? 1 : 0;
      const d = toPath(gen(blur(mask, W))[0]);
      if (!d) continue;
      const [cr, cg, cb] = desat(r.color, 0.2);
      g += `<path d="${d}" fill="rgb(${cr},${cg},${cb})" stroke="#070d1f" stroke-width="0.9" stroke-linejoin="round"><title>${r.hemi === 'L' ? 'Left' : 'Right'} ${r.name}</title></path>`;
    }
    g += `<text x="${W / 2}" y="${W - 70}" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="15" fill="#8fa0c2">${vw.hemi === 'lh' ? 'LEFT · lateral' : 'RIGHT · lateral'}</text></g>`;
    body += g;
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 70 ${W * 2} ${W - 120}" role="img" aria-label="Desikan–Killiany atlas regions on the left and right lateral cortical surface">${body}</svg>`;
  writeFileSync(path.join(OUT, 'brain/atlas-lateral.svg'), svg);
  console.log('atlas svg', (svg.length / 1024).toFixed(0), 'KB');
}

function desat(rgb, amt) {
  const l = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  return rgb.map((c) => Math.round(c + (l - c) * amt));
}

function blur(src, W) {
  const out = new Float64Array(src.length);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= W) continue;
          s += src[yy * W + xx];
          n++;
        }
      }
      out[y * W + x] = s / n;
    }
  }
  return out;
}

function toPath(multi) {
  if (!multi) return '';
  let d = '';
  for (const poly of multi.coordinates) {
    for (const ring of poly) {
      const pts = simplify(ring, 1.1);
      if (pts.length < 3) continue;
      d += 'M' + pts.map(([x, y]) => `${Math.round(x)} ${Math.round(y)}`).join('L') + 'Z';
    }
  }
  return d;
}

// Radial-distance simplification: drop points closer than tol to the last kept one.
function simplify(ring, tol) {
  const out = [ring[0]];
  for (let i = 1; i < ring.length; i++) {
    const [px, py] = out[out.length - 1];
    if (Math.hypot(ring[i][0] - px, ring[i][1] - py) >= tol) out.push(ring[i]);
  }
  return out;
}

// ── 3. Axial slices (Tier B) ─────────────────────────────────────────────
{
  const whiteRas = {};
  for (const h of hemis) {
    const w = new Float32Array(h.white.length);
    for (let i = 0; i < w.length; i += 3) {
      w[i] = h.white[i];
      w[i + 1] = -h.white[i + 2];
      w[i + 2] = h.white[i + 1];
    }
    whiteRas[h.hemi] = w;
  }
  const { startMm, bottomMm } = views.section;
  const zs = [];
  for (let z = startMm; z >= bottomMm; z -= 6) zs.push(z);
  const slices = zs.map((z) => {
    const out = { z };
    for (const kind of ['pial', 'white']) {
      let d = '';
      for (const h of hemis) {
        const ras = kind === 'pial' ? h.pialRas : whiteRas[h.hemi];
        for (const loop of sliceLoops(ras, h.faces, z)) {
          const pts = simplify(loop, 1.4);
          if (pts.length < 3) continue;
          d += 'M' + pts.map(([x, y]) => `${Math.round(x * 2) / 2} ${Math.round(-y * 2) / 2}`).join('L') + 'Z';
        }
      }
      out[kind] = d;
    }
    return out;
  });
  const json = JSON.stringify({ units: 'mm, RAS x right, −RAS y (anterior up)', viewBox: [-85, -75, 170, 190], slices });
  writeFileSync(path.join(OUT, 'brain/slices.json'), json);
  console.log('slices', zs.length, (json.length / 1024).toFixed(0), 'KB');
}

// Intersect a closed triangle mesh with the plane RAS z = z0 and chain the
// segments into closed loops (each crossed edge is shared by two triangles).
function sliceLoops(ras, faces, z0) {
  const eps = 1e-4;
  const zOf = (i) => {
    const z = ras[i * 3 + 2] - z0;
    return Math.abs(z) < eps ? eps : z;
  };
  const point = new Map();
  const next = new Map();
  const key = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  const at = (a, b) => {
    const k = key(a, b);
    if (!point.has(k)) {
      const za = zOf(a), zb = zOf(b), t = za / (za - zb);
      point.set(k, [ras[a * 3] + t * (ras[b * 3] - ras[a * 3]), ras[a * 3 + 1] + t * (ras[b * 3 + 1] - ras[a * 3 + 1])]);
    }
    return k;
  };
  const link = new Map();
  for (let f = 0; f < faces.length; f += 3) {
    const v = [faces[f], faces[f + 1], faces[f + 2]];
    const s = v.map((i) => zOf(i) > 0);
    if (s[0] === s[1] && s[1] === s[2]) continue;
    const crossed = [];
    for (let e = 0; e < 3; e++) {
      const a = v[e], b = v[(e + 1) % 3];
      if (s[e] !== s[(e + 1) % 3]) crossed.push(at(a, b));
    }
    const [p, q] = crossed;
    if (!link.has(p)) link.set(p, []);
    if (!link.has(q)) link.set(q, []);
    link.get(p).push(q);
    link.get(q).push(p);
  }
  const seen = new Set();
  const loops = [];
  for (const startKey of link.keys()) {
    if (seen.has(startKey)) continue;
    const loop = [];
    let prev = null;
    let cur = startKey;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      loop.push(point.get(cur));
      const nbrs = link.get(cur);
      const nxt = nbrs.find((k) => k !== prev && !seen.has(k));
      prev = cur;
      cur = nxt;
    }
    if (loop.length > 2) loops.push(loop);
  }
  void next;
  return loops;
}

// ── 4. Open Graph image ──────────────────────────────────────────────────
{
  const site = readFileSync(path.join(ROOT, 'src/data/site.ts'), 'utf8');
  const name = /name:\s*\{\s*value:\s*'([^']*)'/.exec(site)?.[1] ?? '';
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const brain = await sharp(path.join(os.tmpdir(), 'poster-surface.png')).resize(600, 600).toBuffer();
  const text = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
    <text x="72" y="250" font-family="IBM Plex Sans Condensed, Helvetica, Arial, sans-serif" font-size="64" font-weight="500" fill="#e4eaf6">${esc(name)}</text>
    <text x="72" y="310" font-family="IBM Plex Sans, Helvetica, Arial, sans-serif" font-size="30" fill="#8fa0c2">Personal Brain Atlas</text>
    <line x1="72" y1="350" x2="520" y2="350" stroke="#1e2c50" stroke-width="2"/>
    <text x="72" y="392" font-family="IBM Plex Mono, Menlo, monospace" font-size="20" fill="#5cc8f2">My cortex · FreeSurfer 7.4.1 · non-diagnostic</text>
  </svg>`;
  await sharp({ create: { width: 1200, height: 630, channels: 4, background: '#070D1F' } })
    .composite([
      { input: brain, left: 560, top: 15 },
      { input: Buffer.from(text), left: 0, top: 0 },
    ])
    .png()
    .toFile(path.join(OUT, 'og.png'));
  console.log('og.png written for', JSON.stringify(name));
}

// ── 5. Favicons ──────────────────────────────────────────────────────────
{
  const svg = readFileSync(path.join(OUT, 'favicon.svg'));
  const png32 = await sharp(svg).resize(32, 32).png().toBuffer();
  await sharp(svg).resize(180, 180).flatten({ background: '#070D1F' }).png().toFile(path.join(OUT, 'apple-touch-icon.png'));
  // ICO container holding one 32×32 PNG.
  const head = Buffer.alloc(22);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(1, 4);
  head.writeUInt8(32, 6);
  head.writeUInt8(32, 7);
  head.writeUInt8(0, 8);
  head.writeUInt8(0, 9);
  head.writeUInt16LE(1, 10);
  head.writeUInt16LE(32, 12);
  head.writeUInt32LE(png32.length, 14);
  head.writeUInt32LE(22, 18);
  writeFileSync(path.join(OUT, 'favicon.ico'), Buffer.concat([head, png32]));
  console.log('favicons written');
}
