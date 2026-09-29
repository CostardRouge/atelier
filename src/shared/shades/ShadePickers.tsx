import type { CSSProperties } from 'react';
import {
  SHADE_DIRECTIONS,
  SHADE_FALLOFFS,
  SHADE_GRID,
  directionInCell,
  shadeCell,
  shapeGradient,
  type ShadeDirection,
  type ShadeFalloff,
} from './shade-shape';

/**
 * The two pickers a shade's SHAPE is chosen with — the direction on a 3×3
 * grid, the falloff as five small curves — shared by Trips' shades
 * (`ShadesPanel`) and Develop's shade mask (`MaskPanel`), so the same shape is
 * picked the same way in both. The sliders around them (reach, core, centre)
 * stay each host's, drawn in its own inspector's idiom.
 */

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

/** A direction's name, as the grid's cells and a row's hint say it. */
export const SHADE_LABELS = Object.fromEntries(SHADE_DIRECTIONS.map((d) => [d.id, d.label])) as Record<
  ShadeDirection,
  string
>;

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
 * The direction, on a 3×3 grid, cell for cell the badge's own anchor grid,
 * each cell showing the gradient it draws: a list of eleven sentences had to
 * be read every time. The centre holds three shapes (a radial and the two
 * bands, which cross the frame and fit no single cell), offered in a column
 * beside the grid only while the centre is the cell. Multi-select was weighed
 * and declined: every combination that means something is already a band, an
 * inverted band or two shades.
 */
export function ShadeDirectionPicker({
  direction,
  onPick,
  label,
}: {
  /** The direction drawn now — a host resolving it (Trips' anchor) passes the result. */
  direction: ShadeDirection;
  onPick: (next: ShadeDirection) => void;
  /** Names the two groups for a screen reader: `${label} direction`, `${label} centre shape`. */
  label: string;
}) {
  const cell = shadeCell(direction);
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="grid grid-cols-3 gap-1" role="group" aria-label={`${label} direction`}>
        {SHADE_GRID.map(({ cell: at, shapes }) => {
          const shape = at === 'center' ? directionInCell('center', direction) : shapes[0];
          return (
            <GlyphButton
              key={at}
              direction={shape}
              pressed={at === cell}
              label={at === 'center' ? 'Centre' : SHADE_LABELS[shape]}
              onClick={() => onPick(shape)}
            />
          );
        })}
      </div>
      {cell === 'center' && (
        <div
          className="flex flex-col gap-1 self-center pl-2 border-l border-line"
          role="group"
          aria-label={`${label} centre shape`}
        >
          {SHADE_GRID[4].shapes.map((shape) => (
            <GlyphButton
              key={shape}
              direction={shape}
              pressed={shape === direction}
              label={SHADE_LABELS[shape]}
              onClick={() => onPick(shape)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A falloff's picture: the strength along a shade's run, drawn from the very
 * stops the renderer gets for it — a sketch of the curve could drift from it.
 */
const FALLOFF_PATHS: Record<ShadeFalloff, string> = Object.fromEntries(
  SHADE_FALLOFFS.map(({ id }) => {
    const g = shapeGradient({ direction: 'left', reach: 1, falloff: id }, 1);
    const stops = g?.stops ?? [];
    const line = stops
      .map((s, i) => `${i ? 'L' : 'M'}${(2 + s.at * 32).toFixed(2)} ${(3 + (1 - s.alpha) * 16).toFixed(2)}`)
      .join('');
    return [id, line];
  }),
) as Record<ShadeFalloff, string>;

function FalloffButton({
  falloff,
  pressed,
  disabled,
  onClick,
  label,
  hint,
}: {
  falloff: ShadeFalloff;
  pressed: boolean;
  disabled: boolean;
  onClick: () => void;
  label: string;
  hint: string;
}) {
  const path = FALLOFF_PATHS[falloff];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={pressed}
      title={`${label} — ${hint}`}
      className={`w-9 h-7 rounded-[6px] border bg-paper cursor-pointer disabled:opacity-45 disabled:cursor-default transition-[border-color,box-shadow] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${
        pressed
          ? 'border-accent text-accent shadow-[0_0_0_1px_var(--color-accent)]'
          : 'border-line-strong text-ink-soft hover:border-muted'
      }`}
    >
      <svg viewBox="0 0 36 22" className="w-full h-full" aria-hidden="true">
        <path d={`${path}L34 19L2 19Z`} fill="currentColor" opacity="0.18" />
        <path d={path} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

/** The falloff, as five curves drawn from the renderer's own stops. */
export function ShadeFalloffPicker({
  falloff,
  onPick,
  label,
  disabled = false,
}: {
  falloff: ShadeFalloff;
  onPick: (next: ShadeFalloff) => void;
  /** Names the group for a screen reader: `${label} falloff`. */
  label: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label={`${label} falloff`}>
      {SHADE_FALLOFFS.map((f) => (
        <FalloffButton
          key={f.id}
          falloff={f.id}
          label={f.label}
          hint={f.hint}
          pressed={f.id === falloff}
          disabled={disabled}
          onClick={() => onPick(f.id)}
        />
      ))}
    </div>
  );
}
