import { createStore, useStore } from 'zustand';

export type Mode = 'surface' | 'inflated' | 'section' | 'atlas' | 'docked' | 'explore' | 'deep';
export type Backdrop = '3d' | 'mri' | 'still';
export type Orient = 'axial' | 'coronal' | 'sagittal';
export type CortexStyle = 'solid' | 'glass' | 'hidden';
export type ColorBy = 'curvature' | 'atlas' | 'thickness';
/** Which side of the explorer's slice is cut away: the + side of its axis (above,
 *  in front, right), the − side, or whichever side faces the camera. */
export type CutAway = 'plus' | 'minus' | 'auto';
export type Tier = 'A' | 'B' | 'C';
export type Hemi = 'L' | 'R';
export interface RegionRef { hemi: Hemi; index: number }
export interface Hover {
  region: RegionRef | null;
  /** FreeSurfer label name when the pointer is over a deep structure or an MRI voxel. */
  label?: string | null;
  /** FreeSurfer tkr-RAS of the nearest pial vertex, mm. */
  ras: [number, number, number];
  x: number;
  y: number;
}
export type Command = 'rotateLeft' | 'rotateRight' | 'zoomIn' | 'zoomOut' | 'reset';

interface State {
  mode: Mode;
  /** What fills the stage: live 3D, MRI slices (2D), or the still poster. */
  backdrop: Backdrop;
  /** MRI slice view (backdrop and the explore plane share these). */
  mriOrient: Orient;
  /** Position along the slice axis, 0–1 of the volume extent. */
  mriPos: number;
  mriLabels: boolean;
  /** Explore page tools. */
  deep: boolean;
  cortex: CortexStyle;
  colorBy: ColorBy;
  inflateOn: boolean;
  plane: boolean;
  cutAway: CutAway;
  /** Selected deep structure id from deep.json, e.g. "lh-hippocampus". */
  deepSelected: string | null;
  /** Set when a deep structure is chosen from the list: turn the view toward it. */
  deepFocus: string | null;
  tier: Tier;
  reducedMotion: boolean;
  ready: boolean;
  selected: RegionRef | null;
  /** Set when a region is chosen from the text list: turn the view toward it. */
  focus: RegionRef | null;
  hover: Hover | null;
  thickness: boolean;
  /** Axial cut height, RAS z in mm (section mode). */
  slice: number;
  interacted: boolean;
  /** Pixels per millimetre at the look-at target, for the scale bar. */
  pxPerMm: number;
  /** ?perf in the URL: render continuously and show a frame-time meter. */
  perf: boolean;
  /** Tier B only: the visitor chose to load the 3D view (remembered). */
  optIn3d: boolean;
  command: ((c: Command) => void) | null;
}

export const brainStore = createStore<State>(() => ({
  mode: 'surface',
  backdrop: '3d',
  mriOrient: 'axial',
  mriPos: 0.5,
  mriLabels: false,
  deep: true,
  cortex: 'glass',
  colorBy: 'curvature',
  inflateOn: false,
  plane: true,
  cutAway: 'plus',
  deepSelected: null,
  deepFocus: null,
  tier: 'A',
  reducedMotion: false,
  ready: false,
  selected: null,
  focus: null,
  hover: null,
  thickness: false,
  slice: 60,
  interacted: false,
  pxPerMm: 0,
  perf: false,
  optIn3d: false,
  command: null,
}));

export const useBrain = <T,>(selector: (s: State) => T) => useStore(brainStore, selector);
export const setBrain = brainStore.setState;
export const getBrain = brainStore.getState;

export const sameRegion = (a: RegionRef | null, b: RegionRef | null) =>
  !!a && !!b && a.hemi === b.hemi && a.index === b.index;

// Imperatively updated HUD nodes (orientation letters), written every rendered
// frame without going through React.
export const hudRefs: { orient: Record<string, HTMLElement | null> } = { orient: {} };

/**
 * Effective settings for the deep-structure viewer. Explore takes them from its
 * panel; the Research page ("deep") uses a fixed preset: glass cortex, deep
 * structures, and an MRI slice that follows scroll.
 */
export function viewerSettings(s: State) {
  if (s.mode === 'explore')
    return { on: true, deep: s.deep, plane: s.plane, cortex: s.cortex, colorBy: s.colorBy, inflate: s.inflateOn, cutAway: s.cutAway };
  if (s.mode === 'deep')
    return { on: true, deep: true, plane: true, cortex: 'glass' as CortexStyle, colorBy: 'curvature' as ColorBy, inflate: false, cutAway: 'plus' as CutAway };
  return { on: false, deep: false, plane: false, cortex: 'solid' as CortexStyle, colorBy: 'curvature' as ColorBy, inflate: false, cutAway: 'plus' as CutAway };
}
