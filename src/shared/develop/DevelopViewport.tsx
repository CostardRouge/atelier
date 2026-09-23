import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { describeDevelop, type DevelopSettings } from './develop';
import { developPillClass } from './develop-classes';
import { imageRenderingFor, type PixelView } from '../ui/use-pixel-view';
import TaskEdge from '../ui/TaskEdge';
import { Icons } from '../ui/icons';
import type { DevelopPicture } from './use-develop-picture';

/**
 * A repair patch as the viewport draws it: two discs in the source's own
 * [0,1], the destination and where its pixels come from, with the radius as
 * shares of the frame's width and height (`repair.ts`, `patchExtent`).
 */
export interface RepairRing {
  id: string;
  x: number;
  y: number;
  sx: number;
  sy: number;
  ru: number;
  rv: number;
  kind: 'heal' | 'clone';
  /** The one the panel's sliders edit — drawn in the accent. */
  selected?: boolean;
}

/** The two halves of a ring a hand can take hold of. */
export type RingPart = 'patch' | 'source';

/**
 * A drag on a ring, in the source's own [0,1] — UNBOUNDED, so a hand that
 * strays past the picture's edge still moves the patch to the edge. `onEnd`
 * says whether the pointer travelled at all: a press that did not is a TAP,
 * and a tap on the solid ring takes the patch off (the host's call) — the
 * maintainer's strong preference over a key, the ring's cursor saying so.
 */
export interface RingGesture {
  onStart: (id: string, part: RingPart, point: [number, number]) => void;
  onMove: (point: [number, number]) => void;
  onEnd: (travelled: boolean) => void;
}

/** A spot the dust scan proposes: a heal to accept with a tap, never a patch yet. */
export interface SpotRing {
  x: number;
  y: number;
  ru: number;
}

/** Pixels a pointer may wander before a press on a ring is a drag rather than a tap. */
const RING_SLOP = 3;
/** A ring's hit disc is never smaller than this, in screen pixels: a 3 px ring is not a target. */
const RING_HIT = 11;

/** How a light stroke is drawn on the picture — the fixed `on-media` ink, never a theme colour that goes near-black at night. */
const RING_INK = 'rgba(251,248,241,0.92)';
const CLONE_INK = 'rgba(255,220,120,0.92)';
const RING_HALO = 'rgba(20,18,14,0.55)';
/**
 * The cursor over a solid ring: a native cursor drawn from an SVG — a disc
 * with a minus in it, the same glyph the ring shows under the pointer — so
 * the hand is told what a click does before it clicks. Falls back to the
 * pointer where a data-URI cursor is refused.
 */
const REMOVE_CURSOR = `url("data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22"><circle cx="11" cy="11" r="8.5" fill="rgba(251,248,241,0.96)" stroke="rgba(20,18,14,0.8)" stroke-width="1.4"/><path d="M6.5 11h9" stroke="rgba(20,18,14,0.9)" stroke-width="2" stroke-linecap="round"/></svg>',
)}") 11 11, pointer`;

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
  onCropToView,
  pixelView = 'smooth',
  facts = null,
  shot = null,
  marks = null,
  onUnmark,
  rings = null,
  onRing,
  spots = null,
  onSpot,
  scope = null,
}: {
  picture: DevelopPicture;
  /**
   * The media whose TASKS this stage draws on its bottom edge (`TaskEdge`,
   * `tasks.md`): a RAW being fetched for it, its original on its way. The
   * host names it — a picture's asset id, else its file identity.
   */
  scope?: string | null;
  /**
   * The picture's repair patches, drawn as rings that follow the zoom and the
   * pan: the destination solid, its source dashed, joined by a hair. Placed
   * in SOURCE coordinates, where the pass runs — under a warp they sit where
   * the pixels were, exactly as the subject marks do.
   */
  rings?: readonly RepairRing[] | null;
  /**
   * Given, a ring answers its own press: a drag on the destination MOVES the
   * patch (its source travelling with it), a drag on the dashed source moves
   * where it borrows from, a press on either selects it, and a TAP on the
   * solid ring takes the patch off — a click, the maintainer's preference
   * over a key, with a minus cursor over the ring saying so. The slop that
   * tells a tap from a drag is what keeps a move from throwing a patch away.
   */
  onRing?: RingGesture | null;
  /**
   * Spots the dust scan PROPOSES, drawn as dotted rings with a `+`: a
   * candidate is accepted with a tap (`onSpot`) and healed then, never
   * before. In source coordinates like the rings.
   */
  spots?: readonly SpotRing[] | null;
  onSpot?: (index: number) => void;
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
   * What the CAMERA did — `ƒ/1.7 · 1/240 · ISO 100 · +0.3 EV`
   * (`exif/exif-summary.ts`'s `captureLine`) — drawn at the TOP of the same
   * stack, above a hairline and marked down its edge with the accent.
   *
   * Two authorships in one corner is exactly the thing that had to be kept
   * apart: everything under the rule is this session's and changes on every
   * drag, the line above it is the file's own and can never be edited. Same
   * key (`I`), same chip, one mark saying which hand wrote it.
   */
  shot?: string | null;
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
  /**
   * Make what the zoomed view shows the crop. Given only while it would CHANGE
   * something (the host's `zoneFromView`), and drawn as one quiet pill in the
   * top-right corner — iOS Photos' own gesture: you zoom, the crop is offered,
   * nothing has to be found again on the Crop tab.
   */
  onCropToView?: () => void;
}) {
  const { view, source, problem, cube, holding, wipe, divider, handlers } = picture;
  const picking = Boolean(onPick && picture.picking && source);
  // The ring under the hand: which pointer, where it pressed, whether it has
  // travelled past the slop. One at a time — a second finger is the pinch's.
  const ringDrag = useRef<{ pointerId: number; x: number; y: number; travelled: boolean } | null>(null);
  const ringMoved = useRef<string | null>(null);
  // The ring being MOVED, once the press has travelled past the slop: its
  // cursor turns from the `−` a click would mean to a closed hand, and back
  // to the `−` on release — the hand is told what it is doing NOW.
  const [moving, setMoving] = useState<string | null>(null);
  const grab = (ring: RepairRing, part: RingPart) => (e: ReactPointerEvent<SVGElement>) => {
    if (!onRing) return;
    e.preventDefault();
    // Its OWN press, never the stage's: a press that reached the paint seam
    // would place a new patch under the one being taken hold of.
    e.stopPropagation();
    if (ringDrag.current) return;
    const at = picture.pointAt(e.clientX, e.clientY, true);
    if (!at) return;
    ringDrag.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, travelled: false };
    ringMoved.current = ring.id;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* not a live pointer */
    }
    onRing.onStart(ring.id, part, at);
  };
  const ringMove = (e: ReactPointerEvent<SVGElement>) => {
    const d = ringDrag.current;
    if (!d || d.pointerId !== e.pointerId || !onRing) return;
    e.stopPropagation();
    if (!d.travelled && Math.hypot(e.clientX - d.x, e.clientY - d.y) <= RING_SLOP) return;
    if (!d.travelled) setMoving(ringMoved.current);
    d.travelled = true;
    const at = picture.pointAt(e.clientX, e.clientY, true);
    if (at) onRing.onMove(at);
  };
  const ringRelease = (e: ReactPointerEvent<SVGElement>) => {
    const d = ringDrag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    e.stopPropagation();
    ringDrag.current = null;
    ringMoved.current = null;
    setMoving(null);
    onRing?.onEnd(d.travelled);
  };
  const ringHandlers = (ring: RepairRing, part: RingPart) =>
    onRing
      ? {
          onPointerDown: grab(ring, part),
          onPointerMove: ringMove,
          onPointerUp: ringRelease,
          onPointerCancel: ringRelease,
          // `data-ring` is what the zoom machine reads to leave the press
          // alone (`use-develop-picture.ts`, `wipeClaims`).
          'data-ring': part,
          style: {
            pointerEvents: 'all' as const,
            cursor: moving === ring.id ? 'grabbing' : part === 'patch' ? REMOVE_CURSOR : 'move',
          },
        }
      : {};
  // A tap-gesture mask tool is armed: the pointer ADDS a point, and the native
  // `copy` cursor is the browser's own `+` badge saying so.
  const tapping = !picking && picture.painting && picture.paintGesture === 'tap';
  return (
    <div
      ref={view.viewportRef}
      className={`relative min-h-0 bg-frame rounded-paper overflow-hidden touch-none select-none ${
        picking
          ? 'cursor-crosshair'
          : moving
            ? 'cursor-grabbing'
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
      {/* The veil: a map of the picture in the picture's place — the same
          box and transform as the stage canvas, its backing the same size,
          so `object-contain` letterboxes the two alike. Sized 0 when there
          is nothing to show (`use-develop-picture.ts`, «the veil»). */}
      <canvas
        ref={picture.veilCanvasRef}
        className="absolute inset-0 w-full h-full object-contain pointer-events-none"
        style={{
          transform: view.transform,
          transition: view.settling ? 'transform 220ms var(--ease-paper)' : undefined,
        }}
        aria-hidden="true"
      />
      {/* The top-right corner is a COLUMN: the crop verb first, so it never
          moves when the loupe's status comes and goes under it. */}
      {((onCropToView && !picking) || picture.loupe.active) && (
        <div className="absolute top-2 right-2.5 flex flex-col items-end gap-1">
          {onCropToView && !picking && (
            <button
              type="button"
              // Its OWN press: reaching the stage would start a pan under it.
              onPointerDown={(e) => e.stopPropagation()}
              onClick={onCropToView}
              className={`${developPillClass} gap-1.5 bg-surface/86 text-ink-soft cursor-pointer hover:border-accent hover:text-accent-ink`}
              title="Crop to this view — what the screen shows becomes the crop (⇧C)"
            >
              <span className="text-xs leading-none">{Icons.crop}</span>
              crop
            </button>
          )}
          {picture.loupe.active && (
            <span
              className={`${developPillClass} bg-surface/86 text-ink-soft`}
              role="status"
              title="Past the stage's own pixels the file is decoded whole and drawn at its own density"
            >
              {picture.loupe.state === 'decoding'
                ? 'loupe · decoding…'
                : picture.loupe.state === 'ready'
                  ? `loupe · ${picture.loupe.longEdge ?? ''} px`
                  : picture.loupe.state === 'same'
                    ? 'loupe · the file has no more'
                    : picture.loupe.state === 'capped'
                      ? 'loupe · as close as this device goes'
                      : picture.loupe.state === 'cancelled'
                      ? 'loupe · cancelled'
                      : 'loupe · could not decode'}
            </span>
          )}
        </div>
      )}
      {picture.comparing && (
        <div
          data-wipe-handle
          className="absolute w-7 -ml-3.5 cursor-col-resize group"
          style={{ left: divider.x, top: divider.top, height: Math.max(0, divider.bottom - divider.top) }}
          title="Drag to compare with the picture as shot"
          aria-hidden="true"
        >
          {wipe > 0 && (
            <span className="absolute inset-y-0 left-1/2 w-[1.5px] -ml-[0.75px] bg-on-media/90 pointer-events-none" />
          )}
          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 grid place-items-center w-6 h-6 rounded-full bg-surface/92 border border-line-strong text-ink-soft shadow-paper group-hover:border-accent group-hover:text-accent-ink pointer-events-none">
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
        <span className="absolute inset-0 grid place-items-center px-6 text-center font-mono text-2xs text-on-media">
          {problem}
        </span>
      )}
      {hasFile && !source && !problem && (
        <span className="absolute inset-0 grid place-items-center font-mono text-2xs text-muted">decoding…</span>
      )}
      {/* The passive surface: a hairline along the bottom for whatever is
          happening to THIS picture — the words and the Cancel are the pill's. */}
      {scope && <TaskEdge scope={scope} className="z-10" />}
      {picking && (
        <span
          className={`absolute top-2 left-2.5 ${developPillClass} bg-surface/92 text-accent-ink border-accent`}
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
              className={`absolute -translate-x-1/2 -translate-y-1/2 grid place-items-center w-5 h-5 rounded-full bg-surface/92 border border-line-strong text-ink-soft shadow-paper group ${
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
      {source && ((rings && rings.length > 0) || (spots && spots.length > 0)) && (
        <svg
          className="absolute inset-0 w-full h-full overflow-visible"
          style={{ pointerEvents: 'none' }}
          aria-hidden={!onRing && !onSpot}
        >
          {spots?.map((spot, i) => {
            const at = picture.stagePoint(spot.x, spot.y);
            if (!at || !at.inside) return null;
            const edge = picture.stagePoint(spot.x + spot.ru, spot.y);
            const r = edge ? Math.max(4, Math.hypot(edge.x - at.x, edge.y - at.y)) : 6;
            return (
              <g key={`spot-${spot.x},${spot.y}`}>
                <circle cx={at.x} cy={at.y} r={r} fill="none" stroke={RING_HALO} strokeWidth={2.5} />
                <circle cx={at.x} cy={at.y} r={r} fill="none" stroke={RING_INK} strokeWidth={1} strokeDasharray="1.5 2.5" />
                <path
                  d={`M${at.x - 3} ${at.y}h6M${at.x} ${at.y - 3}v6`}
                  stroke={RING_INK}
                  strokeWidth={1.2}
                  strokeLinecap="round"
                  opacity={0.9}
                />
                {onSpot && (
                  <circle
                    cx={at.x}
                    cy={at.y}
                    r={Math.max(r, RING_HIT)}
                    fill="rgba(251,248,241,0.001)"
                    style={{ pointerEvents: 'all', cursor: 'pointer' }}
                    // Its own press: reaching the stage would place a second
                    // patch under the heal this tap makes.
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onSpot(i);
                    }}
                  >
                    <title>Heal this spot</title>
                  </circle>
                )}
              </g>
            );
          })}
          {rings?.map((ring) => {
            const at = picture.stagePoint(ring.x, ring.y);
            if (!at) return null;
            // The radius in screen pixels: a point one radius to the right,
            // measured as a vector so a rotated framing keeps a circle a circle.
            const edge = picture.stagePoint(ring.x + ring.ru, ring.y);
            const r = edge ? Math.max(3, Math.hypot(edge.x - at.x, edge.y - at.y)) : 6;
            const from = picture.stagePoint(ring.sx, ring.sy);
            const ink = ring.kind === 'heal' ? RING_INK : CLONE_INK;
            const stroke = ring.selected ? 'var(--color-accent)' : ink;
            return (
              <g key={ring.id} className="group">
                {from && (
                  <>
                    <line x1={at.x} y1={at.y} x2={from.x} y2={from.y} stroke={stroke} strokeWidth={1} strokeDasharray="2 3" opacity={0.7} />
                    <circle cx={from.x} cy={from.y} r={r} fill="none" stroke={RING_HALO} strokeWidth={2.5} />
                    <circle
                      cx={from.x}
                      cy={from.y}
                      r={r}
                      fill="none"
                      stroke={stroke}
                      strokeWidth={ring.selected ? 1.6 : 1.2}
                      strokeDasharray="3 3"
                    />
                    <circle
                      cx={from.x}
                      cy={from.y}
                      r={Math.max(r, RING_HIT)}
                      fill="rgba(251,248,241,0.001)"
                      {...ringHandlers(ring, 'source')}
                    >
                      {onRing && <title>Drag to change where this patch borrows from · click to edit the patch</title>}
                    </circle>
                  </>
                )}
                <circle cx={at.x} cy={at.y} r={r} fill="none" stroke={RING_HALO} strokeWidth={3} />
                <circle cx={at.x} cy={at.y} r={r} fill="none" stroke={stroke} strokeWidth={ring.selected ? 2 : 1.4} />
                {ring.selected && <circle cx={at.x} cy={at.y} r={1.6} fill={stroke} />}
                {onRing && (
                  // The `−` the cursor also carries, drawn in the ring under
                  // the pointer: the ring says what the click will do, as the
                  // subject markers do.
                  <path
                    d={`M${at.x - 3.5} ${at.y}h7`}
                    stroke={stroke}
                    strokeWidth={1.8}
                    strokeLinecap="round"
                    className="opacity-0 transition-opacity group-hover:opacity-100"
                  />
                )}
                <circle cx={at.x} cy={at.y} r={Math.max(r, RING_HIT)} fill="rgba(251,248,241,0.001)" {...ringHandlers(ring, 'patch')}>
                  {onRing && <title>Click to take this patch off · drag to move it</title>}
                </circle>
              </g>
            );
          })}
        </svg>
      )}
      {(shot || (facts && facts.length > 0)) && source && (
        <div
          // Pointer-transparent: the facts sit ON the picture, and the picture
          // under them still answers a drag, a wipe and a paint stroke.
          className="absolute bottom-2 left-2.5 max-w-[60%] pointer-events-none flex flex-col items-start gap-0.5"
          role="status"
        >
          {shot && (
            <span className="font-mono text-2xs text-ink bg-surface/84 rounded-[0.25rem] border-l-2 border-accent pl-1.5 pr-1.5 py-0.5 leading-snug">
              {shot}
            </span>
          )}
          {shot && facts && facts.length > 0 && (
            // The rule only exists to separate two things: with one family on
            // the picture there is nothing to divide, and a floating hairline
            // over a photograph is noise.
            <span aria-hidden className="self-stretch h-px bg-surface/50 my-0.5" />
          )}
          {(facts ?? []).map((line) => (
            <span
              key={line}
              className="font-mono text-2xs text-ink-soft bg-surface/84 rounded-[0.25rem] px-1.5 py-0.5 leading-snug"
            >
              {line}
            </span>
          ))}
        </div>
      )}
      {source && cube && !picking && (
        <>
          <span className={`absolute top-2 left-2.5 ${developPillClass} bg-surface/86 text-ink-soft`}>
            {holding ? 'before' : wipe > 0 ? 'before · after' : 'after'}
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
            className={`absolute bottom-2 right-2.5 ${developPillClass} bg-surface/86 text-ink-soft cursor-pointer hover:border-accent`}
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
