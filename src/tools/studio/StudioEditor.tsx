import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useAssetLibrary, useAssetMeta } from '../../shared/library/AssetLibraryContext';
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
  carryRange,
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
import ShadesPanel from '../../shared/shades/ShadesPanel';
import type { Shade } from '../../shared/shades/shades';
import { centreAxis, placedCentre, shadeCentre } from '../../shared/shades/shade-shape';

/** The scope of the clip's own shades, beside a scene's id, while one is placed. */
const CLIP_SHADES = '__clip__';
import GuidesControl from '../../shared/overlay/GuidesControl';
import { exportOverlayVideoViaSeek } from '../../shared/overlay/export-overlay-seek';
import { exportVariantVideo, outroTail } from '../../shared/media/export-variant';
import { knownIdentity, mediaOrigin } from '../../shared/projects/media-identity';
import { readRenditions, writeRendition } from '../../shared/projects/media-rendition';
import { fetchHeld } from '../../shared/sources/held-fetch';
import { trackedFetch } from '../../shared/tasks/tracked';
import { fileIdentity, imageTypeLabel } from '../../shared/library/assets';
import { startTask } from '../../shared/tasks/tasks';
import {
  atStep,
  cancelRun,
  enterUnit,
  finishUnit,
  runFraction,
  runStateOf,
  startRun,
  type RunPhase,
  type RunProgress,
  type RunUnit,
} from '../../shared/tasks/run-progress';
import TaskEdge from '../../shared/ui/TaskEdge';
import SendFinalsPanel from '../../shared/sources/winnow/SendFinalsPanel';
import { readEffectiveExif } from '../../shared/exif/read-exif';
import { downloadBlob } from '../../shared/media/save';
import { frameGrabName, grabFrame } from '../../shared/media/frame-grab';
import {
  canWriteToDisk,
  pickWritableDirectory,
  writeItems,
} from '../../shared/sources/write-files';
import { DecodeUnsupportedError, demuxSource, type DemuxResult } from '../../shared/media/webcodecs-export';
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
  resolutionShortfall,
  variantOutputSize,
  type ExportVariant,
  type VariantResolution,
} from '../../shared/projects/export-variants';
import { ensureFontFaces, overlayFontFaces } from '../../shared/overlay/fonts';
import { settleForStill } from '../../shared/overlay/still-frame';
import { createOutroCard, type OutroCard } from '../../shared/overlay/outro-card';
import OutroPanel from './OutroPanel';
import StageRenditionMenu from './StageRenditionMenu';
import { useStageRendition } from './use-stage-rendition';
import { decodeStillForExport, deliveryFrame, exportDecodeEdge, exportPhotoVariant } from '../../shared/media/photo-frame';
import { decodeStill, stageBudget } from '../../shared/media/still-decode';
import type { ExifData } from '../../shared/exif/exif-parser';
import { cueFromExif } from '../../shared/exif/exif-cue';
import {
  defaultElementsPreset,
  type OverlayElement,
} from '../../shared/overlay/overlay-types';
import { reanchorInPlace } from '../../shared/overlay/draw-overlays';
import { DEFAULT_GUIDES, type GuidesState } from '../../shared/overlay/guides';
import { useOverlayStage } from '../../shared/overlay/use-overlay-stage';
import { useLutStack } from '../../shared/lut/use-lut-stack';
import { sameSlice } from '../../shared/history/history';
import useHistory from '../../shared/history/use-history';
import GradePanel from '../../shared/lut/GradePanel';
import DevelopSheet from '../../shared/develop/DevelopSheet';
import DevelopSection from '../../shared/develop/DevelopSection';
import type { DevelopSettings } from '../../shared/develop/develop';
import { restoreDevelop, writeDevelop, type SavedDevelop } from '../../shared/projects/media-develop';
import type { StyleTheme } from '../../shared/overlay/title-styles';
import StylePanel from '../../shared/overlay/StylePanel';
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
import type { ProjectDoc } from '../../shared/projects/project-types';
import { hashedMediaRefs, mediaHash } from '../../shared/projects/media-identity';
import { putProject } from '../../shared/projects/project-store';
import type { Reconciliation } from '../../shared/projects/reconcile';
import PageBar, { barPill } from '../../shared/ui/PageBar';
import Button from '../../shared/ui/Button';
import { PRESS_LOOK } from '../../shared/ui/press';
import { VERB_GROUND, VerbButton } from '../../shared/ui/VerbMarks';
import DeliverBar, { type ExportVerb } from '../../shared/ui/DeliverBar';
import PanelHost from '../../shared/ui/PanelHost';
import { usePublishSectionBar } from '../../shared/ui/section-rail';
import { useIsCompact } from '../../shared/ui/use-layout-mode';
import { useLearnedGesture } from '../../shared/ui/use-learned-gesture';
import { Icons } from '../../shared/ui/icons';
import { useSurface } from '../../shared/ui/use-surface';
import { FieldRow, InspectorSection, LockSections, Readout, SelectField, ToggleField } from '../../shared/ui/Inspector';
import RunLockNotice, { runClock } from '../../shared/ui/RunLockNotice';
import { deliveryFor } from '../../shared/develop/delivery-source';
import { useDeliveryRow } from '../../shared/develop/use-delivery-row';
import IconButton from '../../shared/ui/IconButton';
import Segmented from '../../shared/ui/Segmented';
import { revealInScroller } from '../../shared/ui/reveal';

/**
 * A transport tool's touch geometry and press (`docs/press-feedback.md` C1,
 * C5): 34 px under a finger whatever the width — a tablet is a wide shell held
 * by one — and down a pixel when pressed, like every control of the suite.
 */
const TRANSPORT_TOUCH = `pointer-coarse:min-h-[2.125rem] pointer-coarse:min-w-[2.125rem] pointer-coarse:px-3 transition-[background-color,border-color,color,translate,box-shadow] duration-150 ease-paper ${PRESS_LOOK} data-pressed:bg-paper-2`;

/**
 * Clips with or without telemetry, and stills — the studio edits all three.
 * A photo is not a second kind of project: it is a media a project can hold
 * beside its clips, and stepping ‹/› between a rush and a frame you shot the
 * same day is the point.
 */
const STUDIO_KINDS = ['video+telemetry', 'video', 'photo'] as const;

/** A variant's stages in an export run (`run-progress.ts`). */
const STILL_PHASES: RunPhase[] = [
  { id: 'render', label: 'Render' },
  { id: 'write', label: 'Write' },
];
const CLIP_PHASES: RunPhase[] = [
  { id: 'encode', label: 'Encode' },
  { id: 'write', label: 'Write' },
];

/** What a measured figure is true of: this clip, these settings, this cut. */
function statKey(clipId: string, variant: ExportVariant, cut: TrimRange | null): string {
  // The row's id is not a setting: two rows asking the same thing cost the same.
  return `${clipId}|${JSON.stringify({ ...variant, id: undefined })}|${cut ? `${cut.start}-${cut.end}` : ''}`;
}

type PanelTab = 'overlay' | 'style' | 'grade' | 'info' | 'export';

const TABS: Array<{ id: PanelTab; label: string }> = [
  { id: 'overlay', label: 'Overlay' },
  { id: 'style', label: 'Style' },
  { id: 'grade', label: 'Grade' },
  { id: 'info', label: 'Info' },
  { id: 'export', label: 'Export' },
];

const notice =
  'my-2 px-4 py-[0.7rem] rounded-paper bg-accent-wash border border-danger-line text-danger-ink text-sm leading-[1.5]';
/** Same shape as `notice`, without the warning colour — for media that is
 * absent but not necessarily a problem (see the missing-media banner below). */
const noticeMuted =
  'my-2 px-4 py-[0.7rem] rounded-paper bg-paper-2 border border-line text-ink-soft text-sm leading-[1.5]';

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
  /** What the shell wants in the project bar — the sync pill of a remote project. */
  headerExtra?: ReactNode;
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
  headerExtra,
  onRepoint,
  onForgetMissing,
}: StudioEditorProps) {
  // A grading screen sits in the darkroom: neutral grey, so the eye does not
  // adapt to warm paper and misjudge the frame (`use-surface.ts`).
  useSurface('darkroom');
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrub = useVideoScrub(videoRef);

  const lib = useAssetLibrary();
  const lutStack = useLutStack();
  const { assets: clips, activeId, active, activeIndex, goPrev, goNext } =
    useActiveAsset(STUDIO_KINDS);

  const activeVideo = active?.parts.video ?? null;
  const activeSrt = active?.parts.srt ?? null;
  const activeImage = active?.kind === 'photo' ? (active.parts.image ?? null) : null;
  const isPhoto = !!activeImage;

  const [tab, setTab] = useState<PanelTab>('overlay');
  // On a phone the inspector is a sheet and its tabs are the shell's bottom
  // bar, so picking a section is also what raises the panel. It opens closed:
  // the stage is what you came for, and a sheet over it on arrival would hide
  // the very thing being edited.
  const compact = useIsCompact();
  const [inspectorOpen, setInspectorOpen] = useState(false);
  // The shell draws them; the list is the SAME `TABS` the docked tab strip
  // renders from, so the two placements can never drift apart. Memoised
  // because the record carries a callback and is compared by identity.
  usePublishSectionBar(
    useMemo(
      () =>
        compact && active
          ? {
              sections: TABS,
              // Marked only while the panel it opens is UP. A cell left
              // marked after the sheet was dismissed says the screen is
              // somewhere it is not — the maintainer's report, from a bar
              // still showing PICTURE over a closed inspector.
              active: inspectorOpen ? tab : null,
              label: 'Studio inspector',
              onSelect: (id: string) => {
                setTab(id as PanelTab);
                setInspectorOpen(true);
              },
            }
          : null,
      [compact, active, tab, inspectorOpen],
    ),
  );
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

  // --- develop --------------------------------------------------------------
  // Each media's own correction, keyed by base name like the trims and
  // guarded by the media's hash the way a trim is by its duration: a develop
  // set on one file is not restored onto a same-named other. The hash is
  // read once per media (128 KiB at most, memoised in `media-identity.ts`).
  const [develops, setDevelops] = useState<Record<string, SavedDevelop>>(
    () => project.media.develops ?? {},
  );
  const activeFile = activeImage ?? activeVideo;
  const [activeHash, setActiveHash] = useState<string | null>(null);
  useEffect(() => {
    setActiveHash(null);
    if (!activeFile) return;
    let cancelled = false;
    void mediaHash(activeFile).then((hash) => {
      if (!cancelled) setActiveHash(hash);
    });
    return () => {
      cancelled = true;
    };
  }, [activeFile]);
  const activeDevelop = activeId ? restoreDevelop(develops[activeId], activeHash) : null;
  /** Write the open media's correction; null puts it back to as shot. */
  function setActiveDevelop(next: DevelopSettings | null) {
    if (!activeId) return;
    setDevelops((prev) => writeDevelop(prev, activeId, next, activeHash));
  }
  // The sheet, and the clip's moment it opened on (a photograph has one).
  const [developOpen, setDevelopOpen] = useState(false);
  const [developAt, setDevelopAt] = useState(0);
  // The sheet's one batch verb here: the same numbers onto every OTHER media
  // of the project, each under its own hash — a copy per entry, never a
  // reference, and the open media is left to Done. The hashes are read as
  // the writes land (memoised per file), so a slow folder writes one by one.
  const otherMedia = useMemo(
    () =>
      clips
        .filter((a) => a.id !== activeId)
        .map((a) => ({ id: a.id, file: a.kind === 'photo' ? a.parts.image : a.parts.video }))
        .filter((m): m is { id: string; file: File } => !!m.file),
    [clips, activeId],
  );
  const developApplyTo = useMemo(
    () =>
      otherMedia.length === 0
        ? []
        : [
            {
              id: 'project',
              label: `Apply to ${otherMedia.length} other media`,
              hint: 'every other photo and clip of this project',
              run: (settings: DevelopSettings) => {
                for (const m of otherMedia) {
                  void mediaHash(m.file).then((hash) => {
                    setDevelops((prev) => writeDevelop(prev, m.id, settings, hash));
                  });
                }
              },
            },
          ],
    [otherMedia],
  );
  // The cube every renderer here takes: the stack baked with THIS media's
  // stored develop. While the sheet is open its draft rides `lutStack.composed`,
  // which only the sheet paints from — the stage keeps the stored value.
  const lut = lutStack.composeWith(activeDevelop);

  // --- which file of the media is on the stage -----------------------------
  // A Winnow media opens on its proxy; a choice stored per media (keyed by
  // base name like the trims) brings another of the capture's files onto the
  // stage — the rush behind a clip's 720p proxy, the camera's JPEG or a RAW
  // companion's render behind a still's WebP (`media-rendition.ts`). The
  // export delivers from that file when it is the one on the stage.
  const [renditions, setRenditions] = useState<Record<string, string>>(() =>
    readRenditions(project.media.renditions),
  );
  const activeMeta = useAssetMeta(activeId);
  const stageRendition = useStageRendition({
    file: activeFile,
    stored: activeId ? (renditions[activeId] ?? null) : null,
    measured:
      activeMeta?.width && activeMeta?.height ? { width: activeMeta.width, height: activeMeta.height } : null,
    onChoose: (id) => {
      if (activeId) setRenditions((prev) => writeRendition(prev, activeId, id));
    },
  });
  /** The file the stage draws: the Library's, or the one chosen once it has landed. */
  const stageFile = stageRendition.file;
  const stageVideo = activeVideo ? stageFile : null;
  const stageImage = activeImage ? stageFile : null;
  /** True while the stage draws a file other than the one the Library holds. */
  const stageOnOther = !!stageFile && !stageRendition.onLibraryFile;
  // The trim bar's gestures are spelled out under it until one has been used.
  const trim = useLearnedGesture('studio.trim');
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
  // Trips' shades over the whole picture, under the scenes and every element
  // — portable like the scenes (`ProjectDoc.shades`), absent on a project
  // stored before they existed.
  const [shades, setShades] = useState<Shade[]>(() => structuredClone(project.shades ?? []));
  // The outro — the closing card appended after the footage. Portable too:
  // intro · footage · closing card is the shape of a delivered piece, and
  // Road Trip fills this slot with the trip's call to action when it briefs
  // the project (shared/roadtrip/hook-scene.ts).
  const [outro, setOutro] = useState<OutroCard | null>(() =>
    structuredClone(project.outro ?? null),
  );
  const [saveState, setSaveState] = useState<SaveState>('saved');

  // Export state.
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  /**
   * Render the deliverables from the editing proxy instead of fetching the
   * capture. Off by default: fidelity is what an export is for, and the
   * browser that added this media already said "exports can fetch originals
   * later". On is the escape hatch — a fast test, or a rush too heavy to pull
   * through the tunnel right now.
   */
  const [renderFromProxy, setRenderFromProxy] = useState(false);
  const [exportDone, setExportDone] = useState(false);
  /**
   * The deliverables of the last run, kept so they can be sent back to the
   * source they were cut from. Memory-backed like every rendered blob; let go
   * on the next run and when the active media changes.
   */
  const [lastRun, setLastRun] = useState<File[]>([]);
  const [exportFileName, setExportFileName] = useState(project.exportPrefs.fileName ?? '');
  const [variants, setVariants] = useState<ExportVariant[]>(() =>
    project.exportPrefs.variants.length
      ? structuredClone(project.exportPrefs.variants)
      : defaultVariants(),
  );
  // What each variant cost, last time it rendered — size, wall clock, speed.
  // Session-only state on purpose: it measures this machine today, not the
  // composition, so it has no business in the project document. Keyed by
  // the clip, the variant's settings and the cut (`statKey`): a figure is only
  // true of what produced it, so a row shows it while its settings are those
  // and hides it the moment one changes — without erasing it, which is what
  // made an edit during a run wipe the figure the run then wrote back.
  const [variantStats, setVariantStats] = useState<Record<string, ExportStat>>({});
  const [runStats, setRunStats] = useState<ExportStat[]>([]);
  // The variant being rendered right now, with the clock it started on, so its
  // row can count up while it works.
  const [liveExport, setLiveExport] = useState<{ id: string; startedAt: number } | null>(
    null,
  );
  const [liveElapsed, setLiveElapsed] = useState(0);
  const exportAbort = useRef<AbortController | null>(null);
  // Where the run stands variant by variant (`run-progress.ts`, his pick V1 +
  // V4 from the Studio lab): the pinned bar's segments, the rows' marks, the
  // masthead pill. It belongs to the CLIP it was started on (`runClip`), not
  // to the one open: the bar follows the run across a clip switch, and the
  // run's figures and finals stay that clip's.
  const [run, setRun] = useState<RunProgress | null>(null);
  const runNow = useRef<RunProgress | null>(null);
  const [runClip, setRunClip] = useState<{ id: string; name: string } | null>(null);
  /** How the last run ended when it did not end whole — a cancel keeps what it wrote. */
  const [runEnd, setRunEnd] = useState<string | null>(null);

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

  // --- the still, when the active media is a photograph --------------------
  // The decoded picture the stage composes over, and the one cue its EXIF is
  // worth (exif-cue.ts) — so the exposure, position and time elements read
  // real values over a photo the way they do over a clip.
  const [photo, setPhoto] = useState<ImageBitmap | null>(null);
  // The still's OWN upright size: the stage holds a copy decoded at its pixel
  // budget (`still-decode.ts`), and every number about the FILE — the header
  // badge, the variants' frames, the export — reads this one.
  const [photoNatural, setPhotoNatural] = useState<{ width: number; height: number } | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoExif, setPhotoExif] = useState<ExifData | null>(null);

  useEffect(() => {
    if (!stageImage) {
      setPhoto(null);
      setPhotoNatural(null);
      setPhotoError(null);
      return;
    }
    let cancelled = false;
    setPhotoError(null);
    // Decoded AT the stage's budget, never whole: a 48-megapixel photograph
    // held open for as long as it is the active media was 194 MB, rescaled
    // into the 4K stage on every redraw. The export decodes the file again at
    // its own density (`handleExport`). It is the file ON THE STAGE — the
    // proxy, or the capture's file chosen above it — and the picture it
    // replaces stays up until this one is decoded.
    void decodeStill(stageImage, { budgetPixels: stageBudget() })
      .then(({ bitmap, natural }) => {
        if (cancelled) {
          bitmap.close();
          return;
        }
        setPhoto(bitmap);
        setPhotoNatural(natural);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setPhoto(null);
        setPhotoNatural(null);
        setPhotoError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [stageImage]);

  // EXIF is read from the head of the file, independently of the decode: a
  // RAW the browser cannot draw still tells us what it was shot at. What the
  // source that handed the file over parsed at ingest fills the gaps, under
  // whatever the bytes still say (`read-exif.ts`) — a Winnow photo proxy is
  // a WebP with no EXIF at all. Read off the MEDIA, never the file on the
  // stage: every file of one capture was shot at the same instant, and the
  // readouts must not move when the stage switches between them.
  useEffect(() => {
    setPhotoExif(null);
    if (!activeImage) return;
    let cancelled = false;
    void readEffectiveExif(activeImage).then((read) => {
      if (!cancelled) setPhotoExif(read.exif);
    });
    return () => {
      cancelled = true;
    };
  }, [activeImage]);

  /**
   * Release a bitmap once the stage has stopped drawing it. Closing it at the
   * moment the next one is decoded would leave the render loop one frame away
   * from painting a detached bitmap — this runs after the commit that already
   * swapped the picture, so the one being closed is unreachable. A full-size
   * still is tens of megabytes; waiting for the collector is not an option.
   */
  const shownPhoto = useRef<ImageBitmap | null>(null);
  useEffect(() => {
    const previous = shownPhoto.current;
    shownPhoto.current = photo;
    if (previous && previous !== photo) previous.close();
  }, [photo]);
  useEffect(() => () => shownPhoto.current?.close(), []);

  // If the active clip can't be decoded (often HEVC), the user can transcode it
  // to H.264 in-browser; once ready, the preview and export use that instead.
  // Of the file ON THE STAGE: a rush chosen above its proxy may be the HEVC
  // the proxy was made to avoid.
  const activeTranscode = useTranscode(stageVideo);
  // Where the active clip came from. A remote source hands over its editing
  // rendition by default, and only it knows how to fetch the capture.
  const origin = mediaOrigin(activeVideo);
  const proxyWithOriginal =
    origin?.fidelity === 'proxy' && typeof origin.fetchOriginal === 'function'
      ? origin
      : null;
  /** True when the export delivers from the capture — the one on the stage, or one it fetches first. */
  const deliversCapture = !!proxyWithOriginal && !renderFromProxy;
  /** True when the export will go and get the capture first: it is not already on the stage. */
  const willFetchOriginal = deliversCapture && !stageOnOther;
  // A PHOTO's own source. Until now `origin` was read off the clip alone and
  // the note said "photos never take this path — a photo's original is often
  // a RAW no browser decodes". O2 of `docs/develop-originals.md` reverses
  // that for the originals a browser DOES decode, and `delivery-source.ts`
  // keeps the RAW rule: a RAW is reached only through the render inside it,
  // measured, never on the assumption that it is full-size.
  const photoOrigin = mediaOrigin(activeImage);
  // Which pixels a still leaves from is not a choice here since R5 of
  // `docs/capture-renditions.md` (2026-09-21): its original is fetched only
  // where the proxy could not fill the frame the variants ask for, and the
  // *Delivers* row says so. A clip keeps `renderFromProxy` — its proxy is
  // always the wrong thing to deliver, a still's often is not.
  // Only while the stage draws that proxy: a file of the capture chosen above
  // it IS the choice, and the export delivers from it as it stands.
  const photoProxy =
    !stageOnOther && photoOrigin?.fidelity === 'proxy' && typeof photoOrigin.fetchOriginal === 'function'
      ? photoOrigin
      : null;
  // Where the finals of the active media would go home to — a clip or a
  // still, whichever is open — and the identity the source vouched for it.
  const finalsMedia = activeVideo ?? activeImage ?? null;
  const finalsOrigin = mediaOrigin(finalsMedia);
  const finalsIdentity = finalsMedia ? knownIdentity(finalsMedia) : null;
  const activeSource = activeTranscode.transcoded ?? stageVideo;
  const activeUrl = useObjectUrl(activeSource);

  useEffect(() => {
    setActiveError(false);
  }, [activeSource]);

  // One-shot restores from the document: the saved LUT, and the clip that was
  // active when the project was last saved (once the library holds it).
  const restoredRef = useRef(false);
  // The grade arrives ASYNCHRONOUSLY (every built-in cube is fetched again), so
  // the looks land after the first render. Until they have, the editor is still
  // seeding itself from the document and nothing that arrives is an edit — see
  // the history below, which would otherwise open a graded project on an undo
  // that strips it. Two flags, not one, because React does NOT promise that
  // the looks land in the same commit as a state set from the promise that
  // brought them — measured landing one commit later, i.e. after a single gate
  // had already opened. `restoreDone` is set after the restore's own writes,
  // so every one of them is in the value by the commit that observes it, and
  // `seeded` opens the gate one commit later still (the effect beside the
  // history, below).
  const [restoreDone, setRestoreDone] = useState(false);
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    void lutStack
      .restore(project.lutStack, project.outputTransform, project.lutFilm)
      .finally(() => setRestoreDone(true));
    if (project.media.activeId && clips.some((c) => c.id === project.media.activeId)) {
      lib.setActive(project.media.activeId);
    }
    // Mount-only by design: the editor is keyed by project.id.
  }, []);

  // Stale codec info goes when the active clip changes. The export's feedback
  // does NOT: it belongs to the clip the run was started on (`runClip`) and is
  // shown as that clip's — a switch mid-run used to blank the bar while the
  // run went on. The per-row figures are keyed by clip, so they need no reset.
  useEffect(() => {
    setActiveInfo({});
    if (!exportAbort.current) setExportError(null);
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
  const clipCues = useMemo(() => retimeCues(rawCues, scale), [rawCues, scale]);
  // A photograph is one cue, built from its EXIF — the file's own, under what
  // the source vouched for — or none, when neither carries anything an element
  // could draw.
  const photoCues = useMemo(() => {
    const cue = photoExif ? cueFromExif(photoExif) : null;
    return cue ? [cue] : [];
  }, [photoExif]);
  const cues = isPhoto ? photoCues : clipCues;
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

  // Probe the container ON THE STAGE for codec + fps (best-effort): the rush
  // chosen above a proxy is rarely the proxy's codec or cadence.
  useEffect(() => {
    if (!stageVideo) return;
    let cancelled = false;
    probeContainer(stageVideo).then((info) => {
      if (!cancelled) setActiveInfo(info);
    });
    return () => {
      cancelled = true;
    };
  }, [stageVideo]);

  // A switch of FILE under the same media keeps the playhead: the proxy and
  // the rush share their seconds, and landing back on 0:00 would lose the
  // frame the person switched files to look at. Read off the element while it
  // still holds the file it is about to leave — the new `src` has not been
  // committed yet — and spent on the new file's `loadedmetadata`.
  const resumeAt = useRef<number | null>(null);
  const shownSource = useRef<{ media: string | null; file: File | null }>({ media: null, file: null });
  if (shownSource.current.file !== activeSource) {
    const before = shownSource.current;
    const at = videoRef.current?.currentTime ?? 0;
    resumeAt.current = before.file && activeSource && before.media === activeId && at > 0 ? at : null;
    shownSource.current = { media: activeId, file: activeSource };
  }
  // The stage video's own frame, once its metadata says it: what the header
  // states while a rush is on the stage, and what the export encodes from it.
  const [stageDims, setStageDims] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    setStageDims(null);
  }, [activeSource]);

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
        if (v.videoWidth && v.videoHeight) setStageDims({ width: v.videoWidth, height: v.videoHeight });
        const resume = resumeAt.current;
        resumeAt.current = null;
        if (resume !== null) {
          try {
            v.currentTime = Math.min(resume, Number.isFinite(v.duration) ? v.duration : resume);
            return;
          } catch {
            /* fall through to the prime */
          }
        }
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

  // The ONE clock a trim is saved against and guarded by: the Library file's.
  // A rush on the stage shares the proxy's seconds but rarely its exact
  // length, and the 50 ms guard would read that as another take — so the
  // trim keeps its own clock and is carried onto the stage's (`carryRange`).
  // With the Library's file on the stage the two are one and nothing moves.
  const trimClock = stageOnOther && activeMeta?.duration && activeMeta.duration > 0 ? activeMeta.duration : duration;
  /** A stored trim as the stage's handles show it. */
  function trimOnStage(saved: SavedTrim | undefined): TrimRange {
    return carryRange(restoreTrim(saved, trimClock, frameStep), trimClock, duration, frameStep);
  }

  // Open each clip on the range that belongs to it. `restoreTrim` refuses a
  // saved range whose media has a different duration — same file name, other
  // take — and falls back to the whole clip.
  useEffect(() => {
    if (!activeId || duration <= 0) {
      setRange(fullRange(duration));
      return;
    }
    const next = trimOnStage(trims[activeId]);
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
    // Cutting a clip — by handle or by I / O — is the gesture the hint under
    // the bar teaches, so it retires the hint the first time it lands.
    if (isTrimmed(next, duration)) trim.learn();
    setRange(next);
    if (!activeId) return;
    setTrims((prev) => {
      const saved = saveTrim(carryRange(next, duration, trimClock, frameStep), trimClock);
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
  // measures and renders correctly. Keyed on the FACES in use, not on the
  // elements: keyed on the elements it ran on every drag step and keystroke,
  // and `document.fonts.ready` always resolves, so every edit rendered the
  // editor a second time for fonts that had not changed.
  const fontFaces = useMemo(() => overlayFontFaces(elements, theme).join('|'), [elements, theme]);
  useEffect(() => {
    let cancelled = false;
    ensureFontFaces(fontFaces ? fontFaces.split('|') : []).then(() => {
      if (!cancelled) setFontTick((t) => t + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [fontFaces]);

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

  /**
   * A tap on an element, as opposed to a drag of one. On a phone the inspector
   * is a sheet, so picking an element on the stage has to RAISE it — otherwise
   * its settings are behind a bottom-bar cell the tap already switched to, and
   * the tap reads as having done nothing. Only on release, and only when the
   * press never travelled: a sheet rising mid-drag would cover the very thing
   * being moved.
   */
  function activateElement(id: string) {
    selectElement(id);
    if (compact) setInspectorOpen(true);
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
    revealInScroller(elementPanelRef.current, { block: 'nearest', behavior: 'smooth' });
  }, [selectedElementId, tab]);

  function toggleVisible(id: string) {
    setElements((prev) =>
      prev.map((e) => (e.id === id ? { ...e, visible: !e.visible } : e)),
    );
  }

  function handleMove(id: string, x: number, y: number) {
    setElements((prev) => prev.map((e) => (e.id === id ? { ...e, x, y } : e)));
  }

  // What the stage and the still export draw: over a photograph the deck is
  // settled first, because a still has no clock to play an entrance against
  // (still-frame.ts). Over a clip it is the deck itself, untouched.
  const stageElements = useMemo(
    () => (isPhoto ? settleForStill(elements) : elements),
    [isPhoto, elements],
  );

  // --- placing a shade's centre on the stage --------------------------------
  /**
   * The shade whose centre the stage is placing (a panel's "Place on the
   * picture") — the clip's own (`CLIP_SHADES`) or a scene's (by its id). Only
   * while the Overlay tab is the one open, and only while that shade still has
   * a centre to move: anything else drops it, so the stage is never left
   * taking presses for a panel nobody can see. A scene's shades are not drawn
   * over a photograph, so neither is their handle.
   */
  const [placing, setPlacing] = useState<{ scope: string; id: string } | null>(null);
  const placingList = !placing
    ? null
    : placing.scope === CLIP_SHADES
      ? shades
      : isPhoto
        ? null
        : (findScene(scenes, placing.scope)?.shades ?? null);
  const shadeInPlace =
    tab === 'overlay' && placing && placingList
      ? (placingList.find((sh) => sh.id === placing.id && sh.enabled !== false) ?? null)
      : null;
  const placingAxis = shadeInPlace ? centreAxis(shadeInPlace.direction) : null;
  const shadeHandle =
    shadeInPlace && placingAxis ? { ...shadeCentre(shadeInPlace), axis: placingAxis } : null;
  const placingLost = placing !== null && shadeHandle === null;
  useEffect(() => {
    if (placingLost) setPlacing(null);
  }, [placingLost]);
  /** What a panel's "Place on the picture" calls, for the shades of `scope`. */
  const placeShade = (scope: string) => (id: string | null) => {
    setPlacing(id ? { scope, id } : null);
    // On a phone the inspector is a sheet over the very picture the centre is
    // placed on: it steps aside, and the tab's cell brings it back.
    if (id && compact) setInspectorOpen(false);
  };
  /** A press or a drag on the stage: the placed shade's centre, on its own axis. */
  const moveShadeCentre = (x: number, y: number) => {
    if (!placing) return;
    const move = (list: Shade[]) =>
      list.map((sh) => {
        if (sh.id !== placing.id) return sh;
        const center = placedCentre(sh, { x, y });
        return center ? { ...sh, center } : sh;
      });
    if (placing.scope === CLIP_SHADES) setShades(move);
    else {
      setScenes((prev) =>
        prev.map((sc) => (sc.id === placing.scope && sc.shades ? { ...sc, shades: move(sc.shades) } : sc)),
      );
    }
  };

  const stage = useOverlayStage({
    videoRef,
    canvasRef,
    still: photo,
    cues,
    elements: stageElements,
    selectedId: selectedElementId,
    guides,
    lut,
    intensity: 1,
    interpolation: lutStack.interpolation,
    theme,
    timeShift,
    scenes: isPhoto ? undefined : scenes,
    // Timeless, so a photograph takes them too — unlike a scene.
    shades,
    // Windows run from the first frame the export keeps, so the preview has to
    // count from the in point too — otherwise a trimmed clip shows the intro
    // at a different moment than the file does.
    originSeconds: isPhoto ? 0 : range.start,
    compare: compareOn,
    resetKey: activeUrl ?? activeId,
    redrawSignal: fontTick,
    onSelect: selectElement,
    onActivate: activateElement,
    onMove: handleMove,
    shadeHandle,
    onPlaceShade: moveShadeCentre,
  });

  function handleScrub(value: number) {
    setTime(value);
    scrub.to(value);
  }

  // --- undo and redo ------------------------------------------------------

  /**
   * The half of the editor's state a step of history holds: the COMPOSITION,
   * and never the session around it. It is the autosave's dependency list, one
   * object — what lands in the document is exactly what steps back — minus the
   * two things a step must not carry: the media that is open (switching clips
   * is navigation, not an edit, and stepping it back would move the ground
   * under the change you meant to undo) and the clips themselves.
   *
   * Unlike Trips, the Studio has no single document in state: it holds a dozen
   * `useState` values and assembles the document on save. So the history
   * compares `sameSlice` rather than by identity — this object is rebuilt on
   * every render, and so, sometimes, are its members: `useLutStack.restore`
   * empties the stack onto a fresh `[]`, which means nothing and read as an
   * edit. One level deeper is where that stops and no further: an item of an
   * immutably updated collection is a new object exactly when it changed.
   */
  const edit = useMemo(
    () => ({
      elements,
      guides,
      theme,
      scenes,
      shades,
      outro,
      projectName,
      aspectId,
      timeShift,
      timeScale,
      trims,
      develops,
      renditions,
      exportFileName,
      variants,
      lutLayers: lutStack.layers,
      lutOutput: lutStack.output,
      lutText: lutStack.customText,
      lutFilm: lutStack.film,
    }),
    [
      elements,
      guides,
      theme,
      scenes,
      shades,
      outro,
      projectName,
      aspectId,
      timeShift,
      timeScale,
      trims,
      develops,
      renditions,
      exportFileName,
      variants,
      lutStack.layers,
      lutStack.output,
      lutStack.customText,
      lutStack.film,
    ],
  );

  // The composition as it is NOW, for a run that took it at the click and asks
  // at its end whether it moved meanwhile (L2).
  const editNow = useRef(edit);
  editNow.current = edit;

  const history = useHistory({
    value: edit,
    isSame: sameSlice,
    what: 'edit',
    // The grade lands after the first render; until it has, what arrives is
    // the document finishing its own arrival, not an edit.
    ready: seeded,
    // A sheet holding its own draft owns the keyboard while it is up: its
    // Cancel is what steps ITS work back, and the document behind it is not
    // what the press is about.
    enabled: !developOpen && !showSettings,
    onRestore: (step) => {
      setElements(step.elements);
      setGuides(step.guides);
      setTheme(step.theme);
      setScenes(step.scenes);
      setShades(step.shades);
      setOutro(step.outro);
      setProjectName(step.projectName);
      setAspectId(step.aspectId);
      setTimeShift(step.timeShift);
      setTimeScale(step.timeScale);
      setTrims(step.trims);
      setDevelops(step.develops);
      setRenditions(step.renditions);
      setExportFileName(step.exportFileName);
      setVariants(step.variants);
      // The live stack, not the saved one: `restore` re-fetches every built-in
      // cube, and the await would land as a second, phantom step.
      lutStack.revert(step.lutLayers, step.lutOutput, step.lutText, step.lutFilm);
      // The selection is not part of a step, so an element that is no longer
      // on the frame simply cannot stay selected.
      setSelectedElementId((id) => (id && step.elements.some((el) => el.id === id) ? id : null));
      // The handles are live state, derived from `trims` only when a clip
      // opens; a restored trim has to reach them here, or the bar would keep
      // showing the cut it just stepped away from.
      if (activeId && duration > 0) {
        setRange(trimOnStage(step.trims[activeId]));
      }
    },
  });

  // The gate, opened one commit after the seeding was observed and AFTER the
  // history's own effect in the same commit (effects run in declaration
  // order), so the beginning it starts from already holds everything the
  // document brought.
  useEffect(() => {
    if (restoreDone && !seeded) setSeeded(true);
  }, [restoreDone, seeded]);

  // --- autosave -----------------------------------------------------------

  // Everything the user does lands in the project document, debounced. The
  // stage canvas is downscaled into a thumbnail so the gallery renders without
  // touching the media. Failures flip the badge to "storage-error" — editing
  // continues in memory.
  const docRef = useRef(project);
  // The shell can change the document WITHOUT remounting the editor — the
  // media folder re-pointed, missing files forgotten — and every save below
  // spreads from this ref. It must follow the prop, or the next autosave
  // writes the old folder handle back over the one just picked.
  useEffect(() => {
    docRef.current = project;
  }, [project]);
  const durationRef = useRef<number>(project.durationSeconds ?? 0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstRun = useRef(true);
  /** The save the timer is waiting to run, and whether one is owed. */
  const pendingSave = useRef<(() => Promise<void>) | null>(null);
  const saveOwed = useRef(false);

  // **A save that is owed is written before the editor goes**, and when the
  // tab is hidden or the page unloads. The debounce below restarts on every
  // edit through its cleanup — and that same cleanup used to run on unmount,
  // cancelling the pending save with nothing to write it: "Projects", a tool
  // switch or a remount lost the last 800 ms of edits every time.
  useEffect(() => {
    const flush = () => {
      if (!saveOwed.current) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = null;
      void pendingSave.current?.();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, []);

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
    const save = async () => {
      saveOwed.current = false;
      setSaveState('saving');
      // Hashing is memoised per file, so only the first save of a folder
      // pays for it; every later autosave is a cache hit.
      const mediaFiles = await hashedMediaRefs(
        clips.flatMap((c) =>
          [c.parts.video, c.parts.srt, c.parts.image].filter((f): f is File => !!f),
        ),
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
        lutFilm: lutStack.film,
        theme,
        scenes,
        shades,
        outro,
        exportPrefs: {
          fileName: exportFileName.trim() || null,
          variants,
        },
        media: {
          ...docRef.current.media,
          files: mediaFiles.length ? mediaFiles : docRef.current.media.files,
          activeId,
          trims,
          develops,
          renditions,
        },
        thumbnail: await bakeThumbnail(),
        durationSeconds: durationRef.current || docRef.current.durationSeconds,
      };
      docRef.current = doc;
      const ok = await putProject(doc);
      onDocSaved(doc);
      setSaveState(ok ? 'saved' : 'storage-error');
    };
    pendingSave.current = save;
    saveOwed.current = true;
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      void save();
    }, 800);
    return () => {
      // Restarting the debounce only: what is owed is written by the
      // unmount flush above, never dropped here.
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
    shades,
    outro,
    exportFileName,
    variants,
    activeId,
    trims,
    develops,
    renditions,
    lutStack.layers,
    lutStack.output,
    // The texture is written (`lutFilm`) and undone like the layers, so it
    // is a trigger like them: a grain or halation change alone used to wait
    // for some other edit before it reached the store.
    lutStack.film,
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
      lutFilm: lutStack.film,
      theme,
      scenes,
      shades,
      outro,
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
    setShades(structuredClone(file.shades ?? []));
    setOutro(structuredClone(file.outro ?? null));
    setExportFileName(file.exportPrefs.fileName ?? '');
    setVariants(structuredClone(file.exportPrefs.variants));
    void lutStack.restore(file.lutStack, file.outputTransform, file.lutFilm);
    // The incoming deck has different ids — whatever was selected is gone.
    setSelectedElementId(null);
    setShowSettings(false);
  }

  // --- export -------------------------------------------------------------

  /**
   * One variant of a still: a single composite, so there is no decode loop, no
   * cadence and no cancellation point — the whole thing is one canvas away.
   */
  async function renderStillVariant(
    bitmap: ImageBitmap,
    variant: ExportVariant,
    frame: { width: number; height: number },
  ): Promise<Blob> {
    const blob = await exportPhotoVariant(bitmap, variant, {
      frame,
      elements: stageElements,
      cue: cues[0] ?? null,
      lut,
      intensity: 1,
      film: lutStack.film,
      theme,
      timeShift,
      shades,
    });
    return blob;
  }

  /** One variant of a clip, through WebCodecs — with the seek fallback. */
  async function renderClipVariant(
    source: File | null,
    demuxed: DemuxResult | null,
    variant: ExportVariant,
    srcWidth: number,
    srcHeight: number,
    onProgress: (p: { phase: string; ratio: number | null }) => void,
    controller: AbortController,
  ): Promise<Blob> {
    if (!source) throw new Error('This media has nothing to export.');
    const opts = {
      elements,
      cues,
      lut,
      intensity: 1,
      // A clip takes the film node too: `SOURCE → CUBE → [FILM] → OUTPUT`.
      film: lutStack.film,
      theme,
      timeShift,
      scenes,
      shades,
      srcWidth,
      srcHeight,
      // null when the whole clip is kept, so an untrimmed export runs the
      // exact path it ran before trimming existed.
      trim: exportTrim(range, duration),
      outro,
    };
    try {
      return await exportVariantVideo(demuxed ?? source, variant, opts, onProgress, controller.signal);
    } catch (err) {
      // Source-geometry variants keep the codec-agnostic seek fallback
      // (playable-but-undecodable HEVC); reframed ones cannot.
      const sourceGeometry =
        variant.aspectId === 'source' && variant.resolution === 'source';
      if (err instanceof DecodeUnsupportedError && sourceGeometry && !activeError) {
        return await exportOverlayVideoViaSeek(
          source,
          cues,
          variant.overlays ? elements : [],
          lut,
          1,
          theme,
          timeShift,
          onProgress,
          controller.signal,
          variant.frameRate,
          opts.trim,
          variant.speed,
          scenes,
          // The fallback runs only at source geometry, so the card composes
          // for the source frame — the same frame everything else drew for.
          variant.overlays ? outroTail(outro, srcWidth, srcHeight) : null,
          shades,
        );
      }
      if (err instanceof DecodeUnsupportedError) {
        throw new Error(
          "This browser can't decode the source for a reframed export — transcode the clip to H.264 first (Overlay tab banner).",
        );
      }
      throw err;
    }
  }

  /**
   * Render the variants in turn — every one, or `only` those (the pinned
   * bar's menu offers each alone); each is written as it finishes.
   */
  async function handleExport(only?: readonly ExportVariant[]) {
    const runVariants = only ?? variants;
    if (!active || exporting || runVariants.length === 0) return;
    if (!activeVideo && !photo) return;
    const meta = lib.getMeta(active.id);
    // A rush the person put on the stage is in hand: the export encodes it
    // as it stands, at its own frame, and fetches nothing. "Render from the
    // proxy" still means the proxy — the Library's file, which every browser
    // decodes.
    const fromStageRush = !isPhoto && stageOnOther && !renderFromProxy;
    const stageW = stageDims?.width ?? videoRef.current?.videoWidth;
    const stageH = stageDims?.height ?? videoRef.current?.videoHeight;
    let srcWidth = photoNatural?.width ?? (fromStageRush ? stageW : meta?.width) ?? videoRef.current?.videoWidth ?? 0;
    let srcHeight = photoNatural?.height ?? (fromStageRush ? stageH : meta?.height) ?? videoRef.current?.videoHeight ?? 0;
    if (!srcWidth || !srcHeight) {
      setExportError(
        isPhoto
          ? 'This photo has not been decoded yet.'
          : 'The clip has not produced its dimensions yet — play a frame first.',
      );
      return;
    }
    // A running preview and an export are two consumers of the same machine:
    // the transport keeps decoding (and, on a conformed clip, at up to 4×)
    // while WebCodecs decodes the same file again beside it. Pause first —
    // the element's own `pause` event keeps the transport's state (and the
    // resume-across-clips ref) honest, so nothing restarts on its own.
    videoRef.current?.pause();
    setExporting(true);
    setExportError(null);
    setExportDone(false);
    setRunStats([]);
    setLastRun([]);
    setRunClip({ id: active.id, name: active.baseName });
    setRunEnd(null);
    const measured: ExportStat[] = [];
    const rendered: File[] = [];
    const controller = new AbortController();
    exportAbort.current = controller;
    const clipId = active.id;
    const cut = trimmed ? range : null;
    // The composition the run renders — this render's, whatever is edited
    // while it goes on (L2: retouching stays free, the export tab is locked).
    const editAtClick = edit;
    // Prefer the transcoded H.264 (if one was made for preview): WebCodecs can
    // decode it directly, where the HEVC original would fail.
    let source = fromStageRush
      ? (activeTranscode.transcoded ?? stageVideo)
      : stageOnOther
        ? activeVideo
        : (activeTranscode.transcoded ?? activeVideo);
    const base = exportFileName.trim() || active.baseName;
    // The run as a TASK too (`tasks.md`, T4): the panel's own bar and Cancel
    // stay, and the masthead's pill says the same wherever the person walks.
    const exportTask = startTask({
      label: `Exporting ${base}`,
      scope: finalsMedia ? (knownIdentity(finalsMedia)?.assetId ?? fileIdentity(finalsMedia)) : null,
      progress: 0,
      detail: `${runVariants.length} variant${runVariants.length === 1 ? '' : 's'}`,
      cancel: () => controller.abort(),
    });
    // The run, variant by variant: a clip is encoded then written, a still
    // rendered then written; a clip whose capture is fetched first says so on
    // its first variant, the one that waits for it.
    const fetchesCapture = !photo && !stageOnOther && Boolean(proxyWithOriginal?.fetchOriginal) && !renderFromProxy;
    const units: RunUnit[] = runVariants.map((v, i) => ({
      id: v.id,
      name: `${active.baseName} · Variant ${variants.indexOf(v) + 1} · ${variantSize(v)}`,
      phases: photo
        ? STILL_PHASES
        : i === 0 && fetchesCapture
          ? [{ id: 'fetch', label: 'Fetch original' }, ...CLIP_PHASES]
          : CLIP_PHASES,
    }));
    const showRun = (next: RunProgress | null) => {
      runNow.current = next && controller.signal.aborted ? cancelRun(next) : next;
      setRun(runNow.current);
      if (runNow.current) exportTask.update({ progress: runFraction(runNow.current) });
    };
    const say = (phase: string, words: string, ratio: number | null = null) => {
      if (runNow.current) showRun(atStep(runNow.current, phase, words, ratio));
      exportTask.update({ detail: words });
    };
    showRun(startRun(units, Date.now()));
    controller.signal.addEventListener('abort', () => showRun(runNow.current));
    showRun(enterUnit(runNow.current!, 0));
    // A still delivered from its source's ORIGINAL when the frame is worth it
    // (O2 of `docs/develop-originals.md`). Decoded here and closed with the
    // run: the stage keeps its own bitmap. Either way the still is decoded at
    // what the LARGEST variant draws (`stillSourceEdge`), never the whole
    // picture for a 1080 cut, and the variants are sized against the frame it
    // is delivered at (`runFrame`), whatever density was decoded.
    let still = photo;
    let runFrame: { width: number; height: number } | null =
      photo && photoNatural ? deliveryFrame(photoNatural) : null;
    let fetchedStill: ImageBitmap | null = null;
    try {
      if (photo && activeImage && photoProxy && stillFrame) {
        const chosen = await deliveryFor(activeImage, null, stillFrame);
        if (chosen.file !== activeImage) {
          say('render', `Fetching the original from ${photoProxy.sourceId}…`);
          const decoded = await decodeStillForExport(chosen.file, runVariants);
          fetchedStill = decoded.bitmap;
          still = fetchedStill;
          runFrame = decoded.frame;
        }
      }
      // The stage's copy is decoded at the stage's budget: where the run
      // needs more than it holds, the still is decoded again for the run and
      // closed with it. A 1080 cut usually needs less, and costs no decode.
      if (photo && stageImage && still === photo && runFrame) {
        const need = exportDecodeEdge(runVariants, runFrame);
        if (Math.max(photo.width, photo.height) < need) {
          const decoded = await decodeStillForExport(stageImage, runVariants);
          fetchedStill = decoded.bitmap;
          still = fetchedStill;
          runFrame = decoded.frame;
        }
      }
      if (still && runFrame) {
        srcWidth = runFrame.width;
        srcHeight = runFrame.height;
      }
      // Editing happened on the source's proxy; delivering should not. Fetch
      // the capture once, before the first variant, and encode every variant
      // from it — at ITS dimensions, which is what makes a 1080 variant
      // actually 1080. Photos never take this path: `origin` is read off the
      // clip, and a photo's original is often a RAW no browser decodes. Nor
      // does a rush already on the stage: it is the source above.
      if (fetchesCapture && proxyWithOriginal?.fetchOriginal) {
        say('fetch', `Fetching ${proxyWithOriginal.name ?? 'the capture'} from ${proxyWithOriginal.sourceId}`);
        // A task of its own — the capture's name and weight, on its edge,
        // cancellable from the pill — beside the export's own Cancel. Held
        // for the session once it lands, and JOINED if the stage is already
        // bringing it (`held-fetch.ts`): the next export, and a switch of the
        // stage to the rush, cost no second crossing.
        const fetchOriginal = proxyWithOriginal.fetchOriginal;
        const key = activeVideo ? (knownIdentity(activeVideo)?.assetId ?? null) : null;
        const init = {
          label: `Fetching ${proxyWithOriginal.name ?? 'the capture'}`,
          scope: key,
          bytes: proxyWithOriginal.bytes ?? null,
        };
        source = key
          ? await fetchHeld(key, init, fetchOriginal, controller.signal)
          : await trackedFetch({ ...init, signal: controller.signal }, (opts) => fetchOriginal(opts));
        srcWidth = proxyWithOriginal.width ?? srcWidth;
        srcHeight = proxyWithOriginal.height ?? srcHeight;
      }
      // Several variants of a clip read and demux its file ONCE: each used to
      // read the whole file and parse it again. One variant keeps the old path.
      let demuxed: DemuxResult | null = null;
      if (!still && source && runVariants.length > 1) {
        try {
          demuxed = await demuxSource(source);
        } catch {
          // Each variant then reads it itself, and says what went wrong.
          demuxed = null;
        }
      }
      for (let i = 0; i < runVariants.length; i += 1) {
        // Checked per variant, not only inside the encoder: a still renders in
        // one pass and never looks at the signal, so a cancelled run of five
        // stills would otherwise write all five. Returning rather than
        // breaking, so a cancelled run does not then report "✓ Exported".
        if (controller.signal.aborted) return;
        const variant = runVariants[i];
        if (i > 0) showRun(enterUnit(runNow.current!, i));
        say(still ? 'render' : 'encode', still ? `Rendering ${variantSize(variant)}` : `Encoding ${variantSize(variant)}`, still ? null : 0);
        // Time the whole variant, delivery included: writing a 400 MB file to
        // a folder is part of what the user waited for.
        const startedAt = Date.now();
        setLiveExport({ id: variant.id, startedAt });
        // The exporter reports once per decoded frame, and each report used
        // to re-render this whole editor and notify every task subscriber —
        // on the same thread that is decoding and encoding. Half a percent
        // is finer than any bar draws.
        let reported = -1;
        const onProgress = (p: { phase: string; ratio: number | null }) => {
          if (p.phase === 'encoding' && p.ratio != null) {
            if (p.ratio < 1 && p.ratio - reported < 0.005) return;
            reported = p.ratio;
            say('encode', `Encoding ${variantSize(variant)} · ${Math.round(p.ratio * 100)}%`, p.ratio);
          }
        };
        const blob = still
          ? await renderStillVariant(still, variant, runFrame ?? { width: still.width, height: still.height })
          : await renderClipVariant(source, demuxed, variant, srcWidth, srcHeight, onProgress, controller);
        const name = variantFileName(base, variant, isPhoto ? 'photo' : 'video');
        const file = new File([blob], name, { type: blob.type });
        say('write', `Writing ${name}`);
        await deliver(file);
        rendered.push(file);
        const stat: ExportStat = {
          bytes: blob.size,
          seconds: (Date.now() - startedAt) / 1000,
          // What was encoded, not what the clip holds: a trimmed run that
          // rendered 5 s of a 40 s rush is not 8× realtime. A still has no
          // duration at all, so it reports size and wall clock alone.
          clipSeconds: isPhoto
            ? null
            : (trimmed ? trimDuration(range) : durationRef.current) || null,
        };
        measured.push(stat);
        setVariantStats((prev) => ({ ...prev, [statKey(clipId, variant, cut)]: stat }));
        setRunStats([...measured]);
        showRun(finishUnit(runNow.current!, i, true, Date.now()));
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setExportError((err as Error).message || 'Export failed');
      }
    } finally {
      exportTask.done();
      fetchedStill?.close();
      setExporting(false);
      setLiveExport(null);
      exportAbort.current = null;
      runNow.current = null;
      setRun(null);
      // What left, said once the run is over — kept with the clip it was cut
      // from, never the one open.
      if (rendered.length > 0) {
        setLastRun(rendered);
        setExportDone(true);
      }
      // What the run did not deliver, said first: a retouch made while it ran
      // is not in its files, and a cancel keeps what it wrote.
      const moved = !sameSlice(
        { ...editAtClick, variants: null, exportFileName: null },
        { ...editNow.current, variants: null, exportFileName: null },
      );
      setRunEnd(
        [
          moved && rendered.length > 0
            ? 'The project was edited during the export — the files are as it was at the click; export again to send the change.'
            : null,
          controller.signal.aborted
            ? rendered.length > 0
              ? `Cancelled after ${rendered.length} of ${runVariants.length} — what was written stays.`
              : 'Export cancelled — nothing was written.'
            : null,
        ]
          .filter(Boolean)
          .join(' ') || null,
      );
    }
  }

  // An edit to a variant no longer erases its figure: the figure is keyed by
  // the settings that produced it (`statKey`), so the row hides it while they
  // differ — and a run in flight keeps the figures it is writing.
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
  async function deliver(file: File): Promise<void> {
    if (destDir) {
      const res = await writeItems(destDir, [{ name: file.name, file }], { replace: true });
      if (res.errors.length) throw new Error(res.errors[0].message);
      return;
    }
    downloadBlob(file, file.name);
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
        lut,
        intensity: 1,
        theme,
        timeShift,
        scenes,
        shades,
        originSeconds: range.start,
        overlays: true,
      });
      if (blob) {
        const name = frameGrabName(exportFileName.trim() || active.baseName, video.currentTime);
        await deliver(new File([blob], name, { type: blob.type }));
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

  // A decoded still knows its own size exactly (and upright); the library's
  // metadata is the fallback, and the only source for a RAW nothing can decode.
  // What is ON THE STAGE — a remote source's proxy, when that is what was
  // added. The header badge and the frame's aspect describe this, and must
  // keep describing it: claiming the capture's size for a picture the user is
  // not looking at is the same lie in the other direction.
  //
  // A rush switched onto the stage is what the person IS looking at, so it
  // is its frame the badge states — the source's word for it until the
  // element has measured it.
  const rushW = stageOnOther && !isPhoto ? (stageDims?.width ?? proxyWithOriginal?.width ?? undefined) : undefined;
  const rushH = stageOnOther && !isPhoto ? (stageDims?.height ?? proxyWithOriginal?.height ?? undefined) : undefined;
  const srcW = photoNatural?.width ?? rushW ?? activeMeta?.width;
  const srcH = photoNatural?.height ?? rushH ?? activeMeta?.height;
  // What the EXPORT will encode, which is a different file when it fetches the
  // capture first. Only the variant maths uses this: a variant measured
  // against the proxy would promise 1080 from a file it is not going to use.
  // A still's own best source: its original's pixels where it has one. The
  // variant maths reads this, so a variant never promises a frame the file
  // it will really encode cannot give.
  const bestStillW = photoProxy ? (photoProxy.width ?? srcW) : srcW;
  const bestStillH = photoProxy ? (photoProxy.height ?? srcH) : srcH;
  // A clip delivers from its capture (fetched, or on the stage already)
  // unless the proxy was asked for — and that is the Library's file, whatever
  // the stage shows.
  const exportW = isPhoto
    ? bestStillW
    : deliversCapture
      ? (proxyWithOriginal?.width ?? srcW)
      : stageOnOther
        ? (activeMeta?.width ?? srcW)
        : srcW;
  const exportH = isPhoto
    ? bestStillH
    : deliversCapture
      ? (proxyWithOriginal?.height ?? srcH)
      : stageOnOther
        ? (activeMeta?.height ?? srcH)
        : srcH;
  /**
   * The biggest frame the variants will write, from that best source — the
   * frame the *Delivers* row asks its question against. A Studio variant
   * never upscales (`variantOutputSize` caps at the source's short side), so
   * the question is the roll's: can the file in hand fill the frame the
   * ORIGINAL could give?
   */
  const stillFrame = useMemo(() => {
    if (!isPhoto || !bestStillW || !bestStillH) return null;
    let best: { w: number; h: number } | null = null;
    for (const v of variants) {
      const o = variantOutputSize(v, bestStillW, bestStillH);
      if (!best || o.w * o.h > best.w * best.h) best = o;
    }
    return best;
  }, [isPhoto, bestStillW, bestStillH, variants]);
  // Measured only while the Export tab is up: measuring decodes, and a
  // 48-megapixel decode is not worth a sentence nobody is looking at.
  // Of the file on the stage: a capture's file chosen above the proxy is what
  // the still leaves from, and the row says what it holds.
  const stillDelivery = useDeliveryRow(isPhoto && tab === 'export' ? stageImage : null, null, stillFrame);
  const activeRes = srcW && srcH ? `${srcW}×${srcH}` : null;
  // The stage draws at source resolution, so the guides' notion of "this
  // frame" is the media's own aspect — undefined until the probe lands.
  const frameAspect = srcW && srcH ? srcW / srcH : undefined;
  const activeDetail = (
    isPhoto
      ? [activeRes, stageOnOther && stageImage ? imageTypeLabel(stageImage.name) : (activeMeta?.imageType ?? null)]
      : [activeRes, activeInfo.codec, activeInfo.fps ? `${activeInfo.fps} fps` : null]
  )
    .filter(Boolean)
    .join(' · ');
  // Encoding a video needs WebCodecs; composing a still needs a canvas, which
  // every browser here has — a photo project must not be told to switch browser.
  const exportSupported = isPhoto || isEncodeSupported();
  // The clip's own cadence, when the container probe produced one — used to
  // label "Source fps" and to warn when a variant asks for more than exists.
  const sourceFps = activeInfo.fps && activeInfo.fps > 0 ? activeInfo.fps : null;

  // The export's verbs, PINNED under the inspector's scroll (2026-09-29, his
  // pick S1 from the Studio lab, Develop's grammar): every variant is the
  // button, each variant alone and a frame capture are the menu. What is SET
  // — the output, the variants — stays in the tab's sections, which scroll.
  const fileWord = isPhoto ? 'JPEG' : 'MP4';
  const variantSize = (v: ExportVariant) => {
    const dims = exportW && exportH ? variantOutputSize(v, exportW, exportH) : null;
    return dims ? `${dims.w}×${dims.h}` : v.aspectId === 'source' ? 'source frame' : v.aspectId;
  };
  const exportVerbs: ExportVerb[] = [];
  if (active && exportSupported) {
    exportVerbs.push({
      id: 'all',
      label: variants.length > 1 ? `Export ${variants.length} ${fileWord}s` : `Export the ${fileWord}`,
      hint: isPhoto
        ? 'Render every variant as a JPEG, one after the other'
        : 'Render every variant (H.264 MP4), one after the other',
      run: () => void handleExport(),
    });
    if (variants.length > 1) {
      variants.forEach((v, i) =>
        exportVerbs.push({
          id: `only-${v.id}`,
          label: `Variant ${i + 1} alone`,
          hint: `${variantSize(v)} · ${variantFileName(exportFileName.trim() || active.baseName, v, isPhoto ? 'photo' : 'video')}`,
          run: () => void handleExport([v]),
        }),
      );
    }
  }
  if (active && !isPhoto) {
    exportVerbs.push({
      id: 'frame',
      label: 'Capture this frame',
      hint: 'The frame under the playhead as a JPEG, overlays and look burned in',
      run: () => void handleGrabFrame(),
    });
  }
  const exportSummary = !exportSupported
    ? 'Export needs WebCodecs (try Chrome/Edge/Safari) — editing works everywhere.'
    : `${variants.length} ${fileWord}${variants.length === 1 ? '' : 's'} · ${variants.map(variantSize).join(', ')} · into ${destDir ? destDir.name : 'Downloads'}`;
  // The run's rows are marked only on the clip it runs for: the variants are
  // the project's, the run is one clip's.
  const runHere = run !== null && runClip?.id === activeId;
  const resultsHere = runClip?.id === activeId;
  const exportNote =
    (exportDone && runStats.length > 0) || exportError || runEnd ? (
      <div className="flex flex-col gap-1.5">
        {runEnd && <span className="text-xs text-ink-soft">{runEnd}</span>}
        {exportDone && runStats.length > 0 && (
          <span className="inline-flex items-baseline gap-1.5 font-mono text-xs tabular-nums text-ink-soft">
            <span className="inline-flex self-center text-ok">{Icons.check}</span>
            {!resultsHere && runClip ? `${runClip.name} · ` : ''}
            {describeExportRun(runStats)}
          </span>
        )}
        {exportError && <span className="text-xs text-danger">{exportError}</span>}
      </div>
    ) : null;

  // What the outro's preview composes for: the project's destination format —
  // the card recomposes per variant frame at export, like every overlay.
  const outroAspect = (() => {
    const preset = ASPECT_PRESETS.find((a) => a.id === aspectId);
    return preset ? preset.w / preset.h : (frameAspect ?? 9 / 16);
  })();

  const selectedElement = elements.find((e) => e.id === selectedElementId) ?? null;
  const activeCue = findCue(cues, time);
  // Every timing control reads in "seconds from the first exported frame", so
  // the playhead has to be offset by the in point before it can be shown or
  // dropped into a field.
  const playhead = Math.max(0, time - range.start);
  const introScene = scenes[0] ?? null;
  const selectedScene = findScene(scenes, selectedElement?.sceneId);
  const hasTelemetry = cues.length > 0;


  /**
   * The local save state, drawn the way `SyncPill` draws the remote one: a
   * coloured dot and one word, collapsing to the dot alone on a phone unless
   * the state is waiting on the author. A row of fixed pills has no room for
   * a sentence nobody controls the length of, and "Saved" is a reassurance
   * rather than a thing to read — while "Storage unavailable" is a decision,
   * and a decision nobody is asked to make does not get made.
   *
   * The full text is announced either way, from the live region below.
   */
  const saveBadge: Record<SaveState, { label: string; cls: string; dot: string; act: boolean }> = {
    saved: { label: 'Saved', cls: 'text-ok border-ok-line', dot: 'bg-ok', act: false },
    saving: { label: 'Saving…', cls: 'text-muted border-line', dot: 'bg-faint', act: false },
    unsaved: { label: 'Edited', cls: 'text-muted border-line', dot: 'bg-line-strong', act: false },
    'storage-error': {
      label: 'Storage unavailable — in-memory only',
      cls: 'text-danger border-danger-line',
      dot: 'bg-danger',
      act: true,
    },
  };
  const save = saveBadge[saveState];
  const showSaveLabel = !compact || save.act;

  /** Something is on the stage: a loaded clip, or a decoded still. */
  const hasFrame = !!activeUrl || !!photo;

  const missingCount = reconciliation?.missing ?? 0;
  const changedCount = reconciliation?.changed ?? 0;
  // Renames are absorbed on open rather than reported as trouble — but say so,
  // because a file silently changing name under the project is exactly the
  // kind of thing that should never happen without a word.
  const renamedCount = reconciliation?.renamed ?? 0;
  const hasMissing = missingCount > 0;
  const hasChanged = changedCount > 0;
  const mediaTrouble = hasMissing || hasChanged;

  return (
    <section className="flex flex-col flex-1 min-h-0 gap-4" aria-label="Studio">
      {/* Project bar: back to gallery, editable name, then — pinned right —
          the save state and the format/settings pill. Every pill shares one
          height so the row reads as a single band, not a drift of chips.
          It WRAPS, and the status group goes to its own line rather than
          squeezing: without that, a 390px screen left the name field about
          six characters wide and "Untitled" read as "Untitl". The documented
          shape for a row mixing fixed pills with something elastic — the pills
          keep their width, the whole group drops a line. */}
      <PageBar
        back={{ label: 'Projects', onClick: onShowProjects }}
        trailing={
          <>
            {history.control}
            {headerExtra}
            <span
              className={`${barPill} bg-paper font-mono text-2xs tracking-[0.1em] uppercase ${
                showSaveLabel ? 'gap-1.5' : 'justify-center w-[2.125rem] px-0'
              } ${save.cls}`}
              aria-label={save.label}
            >
              <span
                className={`inline-block w-[7px] h-[7px] rounded-full shrink-0 ${save.dot}`}
                aria-hidden="true"
              />
              {showSaveLabel && save.label}
            </span>
            {/* The pill is a summary; a live region carries the whole state so
                a screen reader hears it change whatever the width. */}
            <span className="sr-only" role="status" aria-live="polite">
              {save.label}
            </span>
            <Button
              onClick={() => setShowSettings(true)}
              className="font-mono text-2xs tracking-[0.06em]"
              title="Project settings — name, format, import/export"
              trailing={Icons.settings}
            >
              {ASPECT_PRESETS.find((a) => a.id === aspectId)?.id ?? aspectId}
            </Button>
          </>
        }
      >
        {/* The one thing in the bar that is NOT a pill, and it is allowed
            because it is one line high: a project is found again by what it is
            called, and the field is where the name is read as well as typed.
            A title that needs two lines goes under the bar instead — see
            `PageBar` and the trip overview. */}
        <input
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          aria-label="Project name"
          /* Exactly the pills' own height, or the row centres a 32px field
             against a 30px pill and pushes the back button 1px down — the
             whole point of the bar is that it does not move. */
          className="grow shrink basis-[9rem] min-w-0 max-w-[24rem] h-[2.125rem] font-serif text-lg bg-transparent border-0 border-b border-transparent focus:border-line-strong focus:outline-none text-ink px-1 py-0"
        />
      </PageBar>

      {developOpen && active && activeFile && (
        <DevelopSheet
          // The picture on the stage — a rush or a camera file chosen above
          // the proxy included — so the sheet judges the pixels the stage
          // shows. The develop itself is the MEDIA's, keyed and hash-guarded
          // by the Library's file whatever is on screen.
          file={stageFile ?? activeFile}
          videoTimeSeconds={developAt}
          title={(stageFile ?? activeFile).name}
          stack={lutStack}
          value={activeDevelop}
          onDone={(next) => {
            setActiveDevelop(next);
            setDevelopOpen(false);
          }}
          onCancel={() => setDevelopOpen(false)}
          footerHint={`writes to ${active.baseName}`}
          applyTo={developApplyTo}
        />
      )}

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
          houseStyle={
            import.meta.env.DEV
              ? {
                  elements,
                  guides,
                  lutStack: lutStack.toSaved(),
                  outputTransform: lutStack.output,
                  lutFilm: lutStack.film,
                  theme,
                  scenes,
                  shades,
                  outro,
                  exportPrefs: { fileName: exportFileName.trim() || null, variants },
                }
              : undefined
          }
        />
      )}

      {renamedCount > 0 && (
        <div className={`${noticeMuted} m-0`}>
          {renamedCount === 1
            ? '1 media file was renamed since last save'
            : `${renamedCount} media files were renamed since last save`}{' '}
          — recognised by content and adopted under the new name.
        </div>
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
              <span className="font-mono text-2xs text-muted tabular-nums min-w-[3ch] text-center">
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
            className="font-semibold text-sm whitespace-nowrap overflow-hidden text-ellipsis"
            title={active.baseName}
          >
            {active.baseName}
          </span>
          {/* Which of the capture's files is on the stage — the proxy, the
              rush, the camera's JPEG — and the others one click away. Drawn
              only where there is something to switch to. */}
          <StageRenditionMenu
            baseName={active.baseName}
            rows={stageRendition.rows}
            current={stageRendition.current}
            fetching={stageRendition.fetching}
            onChoose={stageRendition.choose}
          />
          {activeDetail && (
            <span className="font-mono text-xs tracking-[0.02em] text-muted flex-none">
              {activeDetail}
            </span>
          )}
          {/* Said only once the file has actually been read: a chip that
              appears while the EXIF block is still being parsed reads as a
              verdict on a photo nobody has looked at yet. */}
          {!hasTelemetry && (isPhoto ? photoExif !== null : activeSrt === null) && (
            <span className="font-mono text-2xs tracking-[0.08em] uppercase text-faint flex-none border border-line rounded-full px-2 py-[2px]">
              {isPhoto ? 'no exif' : 'no telemetry'}
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
          {/*
            The stage box takes whatever room the column has, and the picture
            fits itself into it: a canvas is a replaced element, so centring
            plus `max-w-full max-h-full` is the whole of the arithmetic. There
            is no VIEW zoom here — one shipped and was taken back out, because
            over a media preview it fought the gestures the picture itself
            answers (`shared/ui/stage-zoom.ts`).

            `flex-1` is right at EVERY width: the shell keeps the screen's
            height on a phone too (App.tsx), so the chain above is definite all
            the way up and the picture's height always resolves.
          */}
          <div
            className={`relative rounded-paper overflow-hidden flex-1 min-h-0 flex items-center justify-center @max-[800px]:min-h-[240px] ${
              hasFrame ? 'bg-frame' : 'bg-transparent'
            }`}
          >
            {hasFrame ? (
              <canvas
                ref={canvasRef}
                className="block w-auto h-auto max-w-full max-h-full object-contain bg-frame touch-none cursor-grab"
                onPointerDown={stage.onPointerDown}
                onPointerMove={stage.onPointerMove}
                onPointerUp={stage.onPointerUp}
                onPointerCancel={stage.onPointerUp}
              />
            ) : (
              <div className="w-full aspect-video flex items-center justify-center bg-surface border border-line rounded-paper text-muted text-center p-4 font-mono text-sm">
                {clips.length === 0
                  ? 'No media in this project yet — add clips or photos from the Library, or point a folder from the banner above.'
                  : photoError
                    ? 'This photo could not be decoded — see below.'
                    : isPhoto
                      ? 'Decoding the photo…'
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
            {/* This media's own tasks along the stage's edge — its capture
                being fetched, a run of its variants (V1 + V4). */}
            {finalsMedia && <TaskEdge scope={knownIdentity(finalsMedia)?.assetId ?? fileIdentity(finalsMedia)} />}
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
                className="flex-none w-[2.2rem] h-[2.2rem] border-0 rounded-full bg-ink text-paper cursor-pointer text-xs leading-none inline-flex items-center justify-center transition-[background-color] duration-200 ease-paper hover:bg-accent"
                onClick={togglePlay}
                aria-label={playing ? 'Pause' : 'Play'}
                title="Play / pause (Space)"
              >
                {playing ? Icons.pause : Icons.play}
              </button>
              <span className="font-mono text-xs tabular-nums text-muted flex-none min-w-[3.2ch] text-center">
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
              <span className="font-mono text-xs tabular-nums text-muted flex-none min-w-[3.2ch] text-center">
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
                className={`flex-none px-2.5 py-1 rounded-full border font-mono text-2xs tracking-[0.1em] cursor-pointer ${TRANSPORT_TOUCH} ${
                  loop
                    ? 'border-accent bg-accent-wash text-accent-ink'
                    : 'border-line-strong bg-paper text-muted hover:text-accent-ink hover:border-accent'
                }`}
                title="Loop the trimmed range instead of stopping on the out point"
              >
                ↻
              </button>
              {/* A capture renders the frame with its overlays and look: the
                  verb stays down until the file is saved (`useVerb`). */}
              <VerbButton
                onRun={handleGrabFrame}
                disabled={grabbing}
                className={`flex-none px-2.5 py-1 rounded-full border border-line-strong bg-paper text-xs text-muted cursor-pointer hover:text-accent-ink hover:border-accent disabled:opacity-50 disabled:cursor-default ${TRANSPORT_TOUCH} ${VERB_GROUND}`}
                title="Save this frame as a JPEG, overlays and look burned in"
                aria-label="Capture frame"
              >
                {grabbing ? '…' : '⌾'}
              </VerbButton>
              {/* Preview speed. Viewing only — it moves no readout and no
                  export; the delivered speed lives in the Export tab. */}
              <select
                value={previewSpeed === 'realtime' ? 'realtime' : String(previewSpeed)}
                onChange={(e) =>
                  setPreviewSpeed(
                    e.target.value === 'realtime' ? 'realtime' : Number(e.target.value),
                  )
                }
                className={`flex-none pl-2 pr-1 py-1 rounded-full border font-mono text-2xs tracking-[0.06em] cursor-pointer focus:outline-none pointer-coarse:min-h-[2.125rem] transition-colors ${
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
                className={`flex-none px-2.5 py-1 rounded-full border font-mono text-2xs tracking-[0.1em] cursor-pointer ${TRANSPORT_TOUCH} ${
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
             <div className="flex items-center gap-2 h-[1.1rem] pl-[3.05rem] font-mono text-2xs tracking-[0.06em] tabular-nums">
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
                     className="border-0 bg-transparent p-0 text-accent-ink cursor-pointer text-xs leading-none hover:text-accent"
                     title="Use the whole clip again"
                     aria-label="Clear the trim"
                   >
                     ↺
                   </button>
                 </>
               ) : (
                 <span className="text-faint">
                   Full clip
                   {!trim.learned && ' — drag the handles, or press I / O to cut at the playhead'}
                 </span>
               )}
             </div>
            </div>
          )}

          {/* A still has no transport to offer — no play, no trim, no cadence,
              no shutter (the export IS the still). What survives is the one
              control that is about the picture rather than about time: the A/B
              wipe, which is how a grade gets judged. */}
          {isPhoto && photo && (
            <div className="flex flex-wrap items-center gap-2 px-[0.85rem] py-[0.6rem] border border-line rounded-paper bg-surface flex-none">
              <span className="font-mono text-2xs tracking-[0.1em] uppercase text-faint">
                Still
              </span>
              <span className="flex-1" />
              <button
                type="button"
                onClick={() => setCompareOn((c) => !c)}
                aria-pressed={compareOn}
                className={`flex-none px-2.5 py-1 rounded-full border font-mono text-2xs tracking-[0.1em] cursor-pointer transition-colors ${
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

          {photoError && <p className={notice}>{photoError}</p>}
          {stageRendition.error && <p className={noticeMuted}>{stageRendition.error}</p>}

          {activeError && (
            <div className={`${notice} flex flex-col gap-3`}>
              {stageOnOther && stageFile ? (
                <p className="m-0">
                  {stageFile.name} does not decode in this browser — DJI rushes
                  are often HEVC/H.265, which is why the source made an H.264
                  proxy. Go back to the proxy, transcode this file to H.264
                  here (slow for a long 4K rush), or try Safari, which decodes
                  HEVC best.
                </p>
              ) : (
                <p className="m-0">
                  This clip failed to decode for preview. DJI footage is often
                  HEVC/H.265. Transcode it to H.264 to edit and export here (or
                  try Safari, which decodes HEVC best). Overlays still preview
                  over the last frame.
                </p>
              )}
              {stageOnOther && stageRendition.rows[0]?.role === 'proxy' ? (
                <div className="flex flex-wrap items-start gap-3">
                  <Button size="sm" onClick={() => stageRendition.choose('proxy')}>
                    Back to the proxy
                  </Button>
                  <TranscodeControl state={activeTranscode} />
                </div>
              ) : (
                <TranscodeControl state={activeTranscode} />
              )}
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

        {/* Inspector — a column beside the stage wherever there is width for
            one, a sheet over it on a phone. Same content either way: the tabs
            are the only thing that moves, to the shell's bottom bar. */}
        {active && (
          <PanelHost
            asSheet={compact}
            open={inspectorOpen}
            onClose={() => setInspectorOpen(false)}
            title={TABS.find((t) => t.id === tab)?.label ?? 'Inspector'}
            className="flex flex-col gap-3 @min-[800px]:w-[340px] flex-none min-h-0 @max-[800px]:max-h-[calc(var(--app-h)*0.45)] border border-line rounded-paper bg-surface p-3"
          >
            {!compact && (
              <Segmented
                fill
                label="Inspector"
                value={tab}
                onChange={setTab}
                options={TABS}
                className="flex-none"
              />
            )}

            <div className="flex flex-col flex-1 min-h-0 overflow-auto pr-0.5">
              {tab === 'overlay' && (
                <>
                  <InspectorSection
                    id="studio.palette"
                    title="Add an element"
                    open={paletteOpen}
                    onOpenChange={setPaletteOpen}
                  >
                    <ElementPalette
                      elements={elements}
                      cue={activeCue}
                      theme={theme}
                      timeShift={timeShift}
                      onAdd={addElement}
                      open={paletteOpen}
                      onOpenChange={setPaletteOpen}
                      bare
                    />
                  </InspectorSection>

                  {/* Trips' shades, over the whole clip: under the intro's
                      veil and every element, for as long as the footage runs
                      — a corner under the readouts, a sky under a title. */}
                  <InspectorSection
                    id="studio.shades"
                    title="Shades"
                    badge={shades.length ? String(shades.filter((sh) => sh.enabled !== false).length) : undefined}
                    info={
                      <p>
                        Gradients over the whole picture, under every element, so type stays readable
                        — the same shades as in Trips. A scene has its own, which come and go with it.
                        Clean variants leave them out, with the overlays.
                      </p>
                    }
                  >
                    <ShadesPanel
                      shades={shades}
                      onChange={setShades}
                      placing={placing?.scope === CLIP_SHADES ? placing.id : null}
                      onPlace={placeShade(CLIP_SHADES)}
                    />
                  </InspectorSection>

                  {introScene && (
                    <InspectorSection
                      id="studio.scene"
                      title={introScene.name}
                      badge={`${introScene.start.toFixed(1)}–${introScene.end.toFixed(1)} s`}
                    >
                      <ScenePanel
                        scene={introScene}
                        memberCount={elements.filter((e) => e.sceneId === introScene.id).length}
                        playhead={playhead}
                        onChange={(next) =>
                          setScenes((prev) => prev.map((sc) => (sc.id === next.id ? next : sc)))
                        }
                        onRemove={() => removeScene(introScene.id)}
                        placingShade={placing?.scope === introScene.id ? placing.id : null}
                        // A scene is not drawn over a photograph: nothing to place there.
                        onPlaceShade={isPhoto ? undefined : placeShade(introScene.id)}
                      />
                    </InspectorSection>
                  )}

                  {/* The outro — intro · footage · closing card. The stage
                      cannot show it (the playhead cannot travel past the
                      clip), so the block carries its own preview. */}
                  <InspectorSection
                    id="studio.outro"
                    title="Outro"
                    badge={outro ? `+ ${outro.seconds.toFixed(1)} s` : undefined}
                    info={<p>A closing card the export keeps encoding after the footage — appended, never over it.</p>}
                  >
                    {outro ? (
                      <OutroPanel
                        outro={outro}
                        aspect={outroAspect}
                        onChange={setOutro}
                        onRemove={() => setOutro(null)}
                      />
                    ) : (
                      <FieldRow label="Card">
                        <Button
                          size="sm"
                          icon={Icons.plus}
                          onClick={() => setOutro(createOutroCard(projectName.trim() || 'Merci'))}
                        >
                          Add an outro
                        </Button>
                      </FieldRow>
                    )}
                  </InspectorSection>

                  <InspectorSection
                    id="studio.elements"
                    title="Elements"
                    badge={String(elements.length)}
                    open={listOpen}
                    onOpenChange={setListOpen}
                    actions={
                      elements.length === 0 ? (
                        <Button size="sm" variant="ghost" onClick={loadDefaultDeck}>
                          Default deck
                        </Button>
                      ) : resettingDeck ? (
                        <span className="flex items-center gap-1">
                          <Button size="sm" variant="danger" onClick={loadDefaultDeck}>
                            Reset
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setResettingDeck(false)}>
                            Keep
                          </Button>
                        </span>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => setResettingDeck(true)}>
                          Reset deck
                        </Button>
                      )
                    }
                  >
                    {resettingDeck && elements.length > 0 && (
                      <p className="m-0 text-xs text-muted">
                        Replace {elements.length} element{elements.length > 1 ? 's' : ''} with the
                        default deck?
                      </p>
                    )}
                    {/* Capped and scrollable rather than free-growing: a deck
                        of fifteen readouts used to push the style panel off
                        the bottom of the inspector. */}
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
                  </InspectorSection>

                  {selectedElement && (
                    <div ref={elementPanelRef} className="scroll-mt-2 flex flex-col">
                      <InspectorSection
                        id="studio.element-style"
                        title="Element style"
                        info={<p>The selected element’s own look. Delete removes it.</p>}
                      >
                        <ElementPanel
                          element={selectedElement}
                          theme={theme}
                          onChange={(patch) => updateElement(selectedElement.id, patch)}
                        />
                      </InspectorSection>
                      <InspectorSection id="studio.element-timing" title="Timing">
                        <TimingPanel
                          element={selectedElement}
                          scene={selectedScene}
                          playhead={playhead}
                          onChange={(patch) => updateElement(selectedElement.id, patch)}
                        />
                      </InspectorSection>
                    </div>
                  )}

                  <InspectorSection id="studio.guides" title="Guides">
                    <GuidesControl guides={guides} onChange={setGuides} frameAspect={frameAspect} layout="rows" />
                  </InspectorSection>
                </>
              )}

              {tab === 'style' && (
                <InspectorSection
                  id="studio.title-style"
                  title="Title style"
                  info={
                    <p>
                      One look for every title and readout of the project; an element can
                      still depart from it on its own style.
                    </p>
                  }
                >
                  <StylePanel theme={theme} onChange={setTheme} heading={<></>} />
                </InspectorSection>
              )}

              {tab === 'grade' && (
                <>
                  {/* The media's own CORRECTION, one settled row at the TOP:
                      correction before look, on screen as in the cube. The
                      sliders live in the sheet, not here. */}
                  <DevelopSection
                    id="studio.develop"
                    info={
                      <p>
                        This media’s own correction — exposure, tone, colour — applied before
                        every look below. It belongs to this picture or clip and is kept with
                        the project’s media, never in a project file.
                      </p>
                    }
                    develop={activeDevelop}
                    canOpen={Boolean(activeFile)}
                    onOpen={() => {
                      setDevelopAt(videoRef.current?.currentTime ?? 0);
                      setDevelopOpen(true);
                    }}
                    onReset={() => setActiveDevelop(null)}
                  />
                  <InspectorSection id="studio.grade" title="Grade">
                    <GradePanel
                      stack={lutStack}
                      previewImage={photo}
                      previewLabel={activeImage?.name ?? null}
                      previewDraws={false}
                    />
                  </InspectorSection>
                </>
              )}

              {tab === 'info' && (
                <InfoPanel
                  baseName={active.baseName}
                  file={activeImage ?? activeVideo}
                  detail={activeDetail}
                  duration={duration}
                  cues={cues}
                  cue={activeCue}
                  timing={timing}
                  scale={scale}
                  overridden={overridden}
                  photo={isPhoto ? (photoExif ?? {}) : null}
                />
              )}

              {tab === 'export' && (
                <>
                  {run && (
                    <RunLockNotice since={run.startedAt}>
                      The overlays, the style and the grade stay free; an edit made now is said when
                      the run ends and goes to the next export.
                    </RunLockNotice>
                  )}
                  <LockSections locked={run !== null}>
                    <InspectorSection id="studio.export.output" title="Output">
                      <FieldRow label="File name">
                        <input
                          type="text"
                          value={exportFileName}
                          onChange={(e) => setExportFileName(e.target.value)}
                          placeholder={active.baseName}
                          aria-label="File name"
                          className="w-full font-sans text-sm h-[2.125rem] px-3 border border-line-strong rounded-control bg-paper text-ink focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                        />
                      </FieldRow>
                      <FieldRow
                        label="Destination"
                        hint={canWriteToDisk() ? undefined : 'Downloads — folder writing needs Chromium.'}
                      >
                        {canWriteToDisk() ? (
                          <>
                            <Readout muted={!destDir}>{destDir ? destDir.name : 'Downloads'}</Readout>
                            <span className="flex-1" />
                            {destDir && (
                              <Button size="sm" variant="ghost" onClick={() => setDestDir(null)}>
                                Downloads
                              </Button>
                            )}
                            <Button
                              size="sm"
                              onClick={() => {
                                void pickWritableDirectory()
                                  .then(setDestDir)
                                  .catch(() => undefined);
                              }}
                            >
                              {destDir ? 'Change…' : 'Folder…'}
                            </Button>
                          </>
                        ) : (
                          <Readout muted>Downloads</Readout>
                        )}
                      </FieldRow>
                      {(photoProxy || (isPhoto && stageOnOther)) && (
                        <FieldRow
                          label="Delivers"
                          align="start"
                          hint={`${stillDelivery?.reason ? `${stillDelivery.reason}. ` : stillDelivery ? '' : 'Measured once the picture is decoded. '}${
                            photoProxy
                              ? `You are editing on ${photoProxy.sourceId}’s proxy: the full-size original is fetched only where the proxy could not fill the frame your variants ask for, and kept for this session. A RAW is reached only through the render inside it, measured first — develop it on its RAW for the sensor itself.`
                              : `The stage shows ${stageFile?.name ?? 'the file chosen'}, and the still leaves from it as it stands — pick the proxy above the stage to go back.`
                          }`}
                        >
                          <span
                            className={`font-mono text-sm tabular-nums leading-snug pt-1 ${stillDelivery ? 'text-ink' : 'text-muted'}`}
                          >
                            {stillDelivery ? stillDelivery.line : '—'}
                          </span>
                        </FieldRow>
                      )}
                      {proxyWithOriginal && (
                        <FieldRow
                          label="From proxy"
                          hint={
                            stageOnOther ? (
                              <>
                                The stage shows {stageFile?.name ?? 'the original'}
                                {srcH ? ` (${srcH}p)` : ''}
                                {renderFromProxy
                                  ? ` — and the export delivers from ${proxyWithOriginal.sourceId}’s proxy${activeMeta?.height ? ` (${activeMeta.height}p)` : ''}: faster, proxy quality.`
                                  : ' — in hand, so the export encodes from it and fetches nothing.'}
                              </>
                            ) : (
                              <>
                                You are editing on {proxyWithOriginal.sourceId}&apos;s proxy
                                {srcH ? ` (${srcH}p)` : ''}
                                {willFetchOriginal
                                  ? ' — the export fetches the original first, so the deliverables are full quality.'
                                  : ' — and delivering from it: faster, nothing large crosses the network, proxy quality.'}
                              </>
                            )
                          }
                        >
                          <ToggleField
                            label="Render from the proxy"
                            checked={renderFromProxy}
                            onChange={setRenderFromProxy}
                          >
                            For a quick look
                          </ToggleField>
                        </FieldRow>
                      )}
                    </InspectorSection>

                    <InspectorSection
                      id="studio.export.variants"
                      title="Variants"
                      badge={String(variants.length)}
                      actions={
                        <Button size="sm" variant="ghost" icon={Icons.plus} onClick={addVariant}>
                          Variant
                        </Button>
                      }
                    >
                      {variants.map((v, index) => {
                        const dims = exportW && exportH ? variantOutputSize(v, exportW, exportH) : null;
                        // A variant never upscales, so asking for more than the
                        // source holds silently delivers less. Say which.
                        const short = exportW && exportH ? resolutionShortfall(v, exportW, exportH) : null;
                        const stats = variantStats[statKey(activeId ?? '', v, trimmed ? range : null)];
                        const state = runHere ? runStateOf(run, v.id) : null;
                        const fileName = variantFileName(
                          exportFileName.trim() || active.baseName,
                          v,
                          isPhoto ? 'photo' : 'video',
                        );
                        return (
                          <div key={v.id} className="flex flex-col gap-2 pl-3 border-l-2 border-line">
                            <div className="flex items-center gap-2">
                              <span className="flex-1 min-w-0 text-sm font-medium text-ink">Variant {index + 1}</span>
                              <IconButton
                                size="sm"
                                variant="ghost"
                                label="Remove this variant"
                                onClick={() => removeVariant(v.id)}
                                disabled={variants.length <= 1}
                              >
                                {Icons.close}
                              </IconButton>
                            </div>
                            <FieldRow label="Format">
                              <SelectField
                                label="Variant format"
                                value={v.aspectId}
                                onChange={(aspectId) => updateVariant(v.id, { aspectId })}
                                options={[
                                  { id: 'source', label: 'Source frame' },
                                  ...ASPECT_PRESETS.map((a) => ({ id: a.id, label: `${a.id} — ${a.label}` })),
                                ]}
                              />
                            </FieldRow>
                            <FieldRow
                              label="Resolution"
                              hint={
                                short ? (
                                  <span className="text-danger">
                                    {short.asked}p was asked for; this source delivers {short.delivered}p.
                                    {proxyWithOriginal && renderFromProxy
                                      ? ' Turn off “From proxy” to export from the original.'
                                      : ''}
                                  </span>
                                ) : undefined
                              }
                            >
                              <SelectField
                                label="Variant resolution"
                                value={String(v.resolution)}
                                onChange={(r) =>
                                  updateVariant(v.id, {
                                    resolution: (r === 'source' ? 'source' : Number(r)) as VariantResolution,
                                  })
                                }
                                options={[
                                  { id: 'source', label: 'Source' },
                                  { id: '1080', label: '1080p' },
                                  { id: '720', label: '720p' },
                                ]}
                              />
                            </FieldRow>
                            {/* A cadence and a speed are about a sequence of
                                frames; a still has one, so both rows leave. */}
                            {!isPhoto && (
                              <FieldRow
                                label="Frame rate"
                                hint={
                                  sourceFps && v.frameRate !== 'source' && v.frameRate > sourceFps
                                    ? `${v.frameRate} fps from ${sourceFps} — frames are duplicated, not interpolated: no new motion.`
                                    : undefined
                                }
                              >
                                <SelectField
                                  label="Variant frame rate"
                                  value={String(v.frameRate)}
                                  onChange={(f) =>
                                    updateVariant(v.id, {
                                      frameRate: (f === 'source' ? 'source' : Number(f)) as ExportFrameRate,
                                    })
                                  }
                                  options={[
                                    { id: 'source', label: `Source${sourceFps ? ` (${sourceFps} fps)` : ''}` },
                                    ...FRAME_RATE_CHOICES.map((f) => ({ id: String(f), label: `${f} fps` })),
                                  ]}
                                />
                              </FieldRow>
                            )}
                            {!isPhoto && (
                              <FieldRow
                                label="Speed"
                                hint={
                                  variantIsRetimed(v) ? (
                                    <>
                                      {resolveSpeed(v.speed)}× speed
                                      {duration > 0
                                        ? ` — ${formatDuration(retimedDuration(duration, v.speed))} instead of ${formatDuration(duration)}`
                                        : ''}
                                      , delivered without audio: a copied track would drift against a
                                      re-timed picture.
                                    </>
                                  ) : undefined
                                }
                              >
                                <SelectField
                                  label="Variant speed"
                                  value={String(resolveSpeed(v.speed))}
                                  onChange={(sp) => updateVariant(v.id, { speed: Number(sp) })}
                                  options={speedChoices.map((sp) => ({
                                    id: String(sp),
                                    label: `${sp === 1 ? 'Normal' : `${sp}×`}${sp !== 1 && sp === realtimeRate ? ' — real time' : ''}`,
                                  }))}
                                />
                              </FieldRow>
                            )}
                            <FieldRow label="Overlays">
                              <ToggleField
                                label="Burn the overlays in"
                                checked={v.overlays}
                                onChange={(overlays) => updateVariant(v.id, { overlays })}
                              />
                              <span className="flex-1 min-w-0 text-right font-mono text-2xs tabular-nums text-muted truncate" title={fileName}>
                                {dims ? `${dims.w}×${dims.h} · ` : ''}
                                {fileName}
                              </span>
                            </FieldRow>
                            {/* The row is the run's queue while it goes on (V4):
                                waiting, in hand with its stage and its fill, or
                                not written. Once done — and outside a run — it
                                says what it cost, with the settings that paid. */}
                            {state === 'queued' ? (
                              <div className="font-mono text-2xs text-faint">waiting…</div>
                            ) : state === 'active' && run ? (
                              <div className="flex flex-col gap-1" role="status">
                                <div className="flex items-center gap-1.5 font-mono text-2xs tabular-nums text-accent-ink">
                                  <span className="w-[7px] h-[7px] rounded-full bg-accent animate-pulse-dot" />
                                  {(run.phases[run.index] ?? []).find((ph) => ph.id === run.phase)?.label.toLowerCase() ?? 'rendering'}
                                  {run.ratio !== null ? ` · ${Math.round(run.ratio * 100)}%` : '…'} · {formatElapsed(liveElapsed)}
                                </div>
                                {run.ratio !== null && (
                                  <span className="h-[3px] rounded-full bg-line overflow-hidden" aria-hidden="true">
                                    <span className="block h-full bg-accent transition-[width] duration-200" style={{ width: `${run.ratio * 100}%` }} />
                                  </span>
                                )}
                              </div>
                            ) : state === 'failed' ? (
                              <div className="font-mono text-2xs text-danger">! not written</div>
                            ) : (
                              stats && (
                                <div className="flex items-center gap-1.5 font-mono text-2xs tabular-nums text-ink-soft">
                                  <span className="inline-flex text-ok">{Icons.check}</span>
                                  {describeExportStat(stats)}
                                </div>
                              )
                            )}
                          </div>
                        );
                      })}
                    </InspectorSection>
                  </LockSections>

                  {/* A clip that came from a Winnow can send its finals home.
                      Only offered for what was just rendered, only to the
                      instance it came from. */}
                  {exportDone && resultsHere && lastRun.length > 0 && finalsOrigin && (
                    <InspectorSection id="studio.export.home" title="Send home">
                      <SendFinalsPanel
                        files={lastRun}
                        sourceId={finalsOrigin.sourceId}
                        assetId={finalsIdentity?.assetId ?? null}
                      />
                    </InspectorSection>
                  )}
                </>
              )}
            </div>
            {/* The verbs, pinned — and, while a run goes on, the run itself,
                on every tab and whichever clip is open. */}
            {(tab === 'export' || run) && (
              <DeliverBar
                verbs={exportVerbs}
                primary="all"
                summary={exportSummary}
                exporting={exporting && !run ? 'Preparing…' : grabbing ? 'Capturing the frame…' : null}
                progress={run}
                onCancel={cancelExport}
                settingsLine={run ? `The project as at ${runClock(run.startedAt)} · an edit now goes to the next export` : null}
                note={exportNote}
                placement={compact ? 'sheet' : 'panel'}
                unitWord="variant"
                empty="Open a clip or a photo to export."
              />
            )}
          </PanelHost>
        )}
      </div>
      </div>
    </section>
  );
}
