import type { Tier } from './store';

// Tier A: desktop WebGL2, everything. Tier B: phones, low memory, or Save-Data:
// 3D and MRI views are opt-in, no idle rotation, no live section cut.
// Tier C: no WebGL2 (the "Still" backdrop is a separate visitor choice).
export function detectTier(): Tier {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return 'C';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    return 'C';
  }
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  const saveData = nav.connection?.saveData === true;
  const lowMemory = typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 4;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const narrow = window.innerWidth < 900;
  return saveData || lowMemory || coarse || narrow ? 'B' : 'A';
}

export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
