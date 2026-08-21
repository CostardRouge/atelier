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
import type { StyleTheme } from '../../shared/overlay/title-styles';
import StylePanel from './StylePanel';
import { savedMediaRef, type ProjectDoc } from '../../shared/projects/project-types';
import { putProject } from '../../shared/projects/project-store';
import type { Reconciliation } from '../../shared/projects/reconcile';

/** Clips with or without telemetry — the studio edits both. */
const STUDIO_KINDS = ['video+telemetry', 'video'] as const;

type PanelTab = 'overlay' | 'style' | 'grade' | 'export';

const TABS: Array<{ id: PanelTab; label: string }> = [
  { id: 'overlay', label: 'Overlay' },
  { id: 'style', label: 'Style' },
  { id: 'grade', label: 'Grade' },
  { id: 'export', label: 'Export' },
];

const notice =
  'my-2 px-4 py-[0.7rem] rounded-paper bg-accent-wash border border-[#eccabf] text-[#7c2e1c] text-[0.84rem] leading-[1.5]';

type SaveState = 'saved' | 'saving' | 'unsaved' | 'storage-error';

interface StudioEditorProps {
  /** The open project. Keyed by `project.id` upstream, so opening another
   * project remounts the editor with fresh state. */
  project: ProjectDoc;
  /** Media reconciliation computed at open time, if the project had media. */
  reconciliation: Reconciliation | null;
  /** Back to the gallery. */
  onShowProjects: () => void;
  /** The autosaved document, so the shell keeps its copy fresh. */
  onDocSaved: (doc: ProjectDoc) => void;
  /** Re-point the media folder (missing/changed media, or no handle). */
  onRepoint: () => void;
}

/**
 * Studio editor — one canvas stage in the centre (the same engine and renderer
 * the export uses, so what you see is what burns in) and an inspector on the
 * right with Overlay / Grade / Export tabs. Clips without an .srt are welcome:
 * telemetry fields read “—”, free text and the LUT still work.
 *
 * Everything the user does here autosaves into the project document
 * (debounced, IndexedDB), including a stage thumbnail for the gallery.
 */
export default function StudioEditor({
  project,
  reconciliation,
  onShowProjects,
  onDocSaved,
  onRepoint,
}: StudioEditorProps) {
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

  const [elements, setElements] = useState<OverlayElement[]>(() =>
    project.elements.length ? project.elements : defaultElementsPreset(),
  );
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [guides, setGuides] = useState<GuidesState>(() => project.guides ?? DEFAULT_GUIDES);
  const [fontTick, setFontTick] = useState(0);
  const [projectName, setProjectName] = useState(project.name);
  const [theme, setTheme] = useState<StyleTheme | null>(() => project.theme);
  const [saveState, setSaveState] = useState<SaveState>('saved');

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

  // One-shot restores from the document: the saved LUT, and the clip that was
  // active when the project was last saved (once the library holds it).
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    void lutSel.restore(project.lut);
    if (project.media.activeId && clips.some((c) => c.id === project.media.activeId)) {
      lib.setActive(project.media.activeId);
    }
    // Mount-only by design: the editor is keyed by project.id.
  }, []);

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
    ensureOverlayFonts(elements, theme).then(() => {
      if (!cancelled) setFontTick((t) => t + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [elements, theme]);

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
              theme,
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
    theme,
    resetKey: activeUrl,
    redrawSignal: fontTick,
    onSelect: setSelectedElementId,
    onMove: handleMove,
  });

  function handleScrub(value: number) {
    setTime(value);
    scrub.to(value);
  }

  // --- autosave -----------------------------------------------------------

  // Everything the user does lands in the project document, debounced. The
  // stage canvas is downscaled into a thumbnail so the gallery renders without
  // touching the media. Failures flip the badge to "storage-error" — editing
  // continues in memory.
  const docRef = useRef(project);
  const durationRef = useRef<number>(project.durationSeconds ?? 0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstRun = useRef(true);

  useEffect(() => {
    if (duration > 0) durationRef.current = duration;
  }, [duration]);

  async function bakeThumbnail(): Promise<Blob | null> {
    const src = canvasRef.current;
    if (!src || !src.width || !src.height) return docRef.current.thumbnail;
    const w = 480;
    const h = Math.max(1, Math.round((src.height / src.width) * w));
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    out.getContext('2d')?.drawImage(src, 0, 0, w, h);
    return new Promise((resolve) =>
      out.toBlob((b) => resolve(b ?? docRef.current.thumbnail), 'image/jpeg', 0.72),
    );
  }

  useEffect(() => {
    if (firstRun.current) {
      // The seeding render is not a user edit.
      firstRun.current = false;
      return;
    }
    setSaveState('unsaved');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void (async () => {
        setSaveState('saving');
        const mediaFiles = clips.flatMap((c) =>
          [c.parts.video, c.parts.srt, c.parts.image]
            .filter((f): f is File => !!f)
            .map(savedMediaRef),
        );
        const doc: ProjectDoc = {
          ...docRef.current,
          name: projectName.trim() || docRef.current.name,
          updatedAt: Date.now(),
          elements,
          guides,
          lut: {
            selected: lutSel.selected,
            customName: lutSel.customName,
            customText: lutSel.customText,
            intensity: lutSel.intensity,
          },
          theme,
          media: {
            ...docRef.current.media,
            files: mediaFiles.length ? mediaFiles : docRef.current.media.files,
            activeId,
          },
          thumbnail: await bakeThumbnail(),
          durationSeconds: durationRef.current || docRef.current.durationSeconds,
        };
        docRef.current = doc;
        const ok = await putProject(doc);
        onDocSaved(doc);
        setSaveState(ok ? 'saved' : 'storage-error');
      })();
    }, 800);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // Autosave is driven by the edited state, not by callback identities.
  }, [
    elements,
    guides,
    projectName,
    theme,
    activeId,
    lutSel.selected,
    lutSel.intensity,
    lutSel.customText,
    clips,
  ]);

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
        theme,
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

  const saveBadge: Record<SaveState, { label: string; cls: string }> = {
    saved: { label: 'Saved', cls: 'text-[#3f6b3f] border-[#c7d6c0]' },
    saving: { label: 'Saving…', cls: 'text-muted border-line' },
    unsaved: { label: 'Edited', cls: 'text-muted border-line' },
    'storage-error': {
      label: 'Storage unavailable — in-memory only',
      cls: 'text-[#9a3a23] border-[#e3b8a9]',
    },
  };

  const mediaTrouble =
    reconciliation && reconciliation.missing + reconciliation.changed > 0;

  return (
    <section className="flex flex-col flex-1 min-h-0 gap-4" aria-label="Studio">
      {/* Project bar: back to gallery, editable name, save state */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onShowProjects}
          className="flex-none inline-flex items-center gap-1.5 px-3 py-[0.4rem] rounded-full border border-line-strong bg-paper text-[0.78rem] font-semibold text-ink-soft cursor-pointer hover:border-accent hover:text-accent-ink transition-colors"
        >
          ‹ Projects
        </button>
        <input
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          aria-label="Project name"
          className="flex-1 min-w-0 max-w-[24rem] font-serif text-[1.15rem] bg-transparent border-0 border-b border-transparent focus:border-line-strong focus:outline-none text-ink px-1 py-0.5"
        />
        <span
          className={`flex-none font-mono text-[0.64rem] tracking-[0.1em] uppercase border rounded-full px-2.5 py-[3px] ${saveBadge[saveState].cls}`}
          role="status"
        >
          {saveBadge[saveState].label}
        </span>
      </div>

      {mediaTrouble && (
        <div className={`${notice} m-0 flex flex-wrap items-center gap-x-4 gap-y-2`}>
          <span>
            {reconciliation.missing > 0 &&
              `${reconciliation.missing} media file${reconciliation.missing > 1 ? 's' : ''} missing`}
            {reconciliation.missing > 0 && reconciliation.changed > 0 && ' · '}
            {reconciliation.changed > 0 &&
              `${reconciliation.changed} changed since last save`}
            {' '}— the project stays editable.
          </span>
          <button
            type="button"
            onClick={onRepoint}
            className="p-0 border-0 bg-transparent text-accent-ink font-semibold cursor-pointer underline underline-offset-[3px] decoration-[1.5px] hover:text-accent"
          >
            Point to the media folder…
          </button>
        </div>
      )}

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
                  ? 'No media in this project yet — add clips from the Library, or point a folder from the banner above.'
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
                        theme={theme}
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

              {tab === 'style' && (
                <StylePanel theme={theme} onChange={setTheme} />
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
