import type { CSSProperties } from 'react';
import type { Anchor } from '../../shared/overlay/overlay-types';
import {
  MAX_SHADES,
  SHADE_DIRECTIONS,
  SHADE_GRID,
  createShade,
  directionInCell,
  followFlags,
  reachFollowsBadge,
  shadeCell,
  shadeFollow,
  vignetteShade,
  type Shade,
  type ShadeDirection,
  type ShadeFollow,
} from '../../shared/roadtrip/shades';
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
}

const INK = 'color-mix(in srgb, var(--color-ink) 80%, transparent)';

/**
 * A cell's picture of the shade it draws — the gradient itself, so the grid
 * is read by eye rather than by label. A sketch, not the renderer: it only has
 * to tell eleven shapes apart at 30px.
 */
const GLYPHS: Record<ShadeDirection, string> = {
  top: `linear-gradient(to bottom, ${INK}, transparent 75%)`,
  bottom: `linear-gradient(to top, ${INK}, transparent 75%)`,
  left: `linear-gradient(to right, ${INK}, transparent 75%)`,
  right: `linear-gradient(to left, ${INK}, transparent 75%)`,
  radial: `radial-gradient(circle at 50% 50%, ${INK}, transparent 60%)`,
  'middle-vertical': `linear-gradient(to bottom, transparent 10%, ${INK}, transparent 90%)`,
  'middle-horizontal': `linear-gradient(to right, transparent 10%, ${INK}, transparent 90%)`,
  'top-left': `radial-gradient(circle at 0% 0%, ${INK}, transparent 80%)`,
  'top-right': `radial-gradient(circle at 100% 0%, ${INK}, transparent 80%)`,
  'bottom-left': `radial-gradient(circle at 0% 100%, ${INK}, transparent 80%)`,
  'bottom-right': `radial-gradient(circle at 100% 100%, ${INK}, transparent 80%)`,
};

const LABELS = Object.fromEntries(SHADE_DIRECTIONS.map((d) => [d.id, d.label])) as Record<
  ShadeDirection,
  string
>;

/** The shapes whose reach is a radius. */
const ROUND = new Set<ShadeDirection>(['radial', 'top-left', 'top-right', 'bottom-left', 'bottom-right']);

const FOLLOW_OPTIONS = [
  { id: 'none', label: 'No', title: 'Placed where the grid says' },
  { id: 'edge', label: 'Edge', title: 'The reach lands on the badge, the side stays yours' },
  { id: 'anchor', label: 'Anchor', title: 'Sits where the badge is anchored, and moves with it' },
] as const satisfies readonly { id: ShadeFollow; label: string; title: string }[];

function GlyphButton({
  direction,
  pressed,
  onClick,
  label,
}: {
  direction: ShadeDirection;
  pressed: boolean;
  onClick: () => void;
  label: string;
}) {
  const style: CSSProperties = { backgroundImage: GLYPHS[direction] };
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      style={style}
      className={`w-8 h-8 rounded-[6px] border bg-paper cursor-pointer transition-[border-color,box-shadow] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${
        pressed
          ? 'border-accent shadow-[0_0_0_1px_var(--color-accent)]'
          : 'border-line-strong hover:border-muted'
      }`}
    />
  );
}

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
 * beside the grid only while the centre is the cell.
 *
 * Two shortcuts sit beside the plain "add", because the two shapes that get
 * reached for constantly (a scrim under the hook, a corner vignette) would
 * otherwise each be four adjustments.
 */
export default function ShadesPanel({ shades, onChange, anchor }: ShadesPanelProps) {
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
        const cell = shadeCell(direction);
        const round = ROUND.has(direction);
        // A top or bottom shade following the badge takes its reach from the
        // block, so the slider would be a control that does nothing.
        const reachLive = !reachFollowsBadge(direction, follow);
        // Absent on every shade stored before the switch existed: that is ON.
        const on = shade.enabled !== false;
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
                  ? `${LABELS[direction]} — where the badge is anchored.`
                  : LABELS[direction]
              }
            >
              <div
                className="grid grid-cols-3 gap-1"
                role="group"
                aria-label={`Shade ${i + 1} direction`}
              >
                {SHADE_GRID.map(({ cell: at, shapes }) => {
                  const shape = at === 'center' ? directionInCell('center', direction) : shapes[0];
                  return (
                    <GlyphButton
                      key={at}
                      direction={shape}
                      pressed={at === cell}
                      label={at === 'center' ? 'Centre' : LABELS[shape]}
                      onClick={() => pick(shape)}
                    />
                  );
                })}
              </div>
              {cell === 'center' && (
                <div
                  className="flex flex-col gap-1 self-center pl-2 border-l border-line"
                  role="group"
                  aria-label={`Shade ${i + 1} centre shape`}
                >
                  {SHADE_GRID[4].shapes.map((shape) => (
                    <GlyphButton
                      key={shape}
                      direction={shape}
                      pressed={shape === direction}
                      label={LABELS[shape]}
                      onClick={() => pick(shape)}
                    />
                  ))}
                </div>
              )}
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
