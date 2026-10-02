import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

/**
 * The handle between the stage and the band: dragged, it gives the band its
 * size (the host turns the travel into a height or a width through
 * `bandAfterDrag`, and writes it to the device's preference); double-clicked
 * (or Enter), it folds the band to its rail and back — `B`'s gesture for a
 * pointer. A drag surface and nothing else, so it claims every touch on
 * itself (`touch-none` is right here: it is not in a scroll box and writes
 * only a drag) and captures the pointer for the drag's length.
 */
export default function BandGrip({
  axis,
  size,
  label,
  onDrag,
  onEnd,
  onToggle,
}: {
  /** `y` for a band under the picture (dragged up and down), `x` beside it. */
  axis: 'x' | 'y';
  /** The grip's thickness across the axis, in px (`StripMetrics.grip`). */
  size: number;
  label: string;
  /** The pointer's travel from where the drag began, in CSS px. */
  onDrag: (travel: { dx: number; dy: number }) => void;
  onEnd?: () => void;
  onToggle: () => void;
}) {
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    setDragging(true);
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const s = start.current;
    if (!s || s.id !== e.pointerId) return;
    onDrag({ dx: e.clientX - s.x, dy: e.clientY - s.y });
  };
  const finish = (e: ReactPointerEvent) => {
    if (!start.current || start.current.id !== e.pointerId) return;
    start.current = null;
    setDragging(false);
    onEnd?.();
  };
  const vertical = axis === 'y';
  return (
    <button
      type="button"
      aria-label={label}
      title={`${label} — drag; double-click to fold (B)`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onDoubleClick={onToggle}
      className={`group flex-none grid place-items-center p-0 border-0 bg-transparent touch-none select-none ${
        vertical ? 'w-full cursor-row-resize' : 'h-full cursor-col-resize'
      }`}
      style={vertical ? { height: size } : { width: size }}
    >
      <span
        className={`block rounded-full transition-colors ${vertical ? 'w-11 h-1' : 'w-1 h-11'} ${
          dragging ? 'bg-accent' : 'bg-line-strong group-hover:bg-accent group-focus-visible:bg-accent'
        }`}
        aria-hidden="true"
      />
    </button>
  );
}
