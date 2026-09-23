import { useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import DevelopFold from './DevelopFold';
import { developLinkClass } from './develop-classes';
import { RangeSlider } from './DevelopSliders';
import {
  GRADE_ZONES,
  isDefaultGrading,
  neutralGrading,
  pointOnWheel,
  wheelPoint,
  withShape,
  withWheel,
  zoneLabel,
  type ColourGrading,
  type GradeWheel,
  type GradeZone,
} from './grading';

const HINT =
  'A colour and a light for the shadows, the midtones and the highlights, and one for the whole picture. Drag in a wheel: the angle is the hue, the distance from the centre how strongly it tints; a wheel colours without brightening, and the slider under it moves the light. Balance says where the shadows end and the highlights begin; Blending how far each range reaches into the next. Double-click a wheel to clear its colour.';

/**
 * The hue circle, drawn by the browser: a conic sweep from red at the right
 * turning clockwise — the same convention `wheelPoint` reads — under a grey
 * that fades out toward the rim, so the centre is "no colour". Fixed colours
 * on purpose: a colour wheel is its colours in every theme.
 */
const WHEEL_BACKGROUND = [
  'radial-gradient(closest-side, rgb(128 128 128) 0%, rgb(128 128 128 / 0) 100%)',
  `conic-gradient(from 90deg, ${[0, 60, 120, 180, 240, 300, 360].map((h) => `hsl(${h} 85% 55%)`).join(', ')})`,
].join(', ');

function Wheel({
  zone,
  value,
  onChange,
}: {
  zone: GradeZone;
  value: GradeWheel;
  onChange: (next: GradeWheel) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);
  const label = zoneLabel(zone);

  const readAt = (e: { clientX: number; clientY: number }) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box || box.width <= 0) return;
    const r = box.width / 2;
    const { hue, saturation } = wheelPoint((e.clientX - box.left - r) / r, (e.clientY - box.top - r) / r);
    onChange({ ...value, hue, saturation });
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    dragging.current = true;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* not a live pointer */
    }
    readAt(e);
    e.preventDefault();
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragging.current) readAt(e);
  };
  const end = () => {
    dragging.current = false;
  };
  // The keyboard's way in: ←/→ turn the hue, ↑/↓ the strength; Shift for ten.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const hue = (value.hue + (e.key === 'ArrowRight' ? step : -step) + 360) % 360;
      onChange({ ...value, hue });
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const saturation = Math.max(0, Math.min(100, value.saturation + (e.key === 'ArrowUp' ? step : -step)));
      onChange({ ...value, saturation });
    } else return;
    e.preventDefault();
  };

  const puck = pointOnWheel(value.hue, value.saturation);
  const coloured = value.saturation > 0;
  return (
    <div className="flex flex-col items-stretch gap-1 min-w-0">
      <span className={`text-xs text-center truncate ${coloured || value.luminance ? 'font-semibold text-ink' : 'text-ink'}`}>
        {label}
      </span>
      <div
        ref={ref}
        role="slider"
        tabIndex={0}
        aria-label={`${label} colour`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value.saturation}
        aria-valuetext={coloured ? `hue ${value.hue} degrees, strength ${value.saturation}` : 'no colour'}
        title={`${label} — drag for a colour; arrows turn it (←/→) and strengthen it (↑/↓)`}
        className="relative w-full aspect-square rounded-full border border-line cursor-crosshair touch-none select-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        style={{ background: WHEEL_BACKGROUND }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onPointerCancel={end}
        onDoubleClick={() => onChange({ ...value, saturation: 0 })}
        onKeyDown={onKeyDown}
      >
        <span
          aria-hidden="true"
          className="absolute w-3 h-3 -ml-1.5 -mt-1.5 rounded-full border-2 border-on-media shadow pointer-events-none"
          style={{
            left: `${50 + puck.x * 50}%`,
            top: `${50 + puck.y * 50}%`,
            background: coloured ? `hsl(${value.hue} 85% ${55 + (1 - value.saturation / 100) * 20}%)` : 'rgb(128 128 128)',
          }}
        />
      </div>
      <span className="font-mono text-3xs tabular-nums text-center text-faint">
        {coloured ? `${value.hue}° · ${value.saturation}` : '—'}
      </span>
      <RangeSlider
        label="Light"
        value={value.luminance}
        range={{ min: -100, max: 100, step: 1, unit: '' }}
        onChange={(luminance) => onChange({ ...value, luminance })}
      />
    </div>
  );
}

/**
 * Colour grading (`grading.ts`), Lightroom's wheels: shadows, midtones and
 * highlights side by side — they are set against each other — then the
 * global wheel beside Blending and Balance.
 */
export default function DevelopGrading({
  value,
  onChange,
}: {
  value: ColourGrading | null | undefined;
  onChange: (grading: ColourGrading | null) => void;
}) {
  const g = value ?? neutralGrading();
  const wheel = (zone: GradeZone) => (
    <Wheel key={zone} zone={zone} value={g[zone]} onChange={(w) => onChange(withWheel(value, zone, w))} />
  );
  const touched = !isDefaultGrading(value) || g.blending !== 50 || g.balance !== 0;
  return (
    <DevelopFold id="grading" title="Colour grading" info={<p>{HINT}</p>} marked={!isDefaultGrading(value)} defaultOpen={false}>
      <div className="grid grid-cols-3 gap-3">{GRADE_ZONES.filter((z) => z !== 'global').map(wheel)}</div>
      <div className="grid grid-cols-3 gap-3 items-start">
        {wheel('global')}
        <div className="col-span-2 flex flex-col gap-2 pt-5">
          <RangeSlider
            label="Blending"
            value={g.blending}
            reset={50}
            printed={String(g.blending)}
            range={{ min: 0, max: 100, step: 1, unit: '' }}
            onChange={(v) => onChange(withShape(value, 'blending', v))}
          />
          <RangeSlider
            label="Balance"
            value={g.balance}
            range={{ min: -100, max: 100, step: 1, unit: '' }}
            onChange={(v) => onChange(withShape(value, 'balance', v))}
          />
        </div>
      </div>
      {touched && (
        <button type="button" className={`${developLinkClass} self-start`} onClick={() => onChange(null)}>
          Reset grading
        </button>
      )}
    </DevelopFold>
  );
}
