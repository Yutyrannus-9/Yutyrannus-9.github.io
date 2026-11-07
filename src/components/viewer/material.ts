import * as THREE from 'three';
import meta from '../../data/brain/meta.json';

// Brain surface material: MeshStandardMaterial with custom per-vertex data.
//   base   FreeSurfer-style curvature shading from sulc (gyri light, sulci dark)
//   atlas  Desikan–Killiany colors from the FreeSurfer LUT, desaturated 20%
//   thick  single-hue sequential ramp, 1.5–3.5 mm
// plus selection, hover, and a faint cyan fresnel rim.

const PALETTE_SIZE = 36;

function paletteArray(): Float32Array {
  const arr = new Float32Array(PALETTE_SIZE * 3);
  const c = new THREE.Color();
  for (const r of meta.regions) {
    if (r.hemi !== 'L') continue;
    c.setRGB(r.color[0] / 255, r.color[1] / 255, r.color[2] / 255, THREE.SRGBColorSpace);
    arr.set([c.r, c.g, c.b], (r.index - 1) * 3);
  }
  return arr;
}

export interface BrainUniforms {
  uAtlas: { value: number };
  uThick: { value: number };
  uSelected: { value: number };
  uSelMix: { value: number };
  uHover: { value: number };
  [k: string]: { value: unknown };
}

export function createBrainMaterial() {
  const uniforms: BrainUniforms = {
    uAtlas: { value: 0 },
    uThick: { value: 0 },
    uSelected: { value: -1 },
    uSelMix: { value: 0 },
    uHover: { value: -1 },
    uGyrus: { value: new THREE.Color('#a3b3d4') },
    uSulcus: { value: new THREE.Color('#2a3a62') },
    uSelColor: { value: new THREE.Color('#b69cff') },
    uRimColor: { value: new THREE.Color('#5cc8f2') },
    uRim: { value: 0.22 },
    uRamp0: { value: new THREE.Color('#1b3a78') },
    uRamp1: { value: new THREE.Color('#3f8fd0') },
    uRamp2: { value: new THREE.Color('#d9f3ff') },
    uPalette: { value: paletteArray() },
    uPack: { value: new THREE.Vector4(meta.pack.sulc.min, meta.pack.sulc.max, meta.pack.thickness.max, meta.pack.curv.min) },
  };

  const material = new THREE.MeshStandardMaterial({ roughness: 0.74, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 _data;
flat varying float vRegion;
varying vec3 vScalars;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vRegion = _data.x;
vScalars = _data.yzw;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
flat varying float vRegion;
varying vec3 vScalars;
uniform float uAtlas, uThick, uSelected, uSelMix, uHover, uRim;
uniform vec3 uGyrus, uSulcus, uSelColor, uRimColor, uRamp0, uRamp1, uRamp2;
uniform vec3 uPalette[${PALETTE_SIZE}];
uniform vec4 uPack;`,
      )
      .replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        `float region = floor(vRegion + 0.5);
float sulc = uPack.x + vScalars.x / 255.0 * (uPack.y - uPack.x);
float thick = vScalars.y / 255.0 * uPack.z;
float curv = uPack.w + vScalars.z / 255.0 * (-2.0 * uPack.w);
float deep = smoothstep(-4.0, 4.0, sulc);
vec3 col = mix(uGyrus, uSulcus, deep);
col *= 1.0 - 0.5 * smoothstep(-0.02, 0.22, curv);
if (region > 0.5) {
  vec3 atlas = uPalette[int(region) - 1];
  atlas = mix(atlas, vec3(dot(atlas, vec3(0.2126, 0.7152, 0.0722))), 0.2);
  atlas *= mix(1.0, 0.7, deep);
  col = mix(col, atlas, uAtlas);
  float t = clamp((thick - 1.5) / 2.0, 0.0, 1.0);
  vec3 ramp = t < 0.5 ? mix(uRamp0, uRamp1, t * 2.0) : mix(uRamp1, uRamp2, t * 2.0 - 1.0);
  col = mix(col, ramp * mix(1.0, 0.82, deep), uThick);
  if (uSelected > 0.0) {
    if (abs(region - uSelected) < 0.5) col = mix(col, uSelColor, 0.55 * uSelMix);
    else col = mix(col, col * 0.35 + vec3(0.02, 0.03, 0.06), 0.8 * uSelMix);
  }
  if (abs(region - uHover) < 0.5) col = mix(col, vec3(1.0), 0.16);
} else {
  col *= mix(1.0, 0.5, max(uAtlas, uThick));
  if (uSelected > 0.0) col *= mix(1.0, 0.4, uSelMix);
}
vec4 diffuseColor = vec4( col, opacity );`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
float fres = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0);
totalEmissiveRadiance += uRimColor * uRim * fres;`,
      );
  };
  material.customProgramCacheKey = () => 'pba-brain-1';
  return { material, uniforms };
}

// Stencil passes for section mode. Each closed surface flips one stencil bit
// per layer it covers, so after both passes a pixel on the cap plane has
// bit 0 = inside pial, bit 1 = inside white.
export function createStencilMaterial(bit: 1 | 2, plane: THREE.Plane) {
  return new THREE.MeshBasicMaterial({
    side: THREE.DoubleSide,
    colorWrite: false,
    depthWrite: false,
    depthTest: false,
    clippingPlanes: [plane],
    stencilWrite: true,
    stencilFunc: THREE.AlwaysStencilFunc,
    stencilWriteMask: bit,
    stencilFail: THREE.InvertStencilOp,
    stencilZFail: THREE.InvertStencilOp,
    stencilZPass: THREE.InvertStencilOp,
  });
}

// Cap fills: white matter where bit 1 is set, cortical ribbon where only bit 0 is.
export function createCapMaterial(kind: 'white' | 'ribbon') {
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color(kind === 'white' ? '#d6deec' : '#6d7fa6'),
    stencilWrite: true,
    stencilWriteMask: 0,
    stencilRef: kind === 'white' ? 2 : 1,
    stencilFuncMask: kind === 'white' ? 2 : 3,
    stencilFunc: THREE.EqualStencilFunc,
    stencilFail: THREE.KeepStencilOp,
    stencilZFail: THREE.KeepStencilOp,
    stencilZPass: THREE.KeepStencilOp,
  });
}
