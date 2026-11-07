// FreeSurfer tkr-RAS (x right, y anterior, z superior) ↔ three.js (y up).
// Same mapping as scripts/lib/surfaces.mjs: (x, y, z) → (x, z, −y).
export const rasToThreeVec = (x: number, y: number, z: number): [number, number, number] => [x, z, -y];
export const threeToRas = (x: number, y: number, z: number): [number, number, number] => [x, -z, y];
