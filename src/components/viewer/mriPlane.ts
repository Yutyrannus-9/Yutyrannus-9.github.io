import * as THREE from 'three';
import { ATLAS_STOPS, axisOf, LABEL_FILL, labelById, MRI_STOPS, type Volume } from './volume';
import type { Orient } from './store';
import { rasToThreeVec } from './coords';

// The MRI slice plane in the 3D explorer: a quad at the current slice that
// samples the 1.5 mm T1 as a Data3DTexture, so the cut face shows real image
// intensities. Labels are optional and come from a second 3D texture.


export function createMriPlane(vol: Volume) {
  const [nx, ny, nz] = vol.dims;
  const t1 = new THREE.Data3DTexture(vol.t1, nx, ny, nz);
  t1.format = THREE.RedFormat;
  t1.type = THREE.UnsignedByteType;
  t1.minFilter = t1.magFilter = THREE.LinearFilter;
  t1.unpackAlignment = 1;
  t1.needsUpdate = true;

  const lab = new THREE.Data3DTexture(vol.labels, nx, ny, nz);
  lab.format = THREE.RedFormat;
  lab.type = THREE.UnsignedByteType;
  lab.minFilter = lab.magFilter = THREE.NearestFilter;
  lab.unpackAlignment = 1;
  lab.needsUpdate = true;

  const pal = new Uint8Array(256 * 4);
  LABEL_FILL.forEach((f, i) => {
    if (f) pal.set([Math.round(f[0]), Math.round(f[1]), Math.round(f[2]), 255], i * 4);
  });
  const palette = new THREE.DataTexture(pal, 256, 1, THREE.RGBAFormat);
  palette.colorSpace = THREE.SRGBColorSpace;
  palette.needsUpdate = true;

  const rgb = (c: [number, number, number]) => new THREE.Color().setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uT1: { value: t1 },
      uLab: { value: lab },
      uPal: { value: palette },
      uLabels: { value: 0 },
      uOrigin: { value: new THREE.Vector3(...vol.originRas) },
      uVoxel: { value: vol.voxelMm },
      uDims: { value: new THREE.Vector3(nx, ny, nz) },
      uC0: { value: rgb(MRI_STOPS[0][1]) },
      uC1: { value: rgb(MRI_STOPS[1][1]) },
      uC2: { value: rgb(MRI_STOPS[2][1]) },
      uC3: { value: rgb(MRI_STOPS[3][1]) },
      uA0: { value: rgb(ATLAS_STOPS[0][1]) },
      uA1: { value: rgb(ATLAS_STOPS[1][1]) },
      uA2: { value: rgb(ATLAS_STOPS[2][1]) },
      uA3: { value: rgb(ATLAS_STOPS[3][1]) },
      uStepU: { value: new THREE.Vector3() },
      uStepW: { value: new THREE.Vector3() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vRas;
      void main() {
        vRas = vec3(position.x, -position.z, position.y);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      precision highp sampler3D;
      uniform sampler3D uT1;
      uniform sampler3D uLab;
      uniform sampler2D uPal;
      uniform float uLabels, uVoxel;
      uniform vec3 uOrigin, uDims, uC0, uC1, uC2, uC3, uA0, uA1, uA2, uA3, uStepU, uStepW;
      varying vec3 vRas;
      vec3 ramp(float v, vec3 a, vec3 b, vec3 c, vec3 d) {
        return v < 0.35 ? mix(a, b, v / 0.35) : v < 0.7 ? mix(b, c, (v - 0.35) / 0.35) : mix(c, d, (v - 0.7) / 0.3);
      }
      float labelAt(vec3 tc) { return floor(texture(uLab, tc).r * 255.0 + 0.5); }
      void main() {
        vec3 tc = ((vRas - uOrigin) / uVoxel + 0.5) / uDims;
        if (any(lessThan(tc, vec3(0.0))) || any(greaterThan(tc, vec3(1.0)))) discard;
        float v = texture(uT1, tc).r;
        if (v < 0.02) discard;
        vec3 col;
        if (uLabels > 0.5) {
          // Atlas style: slate base, filled label, darker outline where the label changes.
          col = ramp(v, uA0, uA1, uA2, uA3);
          float l = labelAt(tc);
          vec4 pc = texelFetch(uPal, ivec2(int(l), 0), 0);
          if (pc.a > 0.5) {
            col = mix(col, pc.rgb, 0.55);
            bool edge = labelAt(tc + uStepU) != l || labelAt(tc - uStepU) != l || labelAt(tc + uStepW) != l || labelAt(tc - uStepW) != l;
            if (edge) col *= vec3(0.5, 0.5, 0.55);
          }
        } else {
          col = ramp(v, uC0, uC1, uC2, uC3);
        }
        gl_FragColor = vec4(col, smoothstep(0.02, 0.1, v));
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 4;
  mesh.frustumCulled = false;

  const lo = vol.originRas;
  const hi = [0, 1, 2].map((a) => vol.originRas[a] + (vol.dims[a] - 1) * vol.voxelMm);

  /** Move the quad to a slice. Returns the slice's RAS coordinate along its axis. */
  const update = (o: Orient, pos: number, labels: boolean) => {
    const a = axisOf(o);
    const k = Math.round(pos * (vol.dims[a] - 1));
    const at = lo[a] + k * vol.voxelMm;
    const [u, w] = [0, 1, 2].filter((i) => i !== a);
    const su = [0, 0, 0];
    su[u] = 1 / vol.dims[u];
    const sw = [0, 0, 0];
    sw[w] = 1 / vol.dims[w];
    material.uniforms.uStepU.value.set(su[0], su[1], su[2]);
    material.uniforms.uStepW.value.set(sw[0], sw[1], sw[2]);
    const corners = [
      [lo[u], lo[w]],
      [hi[u], lo[w]],
      [hi[u], hi[w]],
      [lo[u], hi[w]],
    ];
    const arr = geometry.attributes.position.array as Float32Array;
    corners.forEach(([cu, cw], i) => {
      const ras = [0, 0, 0];
      ras[a] = at;
      ras[u] = cu;
      ras[w] = cw;
      arr.set(rasToThreeVec(ras[0], ras[1], ras[2]), i * 3);
    });
    geometry.attributes.position.needsUpdate = true;
    geometry.computeBoundingSphere();
    material.uniforms.uLabels.value = labels ? 1 : 0;
    return at;
  };

  const labelAtRas = (ras: [number, number, number]) => {
    const idx = [0, 1, 2].map((a) => Math.round((ras[a] - lo[a]) / vol.voxelMm));
    if (idx.some((i, a) => i < 0 || i >= vol.dims[a])) return null;
    const i = idx[0] + idx[1] * nx + idx[2] * nx * ny;
    if (vol.t1[i] < 4) return null;
    return labelById.get(vol.labels[i])?.name ?? null;
  };

  const dispose = () => {
    t1.dispose();
    lab.dispose();
    palette.dispose();
    material.dispose();
    geometry.dispose();
  };

  return { mesh, update, labelAtRas, dispose };
}
