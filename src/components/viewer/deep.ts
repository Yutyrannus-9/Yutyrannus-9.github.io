import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { DEEP as deepMeta, deepById } from './deepMeta';

export { deepById };

export interface DeepMesh {
  id: string;
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  base: THREE.Color;
  center: THREE.Vector3;
}

// Subcortical meshes from scripts/build-deep.mjs, dequantized into the same
// three.js millimetre space as the cortical surfaces.
export async function loadDeep(plane: THREE.Plane): Promise<DeepMesh[]> {
  await MeshoptDecoder.ready;
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(`/brain/deep.glb?v=${deepMeta.version}`);
  gltf.scene.updateMatrixWorld(true);
  const out: DeepMesh[] = [];
  const v = new THREE.Vector3();
  gltf.scene.traverse((o) => {
    const src = o as THREE.Mesh;
    if (!src.isMesh) return;
    const id = (src.parent?.name && deepById.has(src.parent.name) ? src.parent.name : src.name) || '';
    const info = deepById.get(id) ?? deepById.get(src.name);
    if (!info) return;
    const g = src.geometry;
    const n = g.attributes.position.count;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(g.attributes.position as THREE.BufferAttribute, i).applyMatrix4(src.matrixWorld);
      pos.set([v.x, v.y, v.z], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(g.index!.array as ArrayLike<number>), 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const base = new THREE.Color().setRGB(info.color[0] / 255, info.color[1] / 255, info.color[2] / 255, THREE.SRGBColorSpace);
    const l = base.r * 0.2126 + base.g * 0.7152 + base.b * 0.0722;
    base.lerp(new THREE.Color(l, l, l), 0.15);
    const material = new THREE.MeshStandardMaterial({ color: base.clone(), roughness: 0.55, metalness: 0, clippingPlanes: [plane] });
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = info.id;
    mesh.userData.deep = info.id;
    mesh.renderOrder = 2;
    out.push({ id: info.id, mesh, material, base, center: geo.boundingSphere!.center.clone() });
  });
  return out;
}
