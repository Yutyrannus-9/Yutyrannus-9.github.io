// Build step: resample the brain-only T1 and its FreeSurfer label map for the web.
//
//   node scripts/build-volume.mjs
//
// Input (local only, git-ignored): assets-src/brain/web_volumes/
//   t1_brain_uint8.raw.gz          SAMSEG bias-corrected T1, brain + 4 mm, face removed, 1 mm
//   labels_freesurfer_uint8.raw.gz recon-all aseg + DK labels, 1 mm
// Output (published only after a professional read, see site.ts `mri`):
//   public/brain/mri/t1.u8.gz       1.5 mm, x-fastest (three.js Data3DTexture order)
//   public/brain/mri/labels.u8.gz   1.5 mm, nearest-neighbour labels
//   src/data/brain/volume.json      dims, voxel → tkr-RAS transform, label table
//
// The brief (§4.7) requires slices to be downsampled to at least 1.5 mm.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { ROOT } from './lib/surfaces.mjs';

const SRC = path.join(ROOT, 'assets-src/brain/web_volumes');
const OUT = path.join(ROOT, 'public/brain/mri');
const STEP = 1.5;

const meta = JSON.parse(readFileSync(path.join(SRC, 'volumes_meta.json'), 'utf8'));
const [nx, ny, nz] = meta.shape_xyz;
const t1 = zlib.gunzipSync(readFileSync(path.join(SRC, 't1_brain_uint8.raw.gz')));
const lab = zlib.gunzipSync(readFileSync(path.join(SRC, 'labels_freesurfer_uint8.raw.gz')));
if (t1.length !== nx * ny * nz || lab.length !== nx * ny * nz) throw new Error('unexpected volume size');
const src = (x, y, z) => (x * ny + y) * nz + z; // C-order over (x, y, z), per volumes_meta.json

// Light 3-tap blur along each axis before resampling (anti-aliasing).
function blurAxis(data, axis) {
  const out = new Float32Array(data.length);
  const d = [0, 0, 0];
  for (let x = 0; x < nx; x++) {
    for (let y = 0; y < ny; y++) {
      for (let z = 0; z < nz; z++) {
        const c = [x, y, z];
        let s = 0, w = 0;
        for (const [off, k] of [[-1, 0.25], [0, 0.5], [1, 0.25]]) {
          d[0] = x; d[1] = y; d[2] = z;
          d[axis] = c[axis] + off;
          if (d[axis] < 0 || d[axis] >= [nx, ny, nz][axis]) continue;
          s += data[src(d[0], d[1], d[2])] * k;
          w += k;
        }
        out[src(x, y, z)] = s / w;
      }
    }
  }
  return out;
}
let smooth = Float32Array.from(t1);
for (const axis of [0, 1, 2]) smooth = blurAxis(smooth, axis);

const [ox, oy, oz] = [nx, ny, nz].map((n) => Math.floor((n - 1) / STEP) + 1);
const outT1 = new Uint8Array(ox * oy * oz);
const outLab = new Uint8Array(ox * oy * oz);
const dst = (x, y, z) => x + y * ox + z * ox * oy; // x fastest

const tri = (px, py, pz) => {
  const x0 = Math.min(nx - 2, Math.floor(px)), y0 = Math.min(ny - 2, Math.floor(py)), z0 = Math.min(nz - 2, Math.floor(pz));
  const fx = px - x0, fy = py - y0, fz = pz - z0;
  let v = 0;
  for (let i = 0; i < 2; i++)
    for (let j = 0; j < 2; j++)
      for (let k = 0; k < 2; k++)
        v += smooth[src(x0 + i, y0 + j, z0 + k)] * (i ? fx : 1 - fx) * (j ? fy : 1 - fy) * (k ? fz : 1 - fz);
  return v;
};

for (let z = 0; z < oz; z++) {
  for (let y = 0; y < oy; y++) {
    for (let x = 0; x < ox; x++) {
      const px = x * STEP, py = y * STEP, pz = z * STEP;
      outT1[dst(x, y, z)] = Math.round(Math.min(255, tri(Math.min(px, nx - 1), Math.min(py, ny - 1), Math.min(pz, nz - 1))));
      outLab[dst(x, y, z)] = lab[src(Math.min(nx - 1, Math.round(px)), Math.min(ny - 1, Math.round(py)), Math.min(nz - 1, Math.round(pz)))];
    }
  }
}

mkdirSync(OUT, { recursive: true });
const gzT1 = zlib.gzipSync(outT1, { level: 9 });
const gzLab = zlib.gzipSync(outLab, { level: 9 });
writeFileSync(path.join(OUT, 't1.u8.gz'), gzT1);
writeFileSync(path.join(OUT, 'labels.u8.gz'), gzLab);

// Output voxel (i, j, k) sits at input index (1.5 i, 1.5 j, 1.5 k); input → tkr-RAS from the meta.
const m = meta.voxel_to_surface_tkrRAS;
const origin = [m[0][3], m[1][3], m[2][3]];
const labels = meta.label_volumes.freesurfer.labels.map((l) => ({ index: l.index, fsLabel: l.fs_label, name: l.name, rgb: l.rgb }));
const volume = {
  generatedBy: 'scripts/build-volume.mjs',
  dims: [ox, oy, oz],
  voxelMm: STEP,
  order: 'x fastest: index = x + y*nx + z*nx*ny; axes are RAS (x right, y anterior, z superior)',
  /** tkr-RAS (mm) of voxel (0,0,0); RAS = origin + voxelMm * index. */
  originRas: origin,
  note: meta.note,
  version: createHash('sha1').update(gzT1).update(gzLab).digest('hex').slice(0, 10),
  bytes: { t1: gzT1.length, labels: gzLab.length },
  labels,
};
writeFileSync(path.join(ROOT, 'src/data/brain/volume.json'), JSON.stringify(volume));
console.log(`volume ${ox}×${oy}×${oz} @ ${STEP} mm; t1.gz ${(gzT1.length / 1024).toFixed(0)} KB, labels.gz ${(gzLab.length / 1024).toFixed(0)} KB`);
