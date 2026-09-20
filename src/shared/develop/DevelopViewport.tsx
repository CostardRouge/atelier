import { describeDevelop, type DevelopSettings } from './develop';
import { developPillClass } from './develop-classes';
import { imageRenderingFor, type PixelView } from '../ui/use-pixel-view';
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
  pixelView = 'smooth',
  facts = null,
  marks = null,
  onUnmark,
}: {
  picture: DevelopPicture;
  /**
   * Points the author PICKED on the picture, in the source's own [0,1] — a
   * subject mask's taps. Drawn as `+` discs that follow the zoom and the pan.
   *
   * They were invisible until 2026-09-19, which made the documented
   * tap-a-marker-to-remove gesture unusable: nothing said where a marker was,
   * so nothing could be aimed at. A point the crop cut away is not drawn.
   */
  marks?: readonly (readonly [number, number])[] | null;
  /** Taking one off. Given, a marker answers its own click and shows `−`. */
  onUnmark?: (index: number) => void;
  /**
   * The picture's own facts, drawn DOWN its bottom-left corner — what the
   * numbers say, what the picture is, what else is on it. Over the photograph
   * rather than under it, one fact per line: a stage is where the room is, and
   * a corner costs nothing when there is nothing to say (omit it and no box is
   * drawn). The host decides whether they are showing (`I`).
   */
  facts?: readonly string[] | null;
  /**
   * How a MAGNIFIED picture is drawn. Only past 1:1 does it change anything,
   * and there it decides whether a magnified pixel looks like a pixel or like
   * a gradient nothing photographed (`use-pixel-view.ts`).
   */
  pixelView?: PixelView;
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
  // A tap-gesture mask tool is armed: the pointer ADDS a point, and the native
  // `copy` cursor is the browser's own `+` badge saying so.
  const tapping = !picking && picture.painting && picture.paintGesture === 'tap';
  return (
    <div
      ref={view.viewportRef}
      className={`relative min-h-0 bg-frame rounded-paper overflow-hidden touch-none select-none ${
        picking
          ? 'cursor-crosshair'
          : tapping
            ? 'cursor-copy'
            : view.zoomed
            ? view.panning
              ? 'cursor-grabbing'
              : 'cursor-grab'
            : picture.comparing
              ? 'cursor-col-resize'
              : 'cursor-default'
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
          // Below 1:1 the browser is DOWNSCALING, where `pixelated` is simply
          // worse — it aliases a picture nobody asked to inspect. The choice
          // only takes effect where it means something.
          imageRendering: view.magnifying ? imageRenderingFor(pixelView) : undefined,
        }}
        aria-label="The picture, corrected"
      />
      {/* The loupe: the file's own pixels, drawn in VIEWPORT space over the
          stage while the view is past the stage's 1:1. Sized 0 and drawing
          nothing when it is not (`use-develop-picture.ts`, «the loupe»). */}
      <canvas
        ref={picture.loupe.canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
        aria-hidden="true"
      />
      {picture.loupe.active && (
        <span
          className={`absolute top-2 right-2.5 ${developPillClass} bg-[rgba(251,248,241,0.86)] text-ink-soft`}
          role="status"
          title="Past the stage's own pixels the file is decoded whole and drawn at its own density"
        >
          {picture.loupe.state === 'decoding'
            ? 'loupe · decoding…'
            : picture.loupe.state === 'ready'
              ? `loupe · ${picture.loupe.longEdge ?? ''} px`
              : picture.loupe.state === 'same'
                ? 'loupe · the file has no more'
                : 'loupe · could not decode'}
        </span>
      )}
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
      {source &&
        marks?.map(([sx, sy], i) => {
          const at = picture.stagePoint(sx, sy);
          if (!at || !at.inside) return null;
          return (
            <button
              key={`${sx},${sy},${i}`}
              type="button"
              // Its OWN press, and it never reaches the stage: the tap path
              // below would hit-test the same marker on state this click has
              // already changed, and remove it twice — which lands as an ADD.
              onPointerDown={
                onUnmark
                  ? (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onUnmark(i);
                    }
                  : undefined
              }
              disabled={!onUnmark}
              className={`absolute -translate-x-1/2 -translate-y-1/2 grid place-items-center w-5 h-5 rounded-full bg-[rgba(251,248,241,0.92)] border border-line-strong text-ink-soft shadow-paper group ${
                onUnmark ? 'cursor-pointer hover:border-accent hover:text-accent-ink' : 'pointer-events-none'
              }`}
              style={{ left: at.x, top: at.y }}
              title={onUnmark ? 'Take this point off the subject' : 'A point of the subject'}
              aria-label={onUnmark ? `Take subject point ${i + 1} off` : `Subject point ${i + 1}`}
            >
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
                {/* `+` at rest, `−` under the pointer: the vertical stroke is
                    what the hover takes away, so the icon SAYS what the click
                    will do rather than what the marker is. */}
                <path d="M5 12h14" />
                <path d="M12 5v14" className={onUnmark ? 'group-hover:hidden' : ''} />
              </svg>
            </button>
          );
        })}
      {facts && facts.length > 0 && source && (
        <div
          // Pointer-transparent: the facts sit ON the picture, and the picture
          // under them still answers a drag, a wipe and a paint stroke.
          className="absolute bottom-2 left-2.5 max-w-[60%] pointer-events-none flex flex-col items-start gap-0.5"
          role="status"
        >
          {facts.map((line) => (
            <span
              key={line}
              className="font-mono text-2xs text-ink-soft bg-[rgba(251,248,241,0.84)] rounded-[0.25rem] px-1.5 py-0.5 leading-snug"
            >
              {line}
            </span>
          ))}
        </div>
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
  also = null,
}: {
  draft: DevelopSettings;
  note?: string | null;
  picture: DevelopPicture;
  /**
   * What ELSE is on the picture that the develop's own numbers do not say —
   * layers, today. Without it the line reads "nothing changes the picture yet"
   * over a picture a layer is visibly changing, because it was written when a
   * cube was the only thing that could change one.
   */
  also?: string | null;
}) {
  const { source, cube, view, painting, paintGesture } = picture;
  const touched = Boolean(cube) || Boolean(also);
  // While a drag PAINTS, it does not compare: offering the wipe would be
  // offering a gesture the picture has already given away.
  const gesture = painting
    ? paintGesture === 'tap'
      ? ' · tap the subject on the picture'
      : ' · drag across the picture to paint the mask'
    : view.zoomed
      ? picture.comparing
        ? ' · drag to look around, the handle on the divider compares'
        : ' · drag to look around'
      : picture.comparing
        ? ' · drag across the picture to compare, wheel or pinch to look closer'
        : ' · wheel or pinch to look closer';
  return (
    <p className="m-0 flex-none font-mono text-2xs text-faint leading-relaxed">
      {describeDevelop(draft)}
      {also ? ` · ${also}` : ''}
      {note ? ` — ${note}` : ''}
      {source && (touched || painting) ? gesture : source ? ' · nothing changes the picture yet' : ''}
    </p>
  );
}
