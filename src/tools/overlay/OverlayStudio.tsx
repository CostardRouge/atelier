import { useEffect, useMemo, useRef, useState } from 'react';
import { useAssetLibrary } from '../../shared/library/AssetLibraryContext';
import { selectedUsableAssets } from '../../shared/library/capabilities';
import { formatDuration } from '../../shared/lib/format';
import { isEncodeSupported } from '../../shared/media/webcodecs-export';
import { probeContainer, type ContainerInfo } from '../../shared/media/video-metadata';
import { parseSrt, type Cue } from '../telemetry/srt-parser';
import { findCue } from '../telemetry/find-cue';
import ElementList from './ElementList';
import ElementPanel from './ElementPanel';
import { exportOverlay } from './export-overlay';
import { ensureOverlayFonts } from './fonts';
import {
  createTelemetryElement,
  createTextElement,
  defaultElementsPreset,
  type OverlayElement,
  type TelemetryFieldKey,
} from './overlay-types';
import { reanchor, useOverlayStage } from './use-overlay-stage';

/** Precise current-position readout: `M:SS.cs` (centiseconds). */
function formatTimecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00.00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds % 1) * 100);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

interface OverlayClip {
  id: string;
  name: string;
  video: File;
  srt: File;
}

const notice =
  'my-2 px-4 py-[0.7rem] rounded-paper bg-accent-wash border border-[#eccabf] text-[#7c2e1c] text-[0.84rem] leading-[1.5]';

/**
 * Telemetry Overlay — place altitude/GPS/exposure readouts (and free text) on a
 * DJI clip, then export an MP4 with the telemetry burned in.
 *
 * The clips come from the shared library's selection (video+telemetry assets);
 * a ‹ / › switcher picks which one to edit. The canvas stage composites the
 * live frame and the overlays with the very same renderer the export uses, so
 * what you place is exactly what's burned in. Only the active clip is decoded;
 * nothing uploads.
 */
export default function OverlayStudio() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrubbingRef = useRef(false);

  const lib = useAssetLibrary();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeUrl, setActiveUrl] = useState<string | null>(null);
  const [activeError, setActiveError] = useState(false);
  const [activeInfo, setActiveInfo] = useState<ContainerInfo>({});
  const [cues, setCues] = useState<Cue[]>([]);

  const [elements, setElements] = useState<OverlayElement[]>(defaultElementsPreset);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [fontTick, setFontTick] = useState(0);

  // Transport, mirrored from the offscreen video element.
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Export state.
  const [exporting, setExporting] = useState(false);
  const [exportRatio, setExportRatio] = useState(0);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportDone, setExportDone] = useState(false);
  const exportAbort = useRef<AbortController | null>(null);
  const exportSupported = isEncodeSupported();

  // The video+telemetry clips selected in the library, in library order.
  const clips = useMemo<OverlayClip[]>(
    () =>
      selectedUsableAssets(['video+telemetry'], lib.assets, lib.selection)
        .map((a) => ({
          id: a.id,
          name: a.baseName,
          video: a.parts.video,
          srt: a.parts.srt,
        }))
        .filter((c): c is OverlayClip => Boolean(c.video && c.srt)),
    [lib.assets, lib.selection],
  );

  const activeClip = clips.find((c) => c.id === activeId) ?? null;
  const activeIndex = clips.findIndex((c) => c.id === activeId);

  // --- selection plumbing -------------------------------------------------

  // Keep a valid active clip: default to first, repoint if removed.
  useEffect(() => {
    if (clips.length === 0) {
      if (activeId !== null) setActiveId(null);
    } else if (activeId === null || !clips.some((c) => c.id === activeId)) {
      setActiveId(clips[0].id);
    }
  }, [clips, activeId]);

  useEffect(() => {
    if (activeId) lib.ensureMeta(activeId);
  }, [activeId, lib.ensureMeta]);

  // Swap the preview source when the active clip changes.
  useEffect(() => {
    if (!activeClip) {
      setActiveUrl(null);
      return;
    }
    const url = URL.createObjectURL(activeClip.video);
    setActiveUrl(url);
    setActiveError(false);
    setActiveInfo({});
    setTime(0);
    setPlaying(false);
    setExportDone(false);
    setExportError(null);
    return () => URL.revokeObjectURL(url);
    // activeClip identity is stable for a given id; key on the id.
  }, [activeId]);

  // Parse the active clip's telemetry.
  useEffect(() => {
    if (!activeClip) {
      setCues([]);
      return;
    }
    let cancelled = false;
    activeClip.srt
      .text()
      .then((text) => {
        if (!cancelled) setCues(parseSrt(text));
      })
      .catch(() => {
        if (!cancelled) setCues([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  // Probe the active clip's container for codec + fps (best-effort).
  useEffect(() => {
    if (!activeClip) return;
    let cancelled = false;
    probeContainer(activeClip.video).then((info) => {
      if (!cancelled) setActiveInfo(info);
    });
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  // Keep transport state in sync with the element.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => {
      if (!scrubbingRef.current) setTime(v.currentTime);
    };
    const onMeta = () => setDuration(Number.isFinite(v.duration) ? v.duration : 0);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('ended', onPause);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('loadedmetadata', onMeta);
    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('ended', onPause);
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('loadedmetadata', onMeta);
    };
  }, [activeUrl]);

  // Load the brand fonts any element uses, then force a repaint so canvas text
  // measures and renders correctly.
  useEffect(() => {
    let cancelled = false;
    ensureOverlayFonts(elements).then(() => {
      if (!cancelled) setFontTick((t) => t + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [elements]);

  // --- element editing ----------------------------------------------------

  function updateElement(id: string, patch: Partial<OverlayElement>) {
    setElements((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }

  function addElement(el: OverlayElement) {
    // Stagger new elements so they don't land exactly on top of each other.
    const offset = Math.min(0.5, elements.length * 0.06);
    const placed = { ...el, y: Math.min(0.95, el.y + offset) };
    setElements((prev) => [...prev, placed]);
    setSelectedElementId(placed.id);
  }

  function removeElement(id: string) {
    setElements((prev) => prev.filter((e) => e.id !== id));
    setSelectedElementId((s) => (s === id ? null : s));
  }

  function toggleVisible(id: string) {
    setElements((prev) =>
      prev.map((e) => (e.id === id ? { ...e, visible: !e.visible } : e)),
    );
  }

  function handleMove(id: string, x: number, y: number) {
    setElements((prev) =>
      prev.map((e) =>
        e.id === id ? { ...e, x, y, anchor: reanchor({ ...e, x, y }) } : e,
      ),
    );
  }

  const stage = useOverlayStage({
    videoRef,
    canvasRef,
    cues,
    elements,
    selectedId: selectedElementId,
    resetKey: activeUrl,
    redrawSignal: fontTick,
    onSelect: setSelectedElementId,
    onMove: handleMove,
  });

  // --- transport ----------------------------------------------------------

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  }

  function handleScrub(value: number) {
    setTime(value);
    const v = videoRef.current;
    if (v) v.currentTime = value;
  }

  function goPrev() {
    if (activeIndex > 0) setActiveId(clips[activeIndex - 1].id);
  }
  function goNext() {
    if (activeIndex >= 0 && activeIndex < clips.length - 1) {
      setActiveId(clips[activeIndex + 1].id);
    }
  }

  // --- export -------------------------------------------------------------

  async function handleExport() {
    if (!activeClip || exporting) return;
    setExporting(true);
    setExportRatio(0);
    setExportError(null);
    setExportDone(false);
    const controller = new AbortController();
    exportAbort.current = controller;
    const meta = lib.meta.get(activeClip.id);
    try {
      await exportOverlay(
        activeClip.video,
        cues,
        elements,
        {
          codec: activeInfo.codec,
          width: meta?.width,
          height: meta?.height,
          videoPlayable: !activeError,
        },
        (p) => {
          if (p.phase === 'encoding' && p.ratio != null) setExportRatio(p.ratio);
        },
        controller.signal,
      );
      setExportDone(true);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setExportError((err as Error).message || 'Export failed');
      }
    } finally {
      setExporting(false);
      exportAbort.current = null;
    }
  }

  function cancelExport() {
    exportAbort.current?.abort();
  }

  // --- derived ------------------------------------------------------------

  const activeMeta = activeId ? lib.meta.get(activeId) : undefined;
  const activeRes =
    activeMeta?.width && activeMeta?.height
      ? `${activeMeta.width}×${activeMeta.height}`
      : null;
  const activeDetail = [
    activeRes,
    activeInfo.codec,
    activeInfo.fps ? `${activeInfo.fps} fps` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const selectedElement = elements.find((e) => e.id === selectedElementId) ?? null;
  // For the element-list value previews only; the canvas draws its own synced
  // cue. Binary search keeps this cheap even for tens of thousands of cues.
  const activeCue = findCue(cues, time);

  return (
    <section
      className="flex flex-col flex-1 min-h-0 gap-4"
      aria-label="Telemetry Overlay"
    >
      {/* Header: clip switcher + name + detail */}
      {activeClip && (
        <div className="flex items-center gap-[0.7rem] m-0 min-w-0">
          {clips.length > 1 && (
            <div className="flex items-center gap-1 flex-none">
              <button
                type="button"
                className="w-6 h-6 grid place-items-center rounded-full border border-line-strong bg-paper text-ink-soft cursor-pointer leading-none hover:border-accent hover:text-accent-ink disabled:opacity-40 disabled:cursor-default"
                onClick={goPrev}
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
                onClick={goNext}
                disabled={activeIndex >= clips.length - 1}
                aria-label="Next clip"
              >
                ›
              </button>
            </div>
          )}
          <span
            className="font-semibold text-[0.9rem] whitespace-nowrap overflow-hidden text-ellipsis"
            title={activeClip.name}
          >
            {activeClip.name}
          </span>
          {activeDetail && (
            <span className="font-mono text-[0.72rem] tracking-[0.02em] text-muted flex-none">
              {activeDetail}
            </span>
          )}
        </div>
      )}

      {/* Body: stage + inspector */}
      <div className="flex flex-col min-[900px]:flex-row gap-4 flex-1 min-h-0">
        {/* Stage */}
        <div className="flex flex-col gap-[0.6rem] flex-1 min-w-0 min-h-0">
          <div
            className={`relative rounded-paper overflow-hidden flex-1 min-h-0 flex items-center justify-center max-[820px]:min-h-[240px] ${
              activeUrl ? 'bg-frame' : 'bg-transparent'
            }`}
          >
            {activeUrl ? (
              <canvas
                ref={canvasRef}
                className="block w-auto h-auto max-w-full max-h-full object-contain bg-frame touch-none cursor-grab"
                onPointerDown={stage.onPointerDown}
                onPointerMove={stage.onPointerMove}
                onPointerUp={stage.onPointerUp}
                onPointerCancel={stage.onPointerUp}
              />
            ) : (
              <div className="w-full aspect-video flex items-center justify-center bg-surface border border-line rounded-paper text-muted text-center p-4 font-mono text-[0.85rem]">
                {clips.length === 0
                  ? 'Select a DJI clip with telemetry in the Library.'
                  : 'Select a clip to edit.'}
              </div>
            )}
            {/* Offscreen decoder + audio source. Kept rendered (not
                display:none) so the browser keeps producing frames. */}
            <video
              ref={videoRef}
              src={activeUrl ?? undefined}
              className="absolute w-0.5 h-0.5 left-0 bottom-0 opacity-0 pointer-events-none"
              playsInline
              muted
              onError={() => setActiveError(true)}
            />
          </div>

          {activeUrl && (
            <div className="flex items-center gap-[0.85rem] px-[0.85rem] py-[0.6rem] border border-line rounded-paper bg-surface flex-none">
              <button
                type="button"
                className="flex-none w-[2.2rem] h-[2.2rem] border-0 rounded-full bg-ink text-paper cursor-pointer text-[0.8rem] leading-none inline-flex items-center justify-center transition-[background-color] duration-200 ease-paper hover:bg-accent"
                onClick={togglePlay}
                aria-label={playing ? 'Pause' : 'Play'}
              >
                {playing ? '❚❚' : '▶'}
              </button>
              <span className="font-mono text-[0.74rem] tabular-nums text-muted flex-none min-w-[3.2ch] text-center">
                {formatTimecode(time)}
              </span>
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
                onPointerCancel={() => {
                  scrubbingRef.current = false;
                }}
                onChange={(e) => handleScrub(Number(e.target.value))}
                aria-label="Seek"
              />
              <span className="font-mono text-[0.74rem] tabular-nums text-muted flex-none min-w-[3.2ch] text-center">
                {formatDuration(duration)}
              </span>
            </div>
          )}

          {activeError && (
            <p className={notice}>
              This clip failed to decode for preview. DJI footage is often
              HEVC/H.265 — try Safari (best HEVC support) or transcode to H.264.
              Overlays still preview over the last frame.
            </p>
          )}
          {activeClip && cues.length === 0 && (
            <p className={notice}>
              No telemetry could be read from this clip's .srt — telemetry fields
              will show “—”. Free-text elements still work.
            </p>
          )}
        </div>

        {/* Inspector */}
        {activeClip && (
          <div className="flex flex-col gap-3 min-[900px]:w-[340px] flex-none min-h-0 overflow-auto border border-line rounded-paper bg-surface p-3">
            <h2 className="m-0 font-mono text-[0.7rem] font-medium uppercase tracking-[0.16em] text-muted">
              Elements
            </h2>
            <ElementList
              elements={elements}
              selectedId={selectedElementId}
              cue={activeCue}
              onSelect={setSelectedElementId}
              onAddField={(f: TelemetryFieldKey) =>
                addElement(createTelemetryElement(f))
              }
              onAddText={() => addElement(createTextElement())}
              onAddPreset={() => {
                const deck = defaultElementsPreset();
                setElements(deck);
                setSelectedElementId(deck[0]?.id ?? null);
              }}
              onRemove={removeElement}
              onToggleVisible={toggleVisible}
            />

            {selectedElement && (
              <div className="pt-3 border-t border-line">
                <h2 className="m-0 mb-2 font-mono text-[0.7rem] font-medium uppercase tracking-[0.16em] text-muted">
                  Style
                </h2>
                <ElementPanel
                  element={selectedElement}
                  onChange={(patch) => updateElement(selectedElement.id, patch)}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer: export */}
      <div className="flex items-center justify-end gap-4 border-t border-line pt-4 flex-none">
        {exporting ? (
          <>
            <div className="flex items-center gap-[0.85rem] flex-1" role="status">
              <span className="font-mono text-[0.74rem] tracking-[0.04em] text-ink-soft flex-none">
                Exporting… {Math.round(exportRatio * 100)}%
              </span>
              <progress
                data-export
                className="flex-1 h-2 accent-accent"
                value={exportRatio}
                max={1}
              />
            </div>
            <button
              type="button"
              className="p-0 border-0 bg-transparent text-accent-ink font-semibold cursor-pointer underline underline-offset-[3px] decoration-[1.5px] hover:text-accent"
              onClick={cancelExport}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            {!exportSupported && activeClip && (
              <span className="mr-auto text-[0.78rem] text-muted">
                Export needs WebCodecs (try Chrome/Edge/Safari) — editing works
                everywhere.
              </span>
            )}
            {exportDone && (
              <span className="mr-auto text-[0.78rem] text-[#3f6b3f] font-semibold" role="status">
                ✓ Exported
              </span>
            )}
            {exportError && (
              <span className="mr-auto text-[0.78rem] text-[#9a3a23]" role="status">
                {exportError}
              </span>
            )}
            <button
              type="button"
              className="px-[1.1rem] py-2 inline-flex items-center justify-center gap-2 border border-ink rounded-full bg-ink text-paper cursor-pointer text-[0.82rem] font-semibold transition-[transform,background-color,color] duration-200 ease-paper hover:bg-accent hover:border-accent hover:text-white active:scale-[0.98] disabled:opacity-50 disabled:cursor-default"
              onClick={handleExport}
              disabled={!activeClip || !exportSupported}
              title="Render a copy with the telemetry burned in (H.264 MP4)"
            >
              Export MP4
            </button>
          </>
        )}
      </div>
    </section>
  );
}
