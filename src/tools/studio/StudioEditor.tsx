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
import ElementPalette from '../../shared/overlay/ElementPalette';
import ElementPanel from '../../shared/overlay/ElementPanel';
import GuidesControl from '../../shared/overlay/GuidesControl';
import { exportOverlayVideoViaSeek } from '../../shared/overlay/export-overlay-seek';
import { exportVariantVideo } from '../../shared/media/export-variant';
import { downloadBlob } from '../../shared/media/save';
import { frameGrabName, grabFrame } from '../../shared/media/frame-grab';
import {
  canWriteToDisk,
  pickWritableDirectory,
  writeItems,
} from '../../shared/sources/write-files';
import { DecodeUnsupportedError } from '../../shared/media/webcodecs-export';
import {
  FRAME_RATE_CHOICES,
  type ExportFrameRate,
} from '../../shared/media/frame-rate';
import {
  createVariant,
  defaultVariants,
  variantFileName,
  variantOutputSize,
  type ExportVariant,
  type VariantResolution,
} from '../../shared/projects/export-variants';
import { ensureOverlayFonts } from '../../shared/overlay/fonts';
import {
  defaultElementsPreset,
  type OverlayElement,
} from '../../shared/overlay/overlay-types';
import { reanchorInPlace } from '../../shared/overlay/draw-overlays';
import { DEFAULT_GUIDES, type GuidesState } from '../../shared/overlay/guides';
import { useOverlayStage } from '../../shared/overlay/use-overlay-stage';
import { useLutStack } from '../../shared/lut/use-lut-stack';
import GradePanel from './GradePanel';
import type { StyleTheme } from '../../shared/overlay/title-styles';
import StylePanel from './StylePanel';
import ProjectSettingsModal from './ProjectSettingsModal';
import InfoPanel from './InfoPanel';
import { ASPECT_PRESETS } from '../../shared/projects/project-types';
import { NO_SHIFT, type TimeShift } from '../../shared/telemetry/time-format';
import { savedMediaRef, type ProjectDoc } from '../../shared/projects/project-types';
import { putProject } from '../../shared/projects/project-store';
import type { Reconciliation } from '../../shared/projects/reconcile';

/** Clips with or without telemetry — the studio edits both. */
const STUDIO_KINDS = ['video+telemetry', 'video'] as const;

type PanelTab = 'overlay' | 'style' | 'grade' | 'info' | 'export';

/**
 * The project bar's chips. One fixed height for all of them — the save badge
 * used to be visibly smaller than its neighbours, which made the row look like
 * three unrelated widgets rather than one bar.
 */
const barPill =
  'flex-none inline-flex items-center gap-1.5 h-[1.95rem] px-3 rounded-full border transition-colors';

const TABS: Array<{ id: PanelTab; label: string }> = [
  { id: 'overlay', label: 'Overlay' },
  { id: 'style', label: 'Style' },
  { id: 'grade', label: 'Grade' },
  { id: 'info', label: 'Info' },
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
  const lutStack = useLutStack();
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
  const [resettingDeck, setResettingDeck] = useState(false);
  // The palette starts unfolded only when there is nothing on the frame yet.
  const [paletteOpen, setPaletteOpen] = useState(() => elements.length === 0);
  const [listOpen, setListOpen] = useState(true);
  const elementPanelRef = useRef<HTMLDivElement>(null);
  const [guides, setGuides] = useState<GuidesState>(() => project.guides ?? DEFAULT_GUIDES);
  const [fontTick, setFontTick] = useState(0);
  const [compareOn, setCompareOn] = useState(false);
  const [grabbing, setGrabbing] = useState(false);
  // Export destination: the browser's downloads, or a folder the user picks
  // once (File System Access — Chromium only). The handle lives for the
  // session; it is a delivery choice, not project data.
  const [destDir, setDestDir] = useState<FileSystemDirectoryHandle | null>(null);
  const [projectName, setProjectName] = useState(project.name);
  const [aspectId, setAspectId] = useState(project.settings.aspectId);
  // The clip's capture-time correction — footage-level, so every clock, date
  // and timestamp element reads through the same one.
  const [timeShift, setTimeShift] = useState<TimeShift>(
    () => project.settings.timeShift ?? { ...NO_SHIFT },
  );
  const [showSettings, setShowSettings] = useState(false);
  const [theme, setTheme] = useState<StyleTheme | null>(() => project.theme);
  const [saveState, setSaveState] = useState<SaveState>('saved');

  // Export state.
  const [exporting, setExporting] = useState(false);
  const [exportRatio, setExportRatio] = useState(0);
  const [exportStep, setExportStep] = useState<{ index: number; total: number } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportDone, setExportDone] = useState(false);
  const [exportFileName, setExportFileName] = useState(project.exportPrefs.fileName ?? '');
  const [variants, setVariants] = useState<ExportVariant[]>(() =>
    project.exportPrefs.variants.length
      ? structuredClone(project.exportPrefs.variants)
      : defaultVariants(),
  );
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
    void lutStack.restore(project.lutStack, project.outputTransform);
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
              timeShift,
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
    // Touching the deck answers the reset question; an armed confirmation must
    // never sit waiting behind work done since.
    setResettingDeck(false);
  }

  /** Replace the deck with the starter preset — the only destructive add. */
  function loadDefaultDeck() {
    const deck = defaultElementsPreset();
    setElements(deck);
    setSelectedElementId(deck[0]?.id ?? null);
    setResettingDeck(false);
  }

  function removeElement(id: string) {
    setElements((prev) => prev.filter((e) => e.id !== id));
    setSelectedElementId((s) => (s === id ? null : s));
    setResettingDeck(false);
  }

  // Delete / Backspace removes the selected element. Guarded on the event
  // target: the same keys must keep editing text inside the project name, a
  // free-text element, a file name or any number box.
  useEffect(() => {
    if (!selectedElementId) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
      ) {
        return;
      }
      e.preventDefault(); // Backspace would otherwise navigate back.
      removeElement(selectedElementId!);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // `removeElement` only calls state updaters, so the mounted listener stays
    // correct; the selected id is what has to be fresh.
  }, [selectedElementId]);

  // Picking an element is a request to edit it, wherever the inspector
  // happens to be: the settings only exist on the Overlay tab, so a click on
  // the stage from Style / Grade / Info / Export comes back with the tab.
  function selectElement(id: string | null) {
    setSelectedElementId(id);
    if (id) setTab('overlay');
  }

  // Selecting an element — from the list, or by clicking it on the stage —
  // brings its settings into view. With a long deck the panel sits well below
  // the fold, and hunting for it was the maintainer's complaint. Keyed on the
  // tab too: coming back from another tab must scroll even when the selection
  // itself did not change (clicking the element that was already selected).
  useEffect(() => {
    if (!selectedElementId || tab !== 'overlay') return;
    elementPanelRef.current?.scrollIntoView({
      block: 'nearest',
      behavior: 'smooth',
    });
  }, [selectedElementId, tab]);

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
    lut: lutStack.composed,
    intensity: 1,
    interpolation: lutStack.interpolation,
    theme,
    timeShift,
    compare: compareOn,
    resetKey: activeUrl,
    redrawSignal: fontTick,
    onSelect: selectElement,
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
          settings: { ...docRef.current.settings, aspectId, timeShift },
          elements,
          guides,
          lutStack: lutStack.toSaved(),
          outputTransform: lutStack.output,
          theme,
          exportPrefs: {
            fileName: exportFileName.trim() || null,
            variants,
          },
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
    aspectId,
    timeShift,
    theme,
    exportFileName,
    variants,
    activeId,
    lutStack.layers,
    lutStack.output,
    clips,
  ]);

  // --- export -------------------------------------------------------------

  /** Render every requested variant in turn; each downloads as it finishes. */
  async function handleExport() {
    if (!active || !activeVideo || exporting || variants.length === 0) return;
    const meta = lib.meta.get(active.id);
    const srcWidth = meta?.width ?? videoRef.current?.videoWidth ?? 0;
    const srcHeight = meta?.height ?? videoRef.current?.videoHeight ?? 0;
    if (!srcWidth || !srcHeight) {
      setExportError('The clip has not produced its dimensions yet — play a frame first.');
      return;
    }
    setExporting(true);
    setExportRatio(0);
    setExportError(null);
    setExportDone(false);
    const controller = new AbortController();
    exportAbort.current = controller;
    // Prefer the transcoded H.264 (if one was made for preview): WebCodecs can
    // decode it directly, where the HEVC original would fail.
    const source = activeTranscode.transcoded ?? activeVideo;
    const base = exportFileName.trim() || active.baseName;
    try {
      for (let i = 0; i < variants.length; i += 1) {
        const variant = variants[i];
        setExportStep({ index: i + 1, total: variants.length });
        setExportRatio(0);
        const opts = {
          elements,
          cues,
          lut: lutStack.composed,
          intensity: 1,
          theme,
          timeShift,
          srcWidth,
          srcHeight,
        };
        const onProgress = (p: { phase: string; ratio: number | null }) => {
          if (p.phase === 'encoding' && p.ratio != null) setExportRatio(p.ratio);
        };
        let blob: Blob;
        try {
          blob = await exportVariantVideo(source, variant, opts, onProgress, controller.signal);
        } catch (err) {
          // Source-geometry variants keep the codec-agnostic seek fallback
          // (playable-but-undecodable HEVC); reframed ones cannot.
          const sourceGeometry =
            variant.aspectId === 'source' && variant.resolution === 'source';
          if (
            err instanceof DecodeUnsupportedError &&
            sourceGeometry &&
            !activeError
          ) {
            blob = await exportOverlayVideoViaSeek(
              source,
              cues,
              variant.overlays ? elements : [],
              lutStack.composed,
              1,
              theme,
              timeShift,
              onProgress,
              controller.signal,
              variant.frameRate,
            );
          } else if (err instanceof DecodeUnsupportedError) {
            throw new Error(
              "This browser can't decode the source for a reframed export — transcode the clip to H.264 first (Overlay tab banner).",
            );
          } else {
            throw err;
          }
        }
        await deliver(blob, variantFileName(base, variant));
      }
      setExportDone(true);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setExportError((err as Error).message || 'Export failed');
      }
    } finally {
      setExporting(false);
      setExportStep(null);
      exportAbort.current = null;
    }
  }

  function updateVariant(id: string, patch: Partial<ExportVariant>) {
    setVariants((prev) => prev.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  }
  function addVariant() {
    // A new row starts from the project's destination format — the reason the
    // format lives in the settings.
    setVariants((prev) => [...prev, createVariant(aspectId)]);
  }
  function removeVariant(id: string) {
    setVariants((prev) => (prev.length > 1 ? prev.filter((v) => v.id !== id) : prev));
  }

  function cancelExport() {
    exportAbort.current?.abort();
  }

  /** Write one finished file: into the chosen folder, else download it. */
  async function deliver(blob: Blob, name: string): Promise<void> {
    if (destDir) {
      const res = await writeItems(destDir, [
        { name, file: new File([blob], name, { type: blob.type }) },
      ]);
      if (res.errors.length) throw new Error(res.errors[0].message);
      return;
    }
    downloadBlob(blob, name);
  }

  /** Capture the composed frame under the playhead as a JPEG still. */
  async function handleGrabFrame() {
    const video = videoRef.current;
    if (!video || !active || grabbing) return;
    setGrabbing(true);
    try {
      const blob = await grabFrame(video, {
        elements,
        cues,
        lut: lutStack.composed,
        intensity: 1,
        theme,
        timeShift,
        overlays: true,
      });
      if (blob) {
        await deliver(
          blob,
          frameGrabName(exportFileName.trim() || active.baseName, video.currentTime),
        );
      } else {
        setExportError('No decoded frame to capture yet — play or scrub first.');
      }
    } catch (err) {
      setExportError((err as Error).message || 'Frame capture failed');
    } finally {
      setGrabbing(false);
    }
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
  // The clip's own cadence, when the container probe produced one — used to
  // label "Source fps" and to warn when a variant asks for more than exists.
  const sourceFps = activeInfo.fps && activeInfo.fps > 0 ? activeInfo.fps : null;

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
      {/* Project bar: back to gallery, editable name, then — pinned right —
          the save state and the format/settings pill. Every pill shares one
          height so the row reads as a single band, not a drift of chips. */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onShowProjects}
          className={`${barPill} border-line-strong bg-paper text-[0.78rem] font-semibold text-ink-soft cursor-pointer hover:border-accent hover:text-accent-ink`}
        >
          ‹ Projects
        </button>
        <input
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          aria-label="Project name"
          className="flex-1 min-w-0 max-w-[24rem] font-serif text-[1.15rem] bg-transparent border-0 border-b border-transparent focus:border-line-strong focus:outline-none text-ink px-1 py-0.5"
        />
        <span className="flex-1" />
        <span
          className={`${barPill} font-mono text-[0.64rem] tracking-[0.1em] uppercase ${saveBadge[saveState].cls}`}
          role="status"
        >
          {saveBadge[saveState].label}
        </span>
        <button
          type="button"
          onClick={() => setShowSettings(true)}
          className={`${barPill} border-line-strong bg-paper font-mono text-[0.68rem] tracking-[0.06em] text-ink-soft cursor-pointer hover:border-accent hover:text-accent-ink`}
          title="Project settings — name, format"
        >
          {ASPECT_PRESETS.find((a) => a.id === aspectId)?.id ?? aspectId}
          <span className="text-[1.05rem] leading-none" aria-hidden="true">
            ⚙
          </span>
        </button>
      </div>

      {showSettings && (
        <ProjectSettingsModal
          name={projectName}
          aspectId={aspectId}
          timeShift={timeShift}
          onCancel={() => setShowSettings(false)}
          onApply={({ name, aspectId: nextAspect, timeShift: nextShift }) => {
            setProjectName(name);
            setAspectId(nextAspect);
            setTimeShift(nextShift);
            setShowSettings(false);
          }}
        />
      )}

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

      {/*
        Body: stage + inspector.

        The split is a CONTAINER query, not a viewport one. The editor's real
        estate is the window minus the Library sidebar (288px) and the shell's
        margins, so a viewport breakpoint lied: at a 1000px window the row
        layout still applied and the 340px inspector left the stage 308px —
        the inspector was wider than the picture. Measuring the editor's own
        width puts the two side by side only when there is room for both.

        The container wrapper exists so the settings modal, a sibling of this
        block, stays out of it: `container-type: inline-size` implies layout
        containment, which would make a `position: fixed` overlay resolve
        against the container instead of the viewport.
      */}
      <div className="@container flex-1 min-h-0 flex flex-col">
      <div className="flex flex-col @min-[800px]:flex-row gap-4 flex-1 min-h-0">
        {/* Stage */}
        <div className="flex flex-col gap-[0.6rem] flex-1 min-w-0 min-h-0">
          <div
            className={`relative rounded-paper overflow-hidden flex-1 min-h-0 flex items-center justify-center @max-[800px]:min-h-[240px] ${
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
              <button
                type="button"
                onClick={() => void handleGrabFrame()}
                disabled={grabbing}
                className="flex-none px-2.5 py-1 rounded-full border border-line-strong bg-paper text-[0.78rem] text-muted cursor-pointer hover:text-accent-ink hover:border-accent transition-colors disabled:opacity-50 disabled:cursor-default"
                title="Save this frame as a JPEG, overlays and look burned in"
                aria-label="Capture frame"
              >
                {grabbing ? '…' : '⌾'}
              </button>
              <button
                type="button"
                onClick={() => setCompareOn((c) => !c)}
                aria-pressed={compareOn}
                className={`flex-none px-2.5 py-1 rounded-full border font-mono text-[0.64rem] tracking-[0.1em] cursor-pointer transition-colors ${
                  compareOn
                    ? 'border-accent bg-accent-wash text-accent-ink'
                    : 'border-line-strong bg-paper text-muted hover:text-accent-ink hover:border-accent'
                }`}
                title="Compare original vs composed — drag the divider on the stage"
              >
                A/B
              </button>
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
          {lutStack.error && <p className={notice}>{lutStack.error}</p>}
        </div>

        {/* Inspector */}
        {active && (
          <div className="flex flex-col gap-3 @min-[800px]:w-[340px] flex-none min-h-0 @max-[800px]:max-h-[45vh] border border-line rounded-paper bg-surface p-3">
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
                  <ElementPalette
                    elements={elements}
                    cue={activeCue}
                    theme={theme}
                    timeShift={timeShift}
                    onAdd={addElement}
                    open={paletteOpen}
                    onOpenChange={setPaletteOpen}
                  />

                  <div className="pt-3 border-t border-line flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => setListOpen((o) => !o)}
                      aria-expanded={listOpen}
                      className="flex items-center gap-1.5 p-0 border-0 bg-transparent text-accent-ink font-semibold text-[0.82rem] cursor-pointer hover:text-accent"
                    >
                      <span aria-hidden="true" className="text-[0.7rem]">
                        {listOpen ? '▾' : '▸'}
                      </span>
                      Elements
                      <span className="ml-auto font-mono text-[0.66rem] tabular-nums text-muted">
                        {elements.length}
                      </span>
                    </button>
                    {/*
                      Capped and scrollable rather than free-growing: a deck of
                      fifteen readouts used to push the style panel off the
                      bottom of the inspector.
                    */}
                    {listOpen && (
                      <div className="max-h-[15rem] overflow-y-auto overscroll-contain -mx-1 px-1">
                        <ElementList
                          elements={elements}
                          selectedId={selectedElementId}
                          cue={activeCue}
                          timeShift={timeShift}
                          onSelect={selectElement}
                          onRemove={removeElement}
                          onToggleVisible={toggleVisible}
                        />
                      </div>
                    )}

                    {/* The starter deck: an offer when there is nothing to
                        lose, a two-step confirm once there is. */}
                    {elements.length === 0 ? (
                      <button
                        type="button"
                        onClick={loadDefaultDeck}
                        className="self-start p-0 border-0 bg-transparent text-[0.78rem] text-accent-ink font-semibold cursor-pointer underline underline-offset-[3px] hover:text-accent"
                      >
                        Start from the default deck
                      </button>
                    ) : resettingDeck ? (
                      <span className="flex flex-wrap items-center gap-2 text-[0.75rem] text-muted">
                        Replace {elements.length} element
                        {elements.length > 1 ? 's' : ''} with the default deck?
                        <button
                          type="button"
                          onClick={loadDefaultDeck}
                          className="p-0 border-0 bg-transparent text-[#9a3a23] font-semibold cursor-pointer underline underline-offset-[3px]"
                        >
                          Reset
                        </button>
                        <button
                          type="button"
                          onClick={() => setResettingDeck(false)}
                          className="p-0 border-0 bg-transparent text-muted cursor-pointer"
                        >
                          Keep
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setResettingDeck(true)}
                        className="self-start p-0 border-0 bg-transparent text-[0.75rem] text-faint cursor-pointer hover:text-[#9a3a23]"
                      >
                        Reset deck
                      </button>
                    )}
                  </div>

                  {selectedElement && (
                    <div ref={elementPanelRef} className="pt-3 border-t border-line scroll-mt-2">
                      <h2 className="m-0 mb-2 flex items-baseline gap-2 font-mono text-[0.7rem] font-medium uppercase tracking-[0.16em] text-muted">
                        Style
                        <span className="ml-auto normal-case tracking-normal text-[0.68rem] text-faint">
                          Delete removes it
                        </span>
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

              {tab === 'grade' && <GradePanel stack={lutStack} />}

              {tab === 'info' && (
                <InfoPanel
                  baseName={active.baseName}
                  video={activeVideo}
                  detail={activeDetail}
                  duration={duration}
                  cues={cues}
                  cue={activeCue}
                />
              )}

              {tab === 'export' && (
                <div className="flex flex-col gap-3.5">
                  <label className="flex flex-col gap-1">
                    <span className="font-mono text-[0.66rem] tracking-[0.12em] uppercase text-muted">
                      File name
                    </span>
                    <input
                      type="text"
                      value={exportFileName}
                      onChange={(e) => setExportFileName(e.target.value)}
                      placeholder={active.baseName}
                      className="font-sans text-[0.84rem] px-3 py-2 border border-line-strong rounded-paper bg-paper text-ink focus:outline-none focus:border-accent"
                    />
                  </label>

                  <div className="flex flex-col gap-1">
                    <span className="font-mono text-[0.66rem] tracking-[0.12em] uppercase text-muted">
                      Destination
                    </span>
                    <div className="flex items-center gap-2 min-w-0">
                      {canWriteToDisk() ? (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              void pickWritableDirectory()
                                .then(setDestDir)
                                .catch(() => undefined);
                            }}
                            className="flex-none px-3 py-[0.35rem] rounded-full border border-line-strong bg-paper text-[0.78rem] font-semibold text-ink cursor-pointer hover:border-accent"
                          >
                            {destDir ? 'Change folder…' : 'Choose folder…'}
                          </button>
                          <span className="min-w-0 truncate text-[0.76rem] text-muted">
                            {destDir ? destDir.name : 'Downloads'}
                          </span>
                          {destDir && (
                            <button
                              type="button"
                              onClick={() => setDestDir(null)}
                              className="flex-none p-0 border-0 bg-transparent text-[0.74rem] text-faint cursor-pointer hover:text-accent-ink underline underline-offset-[2px]"
                            >
                              use downloads
                            </button>
                          )}
                        </>
                      ) : (
                        <span className="text-[0.76rem] text-muted">
                          Downloads — folder writing needs Chromium.
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[0.66rem] tracking-[0.12em] uppercase text-muted">
                      Variants · {variants.length}
                    </span>
                    <button
                      type="button"
                      onClick={addVariant}
                      className="p-0 border-0 bg-transparent text-[0.78rem] text-accent-ink font-semibold cursor-pointer underline underline-offset-[3px] hover:text-accent"
                    >
                      + Add variant
                    </button>
                  </div>

                  <div className="flex flex-col gap-2">
                    {variants.map((v) => {
                      const dims =
                        activeMeta?.width && activeMeta?.height
                          ? variantOutputSize(v, activeMeta.width, activeMeta.height)
                          : null;
                      return (
                        <div
                          key={v.id}
                          className="flex flex-col gap-2 border border-line rounded-paper bg-paper px-2.5 py-2"
                        >
                          <div className="flex items-center gap-2">
                            <select
                              className="flex-1 min-w-0 font-sans text-[0.78rem] px-2 py-[0.35rem] border border-line-strong rounded-paper bg-surface text-ink cursor-pointer focus:outline-none focus:border-accent"
                              value={v.aspectId}
                              onChange={(e) => updateVariant(v.id, { aspectId: e.target.value })}
                              aria-label="Variant format"
                            >
                              <option value="source">Source frame</option>
                              {ASPECT_PRESETS.map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.id} — {a.label}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => removeVariant(v.id)}
                              disabled={variants.length <= 1}
                              className="flex-none w-6 h-6 grid place-items-center rounded-full border border-line bg-transparent text-faint cursor-pointer hover:text-[#9a3a23] hover:border-[#e3b8a9] disabled:opacity-30 disabled:cursor-default"
                              aria-label="Remove variant"
                              title="Remove this variant"
                            >
                              ×
                            </button>
                          </div>
                          <div className="flex items-center gap-2">
                            <select
                              className="flex-1 min-w-0 font-sans text-[0.78rem] px-2 py-[0.35rem] border border-line-strong rounded-paper bg-surface text-ink cursor-pointer focus:outline-none focus:border-accent"
                              value={String(v.resolution)}
                              onChange={(e) =>
                                updateVariant(v.id, {
                                  resolution: (e.target.value === 'source'
                                    ? 'source'
                                    : Number(e.target.value)) as VariantResolution,
                                })
                              }
                              aria-label="Variant resolution"
                            >
                              <option value="source">Source res</option>
                              <option value="1080">1080p</option>
                              <option value="720">720p</option>
                            </select>
                            <select
                              className="flex-1 min-w-0 font-sans text-[0.78rem] px-2 py-[0.35rem] border border-line-strong rounded-paper bg-surface text-ink cursor-pointer focus:outline-none focus:border-accent"
                              value={String(v.frameRate)}
                              onChange={(e) =>
                                updateVariant(v.id, {
                                  frameRate: (e.target.value === 'source'
                                    ? 'source'
                                    : Number(e.target.value)) as ExportFrameRate,
                                })
                              }
                              aria-label="Variant frame rate"
                              title="Delivery frame rate — 'Source fps' keeps every frame exactly as shot"
                            >
                              <option value="source">
                                Source fps{sourceFps ? ` (${sourceFps})` : ''}
                              </option>
                              {FRAME_RATE_CHOICES.map((f) => (
                                <option key={f} value={f}>
                                  {f} fps
                                </option>
                              ))}
                            </select>
                          </div>
                          {/* Say what a higher cadence really does: the encoder
                              repeats frames, it does not invent motion. */}
                          {sourceFps && v.frameRate !== 'source' && v.frameRate > sourceFps && (
                            <p className="m-0 text-[0.7rem] leading-snug text-muted">
                              {v.frameRate} fps from {sourceFps} — frames are
                              duplicated, not interpolated: no new motion.
                            </p>
                          )}
                          <div className="flex items-center gap-2 min-w-0">
                            <label className="flex items-center gap-1.5 cursor-pointer select-none flex-none">
                              <input
                                type="checkbox"
                                className="w-3.5 h-3.5 accent-accent cursor-pointer"
                                checked={v.overlays}
                                onChange={(e) => updateVariant(v.id, { overlays: e.target.checked })}
                              />
                              <span className="font-mono text-[0.62rem] tracking-[0.1em] uppercase text-muted">
                                Overlays
                              </span>
                            </label>
                            <span
                              className="flex-1 min-w-0 text-right font-mono text-[0.68rem] tabular-nums text-faint truncate"
                              title={variantFileName(exportFileName.trim() || active.baseName, v)}
                            >
                              {dims ? `${dims.w}×${dims.h} · ` : ''}
                              {variantFileName(exportFileName.trim() || active.baseName, v)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

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
                          {exportStep && exportStep.total > 1
                            ? `Variant ${exportStep.index}/${exportStep.total} · `
                            : 'Exporting… '}
                          {Math.round(exportRatio * 100)}%
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
                          ✓ Exported {variants.length > 1 ? `${variants.length} variants` : ''}
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
                        title="Render every variant (H.264 MP4), one after the other"
                      >
                        Export {variants.length > 1 ? `${variants.length} MP4s` : 'MP4'}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      </div>
    </section>
  );
}
