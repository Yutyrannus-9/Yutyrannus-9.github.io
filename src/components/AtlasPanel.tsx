import meta from '../data/brain/meta.json';
import { sameRegion, setBrain, useBrain, type Hemi } from './viewer/store';
import { fsLabel, hemiName, regionOf } from './viewer/regions';

// Keyboard- and screen-reader-friendly way into the atlas: every region is a
// button, and selecting one highlights it on the 3D surface and turns the view
// toward it.

const LOBES = ['frontal', 'parietal', 'temporal', 'occipital', 'cingulate', 'insula'] as const;
const left = meta.regions.filter((r) => r.hemi === 'L');

export default function AtlasPanel() {
  const selected = useBrain((s) => s.selected);
  const region = regionOf(selected);

  const pick = (hemi: Hemi, index: number) => {
    const ref = { hemi, index };
    const next = sameRegion(selected, ref) ? null : ref;
    setBrain({ selected: next, focus: next });
  };

  return (
    <div className="atlas">
      <div className="atlas__card" aria-live="polite">
        {region ? (
          <>
            <p className="eyebrow">
              {hemiName(region.hemi as Hemi)} hemisphere · {region.lobe} lobe
            </p>
            <h3>{region.name}</h3>
            <p className="mono atlas__label">{fsLabel(region)}</p>
            <p>{region.function}</p>
            <p className="muted atlas__measure">
              On my scan: mean thickness {region.thicknessMm.toFixed(2)} mm, surface area{' '}
              {Math.round(region.areaMm2).toLocaleString('en-US')} mm². FreeSurfer anatomical measurements only, with no
              comparison to any reference group.
            </p>
          </>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            No region selected. Choose one below, or click the brain.
          </p>
        )}
      </div>

      {LOBES.map((lobe) => (
        <details key={lobe} className="atlas__lobe" open={lobe === 'frontal'}>
          <summary>
            {lobe[0].toUpperCase() + lobe.slice(1)}{' '}
            <span className="muted mono">({left.filter((r) => r.lobe === lobe).length})</span>
          </summary>
          <ul>
            {left
              .filter((r) => r.lobe === lobe)
              .map((r) => (
                <li key={r.key}>
                  <span className="atlas__swatch" style={{ background: `rgb(${r.color.join(',')})` }} aria-hidden="true" />
                  <span className="atlas__name">{r.name}</span>
                  {(['L', 'R'] as const).map((h) => (
                    <button
                      key={h}
                      type="button"
                      className="btn atlas__btn"
                      aria-pressed={sameRegion(selected, { hemi: h, index: r.index })}
                      aria-label={`${r.name}, ${hemiName(h).toLowerCase()} hemisphere`}
                      onClick={() => pick(h, r.index)}
                    >
                      {h}
                    </button>
                  ))}
                </li>
              ))}
          </ul>
        </details>
      ))}
    </div>
  );
}
