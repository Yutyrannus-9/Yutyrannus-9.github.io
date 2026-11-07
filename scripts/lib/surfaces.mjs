// Loads the ico6 cortical surfaces exported from FreeSurfer (assets-src/brain/web_ico6)
// and converts them to three.js coordinates.
//
// FreeSurfer tkr-RAS (x = L→R, y = P→A, z = I→S) maps to three.js y-up as
// (x, y, z) → (x, z, −y). Every script and the runtime use this one mapping.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const SRC = path.join(ROOT, 'assets-src/brain/web_ico6');
export const HEMIS = ['lh', 'rh'];

export const rasToThree = (x, y, z) => [x, z, -y];

export function readObj(file) {
  const text = readFileSync(path.join(SRC, file), 'utf8');
  const verts = [];
  const faces = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('v ')) {
      const [, x, y, z] = line.split(/\s+/);
      verts.push(+x, +y, +z);
    } else if (line.startsWith('f ')) {
      const [, a, b, c] = line.split(/\s+/);
      faces.push(+a - 1, +b - 1, +c - 1);
    }
  }
  return { ras: new Float32Array(verts), faces: new Uint32Array(faces) };
}

export function toThree(ras, offsetX = 0) {
  const out = new Float32Array(ras.length);
  for (let i = 0; i < ras.length; i += 3) {
    const [x, y, z] = rasToThree(ras[i] + offsetX, ras[i + 1], ras[i + 2]);
    out[i] = x;
    out[i + 1] = y;
    out[i + 2] = z;
  }
  return out;
}

export function readJson(file) {
  return JSON.parse(readFileSync(path.join(SRC, file), 'utf8'));
}

export function loadHemi(hemi, manifest = readJson('manifest.json')) {
  const off = manifest.display_offsets_mm;
  const pial = readObj(`${hemi}.pial.ico6.obj`);
  const white = readObj(`${hemi}.white.ico6.obj`);
  const inflated = readObj(`${hemi}.inflated.ico6.obj`);
  const sphere = readObj(`${hemi}.sphere.ico6.obj`);
  for (const s of [white, inflated, sphere]) {
    if (s.ras.length !== pial.ras.length) throw new Error(`${hemi}: vertex count mismatch`);
  }
  const data = readJson(`${hemi}.vertex_data.json`);
  return {
    hemi,
    faces: pial.faces,
    pialRas: pial.ras,
    pial: toThree(pial.ras),
    white: toThree(white.ras),
    inflated: toThree(inflated.ras, off.inflated[hemi]),
    sphere: toThree(sphere.ras, off.sphere[hemi]),
    region: data.region_index,
    sulc: data.sulc,
    curv: data.curv,
    thickness: data.thickness_mm,
  };
}

export function bbox(arrays) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const a of arrays) {
    for (let i = 0; i < a.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        if (a[i + k] < min[k]) min[k] = a[i + k];
        if (a[i + k] > max[k]) max[k] = a[i + k];
      }
    }
  }
  return { min, max };
}

export function vertexNormals(pos, faces) {
  const n = new Float32Array(pos.length);
  for (let f = 0; f < faces.length; f += 3) {
    const a = faces[f] * 3, b = faces[f + 1] * 3, c = faces[f + 2] * 3;
    const e1 = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]];
    const e2 = [pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]];
    const nx = e1[1] * e2[2] - e1[2] * e2[1];
    const ny = e1[2] * e2[0] - e1[0] * e2[2];
    const nz = e1[0] * e2[1] - e1[1] * e2[0];
    for (const v of [a, b, c]) {
      n[v] += nx;
      n[v + 1] += ny;
      n[v + 2] += nz;
    }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l;
    n[i + 1] /= l;
    n[i + 2] /= l;
  }
  return n;
}
