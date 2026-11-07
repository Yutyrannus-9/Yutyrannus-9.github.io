import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import meta from '../../data/brain/meta.json';

export interface HemiGeometry {
  hemi: 'lh' | 'rh';
  geometry: THREE.BufferGeometry;
  /** Morph target order in geometry.morphAttributes.position. */
  targets: string[];
}

// Loads one hemisphere GLB and rebuilds it as a plain float32 geometry in
// three.js millimetres (quantization undone), with normals for the base surface
// and each morph target computed here instead of shipped.
async function loadHemi(loader: GLTFLoader, hemi: 'lh' | 'rh'): Promise<HemiGeometry> {
  const gltf = await loader.loadAsync(`/brain/${hemi}.glb?v=${meta.version}`);
  let src: THREE.Mesh | undefined;
  gltf.scene.traverse((o) => {
    if (!src && (o as THREE.Mesh).isMesh) src = o as THREE.Mesh;
  });
  if (!src) throw new Error(`${hemi}.glb has no mesh`);
  src.updateWorldMatrix(true, false);
  const m = src.matrixWorld;
  const lin = new THREE.Matrix3().setFromMatrix4(m);
  const g = src.geometry;
  const n = g.attributes.position.count;
  const v = new THREE.Vector3();

  const base = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(g.attributes.position as THREE.BufferAttribute, i).applyMatrix4(m);
    base[i * 3] = v.x;
    base[i * 3 + 1] = v.y;
    base[i * 3 + 2] = v.z;
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(base, 3));
  const data = g.getAttribute('_data') as THREE.BufferAttribute;
  out.setAttribute('_data', new THREE.BufferAttribute(new Uint8Array(data.array as ArrayLike<number>), 4));
  const index = g.index!;
  out.setIndex(new THREE.BufferAttribute(new Uint16Array(index.array as ArrayLike<number>), 1));
  out.computeVertexNormals();
  const baseNormals = out.attributes.normal.array as Float32Array;

  const targets = (src.userData.targetNames as string[] | undefined) ?? (g.userData.targetNames as string[]) ?? meta.targets;
  const morphPos: THREE.BufferAttribute[] = [];
  const morphNrm: THREE.BufferAttribute[] = [];
  const tmp = new THREE.BufferGeometry();
  tmp.setIndex(out.index);
  (g.morphAttributes.position ?? []).forEach((attr) => {
    const delta = new Float32Array(n * 3);
    const abs = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(attr as THREE.BufferAttribute, i).applyMatrix3(lin);
      delta[i * 3] = v.x;
      delta[i * 3 + 1] = v.y;
      delta[i * 3 + 2] = v.z;
      abs[i * 3] = base[i * 3] + v.x;
      abs[i * 3 + 1] = base[i * 3 + 1] + v.y;
      abs[i * 3 + 2] = base[i * 3 + 2] + v.z;
    }
    tmp.setAttribute('position', new THREE.BufferAttribute(abs, 3));
    tmp.computeVertexNormals();
    const tn = tmp.attributes.normal.array as Float32Array;
    const dn = new Float32Array(n * 3);
    for (let i = 0; i < dn.length; i++) dn[i] = tn[i] - baseNormals[i];
    morphPos.push(new THREE.BufferAttribute(delta, 3));
    morphNrm.push(new THREE.BufferAttribute(dn, 3));
    tmp.deleteAttribute('normal');
  });
  out.morphAttributes.position = morphPos;
  out.morphAttributes.normal = morphNrm;
  out.morphTargetsRelative = true;
  out.computeBoundingSphere();
  g.dispose();
  return { hemi, geometry: out, targets };
}

export async function loadBrain(): Promise<HemiGeometry[]> {
  await MeshoptDecoder.ready;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  return Promise.all([loadHemi(loader, 'lh'), loadHemi(loader, 'rh')]);
}

export { threeToRas } from './coords';
