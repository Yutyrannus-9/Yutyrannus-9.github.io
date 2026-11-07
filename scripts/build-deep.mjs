// Build step: deep (subcortical) structure meshes from the FreeSurfer label map.
//
//   node scripts/build-deep.mjs
//
// Each structure's 1 mm label mask → naive surface nets → Taubin smoothing →
// meshoptimizer simplification → one node per structure in public/brain/deep.glb.
// Names, colors, and plain-language notes go to src/data/brain/deep.json.
// Only shapes are published; no volumes or other measurements.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import { ROOT, rasToThree } from './lib/surfaces.mjs';

const SRC = path.join(ROOT, 'assets-src/brain/web_volumes');
const meta = JSON.parse(readFileSync(path.join(SRC, 'volumes_meta.json'), 'utf8'));
const [nx, ny, nz] = meta.shape_xyz;
const lab = zlib.gunzipSync(readFileSync(path.join(SRC, 'labels_freesurfer_uint8.raw.gz')));
const idx = (x, y, z) => (x * ny + y) * nz + z;
const T = meta.voxel_to_surface_tkrRAS;
const table = meta.label_volumes.freesurfer.labels;
const byName = new Map(table.map((l) => [l.name, l]));

// Conservative, general descriptions (brief §4.7), not statements about this brain.
const STRUCTURES = [
  { key: 'thalamus', name: 'Thalamus', parts: ['Thalamus'], note: 'A relay hub between the cortex and the rest of the brain; involved in sensation, movement, and attention.' },
  { key: 'caudate', name: 'Caudate nucleus', parts: ['Caudate'], note: 'Part of the striatum; involved in learning, goal-directed behavior, and the control of movement.' },
  { key: 'putamen', name: 'Putamen', parts: ['Putamen'], note: 'Part of the striatum; involved in movement and habit learning.' },
  { key: 'pallidum', name: 'Globus pallidus', parts: ['Pallidum'], note: 'Part of the basal ganglia; involved in regulating movement.' },
  { key: 'hippocampus', name: 'Hippocampus', parts: ['Hippocampus'], note: 'Involved in forming new memories and in spatial navigation.' },
  { key: 'amygdala', name: 'Amygdala', parts: ['Amygdala'], note: 'Involved in detecting salience and threat, and in emotional learning.' },
  { key: 'accumbens', name: 'Nucleus accumbens', parts: ['Nucleus-Accumbens'], note: 'Part of the ventral striatum; involved in reward and motivation.' },
  { key: 'ventraldc', name: 'Ventral diencephalon', parts: ['VentralDC'], note: 'A FreeSurfer label that groups several small structures below the thalamus, including the hypothalamus.' },
  { key: 'ventricle', name: 'Lateral ventricle', parts: ['Lateral-Ventricle', 'Inf-Lat-Vent'], note: 'A space filled with cerebrospinal fluid, not neural tissue. Shown as a landmark.' },
  { key: 'cerebellum', name: 'Cerebellum', parts: ['Cerebellum-Cortex', 'Cerebellum-White-Matter'], note: 'Involved in coordinating movement, balance, and motor learning.' },
  { key: 'brainstem', name: 'Brainstem', parts: ['Brain-Stem'], midline: true, note: 'Connects the brain and spinal cord; involved in breathing, heart rate, and arousal.' },
];

function labelIndices(s, hemi) {
  if (s.midline) return [byName.get('Brain-Stem').index];
  return s.parts.map((p) => byName.get(`${hemi}-${p}`)?.index).filter(Boolean);
}

// Naive surface nets on a binary mask. Returns vertices in voxel index space.
function surfaceNets(mask, box) {
  const W = nx + 1, H = ny + 1, D = nz + 1; // cell grid, with a one-voxel pad on each side
  const inside = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < nx && y < ny && z < nz && mask[idx(x, y, z)] === 1;
  const vid = new Int32Array(W * H * D).fill(-1);
  const cell = (x, y, z) => ((x + 1) * H + (y + 1)) * D + (z + 1); // cell (x,y,z) spans voxels x..x+1
  const verts = [];
  for (let x = box[0] - 1; x <= box[3]; x++) {
    for (let y = box[1] - 1; y <= box[4]; y++) {
      for (let z = box[2] - 1; z <= box[5]; z++) {
        let n = 0;
        let sx = 0, sy = 0, sz = 0, cnt = 0;
        const c = [];
        for (let i = 0; i < 8; i++) {
          const v = inside(x + (i & 1), y + ((i >> 1) & 1), z + ((i >> 2) & 1));
          c.push(v);
          if (v) n++;
        }
        if (n === 0 || n === 8) continue;
        // Average of crossing points on the 12 cube edges (midpoints for a binary field).
        for (let i = 0; i < 8; i++) {
          for (const b of [1, 2, 4]) {
            const j = i | b;
            if (j === i || c[i] === c[j]) continue;
            sx += x + ((i & 1) + (j & 1)) / 2;
            sy += y + (((i >> 1) & 1) + ((j >> 1) & 1)) / 2;
            sz += z + (((i >> 2) & 1) + ((j >> 2) & 1)) / 2;
            cnt++;
          }
        }
        vid[cell(x, y, z)] = verts.length / 3;
        verts.push(sx / cnt, sy / cnt, sz / cnt);
      }
    }
  }
  // One quad per voxel edge whose two voxels differ; oriented outward.
  const faces = [];
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) faces.push(a, c, b, a, d, c);
    else faces.push(a, b, c, a, c, d);
  };
  for (let x = Math.max(0, box[0] - 1); x <= box[3]; x++) {
    for (let y = Math.max(0, box[1] - 1); y <= box[4]; y++) {
      for (let z = Math.max(0, box[2] - 1); z <= box[5]; z++) {
        const a = inside(x, y, z);
        // edge to +x neighbour: cells sharing it are (x, y-1..y, z-1..z)
        if (a !== inside(x + 1, y, z))
          quad(vid[cell(x, y - 1, z - 1)], vid[cell(x, y, z - 1)], vid[cell(x, y, z)], vid[cell(x, y - 1, z)], !a);
        if (a !== inside(x, y + 1, z))
          quad(vid[cell(x - 1, y, z - 1)], vid[cell(x - 1, y, z)], vid[cell(x, y, z)], vid[cell(x, y, z - 1)], !a);
        if (a !== inside(x, y, z + 1))
          quad(vid[cell(x - 1, y - 1, z)], vid[cell(x, y - 1, z)], vid[cell(x, y, z)], vid[cell(x - 1, y, z)], !a);
      }
    }
  }
  return { verts: new Float32Array(verts), faces: new Uint32Array(faces) };
}

function taubin(verts, faces, iters = 18, lambda = 0.5, mu = -0.53) {
  const n = verts.length / 3;
  const nbr = Array.from({ length: n }, () => new Set());
  for (let f = 0; f < faces.length; f += 3) {
    const [a, b, c] = [faces[f], faces[f + 1], faces[f + 2]];
    nbr[a].add(b).add(c);
    nbr[b].add(a).add(c);
    nbr[c].add(a).add(b);
  }
  const lists = nbr.map((s) => [...s]);
  const step = (k) => {
    const next = new Float32Array(verts.length);
    for (let i = 0; i < n; i++) {
      const L = lists[i];
      if (!L.length) {
        next.set(verts.subarray(i * 3, i * 3 + 3), i * 3);
        continue;
      }
      for (let d = 0; d < 3; d++) {
        let s = 0;
        for (const j of L) s += verts[j * 3 + d];
        const avg = s / L.length;
        next[i * 3 + d] = verts[i * 3 + d] + k * (avg - verts[i * 3 + d]);
      }
    }
    verts = next;
  };
  for (let i = 0; i < iters; i++) {
    step(lambda);
    step(mu);
  }
  return verts;
}

function compact(verts, faces) {
  const remap = new Int32Array(verts.length / 3).fill(-1);
  const out = [];
  const f2 = new Uint32Array(faces.length);
  for (let i = 0; i < faces.length; i++) {
    const v = faces[i];
    if (remap[v] < 0) {
      remap[v] = out.length / 3;
      out.push(verts[v * 3], verts[v * 3 + 1], verts[v * 3 + 2]);
    }
    f2[i] = remap[v];
  }
  return { verts: new Float32Array(out), faces: f2 };
}

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene('deep');
const out = [];

for (const s of STRUCTURES) {
  for (const hemi of s.midline ? ['M'] : ['Left', 'Right']) {
    const ids = new Set(labelIndices(s, hemi));
    const mask = new Uint8Array(lab.length);
    let count = 0;
    const box = [nx, ny, nz, -1, -1, -1];
    for (let x = 0; x < nx; x++)
      for (let y = 0; y < ny; y++)
        for (let z = 0; z < nz; z++) {
          if (!ids.has(lab[idx(x, y, z)])) continue;
          mask[idx(x, y, z)] = 1;
          count++;
          box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y); box[2] = Math.min(box[2], z);
          box[3] = Math.max(box[3], x); box[4] = Math.max(box[4], y); box[5] = Math.max(box[5], z);
        }
    if (!count) continue;
    let { verts, faces } = surfaceNets(mask, box);
    verts = taubin(verts, faces);
    const target = Math.min(faces.length, Math.max(1500, Math.round(faces.length * 0.25)));
    const simplified = MeshoptSimplifier.simplify(faces, verts, 3, target - (target % 3), 0.01, ['LockBorder']);
    const faces2 = simplified[0] ?? simplified;
    ({ verts, faces } = compact(verts, faces2));
    // voxel index → tkr-RAS → three.js
    const pos = new Float32Array(verts.length);
    for (let i = 0; i < verts.length; i += 3) {
      const rx = T[0][0] * verts[i] + T[0][3], ry = T[1][1] * verts[i + 1] + T[1][3], rz = T[2][2] * verts[i + 2] + T[2][3];
      pos.set(rasToThree(rx, ry, rz), i);
    }
    const id = s.midline ? s.key : `${hemi === 'Left' ? 'lh' : 'rh'}-${s.key}`;
    const label = byName.get(s.midline ? 'Brain-Stem' : `${hemi}-${s.parts[0]}`);
    const prim = doc
      .createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(pos.length / 3 > 65535 ? faces : new Uint16Array(faces)).setBuffer(buffer));
    scene.addChild(doc.createNode(id).setMesh(doc.createMesh(id).addPrimitive(prim)));
    out.push({
      id,
      key: s.key,
      hemi: s.midline ? 'M' : hemi === 'Left' ? 'L' : 'R',
      name: s.name,
      fsLabel: s.midline ? 'Brain-Stem' : `${hemi}-${s.parts[0]}`,
      color: label.rgb,
      note: s.note,
      triangles: faces.length / 3,
    });
  }
}

await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'high', quantizePosition: 14 }));
const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const file = path.join(ROOT, 'public/brain/deep.glb');
await io.write(file, doc);
const bytes = readFileSync(file);
writeFileSync(
  path.join(ROOT, 'src/data/brain/deep.json'),
  JSON.stringify({
    generatedBy: 'scripts/build-deep.mjs',
    version: createHash('sha1').update(bytes).digest('hex').slice(0, 10),
    bytes: bytes.length,
    source: 'FreeSurfer 7.4.1 recon-all aseg labels, 1 mm; surface nets, Taubin smoothing, meshopt simplification',
    structures: out,
  }, null, 1),
);
console.log(`deep.glb ${(bytes.length / 1024).toFixed(0)} KB, ${out.length} meshes, ${out.reduce((a, b) => a + b.triangles, 0)} triangles`);
