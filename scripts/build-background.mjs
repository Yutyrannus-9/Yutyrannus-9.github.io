// Build step: adapt the background photograph (D8) to the site palette.
//
//   node scripts/build-background.mjs
//
// Input: assets-src/background/GFP_Neurons.png (CC BY-SA 4.0, see SOURCE.md).
// The GFP channel is converted to luminance and mapped onto a navy → cyan ramp
// with capped highlights, so the neurons read like a faint night sky and never
// reach pure white. Output files are the adapted work and stay CC BY-SA 4.0.

import path from 'node:path';
import { statSync } from 'node:fs';
import sharp from 'sharp';
import { ROOT } from './lib/surfaces.mjs';

const SRC = path.join(ROOT, 'assets-src/background/GFP_Neurons.png');
const STOPS = [
  [0.0, [7, 13, 31]], // ground #070D1F
  [0.3, [16, 44, 84]],
  [0.65, [46, 132, 184]],
  [1.0, [170, 222, 244]], // capped highlight, not white
];

const lut = new Uint8Array(256 * 3);
for (let i = 0; i < 256; i++) {
  const t = Math.pow(i / 255, 0.85);
  let k = 0;
  while (k < STOPS.length - 2 && t > STOPS[k + 1][0]) k++;
  const [t0, c0] = STOPS[k];
  const [t1, c1] = STOPS[k + 1];
  const u = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
  for (let ch = 0; ch < 3; ch++) lut[i * 3 + ch] = Math.round(c0[ch] + (c1[ch] - c0[ch]) * u);
}

const meta = await sharp(SRC).metadata();
// Crop to 16:10 around the center; the source is 2317 × 1992.
const h = Math.round(meta.width / 1.6);
const top = Math.round((meta.height - h) / 2);
const { data, info } = await sharp(SRC)
  .extract({ left: 0, top, width: meta.width, height: h })
  .extractChannel('green')
  .raw()
  .toBuffer({ resolveWithObject: true });

const rgb = Buffer.alloc(info.width * info.height * 3);
for (let i = 0; i < info.width * info.height; i++) {
  const v = data[i];
  rgb[i * 3] = lut[v * 3];
  rgb[i * 3 + 1] = lut[v * 3 + 1];
  rgb[i * 3 + 2] = lut[v * 3 + 2];
}
const base = sharp(rgb, { raw: { width: info.width, height: info.height, channels: 3 } });

for (const [name, width] of [['sky', 2000], ['sky-sm', 1000]]) {
  const img = base.clone().resize(width);
  await img.clone().avif({ quality: 50, effort: 6 }).toFile(path.join(ROOT, `public/${name}.avif`));
  await img.clone().webp({ quality: 72 }).toFile(path.join(ROOT, `public/${name}.webp`));
  const a = statSync(path.join(ROOT, `public/${name}.avif`)).size;
  const w = statSync(path.join(ROOT, `public/${name}.webp`)).size;
  console.log(`${name}: ${width}px, avif ${(a / 1024).toFixed(0)} KB, webp ${(w / 1024).toFixed(0)} KB`);
}
