import { lazy, Suspense, useEffect, useState } from 'react';
import views from '../../data/brain/views.json';
import { brainStore, getBrain, setBrain, useBrain, type Backdrop, type Mode } from './store';
import { detectTier, prefersReducedMotion } from './tier';
import { mriDefaults } from './layout';
import Hud from './Hud';

// three.js and the scene load only after the island hydrates (client:idle),
// so the poster image stays the largest contentful paint. The MRI slice view
// is a separate, lighter chunk.
const Scene = lazy(() => import('./Scene'));
const MriBackdrop = lazy(() => import('./MriBackdrop'));

const root = () => document.documentElement;
const readMode = (): Mode => (root().dataset.brain as Mode) || 'surface';
const readBackdrop = (): Backdrop => (root().dataset.backdrop as Backdrop) || '3d';

function scrollProgress() {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  return max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
}

function sliceFromScroll() {
  const { startMm, bottomMm } = views.section;
  return Math.round((startMm - scrollProgress() * (startMm - bottomMm)) * 10) / 10;
}

function mriPosFromScroll(mode: Mode) {
  const d = mriDefaults(mode);
  return d.from + (d.to - d.from) * scrollProgress();
}

const readOptIn = () => {
  try {
    return localStorage.getItem('pba:3d') === 'on';
  } catch {
    return false;
  }
};

export default function Viewer() {
  const [mounted, setMounted] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const tier = useBrain((s) => s.tier);
  const mode = useBrain((s) => s.mode);
  const backdrop = useBrain((s) => s.backdrop);
  const optIn = useBrain((s) => s.optIn3d);

  // Download the 3D scene only when it's worth it: never on reading pages until
  // a viewer page has been opened, and on Tier B only after the visitor asks.
  const want3d = mounted && tier !== 'C' && backdrop === '3d' && (loaded || (mode !== 'docked' && (tier === 'A' || optIn)));
  const narrow = mounted && window.innerWidth < 900;
  const wantMri = mounted && backdrop === 'mri' && (tier !== 'B' || optIn) && !(narrow && mode === 'docked');
  useEffect(() => {
    if (want3d && !loaded) setLoaded(true);
  }, [want3d, loaded]);

  useEffect(() => {
    const applyPage = () => {
      const mode = readMode();
      const d = mriDefaults(mode);
      setBrain({
        mode,
        backdrop: readBackdrop(),
        hover: null,
        selected: mode === 'atlas' || mode === 'explore' ? getBrain().selected : null,
        mriOrient: d.orient,
        mriLabels: d.labels,
        mriPos: mriPosFromScroll(mode),
      });
    };
    setBrain({
      tier: detectTier(),
      reducedMotion: prefersReducedMotion(),
      perf: new URLSearchParams(location.search).has('perf'),
      optIn3d: readOptIn(),
    });
    applyPage();
    setMounted(true);

    const onLoad = () => {
      const s = getBrain();
      if (s.mode === 'section') setBrain({ slice: sliceFromScroll() });
      if (s.backdrop === 'mri' || s.mode === 'deep') setBrain({ mriPos: mriPosFromScroll(s.mode) });
    };
    const onBackdrop = () => setBrain({ backdrop: readBackdrop() });
    const onScroll = () => {
      const s = getBrain();
      if (s.mode === 'section') setBrain({ slice: sliceFromScroll() });
      const d = mriDefaults(s.mode);
      // The slice follows scroll on MRI backdrops and on the Research page's 3D slice.
      if ((s.backdrop === 'mri' || s.mode === 'deep') && d.from !== d.to && !s.reducedMotion) setBrain({ mriPos: mriPosFromScroll(s.mode) });
    };
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onMotion = () => setBrain({ reducedMotion: mq.matches });

    document.addEventListener('astro:after-swap', applyPage);
    document.addEventListener('astro:page-load', onLoad);
    document.addEventListener('pba:backdrop', onBackdrop);
    window.addEventListener('scroll', onScroll, { passive: true });
    mq.addEventListener('change', onMotion);

    const stage = document.getElementById('stage');
    const unsub = brainStore.subscribe((s) => {
      if (stage) stage.dataset.ready = String(s.ready && s.tier !== 'C' && s.backdrop === '3d');
    });
    return () => {
      document.removeEventListener('astro:after-swap', applyPage);
      document.removeEventListener('astro:page-load', onLoad);
      document.removeEventListener('pba:backdrop', onBackdrop);
      window.removeEventListener('scroll', onScroll);
      mq.removeEventListener('change', onMotion);
      unsub();
    };
  }, []);

  if (!mounted) return null;
  return (
    <>
      {tier !== 'C' && loaded && (
        <Suspense fallback={null}>
          <Scene />
        </Suspense>
      )}
      {wantMri && (
        <Suspense fallback={null}>
          <MriBackdrop />
        </Suspense>
      )}
      <Hud />
    </>
  );
}
