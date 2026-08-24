import { useEffect, useRef, useState } from 'react';
import type { OverlayElement } from '../../shared/overlay/overlay-types';
import type { StyleTheme } from '../../shared/overlay/title-styles';
import {
  PREVIEW_LONG_EDGE,
  frameSize,
  loadBadgeSource,
  renderBadge,
  type BadgeSource,
  type QrDraw,
} from '../../shared/roadtrip/badge-render';
import type { HookBlock, Shade } from '../../shared/roadtrip/shades';

interface BadgeStageProps {
  file: File | null;
  /** Frame of a clip to sit on; ignored for photos. */
  videoTimeSeconds: number;
  aspect: number;
  elements: OverlayElement[];
  theme: StyleTheme | null;
  /** Where the badge's own animations are up to, in seconds. */
  timeSeconds: number;
  /** Darkening over the picture, under the badge. */
  shades?: readonly Shade[];
  /** The badge block's extent, for a shade that follows the hook. */
  block?: HookBlock | null;
  /** Painted where no picture covers the frame — the closing card's ground. */
  background?: string;
  /** A QR square under the text. */
  qr?: QrDraw | null;
  onSourceLoaded?: (info: { width: number; height: number; duration: number }) => void;
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
 */
export default function BadgeStage({
  file,
  videoTimeSeconds,
  aspect,
  elements,
  theme,
  timeSeconds,
  shades,
  block,
  background,
  qr,
  onSourceLoaded,
  onRendered,
}: BadgeStageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
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
      .then((source) => {
        if (cancelled) {
          source.release();
          return;
        }
        sourceRef.current = source;
        onSourceLoaded?.({
          width: source.width,
          height: source.height,
          duration: 'duration' in source.image ? (source.image.duration ?? 0) : 0,
        });
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

  // Move the open clip to the asked-for moment, then repaint. `frameSeq` is
  // what makes the paint wait for the frame: painting on `videoTimeSeconds`
  // alone would draw the OLD frame, since the seek has not landed yet.
  const [frameSeq, setFrameSeq] = useState(0);
  useEffect(() => {
    const source = sourceRef.current;
    if (!source?.seek || loading) return;
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

  // Paint. Runs on every change of anything drawn, including after a decode.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { w, h } = frameSize(aspect, PREVIEW_LONG_EDGE);
    canvas.width = w;
    canvas.height = h;
    void renderBadge(canvas, {
      source: sourceRef.current,
      elements,
      theme,
      timeSeconds,
      shades,
      block,
      background,
      qr,
    }).then(() => onRenderedRef.current?.(canvas));
  }, [
    aspect,
    elements,
    theme,
    timeSeconds,
    shades,
    block,
    background,
    qr,
    loading,
    file,
    frameSeq,
  ]);

  useEffect(() => () => sourceRef.current?.release(), []);

  return (
    // The picture takes every pixel the column can spare: both max
    // constraints apply to the canvas, and a replaced element honours them
    // proportionally, so it fills the box without ever distorting. The 62vh
    // cap is kept only for the STACKED layout, where the page scrolls and an
    // unbounded picture would push the controls off a phone screen.
    <div className="flex flex-col items-center gap-2 min-h-0 w-full @min-[860px]:flex-1">
      <div className="relative flex items-center justify-center min-h-0 w-full @min-[860px]:flex-1">
        <canvas
          ref={canvasRef}
          className="max-w-full max-h-[62vh] @min-[860px]:max-h-full object-contain rounded-paper border border-line-strong bg-frame"
        />
        {loading && (
          <span className="absolute font-mono text-[0.7rem] text-paper bg-[rgba(20,18,15,0.7)] px-3 py-1.5 rounded-full">
            decoding…
          </span>
        )}
      </div>
      {error && (
        <p className="m-0 max-w-[46ch] text-center text-[0.78rem] text-[#9a3a23]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
