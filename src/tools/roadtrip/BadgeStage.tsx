import { useEffect, useRef, useState } from 'react';
import type { OverlayElement } from '../../shared/overlay/overlay-types';
import type { StyleTheme } from '../../shared/overlay/title-styles';
import {
  PREVIEW_LONG_EDGE,
  frameSize,
  loadBadgeSource,
  renderBadge,
  type BadgeBackdrop,
  type BadgeSource,
} from '../../shared/roadtrip/badge-render';

interface BadgeStageProps {
  file: File | null;
  /** Frame of a clip to sit on; ignored for photos. */
  videoTimeSeconds: number;
  aspect: number;
  elements: OverlayElement[];
  theme: StyleTheme | null;
  /** Where the badge's own animations are up to, in seconds. */
  timeSeconds: number;
  /** Vignette and scrim over the picture, under the badge. */
  backdrop?: BadgeBackdrop;
  /** The badge block's extent, for a scrim confined to the hook zone. */
  block?: { top: number; bottom: number } | null;
  onSourceLoaded?: (info: { width: number; height: number; duration: number }) => void;
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
  backdrop,
  block,
  onSourceLoaded,
}: BadgeStageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sourceRef = useRef<BadgeSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Decode the picture. Re-runs when the clip's frame moves, because a video
  // source IS the seeked element — a photo re-decodes only when the file does.
  useEffect(() => {
    let cancelled = false;
    sourceRef.current?.release();
    sourceRef.current = null;
    setError(null);

    if (!file) {
      // Still paint: an empty frame with its badge is a legitimate thing to
      // look at while choosing a picture.
      const canvas = canvasRef.current;
      if (canvas) {
        void renderBadge(canvas, {
          source: null,
          elements,
          theme,
          timeSeconds,
          backdrop,
          block,
        });
      }
      return;
    }

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
    // the decode, and listing them would re-decode the file on every nudge of
    // a slider.
  }, [file, videoTimeSeconds]);

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
      backdrop,
      block,
    });
  }, [
    aspect,
    elements,
    theme,
    timeSeconds,
    backdrop,
    block,
    loading,
    file,
    videoTimeSeconds,
  ]);

  useEffect(() => () => sourceRef.current?.release(), []);

  return (
    <div className="flex flex-col items-center gap-2 min-h-0">
      <div className="relative flex items-center justify-center min-h-0">
        <canvas
          ref={canvasRef}
          className="max-w-full max-h-[62vh] object-contain rounded-paper border border-line-strong bg-frame"
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
