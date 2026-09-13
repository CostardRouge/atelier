import {
  MAX_SHADES,
  SHADE_DIRECTIONS,
  createShade,
  vignetteShade,
  type Shade,
} from '../../shared/roadtrip/shades';
import Button from '../../shared/ui/Button';
import IconButton from '../../shared/ui/IconButton';
import { FieldRow, RangeField, SelectField, ToggleField } from '../../shared/ui/Inspector';
import { Icons } from '../../shared/ui/icons';

interface ShadesPanelProps {
  shades: Shade[];
  onChange: (next: Shade[]) => void;
}

/**
 * The stack of shades laid over a picture, as inspector rows.
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
    <>
      {shades.length === 0 && (
        <p className="m-0 text-xs text-muted">
          The picture is untouched. Add a shade where the type needs help — a bright sky
          exactly under the hook is the normal case.
        </p>
      )}

      {shades.map((shade, i) => {
        const radial = shade.direction === 'radial';
        // A linear shade that follows the hook takes its reach from the block,
        // so the slider would be a control that does nothing.
        const reachLive = radial || !shade.followHook;
        return (
          <div key={shade.id} className="flex flex-col gap-2.5 pl-3 border-l-2 border-line">
            <div className="flex items-center gap-2">
              <span className="flex-1 text-sm font-medium text-ink">Shade {i + 1}</span>
              <input
                type="color"
                value={shade.color}
                onChange={(e) => patch(shade.id, { color: e.target.value })}
                className="flex-none w-8 h-8 p-0 border border-line-strong rounded-[7px] bg-paper cursor-pointer"
                aria-label={`Shade ${i + 1} colour`}
              />
              <IconButton
                size="sm"
                variant="ghost"
                label={`Remove shade ${i + 1}`}
                onClick={() => onChange(shades.filter((s) => s.id !== shade.id))}
              >
                {Icons.close}
              </IconButton>
            </div>
            <FieldRow label="Direction">
              <SelectField
                label={`Shade ${i + 1} direction`}
                value={shade.direction}
                onChange={(direction) => patch(shade.id, { direction })}
                options={SHADE_DIRECTIONS.map((d) => ({ id: d.id, label: `${d.label} — ${d.hint}` }))}
              />
            </FieldRow>
            <FieldRow label="Strength">
              <RangeField
                label={`Shade ${i + 1} strength`}
                min={0}
                max={1}
                step={0.02}
                value={shade.strength}
                onChange={(strength) => patch(shade.id, { strength })}
                format={(v) => `${Math.round(v * 100)}%`}
              />
            </FieldRow>
            <FieldRow label={radial ? 'Radius' : 'Reach'}>
              <RangeField
                label={`Shade ${i + 1} ${radial ? 'radius' : 'reach'}`}
                min={0}
                max={1}
                step={0.02}
                value={shade.reach}
                disabled={!reachLive}
                onChange={(reach) => patch(shade.id, { reach })}
                format={(v) => `${Math.round(v * 100)}%`}
              />
            </FieldRow>
            <FieldRow label="Invert">
              <ToggleField
                label={`Invert shade ${i + 1}`}
                checked={shade.invert}
                onChange={(invert) => patch(shade.id, { invert })}
              />
            </FieldRow>
            <FieldRow
              label="Follow hook"
              hint={
                <>
                  {shade.invert
                    ? radial
                      ? 'Clear in the middle, closing in at the edges.'
                      : 'Clear at that edge, darkening toward the end of the reach.'
                    : radial
                      ? 'Dark in the middle, clearing outward.'
                      : 'Dark at that edge, clearing inward.'}
                  {shade.followHook && (radial ? ' Centred on the badge.' : ' Landing on the badge’s own edge.')}
                </>
              }
            >
              <ToggleField
                label={`Shade ${i + 1} follows the hook`}
                checked={shade.followHook}
                onChange={(followHook) => patch(shade.id, { followHook })}
              />
            </FieldRow>
          </div>
        );
      })}

      {shades.length < MAX_SHADES ? (
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" icon={Icons.plus} onClick={() => add(createShade())}>
            Shade
          </Button>
          <Button size="sm" variant="ghost" onClick={() => add(createShade({ followHook: true }))}>
            Under the hook
          </Button>
          <Button size="sm" variant="ghost" onClick={() => add(vignetteShade(0.45))}>
            Vignette
          </Button>
        </div>
      ) : (
        <span className="text-xs text-muted">Four is the limit — past that it stops being a treatment.</span>
      )}
    </>
  );
}
