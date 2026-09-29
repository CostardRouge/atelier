import type { Anchor } from '../../shared/overlay/overlay-types';
import {
  MAX_CORE,
  MAX_SHADES,
  SHADE_FALLOFFS,
  centreMovable,
  createShade,
  directionInCell,
  followFlags,
  reachFollowsBadge,
  shadeCentre,
  shadeCore,
  shadeFalloff,
  shadeFollow,
  vignetteShade,
  type Shade,
  type ShadeDirection,
  type ShadeFollow,
} from '../../shared/roadtrip/shades';
import { isRoundShade } from '../../shared/shades/shade-shape';
import {
  SHADE_LABELS,
  ShadeDirectionPicker,
  ShadeFalloffPicker,
} from '../../shared/shades/ShadePickers';
import Button from '../../shared/ui/Button';
import IconButton from '../../shared/ui/IconButton';
import Segmented from '../../shared/ui/Segmented';
import { FieldRow, RangeField, ToggleField } from '../../shared/ui/Inspector';
import { Icons } from '../../shared/ui/icons';

interface ShadesPanelProps {
  shades: Shade[];
  onChange: (next: Shade[]) => void;
  /** The badge's grid anchor, what a shade following it is placed by. */
  anchor?: Anchor;
  /** The shade whose centre the stage is placing, if any. */
  placing?: string | null;
  /**
   * Hand a shade's centre to the stage (or take it back with null). Absent,
   * the centre is set by its sliders alone.
   */
  onPlace?: (id: string | null) => void;
}

const FOLLOW_OPTIONS = [
  { id: 'none', label: 'No', title: 'Placed where the grid says' },
  { id: 'edge', label: 'Edge', title: 'The reach lands on the badge, the side stays yours' },
  { id: 'anchor', label: 'Anchor', title: 'Sits where the badge is anchored, and moves with it' },
] as const satisfies readonly { id: ShadeFollow; label: string; title: string }[];

const pct = (v: number) => `${Math.round(v * 100)}%`;

/**
 * The stack of shades laid over a picture, as inspector rows.
 *
 * One list rather than a vignette control and a scrim control: they were the
 * same thing seen twice, and keeping them apart made the combinations that
 * actually come up impossible — a wash from the left AND a vignette, a band
 * that starts clear at the top and closes toward the middle.
 *
 * A shade's direction is picked on a 3×3 grid, cell for cell the badge's own
 * anchor grid, each cell showing the gradient it draws: a list of eleven
 * sentences had to be read every time. The centre holds three shapes (a radial
 * and the two bands, which cross the frame and fit no single cell), offered
 * beside the grid only while the centre is the cell. That grid and the
 * falloff's curves are `shared/shades/ShadePickers.tsx`, the very pickers
 * Develop's shade mask is drawn with.
 *
 * Two shortcuts sit beside the plain "add", because the two shapes that get
 * reached for constantly (a scrim under the hook, a corner vignette) would
 * otherwise each be four adjustments.
 */
export default function ShadesPanel({
  shades,
  onChange,
  anchor,
  placing = null,
  onPlace,
}: ShadesPanelProps) {
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
        const follow = shadeFollow(shade);
        // What the shade really draws: under "Anchor", the badge's cell.
        const direction =
          follow === 'anchor' && anchor ? directionInCell(anchor, shade.direction) : shade.direction;
        const round = isRoundShade(direction);
        // A top or bottom shade following the badge takes its reach from the
        // block, so the slider would be a control that does nothing.
        const reachLive = !reachFollowsBadge(direction, follow);
        // Absent on every shade stored before the switch existed: that is ON.
        const on = shade.enabled !== false;
        // The fade's shape, read through the helpers so an absent field is
        // shown as what it draws (soft, no core, the middle).
        const falloff = shadeFalloff(shade);
        const core = shadeCore(shade);
        const centre = shadeCentre(shade);
        const movable = centreMovable(direction, follow);
        const centred =
          (movable === 'y' || centre.x === 0.5) && (movable === 'x' || centre.y === 0.5);
        // Picking a cell by hand is placing it by hand: an anchored shade
        // stops following the anchor, but keeps landing on the badge's edge.
        const pick = (next: ShadeDirection) =>
          patch(shade.id, {
            direction: next,
            ...(follow === 'anchor' ? followFlags('edge') : {}),
          });
        return (
          <div
            key={shade.id}
            className={`flex flex-col gap-2.5 pl-3 border-l-2 transition-opacity ${
              on ? 'border-line' : 'border-line opacity-60'
            }`}
          >
            <div className="flex items-center gap-2">
              <ToggleField
                label={on ? `Bypass shade ${i + 1}` : `Enable shade ${i + 1}`}
                checked={on}
                onChange={(enabled) => patch(shade.id, { enabled })}
              />
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
            <FieldRow
              label="From"
              align="start"
              hint={
                follow === 'anchor' && anchor
                  ? `${SHADE_LABELS[direction]} — where the badge is anchored.`
                  : SHADE_LABELS[direction]
              }
            >
              <ShadeDirectionPicker direction={direction} onPick={pick} label={`Shade ${i + 1}`} />
            </FieldRow>
            <FieldRow label="Strength">
              <RangeField
                label={`Shade ${i + 1} strength`}
                min={0}
                max={1}
                step={0.02}
                value={shade.strength}
                disabled={!on}
                onChange={(strength) => patch(shade.id, { strength })}
                format={(v) => `${Math.round(v * 100)}%`}
              />
            </FieldRow>
            <FieldRow label={round ? 'Radius' : 'Reach'}>
              <RangeField
                label={`Shade ${i + 1} ${round ? 'radius' : 'reach'}`}
                min={0}
                max={1}
                step={0.02}
                value={shade.reach}
                disabled={!on || !reachLive}
                onChange={(reach) => patch(shade.id, { reach })}
                format={(v) => `${Math.round(v * 100)}%`}
              />
            </FieldRow>
            <FieldRow
              label="Core"
              hint={
                core > 0
                  ? `Full strength over ${pct(core)} of the ${round ? 'radius' : 'reach'}, then the fade.`
                  : undefined
              }
            >
              <RangeField
                label={`Shade ${i + 1} core`}
                min={0}
                max={MAX_CORE}
                step={0.02}
                value={core}
                disabled={!on}
                onChange={(next) => patch(shade.id, { core: next })}
                format={pct}
              />
            </FieldRow>
            <FieldRow
              label="Falloff"
              hint={SHADE_FALLOFFS.find((f) => f.id === falloff)?.hint}
            >
              <ShadeFalloffPicker
                falloff={falloff}
                label={`Shade ${i + 1}`}
                disabled={!on}
                onPick={(next) => patch(shade.id, { falloff: next })}
              />
            </FieldRow>
            {movable && (
              <FieldRow
                label="Centre"
                align="start"
                hint={
                  placing === shade.id ? (
                    <p>
                      Press or drag on the picture to move the{' '}
                      {movable === 'both' ? 'centre' : 'band'}.
                    </p>
                  ) : centred ? undefined : (
                    <button
                      type="button"
                      className="p-0 bg-transparent border-0 text-xs text-accent-ink underline underline-offset-2 cursor-pointer"
                      onClick={() => patch(shade.id, { center: undefined })}
                    >
                      Back to the middle
                    </button>
                  )
                }
              >
                <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                  {onPlace && (
                    <Button
                      size="sm"
                      variant={placing === shade.id ? 'primary' : 'default'}
                      aria-pressed={placing === shade.id}
                      disabled={!on}
                      className="self-start"
                      onClick={() => onPlace(placing === shade.id ? null : shade.id)}
                    >
                      {placing === shade.id ? 'Done placing' : 'Place on the picture'}
                    </Button>
                  )}
                  {movable !== 'y' && (
                    <div className="flex items-center gap-2 min-w-0">
                      <RangeField
                        label={`Shade ${i + 1} centre across`}
                        min={0}
                        max={1}
                        step={0.01}
                        value={centre.x}
                        disabled={!on}
                        onChange={(x) => patch(shade.id, { center: { ...centre, x } })}
                        format={(v) => `${pct(v)} →`}
                      />
                    </div>
                  )}
                  {movable !== 'x' && (
                    <div className="flex items-center gap-2 min-w-0">
                      <RangeField
                        label={`Shade ${i + 1} centre down`}
                        min={0}
                        max={1}
                        step={0.01}
                        value={centre.y}
                        disabled={!on}
                        onChange={(y) => patch(shade.id, { center: { ...centre, y } })}
                        format={(v) => `${pct(v)} ↓`}
                      />
                    </div>
                  )}
                </div>
              </FieldRow>
            )}
            <FieldRow label="Invert">
              <ToggleField
                label={`Invert shade ${i + 1}`}
                checked={shade.invert}
                onChange={(invert) => patch(shade.id, { invert })}
              />
            </FieldRow>
            <FieldRow
              label="Follow badge"
              hint={FOLLOW_OPTIONS.find((o) => o.id === follow)?.title}
            >
              <Segmented
                size="sm"
                label={`Shade ${i + 1} follows the badge`}
                options={FOLLOW_OPTIONS}
                value={follow}
                onChange={(next) => patch(shade.id, followFlags(next))}
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
