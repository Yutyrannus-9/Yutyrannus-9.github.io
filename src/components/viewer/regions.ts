import meta from '../../data/brain/meta.json';
import type { Hemi, RegionRef } from './store';

export type Region = (typeof meta.regions)[number];
const byKey = new Map(meta.regions.map((r) => [`${r.hemi}:${r.index}`, r]));
export const regionOf = (ref: RegionRef | null): Region | undefined => (ref ? byKey.get(`${ref.hemi}:${ref.index}`) : undefined);
export const fsLabel = (r: Region) => `ctx-${r.hemi === 'L' ? 'lh' : 'rh'}-${r.key}`;
export const hemiName = (h: Hemi) => (h === 'L' ? 'Left' : 'Right');
export const fmtRas = (v: number) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1).padStart(5, ' ');

const SPECIAL: Record<string, string> = {
  'Brain-Stem': 'Brainstem',
  VentralDC: 'ventral diencephalon',
  'Inf-Lat-Vent': 'inferior lateral ventricle',
  'Lateral-Ventricle': 'lateral ventricle',
  'Nucleus-Accumbens': 'nucleus accumbens',
  'Cerebral-White-Matter': 'cerebral white matter',
  'Cerebellum-Cortex': 'cerebellar cortex',
  'Cerebellum-White-Matter': 'cerebellar white matter',
  'choroid-plexus': 'choroid plexus',
  '3rd-Ventricle': 'Third ventricle',
  '4th-Ventricle': 'Fourth ventricle',
  'Optic-Chiasm': 'Optic chiasm',
};

/** Human-readable name for a FreeSurfer label, e.g. "ctx-lh-precuneus" → "Left precuneus". */
export function prettyLabel(fs: string): string {
  const ctx = /^ctx-(lh|rh)-(.+)$/.exec(fs);
  if (ctx) {
    const r = meta.regions.find((x) => x.hemi === (ctx[1] === 'lh' ? 'L' : 'R') && x.key === ctx[2]);
    return `${ctx[1] === 'lh' ? 'Left' : 'Right'} ${r ? r.name.charAt(0).toLowerCase() + r.name.slice(1) : ctx[2]}`;
  }
  if (fs.startsWith('CC_')) return 'Corpus callosum';
  if (SPECIAL[fs]) return SPECIAL[fs];
  const side = /^(Left|Right)-(.+)$/.exec(fs);
  if (side) return `${side[1]} ${SPECIAL[side[2]] ?? side[2].replace(/-/g, ' ').toLowerCase()}`;
  return fs.replace(/[-_]/g, ' ');
}
