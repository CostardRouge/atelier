import { useEffect, useMemo, useRef, useState } from 'react';
import { useAssetLibrary } from '../../shared/library/AssetLibraryContext';
import { selectedUsableAssets } from '../../shared/library/capabilities';
import { parseSrt, type Cue } from '../../shared/telemetry/srt-parser';
import { useActiveCue } from '../../shared/telemetry/use-active-cue';
import { formatHeading, formatGroundSpeed, motionAt } from '../../shared/telemetry/motion';
import { extractTrack, parsePosition } from '../../shared/telemetry/flight-path';
import { useObjectUrl } from '../../shared/media/use-object-url';
import { useFlightMap } from './use-flight-map';

/** Asset kinds the flight map understands — it needs telemetry (the GPS). */
const MAP_KINDS = ['video+telemetry', 'telemetry'] as const;

interface Clip {
  id: string;
  baseName: string;
  video: File | null;
  srt: File | null;
}

export default function MapTool() {
  const lib = useAssetLibrary();
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const clips = useMemo<Clip[]>(
    () =>
      selectedUsableAssets(MAP_KINDS, lib.assets, lib.selection).map((a) => ({
        id: a.id,
        baseName: a.baseName,
        video: a.parts.video ?? null,
        srt: a.parts.srt ?? null,
      })),
    [lib.assets, lib.selection],
  );

  // The active clip follows the shared library focus, falling back to the first.
  const activeId =
    lib.activeId && clips.some((c) => c.id === lib.activeId)
      ? lib.activeId
      : (clips[0]?.id ?? null);
  const active = clips.find((c) => c.id === activeId) ?? null;

  // Reflect the effective active clip back to the library so the sidebar agrees.
  useEffect(() => {
    if (activeId && activeId !== lib.activeId) lib.setActive(activeId);
  }, [activeId, lib.activeId, lib.setActive]);

  // Parse the active clip's telemetry, and make a preview URL for its video.
  const [cues, setCues] = useState<Cue[]>([]);
  const videoUrl = useObjectUrl(active?.video ?? null);
  const [tilesOn, setTilesOn] = useState(false);

  useEffect(() => {
    const srt = active?.srt;
    if (!srt) {
      setCues([]);
      return;
    }
    let cancelled = false;
    srt
      .text()
      .then((text) => !cancelled && setCues(parseSrt(text)))
      .catch(() => !cancelled && setCues([]));
    return () => {
      cancelled = true;
    };
  }, [active?.srt]);

  const track = useMemo(() => extractTrack(cues), [cues]);
  const activeCue = useActiveCue(videoRef, cues, videoUrl);

  // The marker position: the live cue's fix, or the path's start before/while
  // there's no fix, so the marker is never orphaned.
  const position = useMemo<[number, number] | null>(() => {
    const live = activeCue ? parsePosition(activeCue) : null;
    if (live) return live;
    return track.length ? [track[0].lon, track[0].lat] : null;
  }, [activeCue, track]);

  const { ready, error } = useFlightMap(containerRef, track, tilesOn, position);

  const activeIndex = clips.findIndex((c) => c.id === activeId);
  const liveCoord = position ? `${position[1].toFixed(6)}, ${position[0].toFixed(6)}` : null;
  const liveAlt = activeCue?.data.rel_alt;
  const liveMotion = [
    formatGroundSpeed(motionAt(activeCue).groundSpeed),
    formatHeading(motionAt(activeCue).heading),
  ]
    .filter(Boolean)
    .join('  ·  ');

  return (
    <section className="flex flex-col flex-1 min-h-0 gap-[0.6rem]" aria-label="Flight map">
      {/* Control bar: clip switcher + base-map toggle. */}
      <div className="flex flex-wrap items-center gap-2 px-2 py-2 border border-line rounded-paper-lg bg-surface shadow-paper-soft">
        {clips.length === 0 ? (
          <span className="text-[0.82rem] text-muted px-1">
            Select a DJI clip (or a loose <code className="font-mono">.srt</code>)
            in the Library to map its flight.
          </span>
        ) : (
          <>
            {clips.length > 1 && (
              <div className="flex items-center gap-1 flex-none">
                <button
                  type="button"
                  className="w-6 h-6 grid place-items-center rounded-full border border-line-strong bg-paper text-ink-soft cursor-pointer leading-none hover:border-accent hover:text-accent-ink disabled:opacity-40 disabled:cursor-default"
                  onClick={() => activeIndex > 0 && lib.setActive(clips[activeIndex - 1].id)}
                  disabled={activeIndex <= 0}
                  aria-label="Previous clip"
                >
                  ‹
                </button>
                <span className="font-mono text-[0.7rem] text-muted tabular-nums min-w-[3ch] text-center">
                  {activeIndex + 1}/{clips.length}
                </span>
                <button
                  type="button"
                  className="w-6 h-6 grid place-items-center rounded-full border border-line-strong bg-paper text-ink-soft cursor-pointer leading-none hover:border-accent hover:text-accent-ink disabled:opacity-40 disabled:cursor-default"
                  onClick={() =>
                    activeIndex < clips.length - 1 && lib.setActive(clips[activeIndex + 1].id)
                  }
                  disabled={activeIndex >= clips.length - 1}
                  aria-label="Next clip"
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
            <button
              type="button"
              onClick={() => setTilesOn((on) => !on)}
              aria-pressed={tilesOn}
              className="ml-auto flex-none inline-flex items-center gap-1.5 h-[2.1rem] px-[0.9rem] rounded-full border text-[0.8rem] font-semibold transition-colors aria-pressed:border-accent aria-pressed:text-accent-ink aria-pressed:bg-accent-wash border-line-strong bg-paper text-ink-soft hover:border-faint hover:text-ink"
              title="Load OpenStreetMap tiles — the only feature that makes a network request"
            >
              {tilesOn ? 'Map background: on' : 'Load map background'}
            </button>
          </>
        )}
      </div>

      {/* Map stage. The MapLibre container is a flex child with a real pixel
          height (not `absolute inset-0`) — MapLibre adds `.maplibregl-map`
          which sets `position: relative`, and that would override an absolute
          container and collapse it to zero height (a black box). It also keeps
          no React children, since MapLibre owns that DOM; overlays sit beside
          it, positioned against the stage. */}
      <div className="relative flex flex-col rounded-paper overflow-hidden flex-1 min-h-0 bg-frame border border-line max-[820px]:min-h-[280px]">
        <div ref={containerRef} className="flex-1 min-h-0 w-full" />

        {error && (
          <div className="absolute inset-0 grid place-items-center text-center p-6 text-muted font-mono text-[0.82rem]">
            The map library couldn't load.
          </div>
        )}

        {!error && clips.length > 0 && ready && track.length === 0 && (
          <div className="absolute inset-0 grid place-items-center text-center p-6 pointer-events-none">
            <span className="text-[0.82rem] text-white bg-black/55 px-3 py-1.5 rounded-full">
              No GPS fixes in this clip's telemetry.
            </span>
          </div>
        )}

        {/* Live readout, bottom-left. */}
        {liveCoord && track.length > 0 && (
          <div className="absolute bottom-2.5 left-2.5 z-[2] font-mono text-[0.7rem] leading-[1.5] text-white bg-black/55 px-3 py-1.5 rounded-paper pointer-events-none">
            <div className="tabular-nums">{liveCoord}</div>
            <div className="text-white/85">
              {liveAlt ? `${liveAlt} m` : '—'}
              {liveMotion && <span className="text-white/70">{'  ·  '}{liveMotion}</span>}
            </div>
          </div>
        )}

        {/* Tile attribution / privacy note. */}
        {tilesOn ? (
          <span className="absolute bottom-1 right-1 z-[2] font-mono text-[0.58rem] text-ink-soft bg-paper/80 px-1.5 py-0.5 rounded">
            © OpenStreetMap contributors
          </span>
        ) : (
          clips.length > 0 && (
            <span className="absolute top-2.5 left-2.5 z-[2] font-mono text-[0.6rem] tracking-[0.04em] text-white/90 bg-black/45 px-2 py-1 rounded">
              Offline · no tiles loaded
            </span>
          )
        )}
      </div>

      {/* Video — scrubbing it walks the marker along the path. */}
      {active &&
        (active.video ? (
          <video
            ref={videoRef}
            src={videoUrl ?? undefined}
            controls
            playsInline
            className="flex-none w-full max-h-[34vh] rounded-paper bg-frame object-contain"
          />
        ) : (
          <p className="flex-none m-0 px-4 py-[0.7rem] rounded-paper bg-surface border border-line text-[0.82rem] text-muted text-center">
            Telemetry only — add this clip's video to scrub along the path.
          </p>
        ))}
    </section>
  );
}
