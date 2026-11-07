import { useEffect, useRef, useState } from 'react';
import { brainStore, getBrain, setBrain } from './store';
import { mriArea } from './layout';
import { ATLAS_RAMP, LABEL_FILL, labelById, loadVolume, MRI_RAMP, sliceIndex, sliceShape, voxelAt, voxelIndex, voxelToRas, type Volume } from './volume';

// 2D slice view of the brain-only T1 (1.5 mm), drawn on a canvas behind the
// content. Low-contrast navy colormap, soft edges, no animation beyond the
// slice following scroll or the scrubber.


export default function MriBackdrop() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [vol, setVol] = useState<Volume | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    loadVolume()
      .then((v) => alive && setVol(v))
      .catch((e) => {
        console.error(e);
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!vol) return;
    const canvas = ref.current!;
    const off = document.createElement('canvas');
    // Two 2× smoothing passes before the final draw: bilinear on a tiny 1.5 mm
    // slice looks blocky, stepped upscaling approximates a softer bicubic.
    const up1 = document.createElement('canvas');
    const up2 = document.createElement('canvas');
    let raf = 0;
    let geom = { dx: 0, dy: 0, scale: 1, w: 0, h: 0, k: 0 };

    const draw = () => {
      raf = 0;
      const s = getBrain();
      const { w, h } = sliceShape(s.mriOrient);
      const k = sliceIndex(s.mriOrient, s.mriPos);
      off.width = w;
      off.height = h;
      const octx = off.getContext('2d')!;
      const img = octx.createImageData(w, h);
      const px = img.data;
      // Atlas style when labels are on: slate base, filled regions, thin outlines.
      const atlas = s.mriLabels;
      const ramp = atlas ? ATLAS_RAMP : MRI_RAMP;
      // Dim by mixing toward the page ground instead of lowering canvas opacity,
      // so the slice stays opaque and the background photo doesn't show through it.
      const dim = s.mode === 'docked' ? 0.55 : atlas ? 0.72 : 0.62;
      const G0 = [7, 13, 31];
      const lab = new Uint8Array(w * h);
      const vox = new Uint32Array(w * h);
      for (let r = 0; r < h; r++) {
        for (let c = 0; c < w; c++) {
          const [x, y, z] = voxelAt(s.mriOrient, k, c, r);
          const i = voxelIndex(x, y, z);
          vox[r * w + c] = i;
          if (atlas && LABEL_FILL[vol.labels[i]]) lab[r * w + c] = vol.labels[i];
        }
      }
      for (let r = 0; r < h; r++) {
        for (let c = 0; c < w; c++) {
          const p = r * w + c;
          const v = vol.t1[vox[p]];
          const o = p * 4;
          let R = ramp[v * 3], G = ramp[v * 3 + 1], B = ramp[v * 3 + 2];
          const li = lab[p];
          if (li) {
            const f = LABEL_FILL[li]!;
            R = R * 0.45 + f[0] * 0.55;
            G = G * 0.45 + f[1] * 0.55;
            B = B * 0.45 + f[2] * 0.55;
            const edge =
              (c > 0 && lab[p - 1] !== li) || (c < w - 1 && lab[p + 1] !== li) || (r > 0 && lab[p - w] !== li) || (r < h - 1 && lab[p + w] !== li);
            if (edge) {
              R *= 0.5;
              G *= 0.5;
              B *= 0.55;
            }
          }
          px[o] = R * dim + G0[0] * (1 - dim);
          px[o + 1] = G * dim + G0[1] * (1 - dim);
          px[o + 2] = B * dim + G0[2] * (1 - dim);
          px[o + 3] = v < 4 ? 0 : Math.min(255, v * 8);
        }
      }
      octx.putImageData(img, 0, 0);
      for (const [dst, src, f] of [[up1, off, 2], [up2, up1, 4]] as const) {
        dst.width = w * f;
        dst.height = h * f;
        const c = dst.getContext('2d')!;
        c.imageSmoothingEnabled = true;
        c.imageSmoothingQuality = 'high';
        c.clearRect(0, 0, dst.width, dst.height);
        c.drawImage(src, 0, 0, dst.width, dst.height);
      }

      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = canvas.clientWidth;
      const H = canvas.clientHeight;
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
      }
      const { rect, beside } = mriArea(s.mode, W, H);
      canvas.dataset.beside = String(beside);
      const scale = Math.min(rect.w / w, rect.h / h) * 0.84;
      const dx = rect.x + (rect.w - w * scale) / 2;
      const dy = rect.y + (rect.h - h * scale) / 2;
      geom = { dx, dy, scale, w, h, k };

      const ctx = canvas.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(up2, dx, dy, w * scale, h * scale);
      // Soft circular falloff so the slice dissolves into the background.
      const cx = dx + (w * scale) / 2;
      const cy = dy + (h * scale) / 2;
      const rad = (Math.max(w, h) * scale) / 2;
      const g = ctx.createRadialGradient(cx, cy, rad * 0.62, cx, cy, rad * 1.05);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalCompositeOperation = 'destination-in';
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(draw);
    };

    const unsub = brainStore.subscribe((s, p) => {
      if (s.mriOrient !== p.mriOrient || s.mriPos !== p.mriPos || s.mriLabels !== p.mriLabels || s.mode !== p.mode) schedule();
    });
    const ro = new ResizeObserver(schedule);
    ro.observe(canvas);
    // Layout of the page under the canvas changes after navigation.
    const onLoad = () => schedule();
    document.addEventListener('astro:page-load', onLoad);

    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      const c = Math.floor((e.clientX - r.left - geom.dx) / geom.scale);
      const row = Math.floor((e.clientY - r.top - geom.dy) / geom.scale);
      if (c < 0 || row < 0 || c >= geom.w || row >= geom.h) return setBrain({ hover: null });
      const [x, y, z] = voxelAt(getBrain().mriOrient, geom.k, c, row);
      const i = voxelIndex(x, y, z);
      if (vol.t1[i] < 4) return setBrain({ hover: null });
      const l = labelById.get(vol.labels[i]);
      setBrain({
        hover: {
          region: null,
          label: l?.name ?? null,
          ras: voxelToRas(x, y, z).map((v) => Math.round(v * 10) / 10) as [number, number, number],
          x: e.clientX - r.left,
          y: e.clientY - r.top,
        },
      });
    };
    const onLeave = () => setBrain({ hover: null });
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', onLeave);
    schedule();
    return () => {
      cancelAnimationFrame(raf);
      unsub();
      ro.disconnect();
      document.removeEventListener('astro:page-load', onLoad);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
    };
  }, [vol]);

  return (
    <>
      <canvas ref={ref} className="mri" aria-hidden="true" />
      {failed && <p className="hud__note mri__error">The MRI slices couldn't be loaded.</p>}
    </>
  );
}
