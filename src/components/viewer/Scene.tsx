import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import meta from '../../data/brain/meta.json';
import views from '../../data/brain/views.json';
import { loadBrain, type HemiGeometry } from './loadBrain';
import { threeToRas } from './coords';
import { createBrainMaterial, createCapMaterial, createStencilMaterial, type BrainUniforms } from './material';
import { loadDeep, type DeepMesh } from './deep';
import { deepById } from './deepMeta';
import { createMriPlane } from './mriPlane';
import { loadVolume, axisOf, VOLUME } from './volume';
import { stageArea } from './layout';
import { brainStore, getBrain, hudRefs, setBrain, viewerSettings, type Command, type Hemi, type Mode } from './store';

const CENTER = new THREE.Vector3(...(meta.center as [number, number, number]));
const INFLATED_CENTER = new THREE.Vector3(...(views.inflatedCenter as [number, number, number]));
const FOV = views.fovDeg;
const TAN = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

interface Anim {
  from: number;
  to: number;
  t0: number;
  dur: number;
}
const animValue = (a: Anim, now: number) => {
  const k = a.dur <= 0 ? 1 : Math.min(1, (now - a.t0) / a.dur);
  return { v: a.from + (a.to - a.from) * easeOut(k), done: k >= 1 };
};

// ── Stage geometry: where the brain should sit inside the full-viewport canvas ─
function stageRect(mode: Mode, w: number, h: number) {
  const r = stageArea(mode, w, h);
  return { cx: r.x + r.w / 2, cy: r.y + r.h / 2, m: Math.min(r.w, r.h) };
}

// Research ("deep") faces the cut: the removed half is above (axial), in front
// (coronal), or on the right (sagittal), so the camera looks from that side.
const DEEP_DIRS = {
  axial: [-0.55, 0.75, -0.38],
  coronal: [-0.42, 0.3, -0.86],
  sagittal: [0.86, 0.3, -0.4],
} as const;

function viewFor(mode: Mode, w: number, h: number) {
  const v = mode === 'deep' ? { ...views.modes.deep, dir: DEEP_DIRS[getBrain().mriOrient] } : views.modes[mode];
  const { m } = stageRect(mode, w, h);
  const dist = (v.radius * h) / (views.fill * m * TAN);
  const target = (v.center === 'inflated' ? INFLATED_CENTER : CENTER).clone().sub(CENTER);
  const dir = new THREE.Vector3(...(v.dir as [number, number, number])).normalize();
  return { target, position: target.clone().addScaledVector(dir, dist), dist };
}

// What each page asks of the cortex. The explore page takes its settings from the panel.
function targetsFor(s: ReturnType<typeof getBrain>) {
  const v = viewerSettings(s);
  return {
    inflate: s.mode === 'inflated' || (v.on && v.inflate) ? 1 : 0,
    atlas: s.mode === 'atlas' || (v.on && v.colorBy === 'atlas') ? 1 : 0,
    thick: (!v.on && s.thickness) || (v.on && v.colorBy === 'thickness') ? 1 : 0,
    cortex: v.cortex,
  };
}

// ── Brain ───────────────────────────────────────────────────────────────────
interface HemiParts {
  hemi: Hemi;
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  uniforms: BrainUniforms;
  stencilPial: THREE.Mesh;
  stencilWhite: THREE.Mesh;
}

function Brain({ hemis }: { hemis: HemiGeometry[] }) {
  const { camera, gl, invalidate, size } = useThree();
  const group = useRef<THREE.Group>(null!);
  const inner = useRef<THREE.Group>(null!);
  const controls = useRef<OrbitControls | null>(null);
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e4), []);
  const capGroup = useRef<THREE.Group>(null!);
  const deepGroup = useRef<THREE.Group>(null!);
  const [deep, setDeep] = useState<DeepMesh[] | null>(null);
  const [mri, setMri] = useState<ReturnType<typeof createMriPlane> | null>(null);

  const parts = useMemo<HemiParts[]>(() => {
    const clipping = [plane];
    return hemis.map((h) => {
      const { material, uniforms } = createBrainMaterial();
      material.clippingPlanes = clipping;
      const mesh = new THREE.Mesh(h.geometry, material);
      mesh.renderOrder = 3;
      mesh.userData.hemi = h.hemi === 'lh' ? 'L' : 'R';
      const stencilPial = new THREE.Mesh(h.geometry, createStencilMaterial(1, plane));
      const stencilWhite = new THREE.Mesh(h.geometry, createStencilMaterial(2, plane));
      stencilPial.renderOrder = stencilWhite.renderOrder = 1;
      stencilPial.visible = stencilWhite.visible = false;
      stencilPial.raycast = stencilWhite.raycast = () => {};
      const wi = h.targets.indexOf('white');
      if (wi >= 0) stencilWhite.morphTargetInfluences![wi] = 1;
      return { hemi: mesh.userData.hemi as Hemi, mesh, material, uniforms, stencilPial, stencilWhite };
    });
  }, [hemis, plane]);

  const caps = useMemo(() => {
    const geo = new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2);
    const white = new THREE.Mesh(geo, createCapMaterial('white'));
    const ribbon = new THREE.Mesh(geo, createCapMaterial('ribbon'));
    white.renderOrder = ribbon.renderOrder = 2;
    white.raycast = ribbon.raycast = () => {};
    return { white, ribbon };
  }, []);

  // Animation state lives in refs; the frame loop only runs while something moves.
  const anim = useRef({
    inflate: { from: 0, to: 0, t0: 0, dur: 0 } as Anim,
    atlas: { from: 0, to: 0, t0: 0, dur: 0 } as Anim,
    thick: { from: 0, to: 0, t0: 0, dur: 0 } as Anim,
    sel: { from: 0, to: 0, t0: 0, dur: 0 } as Anim,
    slice: { from: 1e4, to: 1e4, t0: 0, dur: 0 } as Anim,
    cam: null as null | { fromPos: THREE.Vector3; toPos: THREE.Vector3; fromT: THREE.Vector3; toT: THREE.Vector3; t0: number; dur: number },
    assemble: { from: 1, to: 0, t0: 0, dur: 0 } as Anim,
    rot: { from: 0, to: 0, t0: 0, dur: 0 } as Anim,
    pxPerMm: 0,
    planeAt: 0,
    // Explorer cut: which side is removed (+1 / −1 along the slice axis) and a
    // 0–1 "open" amount used to wipe the cut away and back in when the side changes.
    cut: { side: 1, open: { from: 0, to: 0, t0: 0, dur: 0 } as Anim, next: 0 },
  });

  const start = (a: Anim, to: number, dur: number) => {
    const now = performance.now();
    const cur = animValue(a, now).v;
    if (a.to === to && animValue(a, now).done) return;
    Object.assign(a, { from: cur, to, t0: now, dur: getBrain().reducedMotion ? 0 : dur });
  };

  const flyTo = (mode: Mode, dur = 900) => {
    const c = controls.current;
    if (!c) return;
    const v = viewFor(mode, size.width, size.height);
    anim.current.cam = {
      fromPos: camera.position.clone(),
      toPos: v.position,
      fromT: c.target.clone(),
      toT: v.target,
      t0: performance.now(),
      dur: getBrain().reducedMotion ? 0 : dur,
    };
    c.minDistance = v.dist * 0.35;
    c.maxDistance = v.dist * 1.8;
    invalidate();
  };

  const flyDir = (dir: THREE.Vector3, dur = 700) => {
    const c = controls.current;
    if (!c) return;
    const dist = camera.position.distanceTo(c.target);
    anim.current.cam = {
      fromPos: camera.position.clone(),
      toPos: c.target.clone().addScaledVector(dir.clone().normalize(), dist),
      fromT: c.target.clone(),
      toT: c.target.clone(),
      t0: performance.now(),
      dur: getBrain().reducedMotion ? 0 : dur,
    };
    invalidate();
  };

  // Load the explorer's extra layers on first use.
  useEffect(() => {
    let alive = true;
    const ensure = () => {
      const v = viewerSettings(getBrain());
      if (!v.on) return;
      if (v.deep && !deep) loadDeep(plane).then((d) => alive && setDeep(d)).catch(console.error);
      const mriOn = document.documentElement.dataset.mri === 'on';
      if (v.plane && mriOn && !mri) loadVolume().then((vol) => alive && setMri(createMriPlane(vol))).catch(console.error);
    };
    ensure();
    const unsub = brainStore.subscribe((s, p) => {
      if (s.mode !== p.mode || s.deep !== p.deep || s.plane !== p.plane) ensure();
    });
    return () => {
      alive = false;
      unsub();
    };
  }, [deep, mri, plane]);
  useEffect(() => () => mri?.dispose(), [mri]);

  // Controls
  useEffect(() => {
    const c = new OrbitControls(camera, gl.domElement);
    c.enableDamping = true;
    c.dampingFactor = 0.09;
    c.enablePan = false;
    c.enableZoom = false; // the wheel scrolls the page (or moves the slice in the explorer); zoom lives in HUD buttons
    c.rotateSpeed = 0.6;
    c.addEventListener('change', () => invalidate());
    c.addEventListener('start', () => setBrain({ interacted: true }));
    gl.domElement.style.touchAction = 'pan-y';
    controls.current = c;
    const mode = getBrain().mode;
    const v = viewFor(mode, size.width, size.height);
    camera.position.copy(v.position);
    c.target.copy(v.target);
    c.minDistance = v.dist * 0.35;
    c.maxDistance = v.dist * 1.8;
    c.update();
    return () => c.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, gl]);

  // Keep the brain centered in the stage when the window or layout changes.
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const { cx, cy } = stageRect(getBrain().mode, size.width, size.height);
    cam.setViewOffset(size.width, size.height, size.width / 2 - cx, size.height / 2 - cy, size.width, size.height);
    cam.updateProjectionMatrix();
    invalidate();
  }, [size.width, size.height, camera, invalidate]);

  // Cortex style: solid, glass (see-through shell), or hidden.
  const applyCortex = (style: 'solid' | 'glass' | 'hidden') => {
    for (const p of parts) {
      const glass = style === 'glass';
      if (p.material.transparent !== glass) {
        p.material.transparent = glass;
        p.material.depthWrite = !glass;
        p.material.needsUpdate = true;
      }
      p.material.opacity = glass ? 0.13 : 1;
      p.uniforms.uRim.value = glass ? 0.55 : 0.22;
      p.mesh.renderOrder = glass ? 6 : 3;
      p.mesh.userData.hiddenStyle = style === 'hidden';
    }
  };

  // Deep-structure selection: highlight one, dim the rest.
  const applyDeepSelection = (id: string | null) => {
    for (const d of deepRef.current ?? []) {
      const on = d.id === id;
      d.material.color.copy(d.base).multiplyScalar(id && !on ? 0.4 : 1);
      d.material.emissive.set(on ? '#6a4bc4' : '#000000');
      d.material.emissiveIntensity = on ? 0.55 : 0;
    }
    invalidate();
  };
  useEffect(() => {
    applyDeepSelection(getBrain().deepSelected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deep]);

  // React to store changes.
  useEffect(() => {
    const a = anim.current;
    const retarget = () => {
      const t = targetsFor(getBrain());
      start(a.inflate, t.inflate, 900);
      start(a.atlas, t.atlas, 300);
      start(a.thick, t.thick, 300);
      applyCortex(t.cortex);
      invalidate();
    };
    const applyMode = (mode: Mode, first = false) => {
      const cam = camera as THREE.PerspectiveCamera;
      const { cx, cy } = stageRect(mode, size.width, size.height);
      cam.setViewOffset(size.width, size.height, size.width / 2 - cx, size.height / 2 - cy, size.width, size.height);
      cam.updateProjectionMatrix();
      retarget();
      const section = mode === 'section' && getBrain().tier === 'A';
      if (section) {
        Object.assign(a.slice, { from: views.section.topMm, to: getBrain().slice, t0: performance.now(), dur: getBrain().reducedMotion ? 0 : 700 });
      } else {
        Object.assign(a.slice, { from: 1e4, to: 1e4, t0: 0, dur: 0 });
      }
      if (controls.current) {
        controls.current.maxPolarAngle = mode === 'section' ? THREE.MathUtils.degToRad(68) : Math.PI;
        controls.current.enabled = mode !== 'docked';
      }
      gl.domElement.style.touchAction = mode === 'explore' ? 'none' : 'pan-y';
      if (mode !== 'surface' && group.current) {
        const r = Math.atan2(Math.sin(group.current.rotation.y), Math.cos(group.current.rotation.y));
        Object.assign(a.rot, { from: r, to: 0, t0: performance.now(), dur: getBrain().reducedMotion ? 0 : 900 });
      }
      if (mode !== 'atlas' && !viewerSettings(getBrain()).on) for (const p of parts) p.mesh.visible = true;
      if (!first) flyTo(mode);
      invalidate();
    };
    applyMode(getBrain().mode, true);
    if (!getBrain().reducedMotion) Object.assign(a.assemble, { from: 1, to: 0, t0: performance.now(), dur: 700 });
    else Object.assign(a.assemble, { from: 0, to: 0, t0: 0, dur: 0 });

    const unsub = brainStore.subscribe((s, prev) => {
      if (s.mode !== prev.mode) applyMode(s.mode);
      else if (
        s.thickness !== prev.thickness ||
        s.inflateOn !== prev.inflateOn ||
        s.colorBy !== prev.colorBy ||
        s.cortex !== prev.cortex
      )
        retarget();
      if (s.deep !== prev.deep || s.plane !== prev.plane || s.mriOrient !== prev.mriOrient || s.mriPos !== prev.mriPos || s.mriLabels !== prev.mriLabels || s.cutAway !== prev.cutAway) invalidate();
      if (s.selected !== prev.selected) {
        // The other hemisphere gets index 999 (matches nothing) so it dims too.
        for (const p of parts) p.uniforms.uSelected.value = s.selected ? (s.selected.hemi === p.hemi ? s.selected.index : 999) : -1;
        Object.assign(a.sel, { from: 0, to: s.selected ? 1 : 0, t0: performance.now(), dur: 150 });
        invalidate();
      }
      if (s.deepSelected !== prev.deepSelected) applyDeepSelection(s.deepSelected);
      if (s.mode === 'deep' && prev.mode === 'deep' && s.mriOrient !== prev.mriOrient) flyTo('deep', 700);
      if (s.deepFocus !== prev.deepFocus && s.deepFocus) {
        const d = deepRef.current?.find((m) => m.id === s.deepFocus);
        if (d) {
          // Move the slice through the structure and look at it from its own side, slightly above.
          const ras = threeToRas(d.center.x, d.center.y, d.center.z);
          const ax = axisOf(s.mriOrient);
          const pos = (ras[ax] - VOLUME.originRas[ax]) / (VOLUME.voxelMm * (VOLUME.dims[ax] - 1));
          setBrain({ mriPos: THREE.MathUtils.clamp(pos, 0, 1) });
          const side = d.center.x - CENTER.x;
          flyDir(new THREE.Vector3(Math.abs(side) < 5 ? -0.7 : Math.sign(side), 0.55, -0.35));
        }
      }
      if (s.focus !== prev.focus) focusOn(s.focus);
      if (s.hover?.region !== prev.hover?.region) {
        for (const p of parts) p.uniforms.uHover.value = s.hover?.region && s.hover.region.hemi === p.hemi ? s.hover.region.index : -1;
        invalidate();
      }
      if (s.slice !== prev.slice && s.mode === 'section' && s.tier === 'A') {
        Object.assign(a.slice, { from: animValue(a.slice, performance.now()).v, to: s.slice, t0: performance.now(), dur: 120 });
        invalidate();
      }
    });

    // Turn toward a region chosen from the list. Medial regions face the other
    // hemisphere, so that hemisphere is hidden while one of them is selected.
    const focusOn = (ref: { hemi: Hemi; index: number } | null) => {
      if (!ref) {
        for (const p of parts) p.mesh.visible = true;
        invalidate();
        return;
      }
      const part = parts.find((p) => p.hemi === ref.hemi);
      if (!part) return;
      const geo = part.mesh.geometry;
      const data = geo.attributes._data;
      const nrm = geo.attributes.normal;
      const n = new THREE.Vector3();
      for (let i = 0; i < data.count; i++) {
        if (data.getX(i) === ref.index) n.x += nrm.getX(i), n.y += nrm.getY(i), n.z += nrm.getZ(i);
      }
      if (n.lengthSq() === 0) return;
      n.normalize();
      const medial = (ref.hemi === 'L' && n.x > 0.3) || (ref.hemi === 'R' && n.x < -0.3);
      for (const p of parts) p.mesh.visible = !medial || p.hemi === ref.hemi;
      group.current.rotation.y = 0;
      a.rot = { from: 0, to: 0, t0: 0, dur: 0 };
      flyDir(n.clone().add(new THREE.Vector3(0, 0.25, 0)));
    };

    const command = (cmd: Command) => {
      const c = controls.current;
      if (!c) return;
      setBrain({ interacted: true });
      const offset = camera.position.clone().sub(c.target);
      if (cmd === 'rotateLeft' || cmd === 'rotateRight') {
        offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), (cmd === 'rotateLeft' ? -1 : 1) * THREE.MathUtils.degToRad(30));
      } else if (cmd === 'zoomIn' || cmd === 'zoomOut') {
        const len = THREE.MathUtils.clamp(offset.length() * (cmd === 'zoomIn' ? 0.82 : 1.22), c.minDistance, c.maxDistance);
        offset.setLength(len);
      }
      if (cmd === 'reset') {
        group.current.rotation.set(0, 0, 0);
        flyTo(getBrain().mode, 500);
        return;
      }
      a.cam = {
        fromPos: camera.position.clone(),
        toPos: c.target.clone().add(offset),
        fromT: c.target.clone(),
        toT: c.target.clone(),
        t0: performance.now(),
        dur: getBrain().reducedMotion ? 0 : 350,
      };
      invalidate();
    };
    setBrain({ command });
    return () => {
      unsub();
      setBrain({ command: null });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parts]);

  const deepRef = useRef<DeepMesh[] | null>(null);
  deepRef.current = deep;
  const mriRef = useRef<ReturnType<typeof createMriPlane> | null>(null);
  mriRef.current = mri;

  // Picking: raycast on pointer move (throttled to animation frames).
  useEffect(() => {
    const el = gl.domElement;
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const tmp = new THREE.Vector3();
    const local = new THREE.Vector3();
    let pending: PointerEvent | null = null;
    let raf = 0;
    let down: { x: number; y: number } | null = null;

    interface Pick {
      x: number;
      y: number;
      region: { hemi: Hemi; index: number } | null;
      ras: [number, number, number];
      label?: string | null;
      deep?: string;
    }
    const pick = (e: { clientX: number; clientY: number }): Pick | null => {
      const rect = el.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const s = getBrain();
      const vs = viewerSettings(s);
      const explore = vs.on;
      const targets: THREE.Object3D[] = [];
      const cortexPickable = !explore || vs.cortex === 'solid';
      if (cortexPickable) for (const p of parts) if (p.mesh.visible) targets.push(p.mesh);
      if (explore && deepGroup.current?.visible) for (const d of deepRef.current ?? []) targets.push(d.mesh);
      if (explore && mriRef.current?.mesh.visible) targets.push(mriRef.current.mesh);
      const hits = ray.intersectObjects(targets, false).filter((h) => plane.distanceToPoint(h.point) >= -0.01 || h.object === mriRef.current?.mesh);
      const hit = hits[0];
      if (!hit) return null;
      const base = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const round = (r: [number, number, number]) => r.map((v) => Math.round(v * 10) / 10) as [number, number, number];
      if (hit.object.userData.deep) {
        local.copy(hit.point);
        inner.current.worldToLocal(local);
        return { ...base, region: null, deep: hit.object.userData.deep as string, label: null, ras: round(threeToRas(local.x, local.y, local.z)) };
      }
      if (hit.object === mriRef.current?.mesh) {
        local.copy(hit.point);
        inner.current.worldToLocal(local);
        const ras = threeToRas(local.x, local.y, local.z);
        const label = mriRef.current.labelAtRas(ras);
        if (label === null) return null;
        return { ...base, region: null, label, ras: round(ras) };
      }
      if (!hit.face) return null;
      const mesh = hit.object as THREE.Mesh;
      let best = -1;
      let bestD = Infinity;
      for (const vi of [hit.face.a, hit.face.b, hit.face.c]) {
        mesh.getVertexPosition(vi, tmp);
        tmp.applyMatrix4(mesh.matrixWorld);
        const d = tmp.distanceToSquared(hit.point);
        if (d < bestD) {
          bestD = d;
          best = vi;
        }
      }
      const pos = mesh.geometry.attributes.position;
      const data = mesh.geometry.attributes._data;
      const index = data.getX(best);
      return {
        ...base,
        region: index > 0 ? { hemi: mesh.userData.hemi as Hemi, index } : null,
        ras: round(threeToRas(pos.getX(best), pos.getY(best), pos.getZ(best))),
      };
    };

    const flush = () => {
      raf = 0;
      if (!pending) return;
      const e = pending;
      pending = null;
      const h = pick(e);
      const prev = getBrain().hover;
      if (!h && !prev) return;
      setBrain({ hover: h ? { region: h.region, label: h.label ?? (h.deep ? deepById.get(h.deep)?.fsLabel ?? h.deep : null), ras: h.ras, x: h.x, y: h.y } : null });
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch' || getBrain().mode === 'docked') return;
      pending = e;
      if (!raf) raf = requestAnimationFrame(flush);
    };
    const onLeave = () => setBrain({ hover: null });

    // Explorer: two-finger vertical swipe moves the slice (one finger rotates).
    const touches = new Map<number, number>();
    let swipeY: number | null = null;
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
      if (e.pointerType === 'touch') {
        touches.set(e.pointerId, e.clientY);
        if (touches.size === 2) swipeY = [...touches.values()].reduce((a, b) => a + b) / 2;
      }
    };
    const onTouchMove = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || !touches.has(e.pointerId)) return;
      touches.set(e.pointerId, e.clientY);
      if (touches.size === 2 && swipeY !== null && getBrain().mode === 'explore') {
        const y = [...touches.values()].reduce((a, b) => a + b) / 2;
        const s = getBrain();
        setBrain({ mriPos: THREE.MathUtils.clamp(s.mriPos + (swipeY - y) / 600, 0, 1) });
        swipeY = y;
      }
    };
    const onUp = (e: PointerEvent) => {
      touches.delete(e.pointerId);
      if (touches.size < 2) swipeY = null;
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      down = null;
      const mode = getBrain().mode;
      const viewer = viewerSettings(getBrain()).on;
      if (mode !== 'atlas' && !viewer) return;
      const h = pick(e);
      if (viewer) {
        setBrain({ deepSelected: h?.deep ?? null, selected: h?.region ?? null });
      } else setBrain({ selected: h?.region ?? null });
    };
    // Explorer: the wheel over the brain moves the slice. The explorer page
    // itself does not scroll on desktop, so this never fights page scrolling.
    const onWheel = (e: WheelEvent) => {
      const s = getBrain();
      if (s.mode !== 'explore' || !s.plane) return;
      e.preventDefault();
      setBrain({ mriPos: THREE.MathUtils.clamp(s.mriPos - e.deltaY / 1500, 0, 1), interacted: true });
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointermove', onTouchMove);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointermove', onTouchMove);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onWheel);
    };
  }, [gl, camera, parts, plane]);

  // Frame loop
  const axes = useMemo(
    () => ({
      R: new THREE.Vector3(1, 0, 0),
      L: new THREE.Vector3(-1, 0, 0),
      S: new THREE.Vector3(0, 1, 0),
      I: new THREE.Vector3(0, -1, 0),
      A: new THREE.Vector3(0, 0, -1),
      P: new THREE.Vector3(0, 0, 1),
    }),
    [],
  );
  const scratch = useMemo(() => ({ p: new THREE.Vector3(), n: new THREE.Vector3(), cam: new THREE.Vector3() }), []);
  useFrame((_, delta) => {
    const a = anim.current;
    const now = performance.now();
    const s = getBrain();
    let moving = false;
    const vs = viewerSettings(s);
    const explore = vs.on;

    const inf = animValue(a.inflate, now);
    const atl = animValue(a.atlas, now);
    const thk = animValue(a.thick, now);
    const sel = animValue(a.sel, now);
    const asm = animValue(a.assemble, now);
    moving ||= !inf.done || !atl.done || !thk.done || !sel.done || !asm.done;

    for (const p of parts) {
      const infIdx = hemis[0].targets.indexOf('inflated');
      if (infIdx >= 0) p.mesh.morphTargetInfluences![infIdx] = inf.v;
      p.uniforms.uAtlas.value = atl.v;
      p.uniforms.uThick.value = thk.v;
      p.uniforms.uSelMix.value = s.selected ? sel.v : 0;
      // First-load assembly: hemispheres slide together from 14 mm apart.
      p.mesh.position.x = (p.hemi === 'L' ? -1 : 1) * 14 * asm.v;
      p.stencilPial.position.x = p.stencilWhite.position.x = p.mesh.position.x;
      if (p.mesh.userData.hiddenStyle) p.mesh.visible = false;
      else if (explore) p.mesh.visible = true;
    }

    // Explorer layers (deep structures and the MRI plane only line up with the
    // folded surface, so they hide while the cortex is inflated).
    const flat = inf.v < 0.02;
    if (deepGroup.current) deepGroup.current.visible = explore && vs.deep && flat && !!deep;
    const planeOn = explore && vs.plane && flat && !!mri;
    if (mri) {
      mri.mesh.visible = planeOn;
      if (planeOn) a.planeAt = mri.update(s.mriOrient, s.mriPos, s.mriLabels);
    }

    // Clipping: the explorer cuts away the side of the slice facing the camera;
    // the Projects page cuts from above with stencil caps.
    const sectionOn = s.mode === 'section' && s.tier === 'A' && flat;
    const sl = animValue(a.slice, now);
    moving ||= !sl.done;
    if (planeOn) {
      const ax = axisOf(s.mriOrient);
      const rasN = [0, 0, 0];
      rasN[ax] = 1;
      const rasP = [0, 0, 0];
      rasP[ax] = a.planeAt;
      inner.current.updateWorldMatrix(true, false);
      scratch.p.set(rasP[0], rasP[2], -rasP[1]).applyMatrix4(inner.current.matrixWorld);
      scratch.n.set(rasN[0], rasN[2], -rasN[1]).transformDirection(inner.current.matrixWorld);
      // Only the axis coordinate of the point matters.
      const along = scratch.p.dot(scratch.n);
      scratch.p.copy(scratch.n).multiplyScalar(along);

      // Which side should be removed? Fixed sides come from the panel. "Auto"
      // follows the camera with hysteresis, so orbiting near edge-on doesn't flicker.
      const cut = a.cut;
      let want = vs.cutAway === 'minus' ? -1 : 1;
      if (vs.cutAway === 'auto') {
        camera.getWorldPosition(scratch.cam);
        const c = controls.current;
        const dist = c ? camera.position.distanceTo(c.target) : 300;
        const lean = scratch.cam.clone().sub(scratch.p).dot(scratch.n) / dist;
        const current = cut.next || cut.side;
        want = lean > 0.15 ? 1 : lean < -0.15 ? -1 : current;
      }
      // Side change: wipe the cut open (the removed part slides back in), flip,
      // then wipe it closed on the new side. ~0.6 s total, instant under reduced motion.
      const op = animValue(cut.open, now);
      if (want !== cut.side && !cut.next) {
        cut.next = want;
        Object.assign(cut.open, { from: op.v, to: 1, t0: now, dur: s.reducedMotion ? 0 : 300 });
      } else if (cut.next && op.done && cut.open.to === 1) {
        cut.side = cut.next;
        cut.next = 0;
        Object.assign(cut.open, { from: 1, to: 0, t0: now, dur: s.reducedMotion ? 0 : 300 });
      }
      const open = animValue(cut.open, now);
      moving ||= !open.done || !!cut.next;
      // Keep the side opposite the removed one; slide the plane out by `open`.
      const removeDir = scratch.n.clone().multiplyScalar(cut.side);
      const easedOpen = open.v * open.v * (3 - 2 * open.v);
      scratch.p.addScaledVector(removeDir, easedOpen * 260);
      plane.setFromNormalAndCoplanarPoint(removeDir.negate(), scratch.p);
    } else {
      plane.normal.set(0, -1, 0);
      plane.constant = sectionOn ? sl.v - CENTER.y : 1e4;
    }
    capGroup.current.position.y = plane.constant;
    capGroup.current.visible = sectionOn;
    for (const p of parts) p.stencilPial.visible = p.stencilWhite.visible = sectionOn;

    // Camera fly
    const c = controls.current;
    if (a.cam && c) {
      const k = a.cam.dur <= 0 ? 1 : Math.min(1, (now - a.cam.t0) / a.cam.dur);
      const e = easeOut(k);
      camera.position.lerpVectors(a.cam.fromPos, a.cam.toPos, e);
      c.target.lerpVectors(a.cam.fromT, a.cam.toT, e);
      if (k >= 1) a.cam = null;
      else moving = true;
    }

    if (s.mode !== 'surface') {
      const r = animValue(a.rot, now);
      if (!r.done) {
        group.current.rotation.y = r.v;
        moving = true;
      }
    }

    // Idle rotation: home page, Tier A, 3D backdrop, until the first interaction.
    if (s.mode === 'surface' && s.tier === 'A' && s.backdrop === '3d' && !s.reducedMotion && !s.interacted && s.ready) {
      group.current.rotation.y += THREE.MathUtils.degToRad(views.idleRotationDegPerSec) * Math.min(delta, 0.05);
      moving = true;
    }

    if (c && c.update()) moving = true;
    if (s.perf) moving = true;

    // HUD: scale bar and orientation letters.
    const cam = camera as THREE.PerspectiveCamera;
    const dist = c ? camera.position.distanceTo(c.target) : 300;
    const pxPerMm = size.height / (2 * dist * TAN);
    if (Math.abs(pxPerMm - a.pxPerMm) > 0.01) {
      a.pxPerMm = pxPerMm;
      setBrain({ pxPerMm });
    }
    const q = cam.quaternion.clone().invert();
    const rot = group.current.quaternion;
    for (const [k, v] of Object.entries(axes)) {
      const node = hudRefs.orient[k];
      if (!node) continue;
      const d = v.clone().applyQuaternion(rot).applyQuaternion(q);
      node.style.transform = `translate(${(d.x * 26).toFixed(1)}px, ${(-d.y * 26).toFixed(1)}px)`;
      node.style.opacity = d.z > 0.2 ? '0.35' : '1';
    }

    if (moving) invalidate();
  });

  return (
    <group ref={group}>
      <group ref={inner} position={[-CENTER.x, -CENTER.y, -CENTER.z]}>
        {parts.map((p) => (
          <group key={p.hemi}>
            <primitive object={p.stencilPial} />
            <primitive object={p.stencilWhite} />
            <primitive object={p.mesh} />
          </group>
        ))}
        <group ref={deepGroup} visible={false}>
          {deep?.map((d) => <primitive key={d.id} object={d.mesh} />)}
        </group>
        {mri && <primitive object={mri.mesh} />}
      </group>
      <group ref={capGroup} visible={false}>
        <primitive object={caps.white} />
        <primitive object={caps.ribbon} />
      </group>
    </group>
  );
}

function Lights() {
  return (
    <>
      <hemisphereLight args={['#dbe6ff', '#0b1330', 0.6]} />
      <directionalLight position={[-300, 260, -160]} intensity={2.1} />
      <directionalLight position={[260, 80, 240]} intensity={0.55} color="#9fb6e8" />
    </>
  );
}

export default function Scene() {
  const [hemis, setHemis] = useState<HemiGeometry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tier = getBrain().tier;

  useEffect(() => {
    let alive = true;
    loadBrain()
      .then((h) => alive && setHemis(h))
      .catch((e) => {
        console.error(e);
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  if (error) return null;
  return (
    <Canvas
      aria-hidden="true"
      className="brain3d"
      // Measure the layout size, not the on-screen box: the docked minimap is a
      // CSS scale, and measuring the scaled box (on scroll) shrank the renderer.
      resize={{ scroll: false, offsetSize: true }}
      frameloop="demand"
      dpr={tier === 'A' ? [1, 1.5] : 1}
      gl={{ antialias: true, alpha: true, stencil: true, powerPreference: 'high-performance' }}
      camera={{ fov: FOV, near: 5, far: 4000, position: [-300, 100, -180] }}
      onCreated={({ gl, scene, camera }) => {
        // Dev-only handle for measuring render cost (see README "Performance").
        if (import.meta.env.DEV) (window as unknown as { __pba: unknown }).__pba = { gl, scene, camera };
        gl.localClippingEnabled = true;
        gl.toneMappingExposure = 0.82;
        gl.setClearColor(0x000000, 0);
      }}
      style={{ position: 'absolute', inset: 0 }}
    >
      <Lights />
      {hemis && <Brain hemis={hemis} />}
      {hemis && <Ready />}
    </Canvas>
  );
}

function Ready() {
  const { invalidate } = useThree();
  useEffect(() => {
    // Let one frame render before revealing the canvas over the poster.
    const id = requestAnimationFrame(() => {
      setBrain({ ready: true });
      invalidate();
    });
    return () => cancelAnimationFrame(id);
  }, [invalidate]);
  return null;
}
