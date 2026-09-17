import { describeDevelop, type DevelopSettings } from './develop';
import { developPillClass } from './develop-classes';
import type { DevelopPicture } from './use-develop-picture';

/**
 * The picture being developed: the canvas, the before/after divider and its
 * handle, the state lines (no picture, decoding, a decoder's refusal), and the
 * two pills over it. Everything it shows is `useDevelopPicture`'s; the host
 * decides its SIZE through `className` (a share of the app height in the
 * modal on a phone, the whole stage in the tool).
 */
export default function DevelopViewport({
  picture,
  hasFile,
  emptyText = 'No picture to develop yet.',
  className = '',
  onPick,
}: {
  picture: DevelopPicture;
  /** A file was given, so an absent source means "decoding". */
  hasFile: boolean;
  /** What an empty frame says — the host knows where a picture comes from. */
  emptyText?: string;
  className?: string;
  /**
   * The colour the eyedropper read, in linear light. Given, the viewport
   * answers a click while `picture.picking` is on; omitted, there is no dropper.
   */
  onPick?: (linear: [number, number, number]) => void;
}) {
  const { view, source, problem, cube, holding, wipe, divider, handlers } = picture;
  const picking = Boolean(onPick && picture.picking && source);
  return (
    <div
      ref={view.viewportRef}
      className={`relative min-h-0 bg-frame rounded-paper overflow-hidden touch-none select-none ${
        picking
          ? 'cursor-crosshair'
          : view.zoomed
            ? view.panning
              ? 'cursor-grabbing'
              : 'cursor-grab'
            : 'cursor-col-resize'
      } ${className}`}
      // While the dropper is armed it takes the gesture WHOLE: the wipe and the
      // pan are the same pointer, and letting them run too would drag the
      // picture out from under the pick.
      {...(picking ? {} : handlers)}
      onPointerDown={
        picking
          ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              const read = picture.pickAt(e.clientX, e.clientY);
              picture.setPicking(false);
              if (read) onPick!(read);
            }
          : handlers.onPointerDown
      }
    >
      <canvas
        ref={picture.canvasRef}
        className="absolute inset-0 w-full h-full object-contain"
        style={{
          transform: view.transform,
          // A finger is followed as it moves; a button is animated.
          transition: view.settling ? 'transform 220ms var(--ease-paper)' : undefined,
        }}
        aria-label="The picture, corrected"
      />
      {picture.comparing && (
        <div
          data-wipe-handle
          className="absolute w-7 -ml-3.5 cursor-col-resize group"
          style={{ left: divider.x, top: divider.top, height: Math.max(0, divider.bottom - divider.top) }}
          title="Drag to compare with the picture as shot"
          aria-hidden="true"
        >
          {wipe < 1 && (
            <span className="absolute inset-y-0 left-1/2 w-[1.5px] -ml-[0.75px] bg-[rgba(251,248,241,0.9)] pointer-events-none" />
          )}
          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 grid place-items-center w-6 h-6 rounded-full bg-[rgba(251,248,241,0.92)] border border-line-strong text-ink-soft shadow-paper group-hover:border-accent group-hover:text-accent-ink pointer-events-none">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 7l-5 5 5 5M15 7l5 5-5 5" />
            </svg>
          </span>
        </div>
      )}
      {!hasFile && (
        <span className="absolute inset-0 grid place-items-center px-6 text-center font-mono text-2xs text-muted">
          {emptyText}
        </span>
      )}
      {problem && (
        <span className="absolute inset-0 grid place-items-center px-6 text-center font-mono text-2xs text-paper">
          {problem}
        </span>
      )}
      {hasFile && !source && !problem && (
        <span className="absolute inset-0 grid place-items-center font-mono text-2xs text-muted">decoding…</span>
      )}
      {picking && (
        <span
          className={`absolute top-2 left-2.5 ${developPillClass} bg-[rgba(251,248,241,0.92)] text-accent-ink border-accent`}
          role="status"
        >
          click something grey
        </span>
      )}
      {source && cube && !picking && (
        <>
          <span className={`absolute top-2 left-2.5 ${developPillClass} bg-[rgba(251,248,241,0.86)] text-ink-soft`}>
            {holding ? 'before' : wipe < 1 ? 'after · before' : 'after'}
          </span>
          <button
            type="button"
            onPointerDown={(e) => {
              e.stopPropagation();
              picture.setHolding(true);
            }}
            onPointerUp={() => picture.setHolding(false)}
            onPointerLeave={() => picture.setHolding(false)}
            onPointerCancel={() => picture.setHolding(false)}
            className={`absolute bottom-2 right-2.5 ${developPillClass} bg-[rgba(251,248,241,0.86)] text-ink-soft cursor-pointer hover:border-accent`}
            title="Hold to see the picture as shot"
          >
            ◐ hold for before
          </button>
        </>
      )}
    </div>
  );
}

/**
 * The line under the picture: what the numbers say, what this picture can give
 * back (`note`), and the gesture that applies right now.
 */
export function DevelopCaption({
  draft,
  note,
  picture,
}: {
  draft: DevelopSettings;
  note?: string | null;
  picture: DevelopPicture;
}) {
  const { source, cube, view } = picture;
  return (
    <p className="m-0 flex-none font-mono text-2xs text-faint leading-relaxed">
      {describeDevelop(draft)}
      {note ? ` — ${note}` : ''}
      {source && cube
        ? view.zoomed
          ? ' · drag to look around, the handle on the divider compares'
          : ' · drag across the picture to compare, wheel or pinch to look closer'
        : source && !cube
          ? ' · nothing changes the picture yet'
          : ''}
    </p>
  );
}
