import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CubeLut } from '../../shared/lib/cube-parser';
import { makeFrameGrader } from '../../shared/lut/frame-grader';
import { holdGrades, type HeldGrader } from '../../shared/lut/held-grader';
import { stageFrameSize } from '../../shared/overlay/stage-size';
import {
  DEFAULT_FRAMING,
  MAX_FRAMING_SCALE,
  canPan,
  panBy,
  type Framing,
} from '../../shared/media/framing';
import { cellAt, type CellRect } from '../../shared/media/media-layout';
import { draggedAssetId, hasAssetDrag } from '../../shared/library/asset-drag';
import { boxForId, hitTest, type ElementBox } from '../../shared/overlay/draw-overlays';
import {
  collageCellAt,
  resolveCollage,
  type CollageLead,
  type SlideCollage,
} from '../../shared/roadtrip/collage';
import type { OverlayElement } from '../../shared/overlay/overlay-types';
import type { StyleTheme } from '../../shared/overlay/title-styles';
import { moveBlock } from '../../shared/roadtrip/badge-layout';
import {
  MAX_PREVIEW_LONG_EDGE,
  PREVIEW_LONG_EDGE,
  boundSource,
  frameSize,
  loadBadgeSource,
  measureBadge,
  renderBadge,
  type BadgeSource,
  type CollageItem,
  type QrDraw,
  type RenderBadgeOptions,
} from '../../shared/roadtrip/badge-render';
import type { HookBlock, Shade } from '../../shared/roadtrip/shades';
import type { FrameRect, ResolvedHook } from '../../shared/roadtrip/hooks/hook-variant';
import { TRIM_EPSILON, type TrimRange } from '../../shared/media/trim';
import { clampPlaybackRate } from '../../shared/media/use-video-transport';
import { useIsCompact } from '../../shared/ui/use-layout-mode';

/**
 * Playing the open clip on the stage. The stage owns the `<video>` behind the
 * picture (it is the decoded source), so it is the only place playback can
 * be driven from; the caller owns the CLOCK — it receives the playhead every
 * animation frame and hands the badge's own time back down as `timeSeconds`.
 */
export interface StagePlayback {
  playing: boolean;
  /** The clip's speed, which is also the preview's rate. */
  rate: number;
  /** The stretch played: playback starts at `start` and stops on `end`. */
  range: TrimRange;
  /** Jump back to `start` on the out point instead of stopping there. */
  loop: boolean;
  /**
   * Which slide is playing. A new one starts its stretch over even when it is
   * the same file with the same cut — the piece moving on (or looping back)
   * from one such slide to the next changes nothing else this loop hears, and
   * the clip would sit paused on the out point where the last one stopped.
   */
  key?: string;
  /** The playhead, in source seconds, once per frame while playing. */
  onTime: (seconds: number) => void;
  /** Playback stopped on the out point. */
  onEnded: () => void;
}

/**
 * What the opener is selected as. It is not an overlay element, so it has no
 * element id — this one is reserved, parsed by nothing and understood by the
 * editor as "the opener", which is what switches the inspector to its tab.
 */
export const HOOK_ID = 'hook';

/** Whether a point in the canvas's own pixels is inside a reported rect. */
function inRect(rect: FrameRect | null | undefined, px: number, py: number): boolean {
  if (!rect) return false;
  return px >= rect.x && px <= rect.x + rect.width && py >= rect.y && py <= rect.y + rect.height;
}

interface BadgeStageProps {
  file: File | null;
  /**
   * Frame of a clip to sit on — the playhead, in source seconds; ignored for
   * photos. While `playback.playing` the element advances on its own and this
   * is only what the caller was last told, so it is not seeked to.
   */
  videoTimeSeconds: number;
  /** Play the clip; absent, the stage shows the one frame it was asked for. */
  playback?: StagePlayback | null;
  aspect: number;
  elements: OverlayElement[];
  theme: StyleTheme | null;
  /** Where the badge's own animations are up to, in seconds. */
  timeSeconds: number;
  /** Darkening over the picture, under the badge. */
  shades?: readonly Shade[];
  /** The badge block's extent, for a shade that follows the hook. */
  block?: HookBlock | null;
  /**
   * The piece's prepared opener, painted under the shades and the badge. The
   * stage passes the very object the PNG deck and the burned-in clip paint, so
   * what is composed here is what is delivered.
   */
  hook?: ResolvedHook | null;
  /** The badge's elements at a moment, when the opener rewrites its words. */
  elementsAt?: ((tSeconds: number) => OverlayElement[]) | null;
  /** Painted where no picture covers the frame — the closing card's ground. */
  background?: string;
  /** A QR square under the text. */
  qr?: QrDraw | null;
  /** The composed grade the picture goes through, or null for the picture as shot. */
  lut?: CubeLut | null;
  /** How the picture sits in the frame. */
  framing?: Framing | null;
  /**
   * Reframing the picture: dragging where no element sits pans it, the wheel
   * zooms. Absent, the picture is fixed and only the badge moves.
   */
  onFraming?: (framing: Framing) => void;
  /** The element outlined on the stage, and kept visible past its window. */
  selectedId?: string | null;
  /** A click on the stage: the element under the pointer, or null for the picture. */
  onSelect?: (id: string | null) => void;
  /**
   * A press on an element that never became a drag — a TAP, which is a request
   * to EDIT it. Selection happens on pointer down, since a block drag starts
   * from it, so it cannot be what raises a phone's inspector sheet: the sheet
   * would rise over the picture the moment a drag began.
   */
  onActivate?: (id: string) => void;
  /**
   * The badge block's anchor, when this slide has one to move. Dragging any
   * element moves the whole block; absent (a caption, the closing card) a
   * click selects and nothing moves.
   */
  blockAnchor?: { x: number; y: number } | null;
  onMoveBlock?: (x: number, y: number) => void;
  /**
   * Where the OPENER's own drawing sits (`HookVariant.frameBox`), asked for
   * at the stage's own pixel size. Given one, the opener is content like any
   * other: a press on it selects it (`onSelect(HOOK_ID)`) and a drag moves it.
   * The badge keeps first claim — an opener is placed once and a badge is
   * composed constantly — so this is only ever tested where no element sits.
   *
   * A function rather than a rect because only the stage knows how big its
   * canvas is, and a rect measured against another size would hit-test a
   * place the drawing is not.
   */
  hookRectFor?: ((frame: { width: number; height: number }) => FrameRect | null) | null;
  /** A drag of the opener: fractions of the frame, incremental. */
  onMoveHook?: (dx: number, dy: number) => void;
  /**
   * Several pictures in this slide's frame. `file`, `framing` and `lut` are
   * then its FIRST cell's; the others come through the three lists below, by
   * cell index (the lead first, so `collageFiles[0]` is ignored in favour of
   * `file`). Absent, the stage is the one-picture stage it always was.
   */
  collage?: SlideCollage | null;
  /** The file each drawn cell resolves to, the lead first. */
  collageFiles?: readonly (File | null)[];
  /** Each cell's cube (the slide's grade baked with that cell's develop), the lead first. */
  collageLuts?: readonly (CubeLut | null)[];
  /** The slide's screen time — what the cells' exit is laid against on the stage. */
  collageSeconds?: number | null;
  /** The cell the inspector is about; 0 is the lead. Outlined on the stage. */
  selectedCell?: number;
  onSelectCell?: (i: number) => void;
  /** Reframing cell `i`'s picture: a drag pans, the wheel zooms — at the CELL's size. */
  onCellFraming?: (i: number, framing: Framing) => void;
  /** A print dragged on a free layout: fractions of the frame, incremental. */
  onMoveCell?: (i: number, dx: number, dy: number) => void;
  /** Two cells' pictures exchanged — a hold, or an Alt-drag, onto another cell. */
  onSwapCells?: (a: number, b: number) => void;
  /**
   * A picture dragged out of the Library and dropped on a cell: its index
   * (0 without a collage — the slide's own picture) and the asset's id.
   * Absent, the stage takes no drops.
   */
  onDropAsset?: (cellIndex: number, assetId: string) => void;
  onSourceLoaded?: (info: { width: number; height: number; duration: number }) => void;
  /**
   * The width the picture wants from the height it was given (height ×
   * aspect), reported on every measure. The editor caps the stage column with
   * it so a portrait frame on a wide screen does not leave the slide rail
   * stranded a third of a screen away. Height-derived on purpose: the column's
   * height does not depend on its width, so capping the width cannot feed
   * back into the measurement.
   */
  onFit?: (widthPx: number) => void;
  /**
   * Fired after each successful paint, with the canvas that was just drawn.
   * Used to keep a thumbnail of the hook — the picture has to be taken here,
   * because this is the only place it already exists.
   */
  onRendered?: (canvas: HTMLCanvasElement) => void;
}

/**
 * The badge over its picture, drawn through exactly the code the PNG export
 * uses — only the canvas is smaller. Anything that made the preview a separate
 * approximation would put the author's eye and the delivered file at odds.
 *
 * Pointing at a piece selects it and dragging moves the block. The selection
 * outline is drawn on a SECOND canvas laid over the first: the paint below
 * stays the export's own, so neither the thumbnail taken from it nor any
 * future consumer can grow a dashed rectangle.
 */
export default function BadgeStage({
  file,
  videoTimeSeconds,
  playback = null,
  aspect,
  elements,
  theme,
  timeSeconds,
  shades,
  block,
  hook = null,
  elementsAt = null,
  background,
  qr,
  lut = null,
  framing = null,
  onFraming,
  selectedId = null,
  onSelect,
  onActivate,
  blockAnchor = null,
  onMoveBlock,
  hookRectFor = null,
  onMoveHook,
  collage = null,
  collageFiles,
  collageLuts,
  collageSeconds = null,
  selectedCell = 0,
  onSelectCell,
  onCellFraming,
  onMoveCell,
  onSwapCells,
  onDropAsset,
  onSourceLoaded,
  onRendered,
  onFit,
}: BadgeStageProps) {
  // Whether anything else is competing for this screen's height — see the
  // wrapper's comment below.
  const compactShell = useIsCompact();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chromeRef = useRef<HTMLCanvasElement>(null);
  const sourceRef = useRef<BadgeSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Held in a ref so a caller passing a fresh closure cannot re-run the paint.
  const onRenderedRef = useRef(onRendered);
  onRenderedRef.current = onRendered;

  // Decode the picture. ONLY when the file changes: moving a clip's frame
  // seeks the element that is already open (below). Re-decoding per nudge —
  // a new element and a new object URL each time — is what made choosing a
  // hook frame stutter and flash "decoding…" the whole way across.
  useEffect(() => {
    let cancelled = false;
    sourceRef.current?.release();
    sourceRef.current = null;
    setError(null);

    // No picture: the paint effect below already draws the empty frame with
    // its badge, at the right size. This branch used to paint too — into a
    // canvas it never sized — and its font wait landed AFTER the resize, so a
    // miniature badge stayed burnt into the corner of the stage.
    if (!file) return;

    setLoading(true);
    void loadBadgeSource(file, videoTimeSeconds)
      .then(async (decoded) => {
        if (cancelled) {
          decoded.release();
          return;
        }
        // The FILE's size is what the editor is told — the exports size their
        // variants from it — while the stage keeps a still within its pixel
        // budget: framing only reads the aspect, and grading 48 MP is what
        // made every drag over a graded still crawl.
        const natural = {
          width: decoded.width,
          height: decoded.height,
          duration: 'duration' in decoded.image ? (decoded.image.duration ?? 0) : 0,
        };
        const source = await boundSource(decoded);
        if (cancelled) {
          source.release();
          return;
        }
        sourceRef.current = source;
        onSourceLoaded?.(natural);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // `elements`/`theme` deliberately absent: they drive the paint below, not
    // the decode. `videoTimeSeconds` likewise — see the seek effect.
  }, [file]);

  // The collage's OTHER cells, decoded within the stage's pixel budget like
  // the lead, and released together. Keyed on the files' identities: a cell
  // whose file did not change is not re-decoded when another cell's does.
  const cellSourcesRef = useRef<(BadgeSource | null)[]>([]);
  const [cellSeq, setCellSeq] = useState(0);
  const cellFileKey = collage
    ? (collageFiles ?? []).map((f) => (f ? `${f.name}|${f.size}|${f.lastModified}` : '')).join('\u0001')
    : '';
  useEffect(() => {
    let cancelled = false;
    const files = collage ? (collageFiles ?? []) : [];
    const previous = cellSourcesRef.current;
    const previousFiles = previousFilesRef.current;
    const next: (BadgeSource | null)[] = files.map(() => null);
    // Keep what already matches, release the rest.
    files.forEach((f, i) => {
      if (i > 0 && f && previousFiles[i] === f && previous[i]) next[i] = previous[i];
    });
    previous.forEach((src, i) => {
      if (src && next[i] !== src) src.release();
    });
    cellSourcesRef.current = next;
    previousFilesRef.current = files.slice();
    const pending = files.map((f, i) => (i > 0 && f && !next[i] ? i : -1)).filter((i) => i >= 0);
    if (pending.length === 0) {
      setCellSeq((n) => n + 1);
      return;
    }
    void Promise.all(
      pending.map(async (i) => {
        const f = files[i];
        if (!f) return;
        try {
          const decoded = await loadBadgeSource(f, 0);
          if (cancelled) {
            decoded.release();
            return;
          }
          const source = await boundSource(decoded);
          if (cancelled || cellSourcesRef.current !== next) {
            source.release();
            return;
          }
          next[i] = source;
        } catch {
          // A cell that cannot be decoded is an empty cell, never a failed stage.
        }
      }),
    ).then(() => {
      if (!cancelled) setCellSeq((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
    // The files' IDENTITIES are the dependency, not the array the caller built.
  }, [cellFileKey]);
  const previousFilesRef = useRef<readonly (File | null)[]>([]);
  useEffect(
    () => () => {
      for (const src of cellSourcesRef.current) src?.release();
      cellSourcesRef.current = [];
    },
    [],
  );

  // Move the open clip to the asked-for moment, then repaint. `frameSeq` is
  // what makes the paint wait for the frame: painting on `videoTimeSeconds`
  // alone would draw the OLD frame, since the seek has not landed yet.
  const [frameSeq, setFrameSeq] = useState(0);
  // The playback callbacks through a ref: the loop below must not be torn
  // down and restarted because the caller passed a fresh closure.
  const playbackRef = useRef(playback);
  playbackRef.current = playback;
  const playing = Boolean(playback?.playing);
  useEffect(() => {
    const source = sourceRef.current;
    if (!source?.seek || loading) return;
    // While the clip plays, `videoTimeSeconds` is the playhead the loop
    // itself reported a frame ago: seeking to it would drag the element
    // backwards a few milliseconds on every frame and stutter the picture.
    if (playbackRef.current?.playing) return;
    let cancelled = false;
    void source
      .seek(videoTimeSeconds)
      .then(() => {
        if (!cancelled) setFrameSeq((n) => n + 1);
      })
      .catch(() => {
        /* a seek that fails leaves the last good frame on screen */
      });
    return () => {
      cancelled = true;
    };
  }, [videoTimeSeconds, loading]);

  // Play the clip. The element advances by itself; a rAF loop reports the
  // playhead to the caller and bumps `frameSeq` so the paint below draws
  // every frame — the caller's `timeSeconds` alone would not, since a
  // content slide's badge time never moves. The out point is watched on the
  // same loop rather than on `timeupdate`, which fires ~4×/s and would let
  // playback run a quarter of a second past the handle.
  useEffect(() => {
    const source = sourceRef.current;
    const v = source?.image;
    const pb = playbackRef.current;
    if (!pb?.playing || loading || !(v instanceof HTMLVideoElement)) return;
    const { start, end } = pb.range;
    v.playbackRate = clampPlaybackRate(pb.rate);
    // Pressing play on (or outside) the out point means replay the stretch.
    if (v.currentTime < start || v.currentTime >= end - TRIM_EPSILON) v.currentTime = start;
    // Muted and started by the author's own press, so the browser allows it;
    // a refusal leaves the frame where it is.
    void v.play().catch(() => {});
    let raf = 0;
    const tick = () => {
      const now = playbackRef.current;
      if (v.currentTime >= end - TRIM_EPSILON) {
        if (now?.loop) {
          v.currentTime = start;
        } else {
          v.pause();
          // Land exactly on the handle, so the next press is unambiguously
          // "at the out point" and replays from the in point.
          v.currentTime = end;
          now?.onTime(end);
          setFrameSeq((n) => n + 1);
          now?.onEnded();
          return;
        }
      }
      now?.onTime(v.currentTime);
      setFrameSeq((n) => n + 1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      v.pause();
    };
    // The loop restarts when the slide, the stretch, the rate or the loop flag
    // change under it; the callbacks are read through the ref.
  }, [
    playing,
    playback?.key,
    playback?.rate,
    playback?.range.start,
    playback?.range.end,
    playback?.loop,
    loading,
  ]);

  // The hit boxes of the last paint, measured with the very options it used.
  // Read by the pointer handlers and by the outline; refreshed by every paint.
  const boxesRef = useRef<ElementBox[]>([]);
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const hookRectForRef = useRef(hookRectFor);
  hookRectForRef.current = hookRectFor;
  /** The opener's rect at the canvas's CURRENT size, or null. */
  const hookRectNow = useCallback((): FrameRect | null => {
    const canvas = canvasRef.current;
    if (!canvas || !hookRectForRef.current) return null;
    return hookRectForRef.current({ width: canvas.width, height: canvas.height });
  }, []);

  /** The collage's cells at the canvas's current size, from the last paint. */
  const cellRectsRef = useRef<CellRect[]>([]);
  const selectedCellRef = useRef(selectedCell);
  selectedCellRef.current = selectedCell;
  const collageRef = useRef(collage);
  collageRef.current = collage;

  /** The dashed outline around the selected element, on the chrome canvas. */
  const drawChrome = useCallback(() => {
    const chrome = chromeRef.current;
    const canvas = canvasRef.current;
    if (!chrome || !canvas) return;
    if (chrome.width !== canvas.width || chrome.height !== canvas.height) {
      chrome.width = canvas.width;
      chrome.height = canvas.height;
    }
    const ctx = chrome.getContext('2d');
    if (!ctx) return;
    const { width: w, height: h } = chrome;
    ctx.clearRect(0, 0, w, h);
    // The collage's cells: a number on each, a slot where one is empty, the
    // selected one outlined. Editor chrome only — the paint under it is what
    // the thumbnail and the export see.
    // A picture hovering over the frame with no collage: the whole frame is
    // the target, so it is outlined as one.
    if (!collageRef.current && dropCellRef.current !== null) {
      ctx.save();
      ctx.strokeStyle = '#d9442a';
      ctx.lineWidth = Math.max(2, Math.min(w, h) * 0.006);
      ctx.strokeRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(217,68,42,0.16)';
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
    if (collageRef.current) {
      const short = Math.min(w, h);
      const lead = sourceRef.current;
      cellRectsRef.current.forEach((c, i) => {
        const has = i === 0 ? Boolean(lead) : Boolean(cellSourcesRef.current[i]);
        const isSel = i === selectedCellRef.current && !selectedRef.current;
        const isDrop = i === dropCellRef.current;
        ctx.save();
        ctx.translate(c.x + c.w / 2, c.y + c.h / 2);
        if (c.rotation) ctx.rotate((c.rotation * Math.PI) / 180);
        if (!has) {
          ctx.fillStyle = 'rgba(147,139,124,0.16)';
          ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
          ctx.setLineDash([short * 0.012, short * 0.01]);
          ctx.strokeStyle = 'rgba(182,173,156,0.85)';
          ctx.lineWidth = Math.max(1, short * 0.003);
          ctx.strokeRect(-c.w / 2 + short * 0.006, -c.h / 2 + short * 0.006, c.w - short * 0.012, c.h - short * 0.012);
          ctx.setLineDash([]);
          const u = Math.min(c.w, c.h) * 0.14;
          ctx.strokeStyle = 'rgba(182,173,156,0.95)';
          ctx.lineWidth = Math.max(1.2, u * 0.08);
          ctx.beginPath();
          ctx.moveTo(-u * 0.8, u * 0.5);
          ctx.lineTo(-u * 0.2, -u * 0.15);
          ctx.lineTo(u * 0.2, u * 0.25);
          ctx.lineTo(u * 0.45, 0);
          ctx.lineTo(u * 0.8, u * 0.5);
          ctx.stroke();
        }
        if (isDrop) {
          // The cell a drop would land in: filled, not merely outlined — with
          // six cells an outline alone reads as the selection.
          ctx.fillStyle = 'rgba(217,68,42,0.22)';
          ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
        }
        if (isSel || isDrop) {
          ctx.strokeStyle = '#d9442a';
          ctx.lineWidth = Math.max(2, short * (isDrop ? 0.006 : 0.005));
          ctx.strokeRect(-c.w / 2, -c.h / 2, c.w, c.h);
        }
        const r = Math.max(9, short * 0.026);
        ctx.fillStyle = isSel ? '#d9442a' : 'rgba(16,15,13,0.66)';
        ctx.beginPath();
        ctx.arc(-c.w / 2 + r * 1.3, -c.h / 2 + r * 1.3, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = `600 ${r * 1.05}px 'JetBrains Mono', ui-monospace, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1), -c.w / 2 + r * 1.3, -c.h / 2 + r * 1.35);
        ctx.restore();
      });
    }
    const sel = selectedRef.current;
    if (!sel) return;
    // The opener is outlined from the rect the variant reports, elements from
    // the boxes the last paint measured. Same dashes either way: a selection
    // reads the same whatever kind of thing is selected.
    const rect = sel === HOOK_ID ? hookRectNow() : null;
    const box = rect
      ? { x: rect.x, y: rect.y, w: rect.width, h: rect.height }
      : boxForId(boxesRef.current, sel);
    if (!box) return;
    ctx.save();
    ctx.strokeStyle = '#d9442a';
    ctx.lineWidth = Math.max(1.5, h * 0.003);
    ctx.setLineDash([h * 0.012, h * 0.012]);
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    ctx.restore();
  }, [hookRectNow]);

  // One grader, kept across repaints and re-made only when the LUT or the
  // source's pixel size changes. A grader is a WebGL2 context; making one per
  // paint would build and lose a context on every frame of the transport, and
  // contexts are only reclaimed on GC or a forced loss.
  //
  // It HOLDS its grades: a drag repaints the stage on every step, and the
  // picture under it has not changed, so it is graded once and drawn many
  // times (`held-grader.ts`). A clip over the pixel budget is graded into a
  // budget-sized canvas — its element cannot be resampled ahead of the GPU.
  const graderRef = useRef<{ lut: CubeLut; w: number; h: number; grader: HeldGrader } | null>(
    null,
  );
  const graderFor = useCallback((source: BadgeSource | null): HeldGrader | null => {
    const cur = graderRef.current;
    if (!lut || !source || source.width <= 0) {
      cur?.grader.dispose();
      graderRef.current = null;
      return null;
    }
    if (cur && cur.lut === lut && cur.w === source.width && cur.h === source.height) {
      return cur.grader;
    }
    cur?.grader.dispose();
    const size = stageFrameSize(source.width, source.height);
    const grader = holdGrades(makeFrameGrader(lut, size.w, size.h));
    graderRef.current = { lut, w: source.width, h: source.height, grader };
    return grader;
  }, [lut]);
  // One held grader per collage cell, keyed on its cube and its source size —
  // the lead's is `graderFor` above. Disposed with the stage.
  const cellGradersRef = useRef<Map<number, { lut: CubeLut; w: number; h: number; grader: HeldGrader }>>(
    new Map(),
  );
  const cellGraderFor = useCallback(
    (i: number, source: BadgeSource | null, cellLut: CubeLut | null): HeldGrader | null => {
      const cur = cellGradersRef.current.get(i);
      if (!cellLut || !source || source.width <= 0) {
        cur?.grader.dispose();
        cellGradersRef.current.delete(i);
        return null;
      }
      if (cur && cur.lut === cellLut && cur.w === source.width && cur.h === source.height) {
        return cur.grader;
      }
      cur?.grader.dispose();
      const size = stageFrameSize(source.width, source.height);
      const grader = holdGrades(makeFrameGrader(cellLut, size.w, size.h));
      cellGradersRef.current.set(i, { lut: cellLut, w: source.width, h: source.height, grader });
      return grader;
    },
    [],
  );
  useEffect(
    () => () => {
      for (const entry of cellGradersRef.current.values()) entry.grader.dispose();
      cellGradersRef.current.clear();
    },
    [],
  );

  // The frame the held grade was taken from. A clip's element is the same
  // object whatever frame it shows, so every frame the stage is told about
  // (`frameSeq`: a seek landing, a playback tick) is a new picture to grade.
  const gradedSeqRef = useRef(-1);
  useEffect(
    () => () => {
      graderRef.current?.grader.dispose();
      graderRef.current = null;
    },
    [],
  );

  // The picture's box is measured, not styled: the largest box of the
  // frame's aspect that fits the wrapper, set in CSS pixels on the box that
  // holds both canvases. A canvas is a replaced element and never displays
  // past its bitmap, and CSS aspect-ratio cannot transfer a max-constraint
  // back onto a definite axis — so neither could fill the height on its own.
  // The bitmap then follows the displayed size at the device's pixel ratio
  // (floored at PREVIEW_LONG_EDGE, capped so a 5K screen does not repaint a
  // 4K canvas per animation frame), so a bigger preview is sharp, not scaled.
  // Read through a ref: the fit callback must not re-run the observer.
  const onFitRef = useRef(onFit);
  onFitRef.current = onFit;
  const boxRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [longEdge, setLongEdge] = useState(PREVIEW_LONG_EDGE);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    const box = boxRef.current;
    if (!frame || !box) return;
    const fit = () => {
      // The wrapper's client size, not its bounding rect: the content box is
      // the room the picture really has.
      const width = frame.clientWidth;
      const height = frame.clientHeight;
      if (width <= 0 || height <= 0) return;
      onFitRef.current?.(height * aspect);
      const w = Math.min(width, height * aspect);
      const h = w / aspect;
      box.style.width = `${w}px`;
      box.style.height = `${h}px`;
      const dpr = window.devicePixelRatio || 1;
      setLongEdge(
        Math.min(MAX_PREVIEW_LONG_EDGE, Math.max(PREVIEW_LONG_EDGE, Math.round(Math.max(w, h) * dpr))),
      );
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(frame);
    return () => ro.disconnect();
  }, [aspect]);

  // Paint. Runs on every change of anything drawn, including after a decode.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { w, h } = frameSize(aspect, longEdge);
    canvas.width = w;
    canvas.height = h;
    const grader = graderFor(sourceRef.current);
    if (grader && gradedSeqRef.current !== frameSeq) {
      grader.invalidate();
      gradedSeqRef.current = frameSeq;
    }
    let collageRender: RenderBadgeOptions['collage'] = null;
    if (collage) {
      const rects = resolveCollage(collage, w, h);
      cellRectsRef.current = rects;
      const lead: CollageLead = {
        media: null,
        framing: framing ?? DEFAULT_FRAMING,
        develop: null,
      };
      const items: CollageItem[] = rects.map((_, i) => {
        const source = i === 0 ? sourceRef.current : (cellSourcesRef.current[i] ?? null);
        const cellLut = i === 0 ? lut : (collageLuts?.[i] ?? null);
        return {
          source,
          framing: collageCellAt(lead, collage, i).framing,
          grader: i === 0 ? grader : cellGraderFor(i, source, cellLut),
        };
      });
      collageRender = { collage, items, seconds: collageSeconds };
    } else {
      cellRectsRef.current = [];
    }
    const opts: RenderBadgeOptions = {
      source: sourceRef.current,
      elements,
      theme,
      timeSeconds,
      shades,
      block,
      background,
      qr,
      framing,
      hook,
      elementsAt,
      grader,
      collage: collageRender,
      ghostId: selectedId,
    };
    void renderBadge(canvas, opts).then(() => {
      // The thumbnail is taken from the paint alone — the outline lives on
      // the other canvas, so the order here is not what keeps it out.
      onRenderedRef.current?.(canvas);
      const ctx = canvas.getContext('2d');
      boxesRef.current = ctx ? measureBadge(ctx, canvas.width, canvas.height, opts) : [];
      const src = sourceRef.current;
      setPannable(
        !!src &&
          canPan(src.width, src.height, canvas.width, canvas.height, framing ?? DEFAULT_FRAMING),
      );
      drawChrome();
    });
  }, [
    aspect,
    elements,
    theme,
    timeSeconds,
    shades,
    block,
    background,
    qr,
    framing,
    hook,
    elementsAt,
    selectedId,
    loading,
    file,
    frameSeq,
    longEdge,
    drawChrome,
    graderFor,
    collage,
    collageLuts,
    collageSeconds,
    cellGraderFor,
    cellSeq,
    lut,
    selectedCell,
  ]);

  useEffect(() => () => sourceRef.current?.release(), []);

  // --- pointing at the badge -------------------------------------------------
  const [hovering, setHovering] = useState(false);
  /** Whether the picture has any room to be dragged at its current framing. */
  const [pannable, setPannable] = useState(false);
  const framingRef = useRef(framing);
  framingRef.current = framing;
  const onFramingRef = useRef(onFraming);
  onFramingRef.current = onFraming;
  const onCellFramingRef = useRef(onCellFraming);
  onCellFramingRef.current = onCellFraming;
  /** Cell `i`'s framing as the document has it right now — the lead's is `framing`. */
  const cellFramingAt = useCallback((i: number): Framing => {
    const c = collageRef.current;
    if (i === 0 || !c) return framingRef.current ?? DEFAULT_FRAMING;
    return c.cells[i - 1]?.framing ?? DEFAULT_FRAMING;
  }, []);

  /**
   * Zooming the picture INSIDE its frame with the wheel. Attached natively and
   * NOT passively: React's own wheel handler is passive, so `preventDefault`
   * there is ignored and the page scrolls away under the picture you are
   * trying to frame.
   *
   * A ctrl/⌘-wheel — which is also what a trackpad pinch sends — frames the
   * picture too. The stage has no view zoom to hand it to: the preview simply
   * fills the room it is given, so every zoom gesture over it means the one
   * thing the document remembers.
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !onFraming) return;
    const onWheel = (e: WheelEvent) => {
      const c = collageRef.current;
      if (c && onCellFramingRef.current) {
        const rect = canvas.getBoundingClientRect();
        const px = (e.clientX - rect.left) * (canvas.width / rect.width);
        const py = (e.clientY - rect.top) * (canvas.height / rect.height);
        const i = cellAt(cellRectsRef.current, px, py);
        if (i < 0) return;
        const src = i === 0 ? sourceRef.current : cellSourcesRef.current[i];
        if (!src) return;
        e.preventDefault();
        const cf = cellFramingAt(i);
        const scale = Math.min(MAX_FRAMING_SCALE, Math.max(1, cf.scale * Math.exp(-e.deltaY / 400)));
        if (scale !== cf.scale) onCellFramingRef.current(i, { ...cf, scale });
        return;
      }
      const source = sourceRef.current;
      if (!source) return;
      e.preventDefault();
      const f = framingRef.current ?? DEFAULT_FRAMING;
      const scale = Math.min(
        MAX_FRAMING_SCALE,
        Math.max(1, f.scale * Math.exp(-e.deltaY / 400)),
      );
      if (scale === f.scale) return;
      onFramingRef.current?.({ ...f, scale });
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [onFraming, cellFramingAt]);
  // Where a press landed, in CSS pixels, and on what — so a release can tell
  // a tap from a drag.
  const press = useRef<{ id: string; x: number; y: number } | null>(null);
  const drag = useRef<
    | {
        kind: 'block';
        startPx: number;
        startPy: number;
        start: { x: number; y: number };
        moved: boolean;
      }
    | { kind: 'picture'; lastPx: number; lastPy: number }
    | { kind: 'hook'; lastPx: number; lastPy: number }
    | {
        kind: 'cell';
        i: number;
        startPx: number;
        startPy: number;
        lastPx: number;
        lastPy: number;
        /** What the drag became: nothing yet, a reframe, a print moving, or a swap. */
        mode: 'pending' | 'pan' | 'move' | 'swap';
        /** The cell under the pointer while swapping. */
        over: number;
        shift: boolean;
        timer: number;
      }
    | null
  >(null);

  /** A point in the canvas's own pixel space, from any pointer-ish event. */
  const toCanvasPoint = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      px: (clientX - rect.left) * (canvas.width / rect.width),
      py: (clientY - rect.top) * (canvas.height / rect.height),
    };
  }, []);

  /** A pointer event in the canvas's own pixel space. */
  const toPixels = useCallback((e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      px: (e.clientX - rect.left) * (canvas.width / rect.width),
      py: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!onSelect || e.button !== 0) return;
      const pt = toPixels(e);
      if (!pt) return;
      // Cancelling the pointerdown cancels the mousedown behind it, whose
      // default action is to move focus — onto the body, away from the field
      // the selection is about to focus.
      e.preventDefault();
      const id = hitTest(boxesRef.current, pt.px, pt.py);
      if (id) {
        onSelect(id);
        press.current = { id, x: e.clientX, y: e.clientY };
        if (blockAnchor && onMoveBlock) {
          drag.current = {
            kind: 'block',
            startPx: pt.px,
            startPy: pt.py,
            start: blockAnchor,
            moved: false,
          };
          canvasRef.current?.setPointerCapture(e.pointerId);
        }
        return;
      }
      // No element here, so the opener gets its turn: it is content too, and
      // the badge keeping first claim is the only reason it is second.
      if (inRect(hookRectNow(), pt.px, pt.py)) {
        onSelect(HOOK_ID);
        press.current = { id: HOOK_ID, x: e.clientX, y: e.clientY };
        if (onMoveHook) {
          drag.current = { kind: 'hook', lastPx: pt.px, lastPy: pt.py };
          canvasRef.current?.setPointerCapture(e.pointerId);
        }
        return;
      }
      onSelect(null);
      press.current = null;
      // A collage: the cell under the pointer is what the press is about. A
      // hold becomes a swap; moving becomes a reframe (or, on a free layout,
      // moving the print itself).
      if (collageRef.current) {
        const i = cellAt(cellRectsRef.current, pt.px, pt.py);
        if (i < 0) return;
        onSelectCell?.(i);
        const d = {
          kind: 'cell' as const,
          i,
          startPx: pt.px,
          startPy: pt.py,
          lastPx: pt.px,
          lastPy: pt.py,
          mode: e.altKey && onSwapCells ? ('swap' as const) : ('pending' as const),
          over: i,
          shift: e.shiftKey,
          timer: 0,
        };
        if (onSwapCells) {
          d.timer = window.setTimeout(() => {
            if (drag.current === d && d.mode === 'pending') {
              d.mode = 'swap';
              setSwapping(true);
            }
          }, 420);
        }
        drag.current = d;
        if (d.mode === 'swap') setSwapping(true);
        canvasRef.current?.setPointerCapture(e.pointerId);
        return;
      }
      // Nothing under the pointer at all: the gesture is about the PICTURE.
      if (onFraming) {
        drag.current = { kind: 'picture', lastPx: pt.px, lastPy: pt.py };
        canvasRef.current?.setPointerCapture(e.pointerId);
      }
    },
    [onSelect, blockAnchor, onMoveBlock, hookRectNow, onMoveHook, onFraming, toPixels, onSelectCell, onSwapCells],
  );
  /** A swap is under way: the cursor says so. */
  const [swapping, setSwapping] = useState(false);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const canvas = canvasRef.current;
      const pt = toPixels(e);
      if (!canvas || !pt) return;
      const d = drag.current;
      if (!d) {
        if (onSelect) {
          setHovering(
            hitTest(boxesRef.current, pt.px, pt.py) !== null || inRect(hookRectNow(), pt.px, pt.py),
          );
        }
        return;
      }
      if (d.kind === 'cell') {
        const dpr = canvas.width / canvas.getBoundingClientRect().width;
        if (d.mode === 'pending' && Math.hypot(pt.px - d.startPx, pt.py - d.startPy) > 6 * dpr) {
          window.clearTimeout(d.timer);
          const free = cellRectsRef.current[d.i]?.mount === 'print';
          d.mode = free && !d.shift && onMoveCell ? 'move' : 'pan';
        }
        if (d.mode === 'swap') {
          d.over = cellAt(cellRectsRef.current, pt.px, pt.py);
        } else if (d.mode === 'move') {
          onMoveCell?.(d.i, (pt.px - d.lastPx) / canvas.width, (pt.py - d.lastPy) / canvas.height);
        } else if (d.mode === 'pan') {
          const cell = cellRectsRef.current[d.i];
          const src = d.i === 0 ? sourceRef.current : cellSourcesRef.current[d.i];
          if (cell && src && onCellFraming) {
            // The delta in the CELL's own axes (a print may be turned), then
            // `panBy` at the cell's size: the pan is a fraction of the cell's
            // long edge, so it holds at any export size.
            const a = (-cell.rotation * Math.PI) / 180;
            const mx = pt.px - d.lastPx;
            const my = pt.py - d.lastPy;
            const lx = mx * Math.cos(a) - my * Math.sin(a);
            const ly = mx * Math.sin(a) + my * Math.cos(a);
            onCellFraming(
              d.i,
              panBy(cellFramingAt(d.i), src.width, src.height, cell.w, cell.h, lx, ly),
            );
          }
        }
        d.lastPx = pt.px;
        d.lastPy = pt.py;
        return;
      }
      if (d.kind === 'hook') {
        // Incremental, in fractions of the frame: the variant clamps, and no
        // start state can go stale under a re-render mid-drag.
        onMoveHook?.((pt.px - d.lastPx) / canvas.width, (pt.py - d.lastPy) / canvas.height);
        d.lastPx = pt.px;
        d.lastPy = pt.py;
        return;
      }
      if (d.kind === 'picture') {
        const source = sourceRef.current;
        if (!source || !onFraming) return;
        // Deltas are in the canvas's own pixels, which IS the output frame —
        // `panBy` turns them into the picture's axes and clamps them, so no
        // drag can ever open a gap at the edge.
        onFraming(
          panBy(
            framing ?? DEFAULT_FRAMING,
            source.width,
            source.height,
            canvas.width,
            canvas.height,
            pt.px - d.lastPx,
            pt.py - d.lastPy,
          ),
        );
        d.lastPx = pt.px;
        d.lastPy = pt.py;
        return;
      }
      d.moved = true;
      const next = moveBlock(
        d.start,
        (pt.px - d.startPx) / canvas.width,
        (pt.py - d.startPy) / canvas.height,
        !e.altKey,
      );
      onMoveBlock?.(next.x, next.y);
    },
    [onSelect, onMoveBlock, onMoveHook, hookRectNow, onFraming, framing, toPixels, onMoveCell, onCellFraming, cellFramingAt],
  );

  /**
   * A picture dragged out of the Library. The cell under the pointer lights up
   * while it hovers — a drop has to say WHERE it will land, or it is a guess —
   * and dropping writes that cell. Without a collage the whole frame is cell 0,
   * so the same gesture replaces the slide's own picture.
   */
  const [dropCell, setDropCell] = useState<number | null>(null);
  const dropCellRef = useRef<number | null>(null);
  dropCellRef.current = dropCell;

  const cellUnder = useCallback(
    (e: React.DragEvent): number => {
      const pt = toCanvasPoint(e.clientX, e.clientY);
      if (!pt) return 0;
      if (!cellRectsRef.current.length) return 0;
      const i = cellAt(cellRectsRef.current, pt.px, pt.py);
      return i < 0 ? -1 : i;
    },
    [toCanvasPoint],
  );

  const onDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!onDropAsset || !hasAssetDrag(e.dataTransfer)) return;
      // Without this the browser refuses the drop and animates the picture
      // back to the sidebar.
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      const i = cellUnder(e);
      setDropCell(i < 0 ? null : i);
    },
    [onDropAsset, cellUnder],
  );

  const onDragLeave = useCallback(() => setDropCell(null), []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      if (!onDropAsset || !hasAssetDrag(e.dataTransfer)) return;
      e.preventDefault();
      const id = draggedAssetId(e.dataTransfer);
      const i = cellUnder(e);
      setDropCell(null);
      if (id && i >= 0) onDropAsset(i, id);
    },
    [onDropAsset, cellUnder],
  );

  // The highlight lives on the chrome canvas, which only repaints when asked.
  useEffect(() => {
    drawChrome();
  }, [dropCell, drawChrome]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const p = press.current;
    press.current = null;
    const d = drag.current;
    if (d?.kind === 'cell') {
      window.clearTimeout(d.timer);
      if (d.mode === 'swap' && d.over >= 0 && d.over !== d.i) {
        onSwapCellsRef.current?.(d.i, d.over);
        onSelectCellRef.current?.(d.over);
      }
      setSwapping(false);
    }
    // 4px, the threshold every other press-or-drag surface in the suite uses.
    if (p && Math.abs(e.clientX - p.x) <= 4 && Math.abs(e.clientY - p.y) <= 4) {
      onActivate?.(p.id);
    }
    if (drag.current) {
      try {
        canvasRef.current?.releasePointerCapture(e.pointerId);
      } catch {
        // capture may already be gone; ignore
      }
    }
    drag.current = null;
  }, [onActivate]);

  const onSwapCellsRef = useRef(onSwapCells);
  onSwapCellsRef.current = onSwapCells;
  const onSelectCellRef = useRef(onSelectCell);
  onSelectCellRef.current = onSelectCell;

  const cursor = !onSelect
    ? ''
    : swapping
      ? 'cursor-copy'
      : collage
        ? 'cursor-grab active:cursor-grabbing'
        : hovering
      ? blockAnchor
        ? 'cursor-grab active:cursor-grabbing'
        : 'cursor-pointer'
      : onFraming && pannable
        ? 'cursor-grab active:cursor-grabbing'
        : 'cursor-default';

  return (
    // The wrapper decides how much room there is; the box inside takes the
    // largest aspect-fitting slice of it (measured above). Wide: the wrapper
    // grows to the column's whole height.
    //
    // Stacked, it depends on the shell's height model. On a compact shell the
    // wrapper HUGS the picture: it is an aspect box the width of the column,
    // free to shrink when the column is shorter than that, so its height is
    // the picture's own height in both cases. That is what puts the transport
    // under the frame it drives instead of at the foot of the screen — a
    // `flex-1` wrapper is taller than a width-bound picture, and the slack it
    // swallowed read as a gap above the controls and no gap at all below them.
    // The leftover now falls under the whole group, where it is breathing
    // room. Everywhere else stacked (a tablet, where the inspector is still in
    // this column and the column scrolls) it states its own height: as tall as
    // a full-width picture, capped so it never pushes the controls off screen.
    // `cqw` is the section's width, the editor's container.
    //
    // A VIEWPORT question, not the container one the layout splits on: what
    // changes is the shell's height model, which no container can see.
    <div
      style={{ '--aspect': aspect } as React.CSSProperties}
      className={`flex flex-col items-center gap-2 min-h-0 w-full @min-[860px]:flex-1 ${
        compactShell ? 'aspect-[var(--aspect)]' : ''
      }`}
    >
      <div
        ref={frameRef}
        className={`relative flex items-center justify-center min-h-0 w-full @min-[860px]:h-auto @min-[860px]:flex-1 ${
          compactShell ? 'flex-1' : 'h-[min(62vh,calc(100cqw/var(--aspect)))]'
        }`}
      >
        <div
          ref={boxRef}
          className="relative rounded-paper border border-line-strong bg-frame overflow-hidden"
        >
          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={() => setHovering(false)}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            className={`absolute inset-0 w-full h-full touch-none ${cursor}`}
          />
          <canvas
            ref={chromeRef}
            aria-hidden="true"
            className="absolute inset-0 w-full h-full pointer-events-none"
          />
        </div>
        {loading && (
          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 font-mono text-2xs text-paper bg-[rgba(20,18,15,0.7)] px-3 py-1.5 rounded-full">
            decoding…
          </span>
        )}
      </div>
      {error && (
        <p className="m-0 max-w-[46ch] text-center text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
