import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import meta from '../../data/brain/meta.json';
import views from '../../data/brain/views.json';
import { icon, type IconName } from '../../lib/icons';
import { getBrain, hudRefs, setBrain, useBrain, type Command, type Orient } from './store';
import { fmtRas, fsLabel, hemiName, prettyLabel, regionOf } from './regions';
import { deepById } from './deepMeta';
import { orientLabel, sliceIndex, sliceMm, VOLUME, axisOf } from './volume';

const Ico = ({ name }: { name: IconName }) => <span className="hud__ico" dangerouslySetInnerHTML={{ __html: icon(name) }} />;

function Button({ cmd, label, name }: { cmd: Command; label: string; name: IconName }) {
  return (
    <button type="button" className="btn hud__btn" aria-label={label} title={label} onClick={() => getBrain().command?.(cmd)}>
      <Ico name={name} />
    </button>
  );
}

const AXIS_LETTER = ['x', 'y', 'z'];

function Readout() {
  const hover = useBrain((s) => s.hover);
  const mode = useBrain((s) => s.mode);
  const slice = useBrain((s) => s.slice);
  const tier = useBrain((s) => s.tier);
  const ready = useBrain((s) => s.ready);
  const backdrop = useBrain((s) => s.backdrop);
  const orient = useBrain((s) => s.mriOrient);
  const pos = useBrain((s) => s.mriPos);
  const plane = useBrain((s) => s.plane);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => setTarget(document.getElementById('hud-readout')), []);
  if (!target) return null;

  const region = regionOf(hover?.region ?? null);
  const parts: string[] = [];
  const showsMri = backdrop === 'mri' || (mode === 'explore' && plane) || (mode === 'deep' && backdrop === '3d');
  if (showsMri) {
    const a = axisOf(orient);
    parts.push(
      `${orientLabel[orient]} ${String(sliceIndex(orient, pos) + 1).padStart(3, '0')}/${VOLUME.dims[a]}  ${AXIS_LETTER[a]} ${fmtRas(sliceMm(orient, pos)).trim()} mm`,
    );
  } else if (mode === 'section') parts.push(`AX ${fmtRas(slice).trim()} mm`);
  if (hover) {
    parts.push(`RAS ${hover.ras.map((v) => fmtRas(v)).join(' ')} mm`);
    if (region) parts.push(`${fsLabel(region)} → ${region.name}`);
    else if (hover.label) parts.push(`${hover.label} → ${prettyLabel(hover.label)}`);
    else parts.push('medial wall');
  } else if (backdrop === '3d' && tier !== 'C' && ready && mode !== 'docked') {
    parts.push('RAS  —  point at the brain');
  } else if (showsMri && mode !== 'docked') {
    parts.push('RAS  —  point at the slice');
  }
  return createPortal(<span>{parts.join('   ·   ')}</span>, target);
}

function HoverLabel() {
  const hover = useBrain((s) => s.hover);
  if (!hover) return null;
  const region = regionOf(hover.region);
  const text = region ? region.name : hover.label ? prettyLabel(hover.label) : null;
  if (!text) return null;
  return (
    <div className="hud__label" style={{ left: hover.x, top: hover.y }} aria-hidden="true">
      <span className="hud__leader" />
      <span className="hud__labeltext">{text}</span>
    </div>
  );
}

function ScaleBar() {
  const px = useBrain((s) => s.pxPerMm);
  if (!px) return null;
  return (
    <div className="hud__scale" aria-label="Scale bar: 10 millimetres" role="img">
      <span className="hud__scalebar" style={{ width: `${(px * 10).toFixed(1)}px` }} />
      <span>10 mm</span>
    </div>
  );
}

function Orientation() {
  const letters = ['R', 'L', 'A', 'P', 'S', 'I'];
  return (
    <div className="hud__orient" role="img" aria-label="Orientation markers: right, left, anterior, posterior, superior, inferior">
      {letters.map((l) => (
        <span key={l} ref={(el) => void (hudRefs.orient[l] = el)} className="hud__orientletter">
          {l}
        </span>
      ))}
    </div>
  );
}

function ThicknessLegend() {
  return (
    <figure className="hud__legend">
      <figcaption>Cortical thickness, mm</figcaption>
      <div className="hud__ramp" />
      <div className="hud__ticks mono">
        <span>1.5</span>
        <span>2.5</span>
        <span>3.5</span>
      </div>
    </figure>
  );
}

function RegionCard() {
  const selected = useBrain((s) => s.selected);
  const deepSelected = useBrain((s) => s.deepSelected);
  const region = regionOf(selected);
  const deep = deepSelected ? deepById.get(deepSelected) : undefined;
  if (!region && !deep) return null;
  const clear = () => setBrain({ selected: null, focus: null, deepSelected: null, deepFocus: null });
  return (
    <section className="hud__legend hud__region" aria-label="Selected structure">
      {deep ? (
        <>
          <p className="hud__regionmeta mono">{deep.hemi === 'M' ? 'Midline' : hemiName(deep.hemi as 'L' | 'R')} · deep structure</p>
          <p className="hud__regionname">{deep.name}</p>
          <p className="mono hud__regionlabel">{deep.fsLabel}</p>
          <p className="hud__regionfn">{deep.note}</p>
        </>
      ) : (
        region && (
          <>
            <p className="hud__regionmeta mono">
              {hemiName(region.hemi as 'L' | 'R')} · {region.lobe}
            </p>
            <p className="hud__regionname">{region.name}</p>
            <p className="mono hud__regionlabel">{fsLabel(region)}</p>
            <p className="hud__regionfn">{region.function}</p>
          </>
        )
      )}
      <button type="button" className="btn" onClick={clear}>
        Clear selection
      </button>
    </section>
  );
}

function SectionLegend() {
  return (
    <figure className="hud__legend">
      <figcaption>Cut face</figcaption>
      <p><span className="hud__swatch" style={{ background: '#6d7fa6' }} /> Cortical ribbon (between pial and white surfaces)</p>
      <p><span className="hud__swatch" style={{ background: '#d6deec' }} /> Inside the white surface</p>
    </figure>
  );
}

// Tier B and C on the Projects page: pre-rendered axial cross-sections of the
// pial and white surfaces instead of the live stencil cut.
interface SliceSet { viewBox: number[]; slices: { z: number; pial: string; white: string }[] }
let sliceCache: Promise<SliceSet> | null = null;

function SliceImage() {
  const slice = useBrain((s) => s.slice);
  const [set, setSet] = useState<SliceSet | null>(null);
  useEffect(() => {
    sliceCache ??= fetch(`/brain/slices.json?v=${meta.version}`).then((r) => r.json());
    let alive = true;
    sliceCache.then((d) => alive && setSet(d)).catch(() => {});
    const stage = document.getElementById('stage');
    if (stage) stage.dataset.slices = 'true';
    return () => {
      alive = false;
      if (stage) stage.dataset.slices = 'false';
    };
  }, []);
  if (!set) return null;
  const s = set.slices.reduce((a, b) => (Math.abs(b.z - slice) < Math.abs(a.z - slice) ? b : a));
  return (
    <figure className="hud__sliceimg">
      <svg viewBox={set.viewBox.join(' ')} role="img" aria-label={`Axial cross-section of my cortical surfaces at ${fmtRas(s.z).trim()} millimetres`}>
        <path d={s.pial} fill="#6d7fa6" fillRule="evenodd" />
        <path d={s.white} fill="#d6deec" fillRule="evenodd" />
        <text x={set.viewBox[0] + 4} y={set.viewBox[1] + 10} className="hud__slicetext">L</text>
        <text x={set.viewBox[0] + set.viewBox[2] - 10} y={set.viewBox[1] + 10} className="hud__slicetext">R</text>
        <path d={`M${set.viewBox[0] + set.viewBox[2] - 18} ${set.viewBox[1] + set.viewBox[3] - 8}h10`} stroke="#e4eaf6" strokeWidth="0.8" />
        <text x={set.viewBox[0] + set.viewBox[2] - 18} y={set.viewBox[1] + set.viewBox[3] - 2} className="hud__slicetext">10 mm</text>
      </svg>
      <figcaption>
        <span className="mono">AX {fmtRas(s.z).trim()} mm · 6 mm steps · anterior up</span>
        <span><span className="hud__swatch" style={{ background: '#6d7fa6' }} /> Cortical ribbon</span>
        <span><span className="hud__swatch" style={{ background: '#d6deec' }} /> Inside white surface</span>
      </figcaption>
    </figure>
  );
}

function SliceScrubber() {
  const slice = useBrain((s) => s.slice);
  const [lo, hi] = [views.section.bottomMm, views.section.startMm];
  return (
    <label className="hud__slice">
      <span className="mono">Axial cut</span>
      <input
        type="range"
        min={lo}
        max={hi}
        step={1}
        value={Math.round(slice)}
        onChange={(e) => setBrain({ slice: +e.target.value })}
        aria-valuetext={`${slice.toFixed(0)} millimetres, RAS superior axis`}
      />
      <span className="mono">{fmtRas(slice).trim()} mm</span>
    </label>
  );
}

const ORIENTS: { id: Orient; label: string }[] = [
  { id: 'axial', label: 'Axial' },
  { id: 'coronal', label: 'Coronal' },
  { id: 'sagittal', label: 'Sagittal' },
];

/** Plane, slice position, and label overlay for the MRI view (backdrop or explorer plane). */
export function MriControls({ compact = false }: { compact?: boolean }) {
  const orient = useBrain((s) => s.mriOrient);
  const pos = useBrain((s) => s.mriPos);
  const labels = useBrain((s) => s.mriLabels);
  const a = axisOf(orient);
  const n = VOLUME.dims[a];
  const k = sliceIndex(orient, pos);
  return (
    <div className={`mri-controls${compact ? ' mri-controls--compact' : ''}`} role="group" aria-label="MRI slice controls">
      <div className="seg" role="radiogroup" aria-label="Slice plane">
        {ORIENTS.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={orient === o.id}
            className="seg__btn"
            onClick={() => setBrain({ mriOrient: o.id, interacted: true })}
          >
            {o.label}
          </button>
        ))}
      </div>
      <label className="mri-controls__slider">
        <span className="mono">{orientLabel[orient]} {String(k + 1).padStart(3, '0')}/{n}</span>
        <input
          type="range"
          min={0}
          max={n - 1}
          step={1}
          value={k}
          onChange={(e) => setBrain({ mriPos: +e.target.value / (n - 1), interacted: true })}
          aria-label={`${orient} slice`}
          aria-valuetext={`Slice ${k + 1} of ${n}, ${fmtRas(sliceMm(orient, pos)).trim()} millimetres`}
        />
      </label>
      {!compact && (
        <label className="mri-controls__check">
          <input type="checkbox" checked={labels} onChange={(e) => setBrain({ mriLabels: e.target.checked })} />
          <span>Labels</span>
        </label>
      )}
    </div>
  );
}

function MriCaption() {
  return (
    <p className="mri-caption mono">
      My T1 MRI · brain only · resampled to 1.5 mm · anatomical, not diagnostic
    </p>
  );
}

function Load3d() {
  const backdrop = useBrain((s) => s.backdrop);
  const mb =
    backdrop === 'mri'
      ? ((VOLUME.bytes.t1 + VOLUME.bytes.labels) / 1e6).toFixed(1)
      : ((meta.sizes.lh.bytes + meta.sizes.rh.bytes) / 1e6 + 0.3).toFixed(1);
  return (
    <div className="hud__load">
      <button
        type="button"
        className="btn btn--primary"
        onClick={() => {
          try {
            localStorage.setItem('pba:3d', 'on');
          } catch {}
          setBrain({ optIn3d: true });
        }}
      >
        {backdrop === 'mri' ? 'Load MRI slices' : 'Load 3D view'} (about {mb} MB)
      </button>
    </div>
  );
}

function PerfMeter() {
  const [text, setText] = useState('measuring…');
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let frames: number[] = [];
    let t0 = last;
    const tick = (t: number) => {
      frames.push(t - last);
      last = t;
      if (t - t0 > 2000) {
        const sorted = [...frames].sort((a, b) => a - b);
        const fps = (frames.length * 1000) / (t - t0);
        const p95 = sorted[Math.floor(sorted.length * 0.95)];
        const c = document.querySelector('#stage canvas') as HTMLCanvasElement | null;
        setText(`${fps.toFixed(0)} fps · p95 ${p95.toFixed(1)} ms · ${c ? `${c.width}×${c.height}` : 'no canvas'}`);
        frames = [];
        t0 = t;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <p className="hud__note mono">{text}</p>;
}

export default function Hud() {
  const tier = useBrain((s) => s.tier);
  const mode = useBrain((s) => s.mode);
  const backdrop = useBrain((s) => s.backdrop);
  const thickness = useBrain((s) => s.thickness);
  const colorBy = useBrain((s) => s.colorBy);
  const perf = useBrain((s) => s.perf);
  const optIn = useBrain((s) => s.optIn3d);
  const ready = useBrain((s) => s.ready);
  const is3d = backdrop === '3d';
  const isMri = backdrop === 'mri';
  const waiting = tier === 'B' && !optIn && mode !== 'docked' && backdrop !== 'still';
  // 3D controls and instruments appear once the scene has drawn its first frame.
  const live = is3d && tier !== 'C' && !waiting && ready;
  const sliceMode = is3d && mode === 'section' && tier !== 'A';
  const explore = mode === 'explore';
  const deepPage = mode === 'deep';
  const mriOn = typeof document !== 'undefined' && document.documentElement.dataset.mri === 'on';

  return (
    <>
      <Readout />
      {(live || isMri) && <HoverLabel />}
      <div className="hud" data-tier={tier} data-backdrop={backdrop} data-mode={mode}>
        {live && !sliceMode && (
          <div className="hud__controls" role="group" aria-label="Brain view controls">
            <Button cmd="rotateLeft" label="Rotate left" name="rotateCcw" />
            <Button cmd="rotateRight" label="Rotate right" name="rotateCw" />
            <Button cmd="zoomIn" label="Zoom in" name="zoomIn" />
            <Button cmd="zoomOut" label="Zoom out" name="zoomOut" />
            <Button cmd="reset" label="Reset view" name="locate" />
            {!explore && !deepPage && (
              <button
                type="button"
                className="btn"
                aria-pressed={thickness}
                onClick={() => setBrain({ thickness: !thickness })}
                title="Color the cortex by thickness"
              >
                Thickness
              </button>
            )}
          </div>
        )}
        {live && mode === 'section' && tier === 'A' && <SliceScrubber />}
        {sliceMode && <SliceImage />}
        {waiting && !sliceMode && <Load3d />}
        {is3d && tier !== 'C' && !waiting && !ready && mode !== 'docked' && !sliceMode && (
          <p className="hud__note hud__loading mono">Loading 3D surface…</p>
        )}
        {live && deepPage && mriOn && (
          <div className="hud__mri hud__mri--deep">
            <MriControls />
            <p className="mri-caption mono">Slice: my T1 MRI, brain only, 1.5 mm · scroll the page to move it</p>
          </div>
        )}
        {isMri && !waiting && (
          <div className={`hud__mri${mode === 'docked' ? ' hud__mri--docked' : ''}`}>
            <MriControls compact={mode === 'docked'} />
            <MriCaption />
          </div>
        )}
        {!sliceMode && live && (
          <div className="hud__instruments">
            <Orientation />
            <ScaleBar />
          </div>
        )}
        <div className="hud__legends">
          {perf && <PerfMeter />}
          {live && (mode === 'atlas' || explore || deepPage) && <RegionCard />}
          {live && thickness && !sliceMode && !explore && <ThicknessLegend />}
          {live && explore && colorBy === 'thickness' && <ThicknessLegend />}
          {live && mode === 'section' && !sliceMode && <SectionLegend />}
          {backdrop === 'still' && mode !== 'docked' && <p className="hud__note">Still image of the same surface. Switch the backdrop to 3D or MRI above.</p>}
          {tier === 'C' && is3d && mode !== 'docked' && <p className="hud__note">This browser can't show the 3D view, so this is a still image.</p>}
        </div>
      </div>
    </>
  );
}
