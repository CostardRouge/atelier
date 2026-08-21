import { useEffect, useRef, useState } from 'react';
import { useAssetLibrary } from '../../shared/library/AssetLibraryContext';
import { useActiveAsset } from '../../shared/library/use-active-asset';
import { useObjectUrl } from '../../shared/media/use-object-url';
import { useVideoTransport } from '../../shared/media/use-video-transport';
import { formatDuration, formatTimecode } from '../../shared/lib/format';
import { isEncodeSupported } from '../../shared/media/webcodecs-export';
import { useVideoScrub } from '../../shared/media/use-video-scrub';
import { useTranscode } from '../../shared/media/use-transcode';
import TranscodeControl from '../../shared/media/TranscodeControl';
import { probeContainer, type ContainerInfo } from '../../shared/media/video-metadata';
import { parseSrt, type Cue } from '../../shared/telemetry/srt-parser';
import { findCue } from '../../shared/telemetry/find-cue';
import ElementList from '../../shared/overlay/ElementList';
import ElementPanel from '../../shared/overlay/ElementPanel';
import GuidesControl from '../../shared/overlay/GuidesControl';
import { exportOverlay } from '../../shared/overlay/export-overlay';
import { ensureOverlayFonts } from '../../shared/overlay/fonts';
import {
  createHeadingArrowElement,
  createTelemetryElement,
  createTextElement,
  defaultElementsPreset,
  type OverlayElement,
  type TelemetryFieldKey,
} from '../../shared/overlay/overlay-types';
import { reanchorInPlace } from '../../shared/overlay/draw-overlays';
import { DEFAULT_GUIDES, type GuidesState } from '../../shared/overlay/guides';
import { useOverlayStage } from '../../shared/overlay/use-overlay-stage';
import { useLutSelection } from '../../shared/lut/use-lut-selection';
import LutPicker from '../../shared/lut/LutPicker';

/** Clips with or without telemetry — the studio edits both. */
const STUDIO_KINDS = ['video+telemetry', 'video'] as const;

type PanelTab = 'overlay' | 'grade' | 'export';

const TABS: Array<{ id: PanelTab; label: string }> = [
  { id: 'overlay', label: 'Overlay' },
  { id: 'grade', label: 'Grade' },
  { id: 'export', label: 'Export' },
];

const notice =
  'my-2 px-4 py-[0.7rem] rounded-paper bg-accent-wash border border-[#eccabf] text-[#7c2e1c] text-[0.84rem] leading-[1.5]';

/**
 * Studio — the unified editor the suite is converging on (phase 1: viewer +
 * overlay + grade + export in one place; projects and title styles follow).
 *
 * One canvas stage in the centre — the same engine and renderer the export
 * uses, so what you see is what burns in — and an inspector on the right with
 * Overlay / Grade / Export tabs. Unlike the Telemetry Overlay page, clips
 * without an .srt are welcome: telemetry fields read “—”, free text and the
 * LUT still work.
 */
export default function StudioTool() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrub = useVideoScrub(videoRef);

  const lib = useAssetLibrary();
  const lutSel = useLutSelection();
  const { assets: clips, activeId, active, activeIndex, goPrev, goNext } =
    useActiveAsset(STUDIO_KINDS);

  const activeVideo = active?.parts.video ?? null;
  const activeSrt = active?.parts.srt ?? null;

  const [tab, setTab] = useState<PanelTab>('overlay');
  const [activeError, setActiveError] = useState(false);
  const [activeInfo, setActiveInfo] = useState<ContainerInfo>({});
  const [cues, setCues] = useState<Cue[]>([]);

  const [elements, setElements] = useState<OverlayElement[]>(defaultElementsPreset);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [guides, setGuides] = useState<GuidesState>(DEFAULT_GUIDES);
  const [fontTick, setFontTick] = useState(0);

  // Export state.
  const [exporting, setExporting] = useState(false);
  const [exportRatio, setExportRatio] = useState(0);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportDone, setExportDone] = useState(false);
  const exportAbort = useRef<AbortController | null>(null);
  const exportSupported = isEncodeSupported();

  // If the active clip can't be decoded (often HEVC), the user can transcode it
  // to H.264 in-browser; once ready, the preview and export use that instead.
  const activeTranscode = useTranscode(activeVideo);
  const activeSource = activeTranscode.transcoded ?? activeVideo;
  const activeUrl = useObjectUrl(activeSource);

  useEffect(() => {
    setActiveError(false);
  }, [activeSource]);

  // Reset export feedback and stale codec info when the active clip changes.
  useEffect(() => {
    setActiveInfo({});
    setExportDone(false);
    setExportError(null);
  }, [activeId]);

  // Parse the active clip's telemetry — clips without an .srt just get no cues.
  useEffect(() => {
    if (!activeSrt) {
      setCues([]);
      return;
    }
    let cancelled = false;
    activeSrt
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
  }, [activeSrt]);

  // Probe the active clip's container for codec + fps (best-effort).
  useEffect(() => {
    if (!activeVideo) return;
    let cancelled = false;
    probeContainer(activeVideo).then((info) => {
      if (!cancelled) setActiveInfo(info);
    });
    return () => {
      cancelled = true;
    };
  }, [activeVideo]);

  // Transport, with a first-frame prime: a tiny seek forces a decode +
  // 'seeked', which the stage repaints from, so the canvas shows the clip
  // instead of black before the user presses play.
  const { playing, time, duration, setTime, togglePlay } = useVideoTransport(
    videoRef,
    activeUrl,
    {
      scrubbingRef: scrub.scrubbingRef,
      onLoadedMetadata: (v) => {
        if (v.currentTime === 0) {
          try {
            v.currentTime = Math.min(0.001, (v.duration || 1) / 2);
          } catch {
            /* seeking unsupported — the frame will appear on first play */
          }
        }
      },
    },
  );

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
    setElements((prev) =>
      prev.map((e) => {
        if (e.id !== id) return e;
        // Re-anchoring keeps the element where it sits on screen: switch which
        // point is the handle, then recompute (x,y) so the box doesn't jump.
        if (patch.anchor && patch.anchor !== e.anchor) {
          const canvas = canvasRef.current;
          const ctx = canvas?.getContext('2d');
          let moved: { x: number; y: number } | null = null;
          if (canvas && ctx && canvas.width && canvas.height) {
            moved = reanchorInPlace(
              ctx,
              e,
              findCue(cues, videoRef.current?.currentTime ?? 0),
              canvas.width,
              canvas.height,
              patch.anchor,
            );
          }
          return moved ? { ...e, ...patch, ...moved } : { ...e, ...patch };
        }
        return { ...e, ...patch };
      }),
    );
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
    setElements((prev) => prev.map((e) => (e.id === id ? { ...e, x, y } : e)));
  }

  const stage = useOverlayStage({
    videoRef,
    canvasRef,
    cues,
    elements,
    selectedId: selectedElementId,
    guides,
    lut: lutSel.lut,
    intensity: lutSel.intensity,
    resetKey: activeUrl,
    redrawSignal: fontTick,
    onSelect: setSelectedElementId,
    onMove: handleMove,
  });

  function handleScrub(value: number) {
    setTime(value);
    scrub.to(value);
  }

  // --- export -------------------------------------------------------------

  async function handleExport() {
    if (!active || !activeVideo || exporting) return;
    setExporting(true);
    setExportRatio(0);
    setExportError(null);
    setExportDone(false);
    const controller = new AbortController();
    exportAbort.current = controller;
    const meta = lib.meta.get(active.id);
    // Prefer the transcoded H.264 (if one was made for preview): WebCodecs can
    // decode it directly, where the HEVC original would fall back or fail.
    const transcoded = activeTranscode.transcoded;
    try {
      await exportOverlay(
        transcoded ?? activeVideo,
        cues,
        elements,
        lutSel.lut,
        lutSel.intensity,
        {
          codec: transcoded ? undefined : activeInfo.codec,
          width: meta?.width,
          height: meta?.height,
          videoPlayable: transcoded ? true : !activeError,
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
  const activeCue = findCue(cues, time);
  const hasTelemetry = cues.length > 0;

  const tabButton = (t: { id: PanelTab; label: string }) => (
    <button
      key={t.id}
      type="button"
      onClick={() => setTab(t.id)}
      className={`flex-1 px-2 py-[0.45rem] font-mono text-[0.66rem] tracking-[0.14em] uppercase rounded-full cursor-pointer transition-colors ${
        tab === t.id
          ? 'bg-ink text-paper'
          : 'bg-transparent text-muted hover:text-accent-ink'
      }`}
      aria-pressed={tab === t.id}
    >
      {t.label}
    </button>
  );

  return (
    <section className="flex flex-col flex-1 min-h-0 gap-4" aria-label="Studio">
      {/* Header: clip switcher + name + detail */}
      {active && (
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
            title={active.baseName}
          >
            {active.baseName}
          </span>
          {activeDetail && (
            <span className="font-mono text-[0.72rem] tracking-[0.02em] text-muted flex-none">
              {activeDetail}
            </span>
          )}
          {!hasTelemetry && activeSrt === null && (
            <span className="font-mono text-[0.66rem] tracking-[0.08em] uppercase text-faint flex-none border border-line rounded-full px-2 py-[2px]">
              no telemetry
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
                  ? 'Select a clip in the Library to start editing.'
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
              preload="auto"
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
                onPointerDown={scrub.begin}
                onPointerUp={() => scrub.end()}
                onPointerCancel={() => scrub.end()}
                onChange={(e) => handleScrub(Number(e.target.value))}
                aria-label="Seek"
              />
              <span className="font-mono text-[0.74rem] tabular-nums text-muted flex-none min-w-[3.2ch] text-center">
                {formatDuration(duration)}
              </span>
            </div>
          )}

          {activeError && (
            <div className={`${notice} flex flex-col gap-3`}>
              <p className="m-0">
                This clip failed to decode for preview. DJI footage is often
                HEVC/H.265. Transcode it to H.264 to edit and export here (or
                try Safari, which decodes HEVC best). Overlays still preview
                over the last frame.
              </p>
              <TranscodeControl state={activeTranscode} />
            </div>
          )}
          {active && activeSrt && !hasTelemetry && (
            <p className={notice}>
              No telemetry could be read from this clip's .srt — telemetry
              fields will show “—”. Free-text elements still work.
            </p>
          )}
          {lutSel.cubeError && <p className={notice}>{lutSel.cubeError}</p>}
        </div>

        {/* Inspector */}
        {active && (
          <div className="flex flex-col gap-3 min-[900px]:w-[340px] flex-none min-h-0 border border-line rounded-paper bg-surface p-3">
            <div
              className="flex gap-1 p-1 rounded-full bg-paper border border-line flex-none"
              role="tablist"
              aria-label="Inspector"
            >
              {TABS.map(tabButton)}
            </div>

            <div className="flex flex-col gap-3 flex-1 min-h-0 overflow-auto">
              {tab === 'overlay' && (
                <>
                  <ElementList
                    elements={elements}
                    selectedId={selectedElementId}
                    cue={activeCue}
                    onSelect={setSelectedElementId}
                    onAddField={(f: TelemetryFieldKey) =>
                      addElement(createTelemetryElement(f))
                    }
                    onAddText={() => addElement(createTextElement())}
                    onAddArrow={() => addElement(createHeadingArrowElement())}
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
                        onChange={(patch) =>
                          updateElement(selectedElement.id, patch)
                        }
                      />
                    </div>
                  )}

                  <div className="pt-3 border-t border-line flex flex-wrap items-center gap-2">
                    <GuidesControl guides={guides} onChange={setGuides} />
                  </div>
                </>
              )}

              {tab === 'grade' && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-3">
                  <LutPicker
                    selected={lutSel.selected}
                    customName={lutSel.customName}
                    busy={lutSel.busy}
                    intensity={lutSel.intensity}
                    onIntensityChange={lutSel.setIntensity}
                    onSelect={lutSel.applySelection}
                    onUpload={lutSel.uploadCube}
                  />
                  <p className="m-0 w-full text-[0.78rem] text-muted leading-[1.5]">
                    The look grades the preview and the export identically —
                    same renderer, same result.
                  </p>
                </div>
              )}

              {tab === 'export' && (
                <div className="flex flex-col gap-3">
                  <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[0.8rem]">
                    <dt className="font-mono text-[0.66rem] tracking-[0.12em] uppercase text-muted pt-[2px]">
                      Source
                    </dt>
                    <dd className="m-0 truncate" title={active.baseName}>
                      {active.baseName}
                    </dd>
                    {activeDetail && (
                      <>
                        <dt className="font-mono text-[0.66rem] tracking-[0.12em] uppercase text-muted pt-[2px]">
                          Detail
                        </dt>
                        <dd className="m-0 font-mono text-[0.76rem] tabular-nums">
                          {activeDetail}
                        </dd>
                      </>
                    )}
                    <dt className="font-mono text-[0.66rem] tracking-[0.12em] uppercase text-muted pt-[2px]">
                      Output
                    </dt>
                    <dd className="m-0">
                      H.264 MP4, source resolution, overlays + look burned in
                    </dd>
                  </dl>

                  {!exportSupported && (
                    <p className="m-0 text-[0.78rem] text-muted">
                      Export needs WebCodecs (try Chrome/Edge/Safari) — editing
                      works everywhere.
                    </p>
                  )}

                  {exporting ? (
                    <div className="flex flex-col gap-2" role="status">
                      <div className="flex items-center gap-3">
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
                        className="self-start p-0 border-0 bg-transparent text-accent-ink font-semibold cursor-pointer underline underline-offset-[3px] decoration-[1.5px] hover:text-accent"
                        onClick={cancelExport}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <>
                      {exportDone && (
                        <span
                          className="text-[0.78rem] text-[#3f6b3f] font-semibold"
                          role="status"
                        >
                          ✓ Exported
                        </span>
                      )}
                      {exportError && (
                        <span className="text-[0.78rem] text-[#9a3a23]" role="status">
                          {exportError}
                        </span>
                      )}
                      <button
                        type="button"
                        className="px-[1.1rem] py-2 inline-flex items-center justify-center gap-2 border border-ink rounded-full bg-ink text-paper cursor-pointer text-[0.82rem] font-semibold transition-[transform,background-color,color] duration-200 ease-paper hover:bg-accent hover:border-accent hover:text-white active:scale-[0.98] disabled:opacity-50 disabled:cursor-default"
                        onClick={handleExport}
                        disabled={!active || !exportSupported}
                        title="Render a copy with the overlays and look burned in (H.264 MP4)"
                      >
                        Export MP4
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
