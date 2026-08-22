import { useEffect, useMemo, useRef, useState } from 'react';
import { useAssetLibrary } from '../../shared/library/AssetLibraryContext';
import { useActiveAsset } from '../../shared/library/use-active-asset';
import { useObjectUrl } from '../../shared/media/use-object-url';
import {
  clampPlaybackRate,
  useVideoTransport,
} from '../../shared/media/use-video-transport';
import { formatDuration, formatTimecode } from '../../shared/lib/format';
import { isEncodeSupported } from '../../shared/media/webcodecs-export';
import { useVideoScrub } from '../../shared/media/use-video-scrub';
import TrimBar from '../../shared/media/TrimBar';
import {
  clampPlayhead,
  exportTrim,
  fullRange,
  isTrimmed,
  minTrimLength,
  restoreTrim,
  saveTrim,
  setEnd as setTrimEnd,
  setStart as setTrimStart,
  trimDuration,
  type SavedTrim,
  type TrimRange,
} from '../../shared/media/trim';
import {
  describeKeyTarget,
  targetOwnsTyping,
} from '../../shared/media/transport-keys';
import { useTranscode } from '../../shared/media/use-transcode';
import TranscodeControl from '../../shared/media/TranscodeControl';
import { probeContainer, type ContainerInfo } from '../../shared/media/video-metadata';
import { parseSrt, type Cue } from '../../shared/telemetry/srt-parser';
import { findCue } from '../../shared/telemetry/find-cue';
import ElementList from '../../shared/overlay/ElementList';
import ElementPalette from '../../shared/overlay/ElementPalette';
import ElementPanel from '../../shared/overlay/ElementPanel';
import ScenePanel from '../../shared/overlay/ScenePanel';
import TimingPanel from '../../shared/overlay/TimingPanel';
import { createIntroScene, findScene, type Scene } from '../../shared/overlay/scenes';
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
  SPEED_CHOICES,
  resolveSpeed,
  retimedDuration,
  type ExportFrameRate,
} from '../../shared/media/frame-rate';
import {
  describeExportRun,
  describeExportStat,
  formatElapsed,
  type ExportStat,
} from '../../shared/media/export-stats';
import {
  createVariant,
  defaultVariants,
  variantFileName,
  variantIsRetimed,
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
import ProjectSettingsModal, { type ProjectSettingsDraft } from './ProjectSettingsModal';
import {
  projectFileName,
  serializeProjectFile,
  toProjectFile,
  type ProjectFile,
} from '../../shared/projects/project-file';
import InfoPanel from './InfoPanel';
import { ASPECT_PRESETS } from '../../shared/projects/project-types';
import { NO_SHIFT, type TimeShift } from '../../shared/telemetry/time-format';
import {
  AUTO_TIME_SCALE,
  measureTimeScale,
  overrideApplies,
  resolveTimeScale,
  type TimeScaleSetting,
} from '../../shared/telemetry/time-scale';
import { retimeCues } from '../../shared/telemetry/motion';
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
/** Same shape as `notice`, without the warning colour — for media that is
 * absent but not necessarily a problem (see the missing-media banner below). */
const noticeMuted =
  'my-2 px-4 py-[0.7rem] rounded-paper bg-paper-2 border border-line text-ink-soft text-[0.84rem] leading-[1.5]';

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
  /** Drop the currently-missing media from this project's known list, so it
   * stops being flagged next time the project opens (see the banner below). */
  onForgetMissing: () => void;
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
  onForgetMissing,
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
  // Telemetry as parsed, with rates derived against the file's own seconds; the
  // cadence correction is applied below, so changing it re-derives instead of
  // re-reading the sidecar.
  const [rawCues, setRawCues] = useState<Cue[]>([]);

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

  // --- trim ---------------------------------------------------------------
  // In/out points per clip, keyed by base name: switching clips inside a
  // project must not lose the range you just set on the previous one (the
  // maintainer trims several clips of one flight, then exports them one by
  // one). Only trimmed clips have an entry.
  const [trims, setTrims] = useState<Record<string, SavedTrim>>(
    () => project.media.trims ?? {},
  );
  const [range, setRange] = useState<TrimRange>(() => fullRange(0));
  const [loop, setLoop] = useState(false);
  // The transport wires its listeners once per media, so the live values reach
  // it through refs rather than through captured props.
  const rangeRef = useRef<TrimRange | null>(null);
  const loopRef = useRef(false);
  rangeRef.current = range.end > range.start ? range : null;
  loopRef.current = loop;
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
  // Slow motion / time-lapse: how much real time a second of this clip covers.
  const [timeScale, setTimeScale] = useState<TimeScaleSetting>(
    () => project.settings.timeScale ?? { ...AUTO_TIME_SCALE },
  );
  // Preview speed. A viewing choice, not the composition's: session state, no
  // document field, and nothing derived follows it. 'realtime' tracks the
  // clip's own cadence, so a 4× ralenti plays back at life's pace and a
  // hyperlapse crawls — and it stays right when the clip changes.
  const [previewSpeed, setPreviewSpeed] = useState<number | 'realtime'>(1);
  const [showSettings, setShowSettings] = useState(false);
  const [theme, setTheme] = useState<StyleTheme | null>(() => project.theme);
  // Scenes — today the introduction alone. Portable project data: an intro
  // travels with the template, like the elements it lends its window to.
  const [scenes, setScenes] = useState<Scene[]>(() =>
    structuredClone(project.scenes ?? []),
  );
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
  // What each variant cost, last time it rendered — size, wall clock, speed.
  // Session-only state on purpose: it measures this machine today, not the
  // composition, so it has no business in the project document.
  const [variantStats, setVariantStats] = useState<Record<string, ExportStat>>({});
  const [runStats, setRunStats] = useState<ExportStat[]>([]);
  // The variant being rendered right now, with the clock it started on, so its
  // row can count up while it works.
  const [liveExport, setLiveExport] = useState<{ id: string; startedAt: number } | null>(
    null,
  );
  const [liveElapsed, setLiveElapsed] = useState(0);
  const exportAbort = useRef<AbortController | null>(null);
  const exportSupported = isEncodeSupported();

  // Tick the in-flight variant's timer. One interval for the whole export, not
  // one per row, and none at all when nothing is rendering.
  useEffect(() => {
    if (!liveExport) return;
    setLiveElapsed(0);
    const id = setInterval(
      () => setLiveElapsed((Date.now() - liveExport.startedAt) / 1000),
      250,
    );
    return () => clearInterval(id);
  }, [liveExport]);

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
  // The stats go too: another clip renders to another size in another time,
  // and leaving the old figures under the rows would attribute them to it.
  useEffect(() => {
    setActiveInfo({});
    setExportDone(false);
    setExportError(null);
    setVariantStats({});
    setRunStats([]);
  }, [activeId]);

  // Parse the active clip's telemetry — clips without an .srt just get no cues.
  useEffect(() => {
    if (!activeSrt) {
      setRawCues([]);
      return;
    }
    let cancelled = false;
    activeSrt
      .text()
      .then((text) => {
        if (!cancelled) setRawCues(parseSrt(text, { timeScale: 1 }));
      })
      .catch(() => {
        if (!cancelled) setRawCues([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeSrt]);

  // The clip's cadence, measured from its own telemetry, and the scale actually
  // in force (the author's override wins). Re-deriving is a pure pass over the
  // cues, so a change to the setting costs no re-read and no re-parse — and it
  // reaches every readout at once, because they all read `cue.derived`.
  const timing = useMemo(() => measureTimeScale(rawCues), [rawCues]);
  // An override belongs to the clip it was typed for: stepping to another clip
  // falls back to that clip's own measurement rather than inheriting a cadence
  // measured elsewhere.
  const overridden = overrideApplies(timeScale, activeId);
  const scale = resolveTimeScale(timeScale, timing, activeId);
  const cues = useMemo(() => retimeCues(rawCues, scale), [rawCues, scale]);
  // Undoing the conform is exactly playing at 1/scale: a 4× slow clip at 4×.
  const realtimeRate = clampPlaybackRate(1 / scale);
  // The delivered-speed menu: the standard steps, plus the one that undoes this
  // clip's own conform when that is not already among them.
  const speedChoices = useMemo(() => {
    const set = new Set<number>(SPEED_CHOICES);
    if (realtimeRate !== 1) set.add(Math.round(realtimeRate * 100) / 100);
    return [...set].sort((a, b) => a - b);
  }, [realtimeRate]);
  const previewRate = previewSpeed === 'realtime' ? realtimeRate : previewSpeed;

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
      rangeRef,
      loopRef,
      // Stepping through a project's clips shouldn't stop the transport.
      resumeAcrossMedia: true,
      rate: previewRate,
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

  // One frame, or 100 ms when the probe found no frame rate: the handles stop
  // that far from each other, and it is the arrow-key step.
  const frameStep = minTrimLength(activeInfo.fps);

  // Open each clip on the range that belongs to it. `restoreTrim` refuses a
  // saved range whose media has a different duration — same file name, other
  // take — and falls back to the whole clip.
  useEffect(() => {
    if (!activeId || duration <= 0) {
      setRange(fullRange(duration));
      return;
    }
    const next = restoreTrim(trims[activeId], duration, frameStep);
    setRange(next);
    // A clip that reopens trimmed opens ON its in point, not on a frame it no
    // longer keeps.
    const at = videoRef.current?.currentTime ?? 0;
    const inside = clampPlayhead(at, next);
    if (inside !== at) handleScrub(inside);
    // Reading `trims` fresh on a clip change is the point; re-running on every
    // trim edit would fight the edit itself.
  }, [activeId, duration]);

  /** Move the handles and remember them for this clip. */
  function applyRange(next: TrimRange) {
    setRange(next);
    if (!activeId) return;
    setTrims((prev) => {
      const saved = saveTrim(next, duration);
      if (!saved) {
        if (!prev[activeId]) return prev;
        const rest = { ...prev };
        delete rest[activeId];
        return rest;
      }
      return { ...prev, [activeId]: saved };
    });
  }

  const trimmed = isTrimmed(range, duration);

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
    // An intro element brings its scene into being: the palette is the only
    // place an intro starts, so there is nothing to set up first.
    if (el.sceneId && !findScene(scenes, el.sceneId)) {
      setScenes((prev) => [...prev, createIntroScene(3)]);
    }
    // Stagger new elements so they don't land exactly on top of each other —
    // except intro presets, which are composed where they mean to be.
    const offset = el.sceneId ? 0 : Math.min(0.5, elements.length * 0.06);
    const placed = { ...el, y: Math.min(0.95, el.y + offset) };
    setElements((prev) => [...prev, placed]);
    setSelectedElementId(placed.id);
    // Touching the deck answers the reset question; an armed confirmation must
    // never sit waiting behind work done since.
    setResettingDeck(false);
  }

  /** Drop a scene and everything that lived in it — the panel confirms first. */
  function removeScene(id: string) {
    setScenes((prev) => prev.filter((sc) => sc.id !== id));
    setElements((prev) => prev.filter((e) => e.sceneId !== id));
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
      if (targetOwnsTyping(describeKeyTarget(e.target))) return;
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

  // I and O cut at the playhead, Shift returns a handle to the clip's own end
  // — the gestures of any logging tool. (Space belongs to the shared
  // transport.) Guarded on the event target so both stay ordinary characters
  // inside a text field.
  useEffect(() => {
    if (!activeUrl) return;
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (targetOwnsTyping(describeKeyTarget(e.target))) return;
      const key = e.key.toLowerCase();
      if (key !== 'i' && key !== 'o') return;
      if (duration <= 0) return;
      e.preventDefault();
      const d = duration;
      const current = rangeRef.current ?? fullRange(d);
      const at = videoRef.current?.currentTime ?? 0;
      if (key === 'i') {
        applyRange(
          e.shiftKey
            ? setTrimStart(current, 0, d, frameStep)
            : setTrimStart(current, at, d, frameStep),
        );
      } else {
        applyRange(
          e.shiftKey
            ? setTrimEnd(current, d, d, frameStep)
            : setTrimEnd(current, at, d, frameStep),
        );
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // Re-wired when the clip (or its measurements) change: `applyRange` writes
    // the duration it was told into the saved trim, so it must not be stale.
  }, [activeUrl, frameStep, duration, activeId]);

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
    scenes,
    // Windows run from the first frame the export keeps, so the preview has to
    // count from the in point too — otherwise a trimmed clip shows the intro
    // at a different moment than the file does.
    originSeconds: range.start,
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
          settings: { ...docRef.current.settings, aspectId, timeShift, timeScale },
          elements,
          guides,
          lutStack: lutStack.toSaved(),
          outputTransform: lutStack.output,
          theme,
          scenes,
          exportPrefs: {
            fileName: exportFileName.trim() || null,
            variants,
          },
          media: {
            ...docRef.current.media,
            files: mediaFiles.length ? mediaFiles : docRef.current.media.files,
            activeId,
            trims,
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
    timeScale,
    theme,
    scenes,
    exportFileName,
    variants,
    activeId,
    trims,
    lutStack.layers,
    lutStack.output,
    clips,
  ]);

  // --- project file (settings in, settings out) ----------------------------

  /**
   * Download the project's portable half. It is composed from the LIVE editor
   * state plus the settings modal's draft, so what lands on disk is what the
   * user sees — no waiting for the autosave debounce, and no stale copy if the
   * draft was never applied.
   */
  function exportProjectFile(draft: ProjectSettingsDraft) {
    const file = toProjectFile({
      name: draft.name,
      settings: { aspectId: draft.aspectId, timeShift: draft.timeShift },
      elements,
      guides,
      lutStack: lutStack.toSaved(),
      outputTransform: lutStack.output,
      theme,
      scenes,
      exportPrefs: { fileName: exportFileName.trim() || null, variants },
    });
    downloadBlob(
      new Blob([serializeProjectFile(file)], { type: 'application/json' }),
      projectFileName(draft.name),
    );
  }

  /**
   * Adopt an imported file: the whole portable half at once, straight into the
   * live state (the autosave then persists it like any other edit). The name,
   * the media folder and the clip are the project's own and are left alone.
   */
  function importProjectFile(file: ProjectFile) {
    setAspectId(file.settings.aspectId);
    setTimeShift(file.settings.timeShift ?? { ...NO_SHIFT });
    setElements(structuredClone(file.elements));
    setGuides(structuredClone(file.guides));
    setTheme(structuredClone(file.theme));
    setScenes(structuredClone(file.scenes ?? []));
    setExportFileName(file.exportPrefs.fileName ?? '');
    setVariants(structuredClone(file.exportPrefs.variants));
    void lutStack.restore(file.lutStack, file.outputTransform);
    // The incoming deck has different ids — whatever was selected is gone.
    setSelectedElementId(null);
    setShowSettings(false);
  }

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
    setRunStats([]);
    const measured: ExportStat[] = [];
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
        // Time the whole variant, delivery included: writing a 400 MB file to
        // a folder is part of what the user waited for.
        const startedAt = Date.now();
        setLiveExport({ id: variant.id, startedAt });
        const opts = {
          elements,
          cues,
          lut: lutStack.composed,
          intensity: 1,
          theme,
          timeShift,
          scenes,
          srcWidth,
          srcHeight,
          // null when the whole clip is kept, so an untrimmed export runs the
          // exact path it ran before trimming existed.
          trim: exportTrim(range, duration),
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
              opts.trim,
              variant.speed,
              scenes,
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
        const stat: ExportStat = {
          bytes: blob.size,
          seconds: (Date.now() - startedAt) / 1000,
          // What was encoded, not what the clip holds: a trimmed run that
          // rendered 5 s of a 40 s rush is not 8× realtime.
          clipSeconds: (trimmed ? trimDuration(range) : durationRef.current) || null,
        };
        measured.push(stat);
        setVariantStats((prev) => ({ ...prev, [variant.id]: stat }));
        setRunStats([...measured]);
      }
      setExportDone(true);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setExportError((err as Error).message || 'Export failed');
      }
    } finally {
      setExporting(false);
      setExportStep(null);
      setLiveExport(null);
      exportAbort.current = null;
    }
  }

  /**
   * Drop a variant's measurement (all of them with no id). A figure is only
   * true of the settings that produced it: leaving "38 MB · 41 s" under a row
   * whose resolution just changed would credit the new setting with the old
   * run. The run summary goes with it, for the same reason.
   */
  function forgetStats(id?: string) {
    setVariantStats((prev) => {
      if (!id) return Object.keys(prev).length ? {} : prev;
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setRunStats([]);
    setExportDone(false);
  }

  function updateVariant(id: string, patch: Partial<ExportVariant>) {
    setVariants((prev) => prev.map((v) => (v.id === id ? { ...v, ...patch } : v)));
    forgetStats(id);
  }
  function addVariant() {
    // A new row starts from the project's destination format — the reason the
    // format lives in the settings.
    setVariants((prev) => [...prev, createVariant(aspectId)]);
    setRunStats([]);
    setExportDone(false);
  }
  function removeVariant(id: string) {
    setVariants((prev) => (prev.length > 1 ? prev.filter((v) => v.id !== id) : prev));
    forgetStats(id);
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
        scenes,
        originSeconds: range.start,
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
  // The stage draws at source resolution, so the guides' notion of "this
  // frame" is the clip's own aspect — undefined until the probe lands.
  const frameAspect =
    activeMeta?.width && activeMeta?.height
      ? activeMeta.width / activeMeta.height
      : undefined;
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
  // Every timing control reads in "seconds from the first exported frame", so
  // the playhead has to be offset by the in point before it can be shown or
  // dropped into a field.
  const playhead = Math.max(0, time - range.start);
  const introScene = scenes[0] ?? null;
  const selectedScene = findScene(scenes, selectedElement?.sceneId);
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

  const missingCount = reconciliation?.missing ?? 0;
  const changedCount = reconciliation?.changed ?? 0;
  const hasMissing = missingCount > 0;
  const hasChanged = changedCount > 0;
  const mediaTrouble = hasMissing || hasChanged;

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
          title="Project settings — name, format, import/export"
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
          timeScale={overridden ? timeScale : { ...AUTO_TIME_SCALE }}
          measured={timing}
          onCancel={() => setShowSettings(false)}
          onApply={({
            name,
            aspectId: nextAspect,
            timeShift: nextShift,
            timeScale: nextScale,
          }) => {
            setProjectName(name);
            setAspectId(nextAspect);
            setTimeShift(nextShift);
            setTimeScale(
              nextScale.mode === 'manual'
                ? { ...nextScale, clipId: activeId ?? undefined }
                : nextScale,
            );
            setShowSettings(false);
          }}
          onExport={exportProjectFile}
          onImport={importProjectFile}
        />
      )}

      {mediaTrouble && (
        <div
          className={`${hasChanged ? notice : noticeMuted} m-0 flex flex-wrap items-center gap-x-4 gap-y-2`}
        >
          <span>
            {hasMissing &&
              `${missingCount} media file${missingCount > 1 ? 's' : ''} not in this folder`}
            {hasMissing && hasChanged && ' · '}
            {hasChanged && `${changedCount} changed since last save`}
            {' '}— the project stays editable.
            {hasMissing &&
              ' Moved, archived or deleted on purpose? Remove them below so this stops asking.'}
          </span>
          <button
            type="button"
            onClick={onRepoint}
            className="p-0 border-0 bg-transparent text-accent-ink font-semibold cursor-pointer underline underline-offset-[3px] decoration-[1.5px] hover:text-accent"
          >
            Point to the media folder…
          </button>
          {hasMissing && (
            <button
              type="button"
              onClick={onForgetMissing}
              className="p-0 border-0 bg-transparent text-ink-soft font-semibold cursor-pointer underline underline-offset-[3px] decoration-[1.5px] hover:text-ink"
            >
              Remove missing files from this project
            </button>
          )}
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
            <div className="flex flex-col gap-[0.45rem] px-[0.85rem] py-[0.6rem] border border-line rounded-paper bg-surface flex-none">
             {/* Two groups, and the row wraps between them: the rail (play,
                 clock, trim, duration) keeps a usable width, and the tools drop
                 to a line of their own rather than pushing the last one past
                 the edge — which used to give the whole document a horizontal
                 scrollbar on a phone. Every tool added here from now on lands
                 in the second group and costs nothing. */}
             <div className="flex flex-wrap items-center gap-x-[0.85rem] gap-y-2">
              <div className="flex items-center gap-[0.85rem] grow shrink basis-[15rem] min-w-0">
              <button
                type="button"
                className="flex-none w-[2.2rem] h-[2.2rem] border-0 rounded-full bg-ink text-paper cursor-pointer text-[0.8rem] leading-none inline-flex items-center justify-center transition-[background-color] duration-200 ease-paper hover:bg-accent"
                onClick={togglePlay}
                aria-label={playing ? 'Pause' : 'Play'}
                title="Play / pause (Space)"
              >
                {playing ? '❚❚' : '▶'}
              </button>
              <span className="font-mono text-[0.74rem] tabular-nums text-muted flex-none min-w-[3.2ch] text-center">
                {formatTimecode(time)}
              </span>
              <TrimBar
                duration={duration}
                time={time}
                range={range}
                minLength={frameStep}
                step={frameStep}
                onSeek={handleScrub}
                onScrubStart={scrub.begin}
                onScrubEnd={() => scrub.end()}
                onRangeChange={applyRange}
              />
              <span className="font-mono text-[0.74rem] tabular-nums text-muted flex-none min-w-[3.2ch] text-center">
                {formatDuration(duration)}
              </span>
              </div>

              {/* The tools. `flex-wrap` on the group itself is the second net:
                  if even they cannot share one line, they stack instead of
                  overflowing. */}
              <div className="flex flex-wrap items-center gap-2 max-w-full">
              <button
                type="button"
                onClick={() => setLoop((l) => !l)}
                aria-pressed={loop}
                className={`flex-none px-2.5 py-1 rounded-full border font-mono text-[0.64rem] tracking-[0.1em] cursor-pointer transition-colors ${
                  loop
                    ? 'border-accent bg-accent-wash text-accent-ink'
                    : 'border-line-strong bg-paper text-muted hover:text-accent-ink hover:border-accent'
                }`}
                title="Loop the trimmed range instead of stopping on the out point"
              >
                ↻
              </button>
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
              {/* Preview speed. Viewing only — it moves no readout and no
                  export; the delivered speed lives in the Export tab. */}
              <select
                value={previewSpeed === 'realtime' ? 'realtime' : String(previewSpeed)}
                onChange={(e) =>
                  setPreviewSpeed(
                    e.target.value === 'realtime' ? 'realtime' : Number(e.target.value),
                  )
                }
                className={`flex-none pl-2 pr-1 py-1 rounded-full border font-mono text-[0.64rem] tracking-[0.06em] cursor-pointer transition-colors focus:outline-none ${
                  previewRate === 1
                    ? 'border-line-strong bg-paper text-muted hover:text-accent-ink hover:border-accent'
                    : 'border-accent bg-accent-wash text-accent-ink'
                }`}
                aria-label="Preview speed"
                title="Preview speed — the readouts and the export are untouched"
              >
                {SPEED_CHOICES.map((sp) => (
                  <option key={sp} value={sp}>
                    {sp}×
                  </option>
                ))}
                {realtimeRate !== 1 && (
                  <option value="realtime">
                    real ({Math.round(realtimeRate * 100) / 100}×)
                  </option>
                )}
              </select>
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
             </div>

             {/* The trim readout sits on its own line, and that line is ALWAYS
                 rendered: appearing on the first drag, it would resize the row
                 above and make the rail jump under the pointer mid-gesture.
                 Untrimmed, it teaches the two shortcuts instead. */}
             <div className="flex items-center gap-2 h-[1.1rem] pl-[3.05rem] font-mono text-[0.64rem] tracking-[0.06em] tabular-nums">
               {trimmed ? (
                 <>
                   <span
                     className="inline-flex items-center gap-1.5 text-accent-ink"
                     title="Trimmed range — only this part previews and exports"
                   >
                     <span className="uppercase tracking-[0.12em] text-muted">Trim</span>
                     {formatTimecode(range.start)} → {formatTimecode(range.end)} ·{' '}
                     {trimDuration(range).toFixed(1)}s
                   </span>
                   <button
                     type="button"
                     onClick={() => applyRange(fullRange(duration))}
                     className="border-0 bg-transparent p-0 text-accent-ink cursor-pointer text-[0.8rem] leading-none hover:text-accent"
                     title="Use the whole clip again"
                     aria-label="Clear the trim"
                   >
                     ↺
                   </button>
                 </>
               ) : (
                 <span className="text-faint">
                   Full clip — drag the handles, or press I / O to cut at the playhead
                 </span>
               )}
             </div>
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

                  {introScene && (
                    <div className="pt-3 border-t border-line flex flex-col gap-2">
                      <h2 className="m-0 flex items-baseline gap-2 font-mono text-[0.7rem] font-medium uppercase tracking-[0.16em] text-muted">
                        {introScene.name}
                        <span className="ml-auto normal-case tracking-normal text-[0.68rem] text-faint tabular-nums">
                          {introScene.start.toFixed(1)}–{introScene.end.toFixed(1)} s
                        </span>
                      </h2>
                      <ScenePanel
                        scene={introScene}
                        memberCount={
                          elements.filter((e) => e.sceneId === introScene.id).length
                        }
                        playhead={playhead}
                        onChange={(next) =>
                          setScenes((prev) =>
                            prev.map((sc) => (sc.id === next.id ? next : sc)),
                          )
                        }
                        onRemove={() => removeScene(introScene.id)}
                      />
                    </div>
                  )}

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

                      <h2 className="m-0 mt-3 mb-2 pt-3 border-t border-line flex items-baseline gap-2 font-mono text-[0.7rem] font-medium uppercase tracking-[0.16em] text-muted">
                        Timing
                      </h2>
                      <TimingPanel
                        element={selectedElement}
                        scene={selectedScene}
                        playhead={playhead}
                        onChange={(patch) =>
                          updateElement(selectedElement.id, patch)
                        }
                      />
                    </div>
                  )}

                  <div className="pt-3 border-t border-line flex flex-wrap items-center gap-2">
                    <GuidesControl
                      guides={guides}
                      onChange={setGuides}
                      frameAspect={frameAspect}
                    />
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
                  timing={timing}
                  scale={scale}
                  overridden={overridden}
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
                      const stats = variantStats[v.id];
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
                          <div className="flex items-center gap-2">
                            <select
                              className="flex-1 min-w-0 font-sans text-[0.78rem] px-2 py-[0.35rem] border border-line-strong rounded-paper bg-surface text-ink cursor-pointer focus:outline-none focus:border-accent"
                              value={String(resolveSpeed(v.speed))}
                              onChange={(e) =>
                                updateVariant(v.id, { speed: Number(e.target.value) })
                              }
                              aria-label="Variant speed"
                              title="Delivered speed — the clip's duration changes, its cadence does not"
                            >
                              {speedChoices.map((sp) => (
                                <option key={sp} value={sp}>
                                  {sp === 1 ? 'Normal speed' : `${sp}× speed`}
                                  {sp !== 1 && sp === realtimeRate ? ' — real time' : ''}
                                </option>
                              ))}
                            </select>
                          </div>
                          {/* A re-time is a real change of duration, and the
                              audio cannot follow it — say both before it runs. */}
                          {variantIsRetimed(v) && (
                            <p className="m-0 text-[0.7rem] leading-snug text-muted">
                              {resolveSpeed(v.speed)}× speed
                              {duration > 0
                                ? ` — ${formatDuration(retimedDuration(duration, v.speed))} instead of ${formatDuration(duration)}`
                                : ''}
                              , delivered without audio: a copied track would
                              drift against a re-timed picture.
                            </p>
                          )}
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
                          {/* What this row cost last time it rendered — the
                              figure sits with the settings that produced it,
                              which is the whole point of showing it. */}
                          {liveExport?.id === v.id ? (
                            <div
                              className="flex items-center gap-1.5 pt-1.5 border-t border-dashed border-line font-mono text-[0.66rem] tabular-nums text-accent-ink"
                              role="status"
                            >
                              <span className="w-[7px] h-[7px] rounded-full bg-accent animate-pulse-dot" />
                              rendering… {formatElapsed(liveElapsed)}
                            </div>
                          ) : (
                            stats && (
                              <div className="flex items-center gap-1.5 pt-1.5 border-t border-dashed border-line font-mono text-[0.66rem] tabular-nums text-ink-soft">
                                <span className="text-[#3f6b3f]">✓</span>
                                {describeExportStat(stats)}
                              </div>
                            )
                          )}
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
                      {exportDone && runStats.length > 0 && (
                        <div
                          className="flex flex-col gap-0.5 px-2.5 py-2 rounded-paper bg-surface border border-[#c7d6c0]"
                          role="status"
                        >
                          <span className="font-mono text-[0.66rem] tracking-[0.1em] uppercase text-[#3f6b3f]">
                            ✓ Exported
                          </span>
                          <span className="font-mono text-[0.74rem] tabular-nums text-ink-soft">
                            {describeExportRun(runStats)}
                          </span>
                        </div>
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
