import {
  MAX_SHADES,
  SHADE_DIRECTIONS,
  createShade,
  vignetteShade,
  type Shade,
} from '../../shared/roadtrip/shades';

interface ShadesPanelProps {
  shades: Shade[];
  onChange: (next: Shade[]) => void;
}

const legend = 'font-mono text-[0.62rem] tracking-[0.14em] uppercase text-muted';

/**
 * The stack of shades laid over a picture.
 *
 * One list rather than a vignette control and a scrim control: they were the
 * same thing seen twice, and keeping them apart made the combinations that
 * actually come up impossible — a wash from the left AND a vignette, a band
 * that starts clear at the top and closes toward the middle.
 *
 * Two shortcuts sit beside the plain "add", because the two shapes that get
 * reached for constantly (a scrim under the hook, a corner vignette) would
 * otherwise each be four adjustments.
 */
export default function ShadesPanel({ shades, onChange }: ShadesPanelProps) {
  const patch = (id: string, next: Partial<Shade>) =>
    onChange(shades.map((s) => (s.id === id ? { ...s, ...next } : s)));

  const add = (shade: Shade) => {
    if (shades.length >= MAX_SHADES) return;
    onChange([...shades, shade]);
  };

  return (
    <div className="flex flex-col gap-2.5">
      {shades.length === 0 && (
        <p className="m-0 text-[0.76rem] text-muted">
          The picture is untouched. Add a shade where the type needs help — a
          bright sky exactly under the hook is the normal case.
        </p>
      )}

      {shades.map((shade, i) => {
        const radial = shade.direction === 'radial';
        // A linear shade that follows the hook takes its reach from the block,
        // so the slider would be a control that does nothing.
        const reachLive = radial || !shade.followHook;
        return (
          <div
            key={shade.id}
            className="flex flex-col gap-2 p-2.5 rounded-paper border border-line bg-paper"
          >
            <div className="flex items-center gap-2">
              <span className={`${legend} flex-1`}>Shade {i + 1}</span>
              <input
                type="color"
                value={shade.color}
                onChange={(e) => patch(shade.id, { color: e.target.value })}
                className="flex-none w-7 h-7 p-0 border border-line-strong rounded-[5px] bg-paper cursor-pointer"
                aria-label={`Shade ${i + 1} colour`}
              />
              <button
                type="button"
                onClick={() => onChange(shades.filter((s) => s.id !== shade.id))}
                className="flex-none p-0 border-0 bg-transparent text-[0.72rem] text-faint cursor-pointer hover:text-[#9a3a23]"
                aria-label={`Remove shade ${i + 1}`}
              >
                Remove
              </button>
            </div>

            <select
              value={shade.direction}
              onChange={(e) =>
                patch(shade.id, { direction: e.target.value as Shade['direction'] })
              }
              className="font-sans text-[0.78rem] px-2 py-1.5 border border-line-strong rounded-paper bg-paper text-ink cursor-pointer focus:outline-none focus:border-accent"
              aria-label={`Shade ${i + 1} direction`}
            >
              {SHADE_DIRECTIONS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label} — {d.hint}
                </option>
              ))}
            </select>

            <label className="flex flex-col gap-0.5">
              <span className={legend}>
                Strength · {Math.round(shade.strength * 100)}%
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={shade.strength}
                onChange={(e) => patch(shade.id, { strength: Number(e.target.value) })}
                className="accent-accent"
              />
            </label>

            <label className={`flex flex-col gap-0.5 ${reachLive ? '' : 'opacity-45'}`}>
              <span className={legend}>
                {radial ? 'Radius' : 'Reach'} · {Math.round(shade.reach * 100)}%
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={shade.reach}
                disabled={!reachLive}
                onChange={(e) => patch(shade.id, { reach: Number(e.target.value) })}
                className="accent-accent"
              />
            </label>

            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <label className="flex items-center gap-2 text-[0.76rem] text-ink-soft cursor-pointer">
                <input
                  type="checkbox"
                  checked={shade.invert}
                  onChange={(e) => patch(shade.id, { invert: e.target.checked })}
                  className="accent-accent"
                />
                Invert
              </label>
              <label className="flex items-center gap-2 text-[0.76rem] text-ink-soft cursor-pointer">
                <input
                  type="checkbox"
                  checked={shade.followHook}
                  onChange={(e) => patch(shade.id, { followHook: e.target.checked })}
                  className="accent-accent"
                />
                Follow the hook
              </label>
            </div>
            <span className="text-[0.68rem] text-faint">
              {shade.invert
                ? radial
                  ? 'Clear in the middle, closing in at the edges.'
                  : 'Clear at that edge, darkening toward the end of the reach.'
                : radial
                  ? 'Dark in the middle, clearing outward.'
                  : 'Dark at that edge, clearing inward.'}
              {shade.followHook &&
                (radial
                  ? ' Centred on the badge.'
                  : ' Landing on the badge’s own edge.')}
            </span>
          </div>
        );
      })}

      {shades.length < MAX_SHADES ? (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => add(createShade())}
            className="px-2.5 py-1.5 rounded-paper border border-line-strong bg-paper text-[0.74rem] font-semibold text-ink-soft cursor-pointer hover:border-accent hover:text-accent-ink"
          >
            + Shade
          </button>
          <button
            type="button"
            onClick={() => add(createShade({ followHook: true }))}
            className="px-2.5 py-1.5 rounded-paper border border-line bg-paper text-[0.74rem] text-ink-soft cursor-pointer hover:border-accent hover:text-accent-ink"
          >
            + Under the hook
          </button>
          <button
            type="button"
            onClick={() => add(vignetteShade(0.45))}
            className="px-2.5 py-1.5 rounded-paper border border-line bg-paper text-[0.74rem] text-ink-soft cursor-pointer hover:border-accent hover:text-accent-ink"
          >
            + Vignette
          </button>
        </div>
      ) : (
        <span className="text-[0.7rem] text-faint">
          Four is the limit — past that it stops being a treatment.
        </span>
      )}
    </div>
  );
}
