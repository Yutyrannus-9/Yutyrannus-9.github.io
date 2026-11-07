import volumeMeta from '../../data/brain/volume.json';
import type { Orient } from './store';

// Brain-only T1 and FreeSurfer labels at 1.5 mm (scripts/build-volume.mjs).
// Layout is x fastest (x right, y anterior, z superior), which is also the
// order three.js expects for a Data3DTexture.

export interface Volume {
  t1: Uint8Array;
  labels: Uint8Array;
  dims: [number, number, number];
  voxelMm: number;
  originRas: [number, number, number];
}

export const VOLUME = volumeMeta;
export const labelById = new Map(volumeMeta.labels.map((l) => [l.index, l]));

// Some servers send .gz files with Content-Encoding: gzip (the browser then
// inflates them already); others send the raw bytes. Check the gzip magic
// number and only inflate when it's still there.
async function gunzip(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

let pending: Promise<Volume> | null = null;
export function loadVolume(): Promise<Volume> {
  pending ??= Promise.all([
    gunzip(`/brain/mri/t1.u8.gz?v=${volumeMeta.version}`),
    gunzip(`/brain/mri/labels.u8.gz?v=${volumeMeta.version}`),
  ]).then(([t1, labels]) => ({
    t1,
    labels,
    dims: volumeMeta.dims as [number, number, number],
    voxelMm: volumeMeta.voxelMm,
    originRas: volumeMeta.originRas as [number, number, number],
  }));
  pending.catch(() => (pending = null));
  return pending;
}

export const axisOf = (o: Orient) => (o === 'sagittal' ? 0 : o === 'coronal' ? 1 : 2);
export const orientLabel = { axial: 'AX', coronal: 'COR', sagittal: 'SAG' } as const;

/** Slice index for a 0–1 position along the orientation's axis. */
export function sliceIndex(o: Orient, pos: number) {
  const n = volumeMeta.dims[axisOf(o)];
  return Math.max(0, Math.min(n - 1, Math.round(pos * (n - 1))));
}

/** RAS coordinate (mm) of a slice along its axis. */
export function sliceMm(o: Orient, pos: number) {
  const a = axisOf(o);
  return volumeMeta.originRas[a] + sliceIndex(o, pos) * volumeMeta.voxelMm;
}

/**
 * Screen layout of a slice. Neurological convention: the subject's left is on
 * the left. Axial and coronal: right hemisphere on the right. Sagittal: anterior
 * on the left, as in radiology viewers.
 */
export function sliceShape(o: Orient): { w: number; h: number } {
  const [nx, ny, nz] = volumeMeta.dims;
  if (o === 'axial') return { w: nx, h: ny };
  if (o === 'coronal') return { w: nx, h: nz };
  return { w: ny, h: nz };
}

/** Voxel (x, y, z) shown at column c, row r of a slice. */
export function voxelAt(o: Orient, k: number, c: number, r: number): [number, number, number] {
  const [, ny, nz] = volumeMeta.dims;
  if (o === 'axial') return [c, ny - 1 - r, k];
  if (o === 'coronal') return [c, k, nz - 1 - r];
  return [k, ny - 1 - c, nz - 1 - r];
}

export const voxelIndex = (x: number, y: number, z: number) => {
  const [nx, ny] = volumeMeta.dims;
  return x + y * nx + z * nx * ny;
};

export const voxelToRas = (x: number, y: number, z: number): [number, number, number] => {
  const o = volumeMeta.originRas;
  const s = volumeMeta.voxelMm;
  return [o[0] + x * s, o[1] + y * s, o[2] + z * s];
};

type Stops = [number, [number, number, number]][];

// Navy colormap for T1 intensity: dark tissue stays near the page ground and
// the brightest white matter tops out at a soft blue-gray (never pure white).
export const MRI_STOPS: Stops = [
  [0, [7, 13, 31]],
  [0.35, [36, 52, 92]],
  [0.7, [112, 134, 178]],
  [1, [196, 210, 232]],
];
// Atlas style (labels on): a neutral slate base so the FreeSurfer label colors
// read true, dimmer than the navy map so the colored regions carry the image.
export const ATLAS_STOPS: Stops = [
  [0, [8, 10, 20]],
  [0.4, [36, 41, 56]],
  [0.75, [92, 100, 120]],
  [1, [146, 154, 174]],
];
export const MRI_RAMP = rampLut(MRI_STOPS);
export const ATLAS_RAMP = rampLut(ATLAS_STOPS);

/** Label fill colors: FreeSurfer LUT, desaturated 20% like the 3D atlas. Index → rgb, or null to skip. */
const SKIP_LABELS = new Set(['Left-Cerebral-White-Matter', 'Right-Cerebral-White-Matter', 'WM-hypointensities', 'CSF', 'Left-Cerebellum-White-Matter', 'Right-Cerebellum-White-Matter']);
export const LABEL_FILL: ([number, number, number] | null)[] = (() => {
  const out: ([number, number, number] | null)[] = new Array(256).fill(null);
  for (const l of volumeMeta.labels) {
    if (SKIP_LABELS.has(l.name)) continue;
    const lum = 0.2126 * l.rgb[0] + 0.7152 * l.rgb[1] + 0.0722 * l.rgb[2];
    out[l.index] = l.rgb.map((x) => x + (lum - x) * 0.2) as [number, number, number];
  }
  return out;
})();

function rampLut(stops: Stops) {
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
    const [t0, c0] = stops[k];
    const [t1, c1] = stops[k + 1];
    const u = (t - t0) / (t1 - t0);
    for (let ch = 0; ch < 3; ch++) lut[i * 3 + ch] = Math.round(c0[ch] + (c1[ch] - c0[ch]) * u);
  }
  return lut;
}
