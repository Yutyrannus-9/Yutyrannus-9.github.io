// Build step: OBJ + per-vertex JSON → one compressed GLB per hemisphere.
//
//   node scripts/build-brain.mjs
//
// Each GLB holds the pial surface as the base mesh plus morph targets
// ("inflated", "white"), all sharing one vertex order and face list.
// Per-vertex data is packed into one custom attribute, _DATA (uint8 × 4):
//   [0] Desikan–Killiany annot index (0 = medial wall / unknown)
//   [1] sulc      −16…+16 mm  → 0…255
//   [2] thickness   0…5 mm    → 0…255
//   [3] curv     −0.5…+0.5    → 0…255
// One 4-byte attribute instead of three scalar ones because meshopt's vertex
// codec needs a byte stride that is a multiple of 4.
//
// Outputs: public/brain/{lh,rh}.glb and src/data/brain/meta.json.

import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import zlib from 'node:zlib';
import { readFileSync } from 'node:fs';
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { ROOT, HEMIS, loadHemi, readJson, bbox } from './lib/surfaces.mjs';

export const PACK = {
  sulc: { min: -16, max: 16 },
  thickness: { min: 0, max: 5 },
  curv: { min: -0.5, max: 0.5 },
};
// "sphere" is left out: no route uses it, and dropping it keeps both GLBs under
// the 1.5 MB budget. "white" is kept because section mode draws the cortical
// ribbon (pial minus white) on the cut face.
const TARGETS = ['inflated', 'white'];

const toByte = (v, { min, max }) =>
  Math.round((Math.min(max, Math.max(min, v)) - min) / (max - min) * 255);

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;

const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

const manifest = readJson('manifest.json');
const outDir = path.join(ROOT, 'public/brain');
const dataDir = path.join(ROOT, 'src/data/brain');
mkdirSync(outDir, { recursive: true });
mkdirSync(dataDir, { recursive: true });

const hemis = HEMIS.map((h) => loadHemi(h, manifest));
const pialBox = bbox(hemis.map((h) => h.pial));
const center = pialBox.min.map((m, i) => +((m + pialBox.max[i]) / 2).toFixed(2));

const sizes = {};
for (const h of hemis) {
  const n = h.pial.length / 3;
  const data = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    data[i * 4] = Math.max(0, h.region[i]);
    data[i * 4 + 1] = toByte(h.sulc[i], PACK.sulc);
    data[i * 4 + 2] = toByte(h.thickness[i], PACK.thickness);
    data[i * 4 + 3] = toByte(h.curv[i], PACK.curv);
  }

  const doc = new Document();
  const buffer = doc.createBuffer();
  const acc = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);

  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', acc('VEC3', h.pial))
    .setAttribute('_DATA', acc('VEC4', data))
    .setIndices(acc('SCALAR', new Uint16Array(h.faces)));

  for (const name of TARGETS) {
    const delta = new Float32Array(h.pial.length);
    for (let i = 0; i < delta.length; i++) delta[i] = h[name][i] - h.pial[i];
    prim.addTarget(doc.createPrimitiveTarget(name).setAttribute('POSITION', acc('VEC3', delta)));
  }

  const mesh = doc
    .createMesh(h.hemi)
    .addPrimitive(prim)
    .setWeights(TARGETS.map(() => 0))
    .setExtras({ targetNames: TARGETS });
  doc.createScene(h.hemi).addChild(doc.createNode(h.hemi).setMesh(mesh));

  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'high', quantizePosition: 14 }));

  const file = path.join(outDir, `${h.hemi}.glb`);
  await io.write(file, doc);
  const raw = readFileSync(file);
  sizes[h.hemi] = {
    bytes: statSync(file).size,
    gzip: zlib.gzipSync(raw, { level: 9 }).length,
    brotli: zlib.brotliCompressSync(raw).length,
  };

  // Round-trip check: decode the GLB and compare against the source surfaces.
  const back = await io.read(file);
  const bnode = back.getRoot().listNodes()[0];
  const bprim = back.getRoot().listMeshes()[0].listPrimitives()[0];
  const m = bnode.getMatrix();
  const pos = bprim.getAttribute('POSITION');
  const el = [0, 0, 0];
  let maxErr = 0;
  const lookup = new Map();
  for (let i = 0; i < n; i++) {
    lookup.set(`${h.pial[i * 3].toFixed(1)},${h.pial[i * 3 + 1].toFixed(1)},${h.pial[i * 3 + 2].toFixed(1)}`, i);
  }
  for (let i = 0; i < pos.getCount(); i += 97) {
    pos.getElement(i, el);
    const w = [
      m[0] * el[0] + m[4] * el[1] + m[8] * el[2] + m[12],
      m[1] * el[0] + m[5] * el[1] + m[9] * el[2] + m[13],
      m[2] * el[0] + m[6] * el[1] + m[10] * el[2] + m[14],
    ];
    let best = Infinity;
    for (let j = 0; j < n; j += 1) {
      const d = Math.hypot(w[0] - h.pial[j * 3], w[1] - h.pial[j * 3 + 1], w[2] - h.pial[j * 3 + 2]);
      if (d < best) best = d;
      if (best < 0.02) break;
    }
    maxErr = Math.max(maxErr, best);
  }
  sizes[h.hemi].maxPositionErrorMm = +maxErr.toFixed(4);
}

// Content hash for cache-busting: the GLBs are served with immutable caching.
const hash = createHash('sha1');
for (const h of HEMIS) hash.update(readFileSync(path.join(outDir, `${h}.glb`)));
const version = hash.digest('hex').slice(0, 10);

const regionsSrc = readJson('regions.json');
const notes = JSON.parse(readFileSync(path.join(dataDir, 'region-notes.json'), 'utf8'));
const meta = {
  generatedBy: 'scripts/build-brain.mjs',
  version,
  source: manifest.source,
  coordinates: manifest.coordinates,
  center,
  pialBox,
  rasZRange: [pialBox.min[1], pialBox.max[1]],
  targets: TARGETS,
  pack: PACK,
  displayOffsetsMm: manifest.display_offsets_mm,
  atlas: regionsSrc.atlas,
  note: regionsSrc.note,
  regions: regionsSrc.regions.map((r) => ({
    id: r.id,
    hemi: r.hemi,
    index: r.annot_index,
    key: r.key,
    name: r.name,
    lobe: r.lobe,
    function: notes[r.key] ?? r.function_plain,
    color: r.color_rgb,
    thicknessMm: r.thickness_mm,
    areaMm2: r.area_mm2,
  })),
  sizes,
};
writeFileSync(path.join(dataDir, 'meta.json'), JSON.stringify(meta, null, 1));

const total = (k) => Object.values(sizes).reduce((s, v) => s + v[k], 0);
console.table(sizes);
console.log(`total: ${(total('bytes') / 1e6).toFixed(2)} MB raw, ${(total('gzip') / 1e6).toFixed(2)} MB gzip, ${(total('brotli') / 1e6).toFixed(2)} MB brotli`);
console.log('center (three.js mm):', center);
