import type { Mode, Orient } from './store';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const cssPx = (name: string, fallback: number) =>
  parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || fallback;

/** Free area between the layer list and the content column on viewer pages. */
export function stageArea(mode: Mode, w: number, h: number): Rect {
  if (mode === 'docked' || w < 900) return { x: 0, y: 0, w, h };
  const bar = cssPx('--bar', 52);
  const status = cssPx('--status', 40);
  const rail = document.querySelector('.layers')?.getBoundingClientRect().right ?? 0;
  const content = document.querySelector('.content')?.getBoundingClientRect().left ?? w;
  const left = rail + 8;
  const right = Math.max(left + 200, content);
  // Research stacks slice controls under the brain; keep the brain above them.
  const controls = mode === 'deep' ? 120 : 0;
  return { x: left, y: bar, w: right - left, h: h - bar - status - controls };
}

/**
 * Where the MRI slice goes. Viewer pages: the stage area. Reading pages: the
 * space right of the text column when there is room, otherwise full-bleed
 * behind the (opaque) reading sheet.
 */
export function mriArea(mode: Mode, w: number, h: number): { rect: Rect; beside: boolean } {
  if (mode !== 'docked') return { rect: stageArea(mode, w, h), beside: true };
  const bar = cssPx('--bar', 52);
  const status = cssPx('--status', 40);
  const content = document.querySelector('.content > article, .content > *')?.getBoundingClientRect();
  const right = content ? content.right + 32 : w;
  if (w - right >= 300) return { rect: { x: right, y: bar + 16, w: w - right - 24, h: h - bar - status - 32 }, beside: true };
  return { rect: { x: 0, y: bar, w, h: h - bar - status }, beside: false };
}

/** Per-page MRI defaults: which plane, and the slice range that page scroll maps to. */
export function mriDefaults(mode: Mode): { orient: Orient; from: number; to: number; labels: boolean } {
  switch (mode) {
    case 'surface':
      return { orient: 'sagittal', from: 0.46, to: 0.46, labels: false };
    case 'atlas':
      return { orient: 'coronal', from: 0.52, to: 0.52, labels: true };
    case 'section':
      return { orient: 'axial', from: 0.84, to: 0.24, labels: false };
    case 'explore':
      return { orient: 'axial', from: 0.5, to: 0.5, labels: true };
    case 'deep':
      return { orient: 'axial', from: 0.62, to: 0.3, labels: true };
    default:
      return { orient: 'axial', from: 0.66, to: 0.34, labels: false };
  }
}
