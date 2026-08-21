import { useEffect, useMemo, useRef, useState } from 'react';
import { useAssetLibrary } from '../../shared/library/AssetLibraryContext';
import { selectedUsableAssets } from '../../shared/library/capabilities';
import type { Asset } from '../../shared/library/assets';
import { formatDuration } from '../../shared/lib/format';
import { useObjectUrl } from '../../shared/media/use-object-url';
import { useVideoTransport } from '../../shared/media/use-video-transport';
import { clamp01, insetForSplit, reconcilePair } from './compare';

/** Asset kinds the compare tool understands (video+telemetry stands in for video). */
const COMPARE_KINDS = ['photo', 'video'] as const;

interface Side {
  id: string;
  baseName: string;
  kind: 'photo' | 'video';
  file: File;
}

/** Resolve a selected asset id to the media the compare stage should show. */
function resolveSide(assets: readonly Asset[], id: string | null): Side | null {
  if (!id) return null;
  const asset = assets.find((a) => a.id === id);
  if (!asset) return null;
  if (asset.parts.video) {
    return { id, baseName: asset.baseName, kind: 'video', file: asset.parts.video };
  }
  if (asset.parts.image) {
    return { id, baseName: asset.baseName, kind: 'photo', file: asset.parts.image };
  }
  return null;
}

/**
 * Compare A/B — the LUT before/after wipe generalised to two different media.
 * Pick any two photos or clips from the shared library and drag a divider
 * across them: A on the left, B on the right. When both sides are clips, one
 * transport drives them together (seek/scrub kept in sync), so two grades or
 * two takes of the same shot line up frame-for-frame. Nothing is uploaded —
 * only the two compared files are ever decoded.
 */
export default function CompareTool() {
  const lib = useAssetLibrary();

  const options = useMemo(
    () =>
      selectedUsableAssets(COMPARE_KINDS, lib.assets, lib.selection).map((a) => ({
        id: a.id,
        baseName: a.baseName,
      })),
    [lib.assets, lib.selection],
  );
  const optionKey = options.map((o) => o.id).join('|');

  const [aId, setAId] = useState<string | null>(null);
  const [bId, setBId] = useState<string | null>(null);
  const idsRef = useRef({ aId, bId });
  idsRef.current = { aId, bId };

  // Keep the chosen pair valid as the selection changes (runs only when the
  // available set changes; reads the latest ids via a ref).
  useEffect(() => {
    const { a, b } = reconcilePair(
      idsRef.current.aId,
      idsRef.current.bId,
      optionKey ? optionKey.split('|') : [],
    );
    setAId(a);
    setBId(b);
  }, [optionKey]);

  const aSide = resolveSide(lib.assets, aId);
  const bSide = resolveSide(lib.assets, bId);
  const aUrl = useObjectUrl(aSide?.file ?? null);
  const bUrl = useObjectUrl(bSide?.file ?? null);
  const hasBoth = !!aSide && !!bSide;

  const [aError, setAError] = useState(false);
  const [bError, setBError] = useState(false);
  useEffect(() => setAError(false), [aUrl]);
  useEffect(() => setBError(false), [bUrl]);

  // --- divider ------------------------------------------------------------
  const stageRef = useRef<HTMLDivElement>(null);
  const wipeRef = useRef<HTMLDivElement>(null);
  const bLayerRef = useRef<HTMLDivElement>(null);
  const splitRef = useRef(0.5);

  function placeWipe(xNorm: number) {
    const x = clamp01(xNorm);
    splitRef.current = x;
    if (bLayerRef.current) bLayerRef.current.style.clipPath = insetForSplit(x);
    const stage = stageRef.current;
    const wipe = wipeRef.current;
    if (stage && wipe) wipe.style.left = `${x * stage.clientWidth}px`;
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!hasBoth) return;
    const stage = stageRef.current;
    if (!stage) return;
    const r = stage.getBoundingClientRect();
    placeWipe((e.clientX - r.left) / r.width);
  }

  // Re-seed the divider after the sources/layout settle.
  useEffect(() => {
    if (hasBoth) requestAnimationFrame(() => placeWipe(splitRef.current));
  }, [aUrl, bUrl, hasBoth]);

  // --- synced transport (only meaningful when a side is a video) ----------
  const aVideoRef = useRef<HTMLVideoElement>(null);
  const bVideoRef = useRef<HTMLVideoElement>(null);
  const scrubbingRef = useRef(false);

  const aIsVideo = aSide?.kind === 'video';
  const bIsVideo = bSide?.kind === 'video';
  const hasVideo = aIsVideo || bIsVideo;

  function videoEls(): HTMLVideoElement[] {
    const els: HTMLVideoElement[] = [];
    if (aIsVideo && aVideoRef.current) els.push(aVideoRef.current);
    if (bIsVideo && bVideoRef.current) els.push(bVideoRef.current);
    return els;
  }

  // The first present video leads the clock; the other follows (and both
  // play/pause together).
  const leadRef = aIsVideo ? aVideoRef : bVideoRef;
  const { playing, time, duration, setTime, togglePlay } = useVideoTransport(
    leadRef,
    `${aUrl}|${bUrl}|${aIsVideo}|${bIsVideo}`,
    { scrubbingRef, followers: videoEls },
  );

  function seek(t: number) {
    setTime(t);
    for (const v of videoEls()) v.currentTime = t;
  }

  // --- A/B controls -------------------------------------------------------
  function swap() {
    setAId(bId);
    setBId(aId);
  }

  const selectClass =
    'min-w-0 max-w-[14rem] h-[2.1rem] px-2 rounded-full border border-line-strong bg-paper text-[0.8rem] text-ink cursor-pointer focus:outline-none focus:border-accent';

  function sideSelect(value: string | null, onChange: (id: string) => void, label: string) {
    return (
      <select
        className={selectClass}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.baseName}
          </option>
        ))}
      </select>
    );
  }

  function renderMedia(
    side: Side | null,
    url: string | null,
    ref: React.RefObject<HTMLVideoElement>,
    error: boolean,
    onError: () => void,
  ) {
    if (!side || !url) return null;
    if (error) {
      return (
        <div className="max-w-[80%] text-center text-[#8c8576] font-mono text-[0.78rem] leading-[1.5]">
          {side.kind === 'video'
            ? "This clip can't be decoded here (often HEVC/H.265). Try Safari or transcode to H.264."
            : "This file can't be previewed (e.g. camera RAW the browser can't decode)."}
        </div>
      );
    }
    if (side.kind === 'video') {
      return (
        <video
          ref={ref}
          src={url}
          className="max-w-full max-h-full object-contain"
          playsInline
          muted
          onError={onError}
        />
      );
    }
    return (
      <img
        src={url}
        alt={side.baseName}
        className="max-w-full max-h-full object-contain"
        onError={onError}
      />
    );
  }

  return (
    <section className="flex flex-col flex-1 min-h-0 gap-[0.6rem]" aria-label="Compare A/B">
      {/* Control bar: choose A and B, swap. */}
      <div className="flex flex-wrap items-center gap-2 px-2 py-2 border border-line rounded-paper-lg bg-surface shadow-paper-soft">
        {options.length === 0 ? (
          <span className="text-[0.82rem] text-muted px-1">
            Select two photos or clips in the Library to compare.
          </span>
        ) : (
          <>
            <span className="font-mono text-[0.62rem] tracking-[0.14em] uppercase text-accent-ink flex-none">
              A
            </span>
            {sideSelect(aId, setAId, 'Side A')}
            <button
              type="button"
              onClick={swap}
              disabled={!hasBoth}
              className="flex-none w-8 h-8 grid place-items-center rounded-full border border-line-strong bg-paper text-ink-soft hover:border-accent hover:text-accent-ink disabled:opacity-40 disabled:cursor-default transition-colors"
              aria-label="Swap A and B"
              title="Swap A and B"
            >
              ⇄
            </button>
            {sideSelect(bId, setBId, 'Side B')}
            <span className="font-mono text-[0.62rem] tracking-[0.14em] uppercase text-accent-ink flex-none">
              B
            </span>
            {hasVideo && hasBoth && (
              <span className="ml-auto text-[0.72rem] text-muted font-mono">
                synced playback
              </span>
            )}
          </>
        )}
      </div>

      {/* Stage. */}
      <div
        ref={stageRef}
        className={`relative rounded-paper overflow-hidden flex-1 min-h-0 bg-frame max-[820px]:min-h-[260px] ${
          hasBoth ? 'cursor-ew-resize' : ''
        }`}
        onPointerMove={handlePointerMove}
      >
        {aSide ? (
          <>
            {/* A (bottom layer). */}
            <div className="absolute inset-0 grid place-items-center">
              {renderMedia(aSide, aUrl, aVideoRef, aError, () => setAError(true))}
            </div>

            {/* B (top layer, clipped to the right of the divider). */}
            {bSide && (
              <div
                ref={bLayerRef}
                className="absolute inset-0 grid place-items-center"
                style={{ clipPath: insetForSplit(splitRef.current) }}
              >
                {renderMedia(bSide, bUrl, bVideoRef, bError, () => setBError(true))}
              </div>
            )}

            {/* Side labels + divider. */}
            {hasBoth && (
              <>
                <span className="absolute top-2.5 left-2.5 z-[3] font-mono text-[0.62rem] tracking-[0.1em] uppercase text-white bg-black/55 px-[0.4rem] py-[0.18rem] rounded-[5px]">
                  A · {aSide.baseName}
                </span>
                <span className="absolute top-2.5 right-2.5 z-[3] font-mono text-[0.62rem] tracking-[0.1em] uppercase text-white bg-black/55 px-[0.4rem] py-[0.18rem] rounded-[5px]">
                  B · {bSide?.baseName}
                </span>
                <div
                  ref={wipeRef}
                  className="absolute top-0 h-full w-0.5 -ml-px bg-white/90 shadow-[0_0_0_0.5px_rgba(0,0,0,0.4)] pointer-events-none z-[2]"
                  style={{ left: `${splitRef.current * 100}%` }}
                  aria-hidden="true"
                >
                  <span className="absolute top-1/2 left-1/2 w-[34px] h-[34px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/95 bg-black/[0.32] shadow-[0_1px_6px_rgba(0,0,0,0.45)] before:content-[''] before:absolute before:top-1/2 before:left-2 before:w-1.5 before:h-1.5 before:border-t-2 before:border-r-2 before:border-white/95 before:-translate-y-1/2 before:-rotate-[135deg] after:content-[''] after:absolute after:top-1/2 after:right-2 after:w-1.5 after:h-1.5 after:border-t-2 after:border-r-2 after:border-white/95 after:-translate-y-1/2 after:rotate-45" />
                </div>
              </>
            )}

            {/* One side only: invite picking the second. */}
            {!bSide && (
              <span className="absolute bottom-3 left-1/2 -translate-x-1/2 z-[3] text-[0.78rem] text-white bg-black/55 px-3 py-1.5 rounded-full">
                Pick a second asset (B) to compare.
              </span>
            )}
          </>
        ) : (
          <div className="absolute inset-0 grid place-items-center text-muted text-center p-4 font-mono text-[0.85rem]">
            {options.length === 0
              ? 'Select two assets in the Library.'
              : 'Choose A and B above.'}
          </div>
        )}
      </div>

      {/* Synced transport, when at least one side is a clip. */}
      {hasBoth && hasVideo && (
        <div className="flex items-center gap-[0.85rem] px-[0.85rem] py-[0.6rem] border border-line rounded-paper bg-surface flex-none">
          <button
            type="button"
            className="flex-none w-[2.2rem] h-[2.2rem] border-0 rounded-full bg-ink text-paper cursor-pointer text-[0.8rem] leading-none inline-flex items-center justify-center transition-[background-color] duration-200 ease-paper hover:bg-accent"
            onClick={togglePlay}
            aria-label={playing ? 'Pause' : 'Play'}
            title="Play / pause (Space)"
          >
            {playing ? '❚❚' : '▶'}
          </button>
          <input
            type="range"
            className="flex-1 accent-accent cursor-pointer"
            min={0}
            max={duration || 0}
            step={0.001}
            value={Math.min(time, duration || 0)}
            onPointerDown={() => {
              scrubbingRef.current = true;
            }}
            onPointerUp={() => {
              scrubbingRef.current = false;
            }}
            onChange={(e) => seek(Number(e.target.value))}
            aria-label="Seek both clips"
          />
          <span className="font-mono text-[0.74rem] tabular-nums text-muted flex-none min-w-[3.2ch] text-center">
            {formatDuration(duration)}
          </span>
        </div>
      )}
    </section>
  );
}
