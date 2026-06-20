import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAssetLibrary } from '../../shared/library/AssetLibraryContext';
import { selectedUsableAssets } from '../../shared/library/capabilities';
import type { Asset } from '../../shared/library/assets';
import { computeHistograms, computeVectorscope, computeWaveform } from './scopes';
import {
  drawHistogram,
  drawVectorscope,
  drawWaveform,
  type HistogramMode,
  type WaveformMode,
} from './draw-scopes';

/** Asset kinds the scopes can analyse — anything with pixels. */
const SCOPE_KINDS = ['photo', 'video'] as const;
/** Longest edge the frame is downscaled to before reading pixels. */
const SAMPLE_MAX = 320;

interface Source {
  id: string;
  baseName: string;
  kind: 'photo' | 'video';
  file: File;
}

function resolveSource(assets: readonly Asset[], id: string | null): Source | null {
  if (!id) return null;
  const a = assets.find((x) => x.id === id);
  if (!a) return null;
  if (a.parts.video) return { id, baseName: a.baseName, kind: 'video', file: a.parts.video };
  if (a.parts.image) return { id, baseName: a.baseName, kind: 'photo', file: a.parts.image };
  return null;
}

/**
 * Scopes — histogram, waveform and vectorscope for a photo or video frame, the
 * analytical companion to LUT Studio. The frame is downscaled and read locally
 * (nothing uploaded); for a clip the scopes update live as it plays or scrubs.
 */
export default function ScopesTool() {
  const lib = useAssetLibrary();
  const videoRef = useRef<HTMLVideoElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const sampleRef = useRef<HTMLCanvasElement | null>(null);
  const histRef = useRef<HTMLCanvasElement>(null);
  const waveRef = useRef<HTMLCanvasElement>(null);
  const vecRef = useRef<HTMLCanvasElement>(null);

  const [histMode, setHistMode] = useState<HistogramMode>('rgb');
  const [waveMode, setWaveMode] = useState<WaveformMode>('luma');
  const [decodeError, setDecodeError] = useState(false);

  const sources = useMemo(
    () =>
      selectedUsableAssets(SCOPE_KINDS, lib.assets, lib.selection).map((a) => ({
        id: a.id,
        baseName: a.baseName,
      })),
    [lib.assets, lib.selection],
  );

  const activeId =
    lib.activeId && sources.some((s) => s.id === lib.activeId)
      ? lib.activeId
      : (sources[0]?.id ?? null);
  const active = resolveSource(lib.assets, activeId);

  useEffect(() => {
    if (activeId && activeId !== lib.activeId) lib.setActive(activeId);
  }, [activeId, lib.activeId, lib.setActive]);

  // Preview object URL for the active source.
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setDecodeError(false);
    if (!active) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(active.file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [active?.file]);

  // Sample the current frame and paint the three scopes.
  const draw = useCallback(() => {
    if (!active) return;
    const media: HTMLVideoElement | HTMLImageElement | null =
      active.kind === 'video' ? videoRef.current : imgRef.current;
    if (!media) return;

    const isVideo = active.kind === 'video';
    const natW = isVideo
      ? (media as HTMLVideoElement).videoWidth
      : (media as HTMLImageElement).naturalWidth;
    const natH = isVideo
      ? (media as HTMLVideoElement).videoHeight
      : (media as HTMLImageElement).naturalHeight;
    if (!natW || !natH) return;
    if (isVideo && (media as HTMLVideoElement).readyState < 2) return;

    let sample = sampleRef.current;
    if (!sample) {
      sample = document.createElement('canvas');
      sampleRef.current = sample;
    }
    const scale = Math.min(1, SAMPLE_MAX / Math.max(natW, natH));
    const w = Math.max(1, Math.round(natW * scale));
    const h = Math.max(1, Math.round(natH * scale));
    sample.width = w;
    sample.height = h;
    const sctx = sample.getContext('2d', { willReadFrequently: true });
    if (!sctx) return;

    let pixels: ImageData;
    try {
      sctx.drawImage(media, 0, 0, w, h);
      pixels = sctx.getImageData(0, 0, w, h);
    } catch {
      return; // frame not ready / tainted (shouldn't happen for local files)
    }

    const data = pixels.data;
    const hc = histRef.current;
    const wc = waveRef.current;
    const vc = vecRef.current;
    const hctx = hc?.getContext('2d');
    const wctx = wc?.getContext('2d');
    const vctx = vc?.getContext('2d');
    if (hctx && hc) drawHistogram(hctx, hc.width, hc.height, computeHistograms(data), histMode);
    if (wctx && wc) drawWaveform(wctx, wc.width, wc.height, computeWaveform(data, w, h), waveMode);
    if (vctx && vc) drawVectorscope(vctx, vc.width, vc.height, computeVectorscope(data, 256));
  }, [active, histMode, waveMode]);

  // Keep a live ref so the rAF loop always calls the latest draw.
  const drawRef = useRef(draw);
  drawRef.current = draw;

  // Redraw the current frame whenever the source or a scope mode changes.
  useEffect(() => {
    const id = requestAnimationFrame(() => drawRef.current());
    return () => cancelAnimationFrame(id);
  }, [activeId, url, histMode, waveMode]);

  // For a clip: loop while playing, and refresh on seek/load.
  useEffect(() => {
    if (active?.kind !== 'video') return;
    const v = videoRef.current;
    if (!v) return;
    let raf = 0;
    const tick = () => {
      drawRef.current();
      raf = requestAnimationFrame(tick);
    };
    const onPlay = () => {
      cancelAnimationFrame(raf);
      tick();
    };
    const onStop = () => {
      cancelAnimationFrame(raf);
      drawRef.current();
    };
    const onFrame = () => drawRef.current();
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onStop);
    v.addEventListener('ended', onStop);
    v.addEventListener('seeked', onFrame);
    v.addEventListener('loadeddata', onFrame);
    return () => {
      cancelAnimationFrame(raf);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onStop);
      v.removeEventListener('ended', onStop);
      v.removeEventListener('seeked', onFrame);
      v.removeEventListener('loadeddata', onFrame);
    };
  }, [active?.kind, url]);

  const activeIndex = sources.findIndex((s) => s.id === activeId);

  const seg =
    'inline-flex items-center h-full px-[0.7rem] rounded-full text-[0.74rem] font-semibold transition-colors';

  function toggle<T extends string>(
    value: T,
    options: readonly T[],
    onChange: (v: T) => void,
    label: string,
  ) {
    return (
      <div
        className="inline-flex items-center flex-none h-[2.1rem] rounded-full border border-line-strong bg-paper p-[3px]"
        role="group"
        aria-label={label}
      >
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            aria-pressed={value === opt}
            className={`${seg} ${value === opt ? 'bg-ink text-paper' : 'text-muted hover:text-ink'}`}
          >
            {opt}
          </button>
        ))}
      </div>
    );
  }

  return (
    <section className="flex flex-col flex-1 min-h-0 gap-[0.6rem] overflow-y-auto max-[820px]:overflow-visible" aria-label="Scopes">
      {/* Control bar. */}
      <div className="flex flex-wrap items-center gap-2 px-2 py-2 border border-line rounded-paper-lg bg-surface shadow-paper-soft">
        {sources.length === 0 ? (
          <span className="text-[0.82rem] text-muted px-1">
            Select a photo or clip in the Library to read its scopes.
          </span>
        ) : (
          <>
            {sources.length > 1 && (
              <div className="flex items-center gap-1 flex-none">
                <button
                  type="button"
                  className="w-6 h-6 grid place-items-center rounded-full border border-line-strong bg-paper text-ink-soft cursor-pointer leading-none hover:border-accent hover:text-accent-ink disabled:opacity-40 disabled:cursor-default"
                  onClick={() => activeIndex > 0 && lib.setActive(sources[activeIndex - 1].id)}
                  disabled={activeIndex <= 0}
                  aria-label="Previous"
                >
                  ‹
                </button>
                <span className="font-mono text-[0.7rem] text-muted tabular-nums min-w-[3ch] text-center">
                  {activeIndex + 1}/{sources.length}
                </span>
                <button
                  type="button"
                  className="w-6 h-6 grid place-items-center rounded-full border border-line-strong bg-paper text-ink-soft cursor-pointer leading-none hover:border-accent hover:text-accent-ink disabled:opacity-40 disabled:cursor-default"
                  onClick={() =>
                    activeIndex < sources.length - 1 && lib.setActive(sources[activeIndex + 1].id)
                  }
                  disabled={activeIndex >= sources.length - 1}
                  aria-label="Next"
                >
                  ›
                </button>
              </div>
            )}
            <span
              className="font-semibold text-[0.9rem] whitespace-nowrap overflow-hidden text-ellipsis min-w-0"
              title={active?.baseName}
            >
              {active?.baseName}
            </span>
            <div className="ml-auto flex items-center gap-2">
              {toggle(histMode, ['rgb', 'luma'] as const, setHistMode, 'Histogram mode')}
              {toggle(waveMode, ['luma', 'parade'] as const, setWaveMode, 'Waveform mode')}
            </div>
          </>
        )}
      </div>

      {active && (
        <>
          {/* Preview. */}
          <div className="flex-none grid place-items-center bg-frame rounded-paper overflow-hidden border border-line max-h-[36vh]">
            {active.kind === 'video' ? (
              <video
                ref={videoRef}
                src={url ?? undefined}
                controls
                playsInline
                className="max-w-full max-h-[36vh] object-contain"
                onError={() => setDecodeError(true)}
              />
            ) : (
              <img
                ref={imgRef}
                src={url ?? undefined}
                alt={active.baseName}
                className="max-w-full max-h-[36vh] object-contain"
                onLoad={() => drawRef.current()}
                onError={() => setDecodeError(true)}
              />
            )}
          </div>

          {decodeError && (
            <p className="flex-none my-1 px-4 py-[0.7rem] rounded-paper bg-accent-wash border border-[#eccabf] text-[#7c2e1c] text-[0.84rem]">
              This file couldn't be decoded here (often HEVC/H.265, or camera
              RAW). The scopes need a frame the browser can decode.
            </p>
          )}

          {/* Scopes. */}
          <div className="flex-none grid grid-cols-1 gap-3 min-[900px]:grid-cols-[1fr_1fr_auto]">
            <figure className="m-0 flex flex-col gap-1">
              <figcaption className="font-mono text-[0.6rem] uppercase tracking-[0.14em] text-muted">
                Histogram
              </figcaption>
              <canvas
                ref={histRef}
                width={512}
                height={240}
                className="w-full h-auto block rounded bg-frame border border-line"
              />
            </figure>
            <figure className="m-0 flex flex-col gap-1">
              <figcaption className="font-mono text-[0.6rem] uppercase tracking-[0.14em] text-muted">
                Waveform
              </figcaption>
              <canvas
                ref={waveRef}
                width={512}
                height={240}
                className="w-full h-auto block rounded bg-frame border border-line"
              />
            </figure>
            <figure className="m-0 flex flex-col gap-1 min-[900px]:w-[240px]">
              <figcaption className="font-mono text-[0.6rem] uppercase tracking-[0.14em] text-muted">
                Vectorscope
              </figcaption>
              <canvas
                ref={vecRef}
                width={256}
                height={256}
                className="w-full h-auto block rounded bg-frame border border-line aspect-square"
              />
            </figure>
          </div>
        </>
      )}
    </section>
  );
}
