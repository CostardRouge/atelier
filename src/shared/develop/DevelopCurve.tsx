import { useRef, useState } from 'react';
import DevelopFold from './DevelopFold';
import Segmented from '../ui/Segmented';
import { developLinkClass } from './develop-classes';
import {
  addCurvePoint,
  curvePath,
  curveToEdit,
  describeCurvePoint,
  moveCurvePoint,
  pointAt,
  removeCurvePoint,
} from './curve-edit';
import {
  CURVE_CHANNELS,
  isIdentityCurve,
  type Curve,
  type CurveChannel,
  type ToneCurves,
} from './curves';
import { histogramShape, type Histogram } from './histogram';

const LABELS: Readonly<Record<CurveChannel, string>> = {
  luma: 'Luma',
  rgb: 'RGB',
  red: 'R',
  green: 'G',
  blue: 'B',
};

/** The ink a channel's curve is drawn in — the channel's own, so the tab needs no legend. */
const STROKE: Readonly<Record<CurveChannel, string>> = {
  luma: 'rgba(251,248,241,0.92)',
  rgb: 'rgba(251,248,241,0.92)',
  red: 'rgba(233,105,88,0.95)',
  green: 'rgba(120,196,132,0.95)',
  blue: 'rgba(116,161,232,0.95)',
};

const HINT =
  'Luma moves the tone and leaves the colour alone — a grey stays grey. RGB runs all three channels through one curve, which is the classic contrast curve and does deepen colour. R, G and B tint on purpose. Drag a point to move it, click the line to add one, double-click a point to drop it; dragging an end inwards sets a black or white point.';

/**
 * The curve editor: one square, the picture's own histogram behind it, the
 * spline over it and its control points on top.
 *
 * The path is SAMPLED from `makeCurve` rather than expressed as béziers
 * (`curvePath`): the spline is monotone cubic and a `C` command would draw a
 * different shape from the one that bakes, which is the class of bug where a
 * picture and its editor quietly disagree.
 *
 * The gesture rules — what a drag may do to a point, what a click near one
 * means — are pure and tested in `curve-edit.ts`, so this file is only the
 * pointer plumbing and the paint.
 */
export default function DevelopCurve({
  value,
  histogram,
  onChange,
  foldPrefix = '',
}: {
  value: ToneCurves | null | undefined;
  histogram: Histogram | null;
  onChange: (curves: ToneCurves | null) => void;
  /** Keeps a LAYER's fold apart from the picture's (`layer.`). */
  foldPrefix?: string;
}) {
  const [channel, setChannel] = useState<CurveChannel>('luma');
  const [dragging, setDragging] = useState(-1);
  const boxRef = useRef<SVGSVGElement | null>(null);
  /**
   * The curve UNDER THE HAND, advanced on every write.
   *
   * A drag fires pointermove far faster than React re-renders, so a handler
   * reading `curve` from its render closure applies every move of the drag to
   * the curve as it was when the pointer went DOWN — and the last write wins,
   * which silently threw away the point the drag had just added. (Measured: a
   * drag from the middle of the diagonal stored two points instead of three,
   * the far end gone.) The roll editor's rule, and the crop pinch's:
   * `develop-roll.md`, `roadtrip.md`.
   */
  const liveRef = useRef<Curve | null>(null);
  /** The point under the hand. The state above is for the PAINT; a handler
   *  reading it from its closure would still see −1 on the first move. */
  const grabRef = useRef(-1);

  const stored = value?.[channel] ?? null;
  const curve = curveToEdit(stored);
  const touched = CURVE_CHANNELS.filter((c) => !isIdentityCurve(value?.[c]));

  /** Write one channel back, storing null for a curve that does nothing. */
  const write = (next: Curve) => {
    liveRef.current = next;
    const base: ToneCurves = value
      ? { ...value }
      : { luma: null, rgb: null, red: null, green: null, blue: null };
    base[channel] = isIdentityCurve(next) ? null : next;
    const empty = CURVE_CHANNELS.every((c) => base[c] === null);
    onChange(empty ? null : base);
  };

  /** Pointer position in CURVE coordinates: y up, clamped to the box. */
  const at = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const box = boxRef.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return { x: 0, y: 0 };
    const x = (e.clientX - box.left) / box.width;
    const y = 1 - (e.clientY - box.top) / box.height;
    return { x: x < 0 ? 0 : x > 1 ? 1 : x, y: y < 0 ? 0 : y > 1 ? 1 : y };
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const p = at(e);
    liveRef.current = curve;
    const found = pointAt(curve, p.x, p.y);
    if (found >= 0) {
      grabRef.current = found;
      setDragging(found);
    } else {
      const added = addCurvePoint(curve, p.x, p.y);
      write(added.curve);
      grabRef.current = added.index;
      setDragging(added.index);
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (grabRef.current < 0) return;
    const p = at(e);
    write(moveCurvePoint(liveRef.current ?? curve, grabRef.current, p.x, p.y));
  };

  const endDrag = (e: React.PointerEvent<SVGSVGElement>) => {
    if (grabRef.current < 0) return;
    grabRef.current = -1;
    setDragging(-1);
    liveRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const heights = histogram ? histogramShape(histogram) : [];
  const n = heights.length;
  const histogramPath =
    n > 0
      ? `M0,1 ${heights.map((v, i) => `L${i / n},${1 - v} L${(i + 1) / n},${1 - v}`).join(' ')} L1,1 Z`
      : '';

  return (
    <DevelopFold
      id={`${foldPrefix}curve`}
      title="Curve"
      info={<p>{HINT}</p>}
      marked={touched.length > 0}
      defaultOpen={false}
    >

      <Segmented
        options={CURVE_CHANNELS.map((c) => ({
          id: c,
          // A dot marks a channel that is shaped, so a tab you are not on
          // still says it is doing something. A node rather than a string, so
          // the marker cannot wrap away from the name it belongs to.
          label: touched.includes(c) ? (
            <>
              {LABELS[c]}
              <span aria-hidden="true" className="ml-1 opacity-70">
                ·
              </span>
            </>
          ) : (
            LABELS[c]
          ),
        }))}
        value={channel}
        onChange={setChannel}
        size="sm"
        fill
        label="Curve channel"
      />

      <div className="relative rounded-control bg-frame p-1.5">
        <svg
          ref={boxRef}
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
          // A fixed box that answers a drag on both axes, not a scroller —
          // `touch-none` is right here (`frontend.md`'s rule is about scrollers).
          className="block w-full aspect-square touch-none cursor-crosshair"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          role="application"
          aria-label={`${LABELS[channel]} curve, ${curve.length} points`}
        >
          {/* The picture's light, behind — the same shape the strip draws. */}
          {n > 0 && <path d={histogramPath} fill="rgba(251,248,241,0.14)" />}
          {/* The straight line: where a point would be if it did nothing. */}
          <path d="M0,1 L1,0" stroke="rgba(251,248,241,0.22)" strokeWidth={1} fill="none" vectorEffect="non-scaling-stroke" />
          <path
            d="M0.25,0 L0.25,1 M0.5,0 L0.5,1 M0.75,0 L0.75,1 M0,0.25 L1,0.25 M0,0.5 L1,0.5 M0,0.75 L1,0.75"
            stroke="rgba(251,248,241,0.09)"
            strokeWidth={1}
            fill="none"
            vectorEffect="non-scaling-stroke"
          />
          {/* `non-scaling-stroke` puts the width in SCREEN pixels, so it is 2
              and not a fraction of the viewBox — at 0.008 the curve was drawn
              sub-pixel and did not appear at all (seen in the pane, not in a
              test: nothing here can fail on an invisible line). */}
          <path
            d={curvePath(curve)}
            stroke={STROKE[channel]}
            strokeWidth={2}
            strokeLinecap="round"
            fill="none"
            vectorEffect="non-scaling-stroke"
          />
          {curve.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={1 - p.y}
              r={i === dragging ? 0.028 : 0.021}
              fill={i === dragging ? STROKE[channel] : 'rgba(251,248,241,0.92)'}
              stroke="rgba(20,18,15,0.55)"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
              onDoubleClick={(e) => {
                e.stopPropagation();
                write(removeCurvePoint(curve, i));
              }}
            >
              <title>{describeCurvePoint(p)}</title>
            </circle>
          ))}
        </svg>
      </div>

      <div className="flex items-center gap-2 font-mono text-3xs tabular-nums text-faint">
        <span>
          {dragging >= 0
            ? describeCurvePoint(curve[dragging])
            : stored
              ? `${curve.length} points`
              : 'straight'}
        </span>
        <span className="flex-1" />
        {stored && (
          <button type="button" className={developLinkClass} onClick={() => write(curveToEdit(null))}>
            Reset {LABELS[channel]}
          </button>
        )}
        {touched.length > 1 && (
          <button type="button" className={developLinkClass} onClick={() => onChange(null)}>
            Reset all
          </button>
        )}
      </div>
    </DevelopFold>
  );
}
