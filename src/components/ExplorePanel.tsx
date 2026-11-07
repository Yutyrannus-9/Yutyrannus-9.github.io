import deepMeta from '../data/brain/deep.json';
import { setBrain, useBrain, type ColorBy, type CortexStyle, type CutAway } from './viewer/store';
import { MriControls } from './viewer/Hud';

// Tool panel for /explore. Every control is a native input, so the whole viewer
// works from the keyboard; the 3D view reacts through the shared store.

function Radios<T extends string>({ name, legend, value, options, onChange }: {
  name: string;
  legend: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <fieldset className="xp__group">
      <legend>{legend}</legend>
      <div className="seg">
        {options.map((o) => (
          <label key={o.id} className="seg__btn" data-checked={value === o.id}>
            <input className="sr-only" type="radio" name={name} value={o.id} checked={value === o.id} onChange={() => onChange(o.id)} />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// One row per structure; left, right, or midline buttons.
const rows = (() => {
  const byKey = new Map<string, { name: string; note: string; ids: { hemi: string; id: string }[]; color: number[] }>();
  for (const s of deepMeta.structures) {
    const row = byKey.get(s.key) ?? { name: s.name, note: s.note, ids: [], color: s.color };
    row.ids.push({ hemi: s.hemi, id: s.id });
    byKey.set(s.key, row);
  }
  return [...byKey.values()];
})();

export default function ExplorePanel({ mriEnabled }: { mriEnabled: boolean }) {
  const inflateOn = useBrain((s) => s.inflateOn);
  const cortex = useBrain((s) => s.cortex);
  const colorBy = useBrain((s) => s.colorBy);
  const deep = useBrain((s) => s.deep);
  const plane = useBrain((s) => s.plane);
  const deepSelected = useBrain((s) => s.deepSelected);
  const cutAway = useBrain((s) => s.cutAway);
  const orient = useBrain((s) => s.mriOrient);
  const sides = { axial: ['Above', 'Below'], coronal: ['In front', 'Behind'], sagittal: ['Right', 'Left'] }[orient];

  const pick = (id: string) => {
    const next = deepSelected === id ? null : id;
    setBrain({ deep: true, deepSelected: next, deepFocus: next, selected: null, inflateOn: false });
  };

  return (
    <div className="xp">
      <Radios<'pial' | 'inflated'>
        name="surface"
        legend="Surface"
        value={inflateOn ? 'inflated' : 'pial'}
        options={[
          { id: 'pial', label: 'Folded' },
          { id: 'inflated', label: 'Inflated' },
        ]}
        onChange={(v) => setBrain({ inflateOn: v === 'inflated' })}
      />
      {inflateOn && <p className="xp__hint">Deep structures and the MRI plane line up with the folded surface, so they hide while it's inflated.</p>}
      <Radios<CortexStyle>
        name="cortex"
        legend="Cortex"
        value={cortex}
        options={[
          { id: 'solid', label: 'Solid' },
          { id: 'glass', label: 'Glass' },
          { id: 'hidden', label: 'Hidden' },
        ]}
        onChange={(v) => setBrain({ cortex: v })}
      />
      <Radios<ColorBy>
        name="color"
        legend="Cortex color"
        value={colorBy}
        options={[
          { id: 'curvature', label: 'Folding' },
          { id: 'atlas', label: 'Atlas' },
          { id: 'thickness', label: 'Thickness' },
        ]}
        onChange={(v) => setBrain({ colorBy: v })}
      />

      <fieldset className="xp__group">
        <legend>Deep structures</legend>
        <label className="xp__toggle">
          <input type="checkbox" checked={deep} onChange={(e) => setBrain({ deep: e.target.checked, deepSelected: e.target.checked ? deepSelected : null })} />
          <span>Show subcortical structures</span>
        </label>
        <ul className="xp__list">
          {rows.map((r) => (
            <li key={r.name}>
              <span className="atlas__swatch" style={{ background: `rgb(${r.color.join(',')})` }} aria-hidden="true" />
              <span>{r.name}</span>
              <span className="xp__btns">
                {r.ids.map(({ hemi, id }) => (
                  <button
                    key={id}
                    type="button"
                    className="btn atlas__btn"
                    aria-pressed={deepSelected === id}
                    aria-label={`${r.name}${hemi === 'M' ? '' : `, ${hemi === 'L' ? 'left' : 'right'}`}`}
                    onClick={() => pick(id)}
                  >
                    {hemi === 'M' ? '·' : hemi}
                  </button>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </fieldset>

      {mriEnabled && (
        <fieldset className="xp__group">
          <legend>MRI slice plane</legend>
          <label className="xp__toggle">
            <input type="checkbox" checked={plane} onChange={(e) => setBrain({ plane: e.target.checked })} />
            <span>Cut through with my T1 MRI</span>
          </label>
          {plane && <MriControls />}
          {plane && (
            <Radios<CutAway>
              name="cut"
              legend="Cut away"
              value={cutAway}
              options={[
                { id: 'plus', label: sides[0] },
                { id: 'minus', label: sides[1] },
                { id: 'auto', label: 'Side facing me' },
              ]}
              onChange={(v) => setBrain({ cutAway: v })}
            />
          )}
          <p className="xp__hint">
            Scroll or two-finger swipe over the brain to move through slices. The cut stays on one side while you
            rotate; "Side facing me" follows the camera and wipes smoothly when it switches.
          </p>
        </fieldset>
      )}
    </div>
  );
}
