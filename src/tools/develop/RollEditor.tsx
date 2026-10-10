import type { LensProfileApplied } from '../../shared/lens/lens-profile';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { DevelopApplyVerb } from '../../shared/develop/develop-host';
import { DEFAULT_DEVELOP, baseRung, isDefaultDevelop, isRawDevelop, normaliseDevelop, withoutBase, type DevelopSettings } from '../../shared/develop/develop';
import { CommandError } from '../../shared/commands/registry';
import { useRegisterCommands } from '../../shared/commands/use-commands';
import { developRecordCommands, sectionCommands } from '../../shared/develop/develop-record-commands';
import { lookCommands } from '../../shared/develop/look-commands';
import { VERDICTS, filterRows, readDay } from '../../shared/develop/ingest-commands';
import { rowMediaRef } from '../../shared/sources/winnow/materialize';
import type { Verdict } from '../../shared/sources/winnow/culling';
import { bridgeSink, bridgeState } from '../../shared/commands/bridge-client';
import { presetCommands } from '../../shared/develop/preset-commands';
import { presetsNow, saveToPresetBook } from '../../shared/develop/use-preset-book';
import { SECTION_IDS, developControls, pictureSummary, rollSummary, targetPicture, withDevelopValues } from '../../shared/develop/develop-commands';
import { landBaseCurve } from '../../shared/develop/base-curve';
import { CHOICE_WORDS, departsFromRoll, ontoRollSensor, type RollChoice } from '../../shared/develop/roll-choice';
import { copyDevelop, hasCopiedDevelop, pasteDevelop, subscribeDevelopClipboard } from '../../shared/develop/develop-clipboard';
import type { Keystone } from '../../shared/render/geometry';
import type { LensCorrection } from '../../shared/render/lens';
import type { DetailSettings } from '../../shared/render/detail';
import type { PostCropVignette } from '../../shared/render/post-vignette';
import type { Patch } from '../../shared/render/repair';
import type { AdjustLayer } from '../../shared/develop/layer';
import type { Framing } from '../../shared/media/framing';
import {
  openAfterRemovals,
  openPictureId,
  sameDevelop,
  selectionAfterClick,
  stepPicture,
  workbenchTabsFor,
  type SelectionModifiers,
  type WorkbenchTab,
} from '../../shared/develop/roll-editor';
import {
  availabilityText,
  pictureDay,
  splitByRoll,
  summarizeAvailability,
  type PictureAvailability,
} from '../../shared/develop/roll-media';
import { deleteRollThumbs, getRollThumbEntries, putRollThumb, setRollThumbAspect } from '../../shared/develop/roll-store';
import {
  STRIP_FILTERS,
  STRIP_METRICS,
  autoBandHeight,
  bandAfterDrag,
  cellAspect,
  columnsForWidth,
  heightForRows,
  maxBandHeight,
  maxBandWidth,
  medianAspect,
  passesStripFilter,
  rowsForHeight,
  stepThumb,
  cullFilterOf,
  stripFilterCounts,
  stripFilterLabel,
  widthForColumns,
  type StripFilterKey,
  type StripKind,
  type StripPlace,
} from '../../shared/develop/roll-strip';
import { WORKING_PREVIEW_ESTIMATE_BYTES } from '../../shared/develop/working-preview';
import { formatBytes } from '../../shared/lib/format';
import { pictureThumbnail } from '../../shared/develop/roll-thumb';
import type { DeckNeighbour } from '../../shared/develop/stage-deck';
import { useObjectUrls } from '../../shared/lib/use-object-urls';
import { warmStageStill } from '../../shared/develop/stage-sources';
import {
  addPictures,
  addVariant,
  variantNumber,
  newRollId,
  pictureLabel,
  copyBorderTo,
  copyCropTo,
  copyGradeTo,
  delivers,
  isClipPicture,
  isEdited,
  isIgnored,
  setDelivery,
  setLeaving,
  setMakingOf,
  toggledDelivery,
  patchPicture,
  setPictureWords,
  pictureEdits,
  removePictures,
  rollProgress,
  sameMediaRef,
  type DeliverState,
  type JournalVia,
  type RollDoc,
  type RollExport,
  type RollPicture,
  type VariantStart,
} from '../../shared/develop/roll-types';
import { journalRoll } from '../../shared/develop/journal';
import { useAssetLibrary } from '../../shared/library/AssetLibraryContext';
import { fileBaseName, type Asset } from '../../shared/library/assets';
import { hashedMediaRefs, mediaOrigin } from '../../shared/projects/media-identity';
import type { SavedMediaRef } from '../../shared/projects/project-types';
import { dropDirectoryHandles, filesFromDataTransfer } from '../../shared/sources/file-sources';
import { useWinnowConnection } from '../../shared/sources/winnow/use-connection';
import { usePublishMediaActions, type MediaActions, type MediaView } from '../../shared/sources/media-scope';
import Button from '../../shared/ui/Button';
import IconButton from '../../shared/ui/IconButton';
import { useFingerSize } from '../../shared/ui/use-coarse-pointer';
import { VERB_DONE_MS, type VerbOutcome } from '../../shared/ui/verb';
import ConfirmDialog from '../../shared/ui/ConfirmDialog';
import EmptyState from '../../shared/ui/EmptyState';
import OverflowMenu, { type OverflowItem } from '../../shared/ui/OverflowMenu';
import SettingsMenu, { type SettingsSection } from '../../shared/ui/SettingsMenu';
import PageBar from '../../shared/ui/PageBar';
import { Icons } from '../../shared/ui/icons';
import { usePublishSectionBar } from '../../shared/ui/section-rail';
import { useIsCompact } from '../../shared/ui/use-layout-mode';
import { useLocalFlag } from '../../shared/ui/use-local-flag';
import type { ExportVerb } from './ExportPanel';
import RollBand from './RollBand';
import SelectionBar, { type SelectionVerbs } from './SelectionBar';
import { useThumbAspects } from './use-thumb-aspects';
import type { CropApplyVerb } from './CropPanel';
import type { BorderApplyVerb } from './BorderSection';
import type { RollBorder } from '../../shared/develop/border-layout';
import DeliveryTable from './DeliveryTable';
import PictureWorkbench, { DEFAULT_BRUSH_TOOL, type BrushTool, type DeliverAction, type LookApplyVerb } from './PictureWorkbench';
import { DEFAULT_REPAIR_TOOL, type RepairTool } from './RepairPanel';
import { useLutInterpolation } from '../../shared/lut/use-lut-interpolation';
import { useExportMarks } from './use-export-marks';
import SettingsSheet from './SettingsSheet';
import DevelopSettingsSheet from './DevelopSettingsSheet';
import { closeDevelopSettings, openDevelopSettings, useDevelopSettingsOpen } from './develop-settings-open';
import { carriedSections, setCarriedSections, useCarriedSections } from './carried-sections';
import type { DevelopClipVerbs } from '../../shared/develop/DevelopSections';
import {
  PICTURE_SECTIONS,
  applySections,
  copiedSectionsOf,
  copiedSettings,
  copySettings,
  pastedSections,
  resetSections,
  subscribeCopiedSettings,
  type PictureSection,
} from '../../shared/develop/picture-sections';
import { exportState, needsExport } from '../../shared/develop/export-marks';
import { runScope, useRollExport } from './use-roll-export';
import TaskEdge from '../../shared/ui/TaskEdge';
import { useRollGrade } from './use-roll-grade';
import { useRollFolders } from './use-roll-folders';
import { useRollMedia } from './use-roll-media';
import { useRollCulling } from './use-roll-culling';
import { countCulling, cullFilterLabel } from '../../shared/sources/winnow/culling';
import { useElementSize } from '../../shared/ui/use-element-width';
import BandGrip from './BandGrip';
import ContactSheet from './ContactSheet';
import { useStripPrefs } from './use-strip-prefs';
import { useRollPreviews } from './use-roll-previews';
import { useRollShots } from './use-roll-shots';
import RollPicker from './RollPicker';

/** One empty answer, so a memo keyed on it holds. */
const NO_SIBLINGS: readonly File[] = [];
/** No cell is ticking: one empty set, so the band's memo holds. */
const NO_IDS: ReadonlySet<string> = new Set();

/**
 * The file of a Library asset a roll can take (2026-09-30): a photograph's
 * image, or a CLIP — with or without its telemetry log, which stays the
 * Studio's. Null for anything else (a lone log, junk).
 */
export function rollFileOf(asset: Asset | undefined): File | null {
  if (!asset) return null;
  if (asset.kind === 'photo') return asset.parts.image ?? null;
  if (asset.kind === 'video' || asset.kind === 'video+telemetry') return asset.parts.video ?? null;
  return null;
}

interface RollEditorProps {
  roll: RollDoc;
  /** The picture the route names; the first when it names none. */
  pictureId: string | null;
  onBack: () => void;
  onChange: (roll: RollDoc) => void;
  /** Open a picture — a step along the strip, never a new history entry each time. */
  onOpenPicture: (pictureId: string | null) => void;
  /** The sync pill, for a roll kept on an instance. */
  headerExtra?: ReactNode;
}

/** Said when a delivery state is asked for while a run goes on (L2). */
const LOCKED_DELIVERY = 'Which pictures leave is locked while an export runs — it goes on with the ones it started with';

/**
 * The Develop tool's editor over a roll (D6 of `docs/develop-tool.md`): the
 * picture large with the workbench beside it, and the roll as a filmstrip
 * under it — the modal's blocks, laid out full-screen. On a phone the stage
 * and the strip share the height and the inspector is a sheet, opened from
 * the shell's bottom bar (the Trips grammar).
 *
 * Every write goes through ONE updater over the latest roll, so a develop, a
 * look and a batch landing in the same tick compose instead of the last one
 * replacing a roll the others already moved on.
 */
/** The roll's own filters, one glyph each; Winnow's take theirs from their kind. */
const FILTER_ICONS: Partial<Record<StripFilterKey, ReactNode>> = {
  all: Icons.stack,
  edited: Icons.sliders,
  leaving: Icons.export,
  held: Icons.held,
  ignored: Icons.eyeOff,
};

export default function RollEditor({ roll, pictureId, onBack, onChange, onOpenPicture, headerExtra }: RollEditorProps) {
  const lib = useAssetLibrary();
  const compact = useIsCompact();
  const finger = useFingerSize();
  // The band's numbers for this shell (`roll-strip.ts`): a phone's and a desktop's differ.
  const stripKind: StripKind = compact ? 'phone' : 'desktop';
  const stripMetrics = STRIP_METRICS[stripKind];
  // How THIS device wants the band — size, folded, the thumbnails — never the roll.
  const [strip, patchStrip] = useStripPrefs(stripKind);
  // The column the stage and the band share, and the band's own width: what
  // the band may take, and what "height follows the roll" is sized against.
  const [columnRef, columnBox] = useElementSize<HTMLDivElement>();
  const [bandRef, bandBox] = useElementSize<HTMLDivElement>();
  // The status lines over the band, measured on their own: a measurement
  // that included the band would feed the band's height back into itself.
  const [statusRef, statusBox] = useElementSize<HTMLDivElement>();
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // The pictures a removal is asking about — one from a cell's menu, several
  // from the selection — when any of them carries work that would go with it.
  const [confirmRemove, setConfirmRemove] = useState<readonly string[] | null>(null);
  // The band's SELECTION (`docs/develop-roll-browser.md` §5): a mode in
  // which a plain click on a cell marks it and the band's header is the bar
  // of verbs acting on every marked picture. Shift / ⌘-click, S, the header's
  // Select, a cell's menu or a finger held on a cell turn it on; Done, S
  // again or Escape turn it off and clear it.
  const [selecting, setSelecting] = useState(false);
  // The CONTACT SHEET (`ContactSheet`): the roll large over the stage, to
  // sort and to act on many — `G`, the band's ▦; a click on a picture opens
  // it and closes the sheet.
  const [contactOpen, setContactOpen] = useState(false);
  // FOCUS: the picture alone — the band, the inspector and the page bar not
  // drawn (`F`, the ⤢ verb in the stage bar; Escape, either, brings them back).
  const [focus, setFocus] = useState(false);
  const toggleFocus = useCallback(() => setFocus((f) => !f), []);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pickingDay, setPickingDay] = useState(false);
  const { connection, client } = useWinnowConnection();
  const winnowRef = useRef({ connection, client });
  winnowRef.current = { connection, client };
  // Which inspector tab is open — kept here, not in the workbench, so it
  // survives stepping to another picture (the workbench remounts per picture).
  const [tab, setTab] = useState<WorkbenchTab>('adjust');
  // Ignored pictures in the strip: dimmed (the default) or left out — a view
  // preference of this browser, never the roll's.
  const [showIgnored, setShowIgnored] = useLocalFlag('atelier.develop.showIgnored', true);
  // The brush and the heal disc are TOOLS, not the picture's: held here with
  // the tab, so the size set on one picture is the size on the next.
  const [brush, setBrush] = useState<BrushTool>({ ...DEFAULT_BRUSH_TOOL });
  const [repairTool, setRepairTool] = useState<RepairTool>({ ...DEFAULT_REPAIR_TOOL });
  const patchBrush = useCallback((patch: Partial<BrushTool>) => setBrush((b) => ({ ...b, ...patch })), []);
  const patchRepairTool = useCallback((patch: Partial<RepairTool>) => setRepairTool((t) => ({ ...t, ...patch })), []);

  const latest = useRef(roll);
  latest.current = roll;
  // Every write lands here and is JOURNALED on the way (`journal.ts`): the
  // pictures the change touched get a step in the SAME document, so the step
  // and the edit are one undo step. `via` says how, when it is not the
  // author's own gesture on that picture.
  const update = useCallback(
    (change: (r: RollDoc) => RollDoc, via?: JournalVia) => {
      const next = change(latest.current);
      if (next === latest.current) return;
      const journaled = journalRoll(latest.current, next, Date.now(), via);
      latest.current = journaled;
      onChange(journaled);
    },
    [onChange],
  );
  const openId = openPictureId(roll.pictures, pictureId);
  const open = openId ? (roll.pictures.find((p) => p.id === openId) ?? null) : null;
  // The look is the OPEN picture's (roll v5): the stack follows the strip.
  // Its writes carry `lookVia` — `agent` while a look command runs, so the
  // journal tells an agent's look from the author's.
  const lookVia = useRef<JournalVia | null>(null);
  const lookUpdate = useCallback((change: (r: RollDoc) => RollDoc) => update(change, lookVia.current ?? undefined), [update]);
  const stack = useRollGrade(open, lookUpdate);
  const stackRef = useRef(stack);
  stackRef.current = stack;
  const lookWrites = useRef(0);
  const lookAsAgent = useCallback(async <T,>(write: () => T | Promise<T>): Promise<T> => {
    lookWrites.current += 1;
    lookVia.current = 'agent';
    try {
      return await write();
    } finally {
      // The stack writes back an effect later, after its bake.
      window.setTimeout(() => {
        lookWrites.current -= 1;
        if (lookWrites.current === 0) lookVia.current = null;
      }, 600);
    }
  }, []);
  const openIdRef = useRef(openId);
  openIdRef.current = openId;

  // --- batch selection (D7): a plain click opens, Shift/⌘ marks for a batch -
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  useEffect(() => {
    // The open picture changing through any OTHER means (a plain click, a
    // step, the route) becomes the anchor for the next Shift-click.
    setAnchor(null);
  }, [openId]);
  const visibleSelected = useMemo(
    () => new Set([...selected].filter((id) => roll.pictures.some((p) => p.id === id))),
    [selected, roll.pictures],
  );
  const handleSelectClick = useCallback(
    (id: string, mods: SelectionModifiers) => {
      setSelected((s) => selectionAfterClick(latest.current.pictures, s, anchor ?? openIdRef.current ?? id, id, mods));
      if (mods.metaKey || mods.ctrlKey) setAnchor(id);
      // A modified click is already a selection: the mode comes on with it,
      // so the bar of verbs is there for what was just marked.
      setSelecting(true);
    },
    [anchor],
  );
  const startSelecting = useCallback((id?: string) => {
    setSelecting(true);
    if (id) setSelected((s) => (s.has(id) ? s : new Set([...s, id])));
  }, []);
  const stopSelecting = useCallback(() => {
    setSelecting(false);
    setSelected(new Set());
    setAnchor(null);
  }, []);
  const selectionTargets = useMemo(
    () => [...visibleSelected].filter((id) => id !== openId),
    [visibleSelected, openId],
  );

  // --- the Library's photos and clips, and where each picture's bytes are --
  const libraryFiles = useMemo(
    () => lib.assets.flatMap((a) => rollFileOf(a) ?? []),
    [lib.assets],
  );
  const selectedFiles = useMemo(
    () => lib.assets.flatMap((a) => (lib.selection.has(a.id) ? (rollFileOf(a) ?? []) : [])),
    [lib.assets, lib.selection],
  );
  // The Library's file when it holds the picture, else the roll's own fetch
  // from the instance its ref names — never a trip through the sidebar.
  // A local picture is found in the Library OR in the folders the roll
  // remembers and the files dropped on it (F4) — the same name-then-hash match.
  const folders = useRollFolders(roll.id);
  const localFiles = useMemo(() => [...libraryFiles, ...folders.photos], [libraryFiles, folders.photos]);
  // The capture files BESIDE the local photographs — a JPEG's DNG, an ARW's
  // HIF (`AssetParts.siblings`, R2): the workbench offers them as the open
  // picture's other renditions, found by base name. A LOCAL picture's only:
  // a file an instance handed over has its own companion (`MediaOrigin`).
  const localSiblings = useMemo(
    () => [...lib.assets.flatMap((a) => (a.kind === 'photo' ? (a.parts.siblings ?? []) : [])), ...folders.siblings],
    [lib.assets, folders.siblings],
  );
  const media = useRollMedia({ pictures: roll.pictures, openId, localFiles });
  const libraryFilesRef = useRef(libraryFiles);
  libraryFilesRef.current = libraryFiles;
  // Winnow's picks and stars, read-only (item 33): shown on the strip and
  // filtered on — the filter is this sitting's, never the roll's.
  const culling = useRollCulling(roll.pictures);
  // What the band SHOWS (`roll-strip.ts`, `StripFilterKey`): the roll's own
  // states, the ignored alone, or Winnow's culling — the sitting's, never the
  // roll's. The arrows and every "Apply to N other pictures" follow it.
  const [stripFilter, setStripFilter] = useState<StripFilterKey>('all');
  const filtering = stripFilter !== 'all';
  const cullingRef = useRef(culling.byPicture);
  cullingRef.current = culling.byPicture;
  const stripFilterRef = useRef(stripFilter);
  stripFilterRef.current = stripFilter;
  const passesFilter = useCallback(
    (p: RollPicture) => passesStripFilter(p, stripFilterRef.current, cullingRef.current.get(p.id)),
    [],
  );
  const { retryFailed, remoteThumb } = media;
  // A local picture whose file is away is developed from its working preview
  // when the roll keeps them (F5); the real file always wins.
  const previews = useRollPreviews({ rollId: roll.id, pictures: roll.pictures, realFiles: media.files });
  const files = useMemo(() => {
    const out = new Map(media.files);
    for (const [id, file] of previews.files) if (!out.has(id)) out.set(id, file);
    return out;
  }, [media.files, previews.files]);
  // Each photograph AS SHOT beside its record, for a model to learn from
  // (`use-roll-shots.ts`): baked from the files in hand, in the background.
  const shots = useRollShots({ rollId: roll.id, pictures: roll.pictures, files });
  const availability = useMemo(() => {
    const out = new Map(media.availability);
    for (const id of previews.files.keys()) if (!media.files.has(id)) out.set(id, { kind: 'preview' });
    return out as ReadonlyMap<string, PictureAvailability>;
  }, [media.availability, media.files, previews.files]);
  const mediaFileFor = media.fileFor;
  const previewFiles = previews.files;
  const fileFor = useCallback(
    async (p: RollPicture) => (await mediaFileFor(p)) ?? previewFiles.get(p.id) ?? null,
    [mediaFileFor, previewFiles],
  );
  const openFile = openId ? (files.get(openId) ?? null) : null;
  // Indexed once per sibling list: the export plan asks for every picture's
  // siblings on every roll change, and a filter over the whole folder per
  // picture was rows × folder each time.
  const siblingsByBase = useMemo(() => {
    const map = new Map<string, File[]>();
    for (const s of localSiblings) {
      const base = fileBaseName(s.name).toLowerCase();
      const list = map.get(base);
      if (list) list.push(s);
      else map.set(base, [s]);
    }
    return map;
  }, [localSiblings]);
  const siblingsFor = useCallback(
    (file: File): readonly File[] => {
      if (mediaOrigin(file)) return NO_SIBLINGS;
      return siblingsByBase.get(fileBaseName(file.name).toLowerCase()) ?? NO_SIBLINGS;
    },
    [siblingsByBase],
  );
  const openSiblings = useMemo(() => (openFile ? siblingsFor(openFile) : []), [openFile, siblingsFor]);
  // Files, not entries: a variant (item 30) is the same file, previewed once.
  const localCount = roll.pictures.filter((p) => !p.ref.assetId && variantNumber(p) < 2).length;
  const reach = summarizeAvailability(
    roll.pictures.map((p) => p.id),
    availability,
  );

  // --- what the Library's ticks would ADD: only what the roll does not hold --
  // The Library ticks whatever it imports, so its selection is mostly pictures
  // the roll already has — counting them kept "Add 3 selected" on the bar for
  // a roll that was complete (the maintainer's report, 2026-09-16).
  const [newPhotos, setNewPhotos] = useState<readonly File[]>([]);
  const pictureKey = roll.pictures.map((p) => p.id).join('|');
  useEffect(() => {
    let alive = true;
    void hashedMediaRefs(selectedFiles).then((refs) => {
      if (!alive) return;
      const held = latest.current.pictures;
      setNewPhotos(selectedFiles.filter((_, i) => !held.some((p) => sameMediaRef(p.ref, refs[i]))));
    });
    return () => {
      alive = false;
    };
  }, [selectedFiles, pictureKey]);

  // --- thumbnails: stored, else baked as shot; the open one redraws graded --
  const [thumbs, setThumbs] = useState<ReadonlyMap<string, Blob>>(new Map());
  const thumbsRef = useRef(thumbs);
  thumbsRef.current = thumbs;
  // The aspects kept beside the stored thumbnails: what lets the band be laid
  // out without decoding a single one (`use-thumb-aspects.ts`).
  const [storedAspects, setStoredAspects] = useState<ReadonlyMap<string, number>>(new Map());
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const idsKey = roll.pictures.map((p) => p.id).join('|');
  useEffect(() => {
    let alive = true;
    void getRollThumbEntries(latest.current.pictures.map((p) => p.id)).then((stored) => {
      if (!alive) return;
      setThumbs((cur) => new Map([...cur, ...[...stored].map(([id, e]) => [id, e.blob] as const)]));
      setStoredAspects((cur) => {
        const next = new Map(cur);
        for (const [id, e] of stored) if (e.aspect) next.set(id, e.aspect);
        return next;
      });
      setLoadedFor(idsKey);
    });
    return () => {
      alive = false;
    };
  }, [idsKey]);

  /**
   * A thumbnail just baked, with the aspect its canvas had: kept beside the
   * bytes, and handed to the band with its aspect in the SAME render, so the
   * cell takes its shape without decoding the blob to measure it.
   */
  const keepThumb = useCallback((id: string, blob: Blob, aspect: number) => {
    void putRollThumb(id, blob, Date.now(), aspect);
    setThumbs((cur) => new Map(cur).set(id, blob));
    if (aspect > 0) setStoredAspects((cur) => new Map(cur).set(id, aspect));
  }, []);
  /** Tried once per picture per visit, so a file the browser cannot decode is not retried on every render. */
  const tried = useRef(new Set<string>());
  useEffect(() => {
    if (loadedFor !== idsKey) return;
    const pictures = latest.current.pictures;
    const due = pictures.filter((p) => files.has(p.id) && !thumbsRef.current.has(p.id) && !tried.current.has(p.id));
    if (due.length === 0) return;
    // The cells nearest the open picture first: they are the ones on screen.
    const at = Math.max(0, pictures.findIndex((p) => p.id === openIdRef.current));
    const index = new Map(pictures.map((p, i) => [p.id, i]));
    due.sort((a, b) => Math.abs((index.get(a.id) ?? 0) - at) - Math.abs((index.get(b.id) ?? 0) - at));
    let alive = true;
    void (async () => {
      // One decode at a time: a roll of big stills never holds two at once.
      for (const p of due) {
        if (!alive) return;
        tried.current.add(p.id);
        // The open picture draws its own, graded, from the stage.
        if (p.id === openIdRef.current) continue;
        const baked = await pictureThumbnail(files.get(p.id)!);
        if (!baked || thumbsRef.current.has(p.id)) continue;
        keepThumb(p.id, baked.blob, baked.aspect);
      }
    })();
    return () => {
      alive = false;
    };
  }, [files, loadedFor, idsKey, keepThumb]);

  // The two pictures beside the open one, decoded for the stage AHEAD of
  // ←/→ (P4 of `docs/develop-performance.md`, `stage-sources.ts`): once the
  // open picture has rendered — its snapshot is the signal — in the roll's
  // one background slot, the next before the previous. Left alone: a clip
  // (a video element, never held), a picture developed from its sensor (its
  // RAW has its own cache), and one that opens on a chosen file of its own
  // or the roll's — the stage would not decode the file in hand.
  const filesRef = useRef(files);
  filesRef.current = files;
  const warmNeighbours = useCallback(
    (id: string) => {
      const { pictures, opensOn } = latest.current;
      if (opensOn) return;
      const skip = (p: RollPicture) => isIgnored(p) || !passesFilter(p);
      // Newest first in the slot, so the previous is queued first.
      for (const by of [-1, 1]) {
        const nid = stepPicture(pictures, id, by, skip);
        if (!nid || nid === id) continue;
        const p = pictures.find((x) => x.id === nid);
        const file = filesRef.current.get(nid);
        if (!p || !file || isClipPicture(p) || baseRung(p.develop?.base) > 0 || p.rendition) continue;
        warmStageStill(file);
      }
    },
    [passesFilter],
  );
  const handleSnapshot = useCallback(
    (id: string, blob: Blob, aspect: number) => {
      tried.current.add(id);
      keepThumb(id, blob, aspect);
      warmNeighbours(id);
    },
    [keepThumb, warmNeighbours],
  );
  // Each thumbnail's shape, which is its cell's (`roll-strip.ts`) — read from
  // the store where it was kept, measured once and kept where it was not
  // (a thumbnail stored before the aspect was kept beside it).
  const keepAspect = useCallback((id: string, aspect: number) => {
    void setRollThumbAspect(id, aspect);
  }, []);
  const thumbAspects = useThumbAspects(thumbs, storedAspects, keepAspect);

  // --- the shell's verb: "Develop" under a picture being looked at (D10) ---
  // `run` is called with the picture already ACTIVE in the Library — but in
  // the same tick as the activation, so a closure would read the previous
  // active asset. The verb only asks; the effect below answers once the
  // render has caught up, from the active asset as it then is.
  //
  // It is also handed WHICH FILE of the capture the sheet was showing (R6 of
  // `docs/capture-renditions.md`): the lightbox writes nothing, so pressing
  // Develop over the camera's JPEG is the one gesture that puts that choice
  // on the picture — the same field the chip above the photograph writes.
  const [pendingAdd, setPendingAdd] = useState(0);
  const pendingView = useRef<MediaView | null>(null);
  const activeFile = useMemo(() => rollFileOf(lib.assets.find((x) => x.id === lib.activeId)), [lib.assets, lib.activeId]);
  useEffect(() => {
    if (pendingAdd === 0) return;
    setPendingAdd(0);
    const view = pendingView.current;
    pendingView.current = null;
    if (!activeFile) {
      setNotice('only a photograph or a clip can be developed');
      return;
    }
    void (async () => {
      const [ref] = await hashedMediaRefs([activeFile]);
      // Never added twice: a picture already on the roll is opened instead.
      update((r) => addPictures(r, [ref]));
      const found = latest.current.pictures.find((p) => sameMediaRef(p.ref, ref));
      if (!found) return;
      // The rendition looked at, on the picture — and a RAW base set aside
      // where it stood, exactly as choosing a file under the chip does.
      if (view) {
        update((r) => {
          const p = r.pictures.find((x) => x.id === found.id);
          if (!p || p.rendition === view.rendition) return r;
          const develop = p.develop && isRawDevelop(p.develop) ? withoutBase(p.develop) : p.develop;
          return patchPicture(r, found.id, { rendition: view.rendition, develop });
        });
      }
      onOpenPicture(found.id);
    })();
  }, [pendingAdd, activeFile, update, onOpenPicture]);
  const offer = useMemo<MediaActions>(
    () => ({
      heading: `on ${roll.name || 'this roll'}`,
      actions: [
        {
          id: 'develop',
          label: 'Develop',
          hint: 'add this picture to the roll and open it on the file you are looking at — one already on the roll is opened, never added twice',
          run: (view) => {
            pendingView.current = view ?? null;
            setPendingAdd((n) => n + 1);
          },
        },
      ],
    }),
    [roll.name],
  );
  usePublishMediaActions(offer);

  // --- verbs ----------------------------------------------------------------
  async function addSelected() {
    if (newPhotos.length === 0) return;
    setAdding(true);
    setNotice(null);
    try {
      const refs = await hashedMediaRefs(newPhotos);
      const before = latest.current.pictures.length;
      let added = 0;
      update((r) => {
        const next = addPictures(r, refs);
        added = next.pictures.length - before;
        return next;
      });
      const already = refs.length - added;
      setNotice(
        added === 0
          ? `already on the roll: ${already === 1 ? 'that picture' : `all ${already}`}`
          : `added ${added}${already > 0 ? ` · ${already} already on the roll` : ''}`,
      );
    } finally {
      setAdding(false);
    }
  }

  /** Refs picked from an instance's day: onto the roll, and the bytes follow when opened. */
  function addRefs(refs: SavedMediaRef[], sourceId: string) {
    setPickingDay(false);
    const before = latest.current.pictures.length;
    let added = 0;
    update((r) => {
      const next = addPictures(r, refs);
      added = next.pictures.length - before;
      return next;
    });
    setNotice(`added ${added} from ${sourceId}`);
  }

  /**
   * Files from this computer — a picked folder, or a drop: the pictures the
   * roll already holds are simply found again (their bytes are now in hand),
   * the others are added.
   */
  async function takeLocal(photos: readonly File[]) {
    if (photos.length === 0) {
      setNotice('no photographs or clips in what was given');
      return;
    }
    setAdding(true);
    try {
      const refs = await hashedMediaRefs(photos);
      const { found, fresh } = splitByRoll(
        latest.current.pictures.map((p) => p.ref),
        refs,
      );
      if (fresh.length) update((r) => addPictures(r, fresh));
      setNotice(
        [found ? `found ${found} again` : '', fresh.length ? `added ${fresh.length}` : ''].filter(Boolean).join(' · ') ||
          'nothing new',
      );
    } finally {
      setAdding(false);
    }
  }

  async function addFolder() {
    const photos = await folders.pickFolder();
    if (photos) await takeLocal(photos);
  }

  const [dropping, setDropping] = useState(false);
  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    if (!dropping) setDropping(true);
  };
  const onDrop = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    setDropping(false);
    // Both started INSIDE the event: a DataTransfer is emptied once it returns.
    const handles = dropDirectoryHandles(e.dataTransfer);
    const listed = filesFromDataTransfer(e.dataTransfer);
    void Promise.all([listed, handles]).then(([dropped, folderHandles]) => takeLocal(folders.accept(dropped, folderHandles)));
  };

  /** Pictures off the roll — one, or the selection; what was done to them goes with them, the files stay. */
  function removeMany(ids: readonly string[]) {
    const nextOpen = openAfterRemovals(latest.current.pictures, ids, openId);
    update((r) => removePictures(r, ids));
    void deleteRollThumbs(ids);
    previews.forget(ids);
    shots.forget(ids);
    // A selection that just left the roll is done with: the mode ends with it.
    const remaining = [...visibleSelected].filter((id) => !ids.includes(id));
    if (selecting && remaining.length === 0) stopSelecting();
    else setSelected(new Set(remaining));
    if (nextOpen !== openId) onOpenPicture(nextOpen);
  }
  /** Asked first where any of them carries work; a plain picture goes at once. */
  function removeAsked(ids: readonly string[]) {
    const pictures = latest.current.pictures.filter((p) => ids.includes(p.id));
    if (pictures.some(isEdited)) setConfirmRemove(ids);
    else removeMany(ids);
  }

  const step = useCallback(
    (by: number) => {
      // The arrows walk the roll's WORK: an ignored picture is stepped over,
      // and so is one Winnow's filter has taken off the strip.
      const next = stepPicture(latest.current.pictures, openIdRef.current, by, (p) => isIgnored(p) || !passesFilter(p));
      if (next && next !== openIdRef.current) onOpenPicture(next);
    },
    [onOpenPicture, passesFilter],
  );

  // A VARIANT of a picture (item 30): Lightroom's virtual copy when it is
  // cloned, Capture One's New Variant when it starts as shot. It is opened
  // at once — making a copy is always to work on it — and wears the source's
  // thumbnail until its own is taken. From the keys and the Add menu it is
  // the open picture's; a cell's menu asks for any picture's.
  const makeVariantOf = useCallback(
    (from: string, start: VariantStart) => {
      const id = newRollId();
      update((r) => addVariant(r, from, start, id));
      if (!latest.current.pictures.some((p) => p.id === id)) return;
      setThumbs((cur) => {
        const blob = cur.get(from);
        return blob && start === 'clone' ? new Map(cur).set(id, blob) : cur;
      });
      onOpenPicture(id);
    },
    [update, onOpenPicture],
  );
  const makeVariant = useCallback(
    (start: VariantStart) => {
      if (openIdRef.current) makeVariantOf(openIdRef.current, start);
    },
    [makeVariantOf],
  );

  // `via` is what the workbench says of a write the author did not make by
  // hand on the picture — the `Auto` switch run as it opened — so the journal
  // and the making-of say so (`journal.ts`).
  const handleDevelop = useCallback(
    (id: string, develop: DevelopSettings | null, via?: JournalVia) =>
      update((r) => {
        const p = r.pictures.find((x) => x.id === id);
        return !p || sameDevelop(p.develop, develop) ? r : patchPicture(r, id, { develop });
      }, via),
    [update],
  );

  // The roll's commands (`shared/commands/`, `develop-commands.ts`): reading
  // its pictures and writing a develop through `handleDevelop`, the funnel the
  // sliders use — journaled `via: 'agent'`, so the making-of and the training
  // file can tell an agent's step from the author's.
  useRegisterCommands('develop-roll', [
    {
      id: 'develop.pictures',
      title: 'List the roll’s pictures',
      description: 'The open roll and its pictures in band order: id, file name, whether it is open, a clip, a variant, which sections carry an edit, whether it leaves in an export.',
      run: () => ({
        roll: rollSummary(latest.current),
        pictures: latest.current.pictures.map((p) => pictureSummary(p, openIdRef.current)),
      }),
    },
    {
      id: 'develop.openPicture',
      title: 'Open a picture',
      description: 'Put a picture of the roll on the stage. Wait for develop.snapshot to be available before looking at it: a picture decodes after it opens.',
      params: { picture: { type: 'string', description: 'The picture id, from develop.pictures.' } },
      run: (p) => {
        const target = targetPicture(latest.current, p.picture, openIdRef.current);
        onOpenPicture(target.id);
        return { open: target.id, name: pictureLabel(target) };
      },
    },
    {
      id: 'develop.controls',
      title: 'Read the sliders',
      description: 'The eleven develop sliders of a picture (the open one unless named) with their range, step, unit and current value — what develop.set writes.',
      params: { picture: { type: 'string', description: 'A picture id; the open picture when absent.', optional: true } },
      run: (p) => {
        const target = targetPicture(latest.current, p.picture, openIdRef.current);
        return { picture: target.id, controls: developControls(target.develop) };
      },
    },
    {
      id: 'develop.get',
      title: 'Read a develop',
      description: 'A picture’s whole develop record (sliders, curves, levels, mixer, B&W, grading, the RAW material), every default filled, and which sections of the picture carry an edit.',
      params: { picture: { type: 'string', description: 'A picture id; the open picture when absent.', optional: true } },
      run: (p) => {
        const target = targetPicture(latest.current, p.picture, openIdRef.current);
        return { picture: target.id, develop: normaliseDevelop(target.develop ?? {}), edited: pictureEdits(target) };
      },
    },
    {
      id: 'develop.set',
      title: 'Set sliders',
      description:
        'Write develop sliders on a picture (the open one unless named), as ABSOLUTE values inside each slider’s range — exposure in EV −3..3, the others −100..100. Keys: exposure, brightness, contrast, highlights, shadows, whites, blacks, temperature, tint, saturation, vibrance. Everything not named is kept. One undo step, journaled as an agent’s.',
      params: {
        values: { type: 'object', description: 'Slider → value, e.g. { "exposure": 0.5, "shadows": 30 }.' },
        picture: { type: 'string', description: 'A picture id; the open picture when absent.', optional: true },
      },
      run: (p) => {
        const target = targetPicture(latest.current, p.picture, openIdRef.current);
        const next = withDevelopValues(target.develop, p.values as Record<string, unknown>);
        handleDevelop(target.id, next, 'agent');
        const now = latest.current.pictures.find((x) => x.id === target.id);
        return { picture: target.id, controls: developControls(now?.develop ?? null) };
      },
    },
    ...developRecordCommands((picture, change) => {
      const target = targetPicture(latest.current, picture, openIdRef.current);
      handleDevelop(target.id, change(target.develop), 'agent');
      const now = latest.current.pictures.find((x) => x.id === target.id);
      return { picture: target.id, develop: normaliseDevelop(now?.develop ?? {}) };
    }),
    ...sectionCommands((picture, section, change) => {
      const target = targetPicture(latest.current, picture, openIdRef.current);
      if (isClipPicture(target)) throw new CommandError('unavailable', 'a clip takes the develop, the look and the crop only');
      const current = (target[section] ?? null) as never;
      const next = change(current) as never;
      if (section === 'keystone') handleKeystone(target.id, next, 'agent');
      else if (section === 'lens') handleLens(target.id, next, 'agent');
      else if (section === 'detail') handleDetail(target.id, next, 'agent');
      else handleVignette(target.id, next, 'agent');
      const now = latest.current.pictures.find((x) => x.id === target.id);
      return { picture: target.id, [section]: now?.[section] ?? null };
    }),
    ...presetCommands({
      presets: presetsNow,
      save: saveToPresetBook,
      roll: () => latest.current,
      pictures: (ids) =>
        ((ids as string[] | undefined) ?? [undefined]).map((id) => targetPicture(latest.current, id, openIdRef.current)),
      write: (changes) =>
        update((r) => {
          let next = r;
          for (const [id, change] of changes) {
            next = patchPicture(next, id, { develop: change.develop });
            if (change.grade !== undefined) next = copyGradeTo(next, [id], change.grade);
          }
          return next;
        }, 'agent'),
    }),
    ...lookCommands({
      stack: () => stackRef.current,
      available: () => (openIdRef.current ? true : 'no picture is open'),
      asAgent: lookAsAgent,
    }),
    {
      id: 'develop.applyTo',
      title: 'Apply a picture’s settings to others',
      description: `Write sections of one picture (the open one unless named) onto other pictures of the roll — the batch verb. sections: any of ${SECTION_IDS.join(', ')}; by default the ones the source has edited. to: picture ids, or ["all"] for every other picture not ignored. A clip receives only the develop, the look and the crop. One undo step.`,
      params: {
        to: { type: 'strings', description: 'Picture ids, or ["all"].' },
        sections: { type: 'strings', description: 'Section ids; the source’s edited sections when absent.', optional: true },
        from: { type: 'string', description: 'The source picture; the open one when absent.', optional: true },
      },
      run: (p) => {
        const roll = latest.current;
        const source = targetPicture(roll, p.from, openIdRef.current);
        const to = p.to as string[];
        const ids =
          to.length === 1 && to[0] === 'all'
            ? roll.pictures.filter((x) => x.id !== source.id && !isIgnored(x)).map((x) => x.id)
            : to.map((id) => targetPicture(roll, id, null).id);
        const asked = (p.sections as string[] | undefined) ?? pictureEdits(source);
        const unknown = asked.filter((s) => !(SECTION_IDS as readonly string[]).includes(s));
        if (unknown.length) throw new CommandError('invalid', `no section ${unknown.join(', ')} — the sections are ${SECTION_IDS.join(', ')}`);
        if (asked.length === 0) throw new CommandError('invalid', 'the source picture has nothing edited — name the sections to copy');
        update((r) => applySections(r, r.pictures.find((x) => x.id === source.id) ?? source, ids, asked as PictureSection[]), 'agent');
        return { from: source.id, to: ids, sections: asked };
      },
    },
    {
      id: 'develop.deliver',
      title: 'Choose which pictures leave',
      description:
        'Set whether pictures leave in an export: auto (edited ones leave), yes, no, or ignore (out of the roll’s work: never exported, skipped by the arrows and by apply-to-all). Locked while an export runs.',
      params: {
        state: { type: 'string', description: 'auto, yes, no or ignore.', enum: ['auto', 'yes', 'no', 'ignore'] },
        pictures: { type: 'strings', description: 'Picture ids; the open picture when absent.', optional: true },
      },
      available: () => (exportRunning.current ? LOCKED_DELIVERY : true),
      run: (p) => {
        const ids = ((p.pictures as string[] | undefined) ?? [undefined]).map((id) => targetPicture(latest.current, id, openIdRef.current).id);
        update((r) => setDelivery(r, ids, p.state as DeliverState), 'agent');
        return { pictures: ids, state: p.state };
      },
    },
    {
      id: 'develop.words',
      title: 'Title and caption',
      description: 'A picture’s own title and caption, written into the delivered file (XMP dc:title, dc:description and EXIF ImageDescription). An empty string removes one.',
      params: {
        title: { type: 'string', description: 'The title.', optional: true },
        caption: { type: 'string', description: 'The caption.', optional: true },
        picture: { type: 'string', description: 'A picture id; the open picture when absent.', optional: true },
      },
      run: (p) => {
        const target = targetPicture(latest.current, p.picture, openIdRef.current);
        if (p.title === undefined && p.caption === undefined) throw new CommandError('invalid', 'give a title, a caption, or both');
        const words: { title?: string; caption?: string } = {};
        if (typeof p.title === 'string') words.title = p.title;
        if (typeof p.caption === 'string') words.caption = p.caption;
        update((r) => setPictureWords(r, target.id, words), 'agent');
        const now = latest.current.pictures.find((x) => x.id === target.id);
        return { picture: target.id, title: now?.title ?? null, caption: now?.caption ?? null };
      },
    },
    {
      id: 'develop.addFromWinnow',
      title: 'Add a Winnow day to the roll',
      description:
        'Add the connected Winnow’s photographs and clips of a day (or a span) to the roll, narrowed by Winnow’s own culling — verdict (pick, reject, skip, unrated) and minimum stars — and by kind. Bursts count as their cover. The bytes are fetched when a picture opens. Answers how many were added and how many the roll already held.',
      params: {
        date: { type: 'string', description: 'The day, YYYY-MM-DD.' },
        dateTo: { type: 'string', description: 'The span’s last day, YYYY-MM-DD; the same day when absent.', optional: true },
        verdict: { type: 'string', description: 'Only this verdict.', enum: VERDICTS, optional: true },
        minStars: { type: 'number', description: 'At least this many stars.', min: 0, max: 5, integer: true, optional: true },
        media: { type: 'string', description: 'photo or video; both when absent.', enum: ['photo', 'video'], optional: true },
        half: { type: 'string', description: 'incoming (still to cull) or final (the Gallery); both when absent.', enum: ['incoming', 'final'], optional: true },
      },
      available: () => (winnowRef.current.client && winnowRef.current.connection ? true : 'no Winnow is connected — connect one on #/sources'),
      run: async (p) => {
        const { client: c, connection: conn } = winnowRef.current;
        if (!c || !conn) throw new CommandError('unavailable', 'no Winnow is connected');
        const from = readDay('date', p.date);
        const to = p.dateTo === undefined ? from : readDay('dateTo', p.dateTo);
        if (to < from) throw new CommandError('invalid', 'dateTo comes before date');
        const rows = await c.allAssets({
          dateFrom: from,
          dateTo: to,
          ...(p.half ? { half: p.half as 'incoming' | 'final' } : {}),
          ...(p.media ? { mediaType: p.media as 'photo' | 'video' } : {}),
        });
        const kept = filterRows(rows, {
          verdict: p.verdict as Verdict | undefined,
          minStars: p.minStars as number | undefined,
          media: p.media as 'photo' | 'video' | undefined,
        }).filter((r) => r.media_type === 'photo' || r.media_type === 'video');
        const refs = kept.map((r) => rowMediaRef(conn.id, r));
        const before = latest.current.pictures.length;
        update((r) => addPictures(r, refs), 'agent');
        const added = latest.current.pictures.length - before;
        return { listed: rows.length, matched: kept.length, added, alreadyOnRoll: kept.length - added };
      },
    },
    {
      id: 'develop.addFromLibrary',
      title: 'Add Library files to the roll',
      description:
        'Add photographs and clips the Library holds (the files imported in this tab) to the roll: by file name, or ["all"]. A picture the roll already holds is found again, never added twice.',
      params: { names: { type: 'strings', description: 'File names as the Library shows them, or ["all"].' } },
      run: async (p) => {
        const names = p.names as string[];
        const pool = libraryFilesRef.current;
        const picked = names.length === 1 && names[0] === 'all' ? pool : names.map((n) => {
          const f = pool.find((x) => x.name === n);
          if (!f) throw new CommandError('invalid', `the Library holds no "${n}" — it holds ${pool.map((x) => x.name).join(', ') || 'nothing'}`);
          return f;
        });
        const refs = await hashedMediaRefs(picked);
        const { found, fresh } = splitByRoll(latest.current.pictures.map((x) => x.ref), refs);
        if (fresh.length) update((r) => addPictures(r, fresh), 'agent');
        return { added: fresh.length, alreadyOnRoll: found };
      },
    },
    {
      id: 'develop.exportPlan',
      title: 'What an export would deliver',
      description:
        'Before anything is rendered: each picture’s line — which file it leaves from, at what size, to which targets — and whether it leaves (develop.deliver decides).',
      run: () => ({
        pictures: latest.current.pictures.map((p) => ({ id: p.id, name: pictureLabel(p), leaves: delivers(p), line: exportsRef.current.lines.get(p.id) ?? null })),
      }),
    },
    {
      id: 'develop.export',
      title: 'Export pictures',
      description:
        'Render pictures through the roll’s own export (its targets, sizes, metadata, HDR) and hand the files to the agent bridge, which writes them into its output folder on this computer — never over an existing file. pictures: ids, ["leaving"] (the ones develop.deliver lets leave — the default) or ["all"]. Answers the paths written and the run’s own sentence. Needs the bridge: an export by hand asks for a folder instead.',
      params: {
        pictures: { type: 'strings', description: 'Picture ids, ["leaving"] or ["all"].', optional: true },
      },
      available: () =>
        bridgeState().status !== 'connected'
          ? 'an export by an agent goes through the bridge, and none is connected'
          : exportsRef.current.exporting
            ? 'an export is already running'
            : true,
      run: async (p) => {
        const roll = latest.current;
        const asked = (p.pictures as string[] | undefined) ?? ['leaving'];
        const ids =
          asked.length === 1 && asked[0] === 'all'
            ? roll.pictures.filter((x) => !isIgnored(x)).map((x) => x.id)
            : asked.length === 1 && asked[0] === 'leaving'
              ? roll.pictures.filter(delivers).map((x) => x.id)
              : asked.map((id) => targetPicture(roll, id, null).id);
        if (ids.length === 0) throw new CommandError('invalid', 'no picture leaves — mark some with develop.deliver, or name them');
        const written: string[] = [];
        const sink = bridgeSink((path) => written.push(path));
        if (!sink) throw new CommandError('unavailable', 'the bridge went away');
        await exportsRef.current.exportPictures(ids, sink);
        // The run's sentence is set on its last render.
        await new Promise((resolve) => window.setTimeout(resolve, 50));
        return { written, note: exportsRef.current.note };
      },
    },
    {
      id: 'develop.reset',
      title: 'Reset sections',
      description: `Put sections of a picture back as shot (the develop alone unless named). Sections: ${SECTION_IDS.join(', ')}. One undo step.`,
      params: {
        sections: { type: 'strings', description: 'Section ids; ["develop"] when absent.', optional: true },
        picture: { type: 'string', description: 'A picture id; the open picture when absent.', optional: true },
      },
      run: (p) => {
        const target = targetPicture(latest.current, p.picture, openIdRef.current);
        const asked = (p.sections as string[] | undefined) ?? ['develop'];
        const unknown = asked.filter((s) => !(SECTION_IDS as readonly string[]).includes(s));
        if (unknown.length) throw new CommandError('invalid', `no section ${unknown.join(', ')} — the sections are ${SECTION_IDS.join(', ')}`);
        update((r) => resetSections(r, target.id, asked as PictureSection[]), 'agent');
        const now = latest.current.pictures.find((x) => x.id === target.id);
        return { picture: target.id, edited: now ? pictureEdits(now) : [] };
      },
    },
  ]);

  const handleFraming = useCallback(
    (id: string, framing: Framing | null, via?: JournalVia) => update((r) => patchPicture(r, id, { framing }), via),
    [update],
  );
  const handleKeystone = useCallback(
    (id: string, keystone: Keystone | null, via?: JournalVia) => update((r) => patchPicture(r, id, { keystone }), via),
    [update],
  );
  const handleRepair = useCallback(
    (id: string, repair: Patch[]) => update((r) => patchPicture(r, id, { repair })),
    [update],
  );
  const handleDetail = useCallback(
    (id: string, detail: DetailSettings | null, via?: JournalVia) => update((r) => patchPicture(r, id, { detail }), via),
    [update],
  );
  const handleVignette = useCallback(
    (id: string, vignette: PostCropVignette | null, via?: JournalVia) => update((r) => patchPicture(r, id, { vignette }), via),
    [update],
  );
  const handleLens = useCallback(
    (id: string, lens: LensCorrection | null, via?: JournalVia) => update((r) => patchPicture(r, id, { lens }), via),
    [update],
  );
  const handleLensProfile = useCallback(
    (id: string, lensProfile: LensProfileApplied | null) => update((r) => patchPicture(r, id, { lensProfile })),
    [update],
  );
  const handleLayers = useCallback(
    (id: string, layers: AdjustLayer[]) => update((r) => patchPicture(r, id, { layers })),
    [update],
  );
  const handleAspect = useCallback(
    (id: string, aspect: string, via?: JournalVia) => update((r) => patchPicture(r, id, { aspect }), via),
    [update],
  );
  const handleRendition = useCallback(
    (id: string, rendition: string | null) => update((r) => patchPicture(r, id, { rendition })),
    [update],
  );
  // The roll's choice of file (`roll-choice.ts`): ONE fact on the roll, one
  // undo step, and every picture with no choice of its own follows it —
  // the pictures added tomorrow too. The ones chosen by hand are counted,
  // since they are the ones that will not move.
  const handleRollChoice = useCallback(
    (opensOn: RollChoice | null) => {
      const before = latest.current;
      if ((before.opensOn ?? null) === opensOn) return;
      update((r) => ({ ...r, opensOn, updatedAt: Date.now() }));
      const own = opensOn ? before.pictures.filter((p) => departsFromRoll(opensOn, p)).length : 0;
      setNotice(
        `${opensOn ? `The roll opens on ${CHOICE_WORDS[opensOn]}` : 'Each picture opens where it opens'}${
          own ? ` — ${own} picture${own === 1 ? '' : 's'} chosen by hand keep${own === 1 ? 's' : ''} its own file` : ''
        }`,
      );
    },
    [update],
  );
  const rollPhotos = useMemo(() => roll.pictures.filter((p) => !isClipPicture(p)).length, [roll.pictures]);
  const handleWords = useCallback(
    (id: string, words: { title?: string; caption?: string }) => update((r) => setPictureWords(r, id, words)),
    [update],
  );
  const handleBorder = useCallback(
    (id: string, border: RollBorder | null) => update((r) => copyBorderTo(r, [id], border)),
    [update],
  );
  // Which pictures leave is an Export-tab setting, locked while a run goes on
  // (L2): the table is inert, and the keys and the strip's badges — the same
  // setting reached from elsewhere — refuse too, and say why. Read through a
  // ref: the run is known only once `useRollExport` has been called below.
  const exportRunning = useRef(false);
  // The delivery keys, answered from the roll as it stands (the state depends on
  // whether the picture is edited), and said in the status line.
  const handleDeliver = useCallback(
    (id: string, action: DeliverAction) => {
      if (exportRunning.current) {
        setNotice(LOCKED_DELIVERY);
        return;
      }
      const picture = latest.current.pictures.find((p) => p.id === id);
      if (!picture) return;
      const next =
        action === 'toggle' ? toggledDelivery(picture) : action === 'auto' ? 'auto' : isIgnored(picture) ? 'auto' : 'ignore';
      update((r) => setDelivery(r, [id], next));
      const after = { ...picture, deliver: next };
      setNotice(
        next === 'ignore'
          ? `${pictureLabel(picture)} ignored — the arrows step over it`
          : `${pictureLabel(picture)} ${delivers(after) ? 'will be exported' : 'stays out of the export'}${next === 'auto' ? ' (the roll’s rule)' : ''}`,
      );
    },
    [update],
  );
  const handleDeliverAll = useCallback(
    (ids: readonly string[], leave: boolean) => {
      if (exportRunning.current) {
        setNotice(LOCKED_DELIVERY);
        return;
      }
      update((r) => setLeaving(r, ids, leave));
      setNotice(`${ids.length} picture${ids.length === 1 ? '' : 's'} ${leave ? 'will be exported' : 'stay out of the export'}`);
    },
    [update],
  );
  const handleExportSettings = useCallback(
    (patch: Partial<RollExport>) => update((r) => ({ ...r, export: { ...r.export, ...patch }, updatedAt: Date.now() })),
    [update],
  );

  // --- the still export (D9): each picture through its own cube --------------
  // Its own develop under its own look, baked from the document with the
  // stage's lattice lookup (`roll-cubes.ts`).
  const { interpolation } = useLutInterpolation();
  // "Proxies only, for this run": the editor's, reset with it, never written
  // to the roll — which pixels is otherwise each picture's own choice.
  const [proxiesOnly, setProxiesOnly] = useState(false);
  // When each picture last LEFT, on this device (`export-marks.ts`): read
  // beside the roll and written when a run lands — never an edit, never undone.
  const pictureIds = useMemo(() => roll.pictures.map((p) => p.id), [roll.pictures]);
  const { marks: exportMarks, record: recordExported } = useExportMarks(roll.id, pictureIds);
  const exports = useRollExport({
    roll,
    files,
    fileFor,
    openId,
    interpolation,
    siblingsOf: siblingsFor,
    proxiesOnly,
    onDelivered: recordExported,
  });
  const { exportPictures } = exports;
  exportRunning.current = exports.progress !== null;
  // Read by the export commands at call time (`develop.export`).
  const exportsRef = useRef(exports);
  exportsRef.current = exports;
  const exportVerbs = useMemo<ExportVerb[]>(() => {
    if (!openId) return [];
    const verbs: ExportVerb[] = [{ id: 'open', label: 'Export this picture', run: () => void exportPictures([openId]) }];
    // A making-of replays a PHOTOGRAPH's edit steps: its states are graded as
    // stills, and a clip is a video, so a clip is not offered one.
    if (!roll.pictures.some((p) => p.id === openId && isClipPicture(p))) {
      verbs.push({
        id: 'making-of',
        label: 'Making-of video…',
        hint: 'this picture’s edit steps replayed as a short video for a feed',
        run: () => setTimelapseOpen(true),
      });
    }
    if (visibleSelected.size > 0) {
      const ids = roll.pictures.filter((p) => visibleSelected.has(p.id)).map((p) => p.id);
      verbs.push({
        id: 'selection',
        label: `Export ${ids.length} selected`,
        hint: 'the pictures marked in the filmstrip, in the strip’s order',
        run: () => void exportPictures(ids),
      });
    }
    // What LEAVES: the edited pictures, and those marked to send — never an
    // ignored one, never one marked to hold (`docs/lightroom-gaps.md` §10).
    const leaving = roll.pictures.filter(delivers).map((p) => p.id);
    if (leaving.length > 0) {
      verbs.push({
        id: 'roll',
        label: `Export ${leaving.length} picture${leaving.length === 1 ? '' : 's'}`,
        hint: 'the pictures that leave — edited ones, and those marked to send — in the strip’s order',
        run: () => void exportPictures(leaving),
      });
      // E4: of those, the ones never delivered from here or changed since —
      // offered only when it is a real subset, else it is the verb above.
      const due = roll.pictures.filter((p) => delivers(p) && needsExport(p, exportMarks)).map((p) => p.id);
      if (due.length > 0 && due.length < leaving.length) {
        verbs.push({
          id: 'changed',
          label: `Export ${due.length} new or changed`,
          hint: 'the pictures that leave and were never exported from this device, or were edited since',
          run: () => void exportPictures(due),
        });
      }
    }
    return verbs;
  }, [openId, visibleSelected, roll.pictures, exportPictures, exportMarks]);

  // The ECHO on the band (`docs/press-feedback.md` C4): the cells a verb
  // just wrote tick for a moment, so a paste onto a selection — which leaves
  // the stage as it was — is still seen to have landed.
  const [written, setWritten] = useState<ReadonlySet<string>>(NO_IDS);
  const writtenTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(writtenTimer.current), []);
  const markWritten = useCallback((ids: readonly string[]) => {
    window.clearTimeout(writtenTimer.current);
    setWritten(new Set(ids));
    writtenTimer.current = window.setTimeout(() => setWritten(NO_IDS), VERB_DONE_MS);
  }, []);
  const writeDevelopTo = useCallback(
    (targets: readonly string[], develop: DevelopSettings | null, via: JournalVia = 'apply') => {
      markWritten(targets);
      // The NUMBERS travel, never the material: a base and its metered gain
      // are facts about the one picture they were measured on. A target's
      // own base is kept, so a batch onto a RAW keeps it on the RAW.
      const numbers = develop ? withoutBase(develop) : null;
      const value = numbers && !isDefaultDevelop(numbers) ? numbers : null;
      update(
        (r) => ({
          ...r,
          pictures: r.pictures.map((p) => {
            if (!targets.includes(p.id)) return p;
            const own = p.develop && isRawDevelop(p.develop) ? { base: p.develop.base, rawGain: p.develop.rawGain, rawProfile: p.develop.rawProfile ?? null } : null;
            const next =
              value || own
                ? { ...(value ?? DEFAULT_DEVELOP), ...(own ?? {}), baseCurve: landBaseCurve(numbers?.baseCurve, p.develop?.baseCurve) }
                : null;
            // Onto a picture on the roll's sensor, a sensor's numbers keep it there.
            return { ...p, develop: ontoRollSensor(r.opensOn, p, isRawDevelop(develop), next) };
          }),
          updatedAt: Date.now(),
        }),
        via,
      );
    },
    [update, markWritten],
  );
  const canPaste = useSyncExternalStore(subscribeDevelopClipboard, hasCopiedDevelop);
  // --- the sections: ⌘C / ⌘V and "apply to others" for any part of a picture
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Develop's own settings — this device's, never the roll's (`DevelopSettingsSheet.tsx`).
  // A module store, so the Export tab's Encoder line opens the same sheet; a
  // sheet left open is closed with the roll, not carried into the next one.
  const deviceSettingsOpen = useDevelopSettingsOpen();
  useEffect(() => closeDevelopSettings, []);
  // The making-of sheet: opened from the Export tab's row or the bar's menu,
  // drawn by the workbench, which holds the picture's bytes.
  const [timelapseOpen, setTimelapseOpen] = useState(false);
  const handleMakingOf = useCallback(
    (id: string, change: { hidden?: string[]; captions?: Record<string, string> }) => update((r) => setMakingOf(r, id, change)),
    [update],
  );
  const copied = useSyncExternalStore(subscribeCopiedSettings, copiedSettings);
  const carried = useCarriedSections();
  const sectionNames = (sections: readonly PictureSection[]) =>
    sections.map((id) => PICTURE_SECTIONS.find((x) => x.id === id)?.label.toLowerCase()).join(', ');
  const copySectionsOf = useCallback(
    (sections: PictureSection[]) => {
      const p = latest.current.pictures.find((x) => x.id === openIdRef.current);
      if (!p) return;
      copySettings(p, sections);
      setNotice(`copied ${sectionNames(sections)}`);
    },
    [],
  );
  /**
   * ⌘C and the copy glyph: the picture AS IT STANDS — `develop` is the
   * workbench's draft, which can be a beat ahead of the roll — holding every
   * section it has something in, with no dialog. The develop numbers also go
   * to the develop clipboard, so a Trips or Studio sheet can paste them.
   */
  // Each verb says how it went (`VerbOutcome`): the glyph that ran it shows ✓
  // or –, and the words are the status line's.
  const copyPicture = useCallback((develop: DevelopSettings): VerbOutcome => {
    const p = latest.current.pictures.find((x) => x.id === openIdRef.current);
    if (!p) return { ok: false, word: 'no picture open' };
    const now = { ...p, develop };
    const sections = copiedSectionsOf(now);
    if (sections.length === 0) {
      const word = 'nothing to copy — this picture is as shot';
      setNotice(word);
      return { ok: false, word };
    }
    copySettings(now, sections);
    copyDevelop(develop);
    const left = sections.filter((id) => !carriedSections().includes(id));
    setNotice(`copied ${sectionNames(sections)}${left.length ? ` — ⌘V leaves ${sectionNames(left)} behind (▾ beside paste)` : ''}`);
    return { ok: true, word: `copied ${sectionNames(sections)}` };
  }, []);
  /** The held picture onto `ids`, carrying what the ▾ says. Null when nothing is held. */
  const pasteOnto = useCallback(
    (ids: readonly string[]): VerbOutcome | null => {
      const held = copiedSettings();
      if (!held || ids.length === 0) return null;
      const sections = pastedSections(held.sections, carriedSections());
      if (sections.length === 0) {
        setNotice(`nothing to paste — ${sectionNames(held.sections)} ${held.sections.length === 1 ? 'is' : 'are'} left behind (▾ beside paste)`);
        return { ok: false, word: 'nothing to paste — the ▾ leaves it all behind' };
      }
      update((r) => applySections(r, held.from, ids, sections), 'paste');
      markWritten(ids);
      const onto = ids.length === 1 && ids[0] === openIdRef.current ? '' : ` onto ${ids.length} picture${ids.length === 1 ? '' : 's'}`;
      setNotice(`pasted ${sectionNames(sections)} from ${pictureLabel(held.from)}${onto}`);
      return { ok: true, word: `pasted ${sectionNames(sections)}${onto}` };
    },
    [update, markWritten],
  );
  const pasteSections = useCallback((): VerbOutcome | null => {
    const id = openIdRef.current;
    return id ? pasteOnto([id]) : null;
  }, [pasteOnto]);
  /**
   * The copy and paste glyphs' state, and the ▾ of what a paste carries —
   * the workbench draws them and adds the draft to a copy. A section the held
   * picture has nothing in is still offered (the choice stands for the next
   * copy) and says so.
   */
  const clip = useMemo<Omit<DevelopClipVerbs, 'onCopy' | 'onPaste'>>(() => {
    const n = selectionTargets.length;
    const goes = copied ? pastedSections(copied.sections, carried) : [];
    const pasteMenu: OverflowItem[] = [
      {
        id: 'from',
        label: copied ? `⌘V carries, from ${pictureLabel(copied.from)}:` : '⌘V carries:',
        disabled: true,
        onSelect: () => {},
      },
      ...PICTURE_SECTIONS.map((sec) => ({
        id: sec.id,
        // A section the held picture has nothing in is greyed, not worded:
        // the tick still stands for the next copy.
        label: copied && !copied.sections.includes(sec.id) ? <span className="text-faint">{sec.label}</span> : sec.label,
        title: copied && !copied.sections.includes(sec.id) ? `${sec.hint} — nothing of it on ${pictureLabel(copied.from)}` : sec.hint,
        checked: carried.includes(sec.id),
        onSelect: () => {
          const now = carriedSections();
          setCarriedSections(now.includes(sec.id) ? now.filter((x) => x !== sec.id) : [...now, sec.id]);
        },
      })),
    ];
    return {
      canCopy: !!open && isEdited(open),
      copyTitle: 'Copy ⌘C — everything done to this picture, held for the next one',
      canPaste: !!copied || canPaste,
      // A paste goes to the selection when there is one: the stage echoes it
      // only when the picture on screen is among what it writes.
      pasteLandsHere: n === 0 || (open !== null && selectionTargets.includes(open.id)),
      pasteTitle: copied
        ? goes.length
          ? `Paste ⌘V — ${sectionNames(goes)} from ${pictureLabel(copied.from)}${n ? `, onto the ${n} selected` : ''}`
          : 'Paste ⌘V — everything copied is left behind; the ▾ chooses'
        : canPaste
          ? 'Paste ⌘V — the develop numbers copied in another sheet'
          : 'Nothing copied yet — ⌘C on an edited picture',
      pasteMenu,
    };
  }, [copied, carried, canPaste, open, selectionTargets.length]);
  const resetSectionsOf = useCallback(
    (sections: PictureSection[]) => {
      const id = openIdRef.current;
      if (!id) return;
      update((r) => resetSections(r, id, sections), 'reset');
      setNotice(`reset ${sectionNames(sections)} — ⌘Z brings them back`);
    },
    [update],
  );
  const applySectionsTo = useCallback(
    (ids: readonly string[], sections: PictureSection[]) => {
      const source = latest.current.pictures.find((x) => x.id === openIdRef.current);
      if (!source) return;
      update((r) => applySections(r, r.pictures.find((x) => x.id === source.id) ?? source, ids, sections), 'apply');
      markWritten(ids);
      setNotice(`${sectionNames(sections)} applied to ${ids.length} picture${ids.length === 1 ? '' : 's'}`);
    },
    [update, markWritten],
  );
  // "The others" are the pictures still in the roll's WORK: an ignored one is
  // never written by an Apply-to-all (`docs/lightroom-gaps.md` §10) — a picture
  // the author marked explicitly still is. With Winnow's filter on, they are
  // the others IN THE STRIP — Lightroom's "filter the picks, then sync": the
  // verbs count what they will write, so the number says it.
  const otherIds = useMemo(
    () =>
      roll.pictures
        .filter(
          (p) =>
            p.id !== openId &&
            !isIgnored(p) &&
            (!filtering || passesStripFilter(p, stripFilter, culling.byPicture.get(p.id))),
        )
        .map((p) => p.id),
    [roll.pictures, openId, filtering, culling.byPicture, stripFilter],
  );
  const others = otherIds.length;
  // The pictures a BORDER can be written onto: never a clip (`isClipPicture`
  // — the pure writer refuses it too), so the verb's count says what it will
  // really write. A crop, by contrast, lands on a clip like on a photograph.
  const isFrame = useCallback(
    (id: string) => {
      const p = roll.pictures.find((x) => x.id === id);
      return !!p && !isClipPicture(p);
    },
    [roll.pictures],
  );
  const frameOtherIds = useMemo(() => otherIds.filter(isFrame), [otherIds, isFrame]);
  const frameSelection = useMemo(() => selectionTargets.filter(isFrame), [selectionTargets, isFrame]);
  const applyTo = useMemo<DevelopApplyVerb[]>(() => {
    if (!openId) return [];
    if (selectionTargets.length > 0) {
      const n = selectionTargets.length;
      const verbs: DevelopApplyVerb[] = [
        {
          id: 'selection',
          label: `Apply to ${n} selected`,
          hint: 'the pictures marked in the filmstrip, each as its own copy',
          run: (settings: DevelopSettings) => writeDevelopTo(selectionTargets, settings),
        },
      ];
      if (canPaste) {
        verbs.push({
          id: 'paste-selection',
          label: `Paste to ${n} selected`,
          hint: 'the copied numbers, written onto each marked picture',
          run: () => {
            const pasted = pasteDevelop();
            if (pasted) writeDevelopTo(selectionTargets, pasted, 'paste');
          },
        });
      }
      return verbs;
    }
    if (others <= 0) return [];
    return [
      {
        id: 'roll',
        label: `Apply to ${others} other picture${others === 1 ? '' : 's'}`,
        hint: 'the rest of this roll, each as its own copy',
        run: (settings: DevelopSettings) =>
          writeDevelopTo(otherIds, settings),
      },
    ];
  }, [openId, others, otherIds, selectionTargets, canPaste, writeDevelopTo]);

  const cropApplyTo = useMemo<CropApplyVerb[]>(() => {
    if (!openId) return [];
    const write = (targets: readonly string[]) => (crop: { aspect: string; framing: Framing }) => {
      update((r) => copyCropTo(r, targets, crop), 'apply');
      markWritten(targets);
    };
    if (selectionTargets.length > 0) {
      const n = selectionTargets.length;
      return [
        {
          id: 'selection',
          label: `Apply crop to ${n} selected`,
          hint: 'the pictures marked in the filmstrip, each as its own copy — on a clip, held still over every frame',
          run: write(selectionTargets),
        },
      ];
    }
    if (others <= 0) return [];
    return [
      {
        id: 'roll',
        label: `Apply crop to ${others} other picture${others === 1 ? '' : 's'}`,
        hint: 'the rest of this roll, each as its own copy — on a clip, held still over every frame',
        run: write(otherIds),
      },
    ];
  }, [openId, others, otherIds, selectionTargets, update, markWritten]);

  // The look's own verbs, apart from the develop's: a look is chosen per
  // picture, and this is the one gesture that dresses others with it. They
  // copy the open picture's STORED look, which the stack writes through.
  const lookApplyTo = useMemo<LookApplyVerb[]>(() => {
    if (!openId) return [];
    const write = (targets: readonly string[]) => () => {
      update((r) => copyGradeTo(r, targets, r.pictures.find((p) => p.id === openId)?.grade ?? null), 'apply');
      markWritten(targets);
    };
    if (selectionTargets.length > 0) {
      const n = selectionTargets.length;
      return [
        {
          id: 'selection',
          label: `Apply look to ${n} selected`,
          hint: 'this picture’s look — LUTs, output, grain — onto the pictures marked in the filmstrip, their develops untouched',
          run: write(selectionTargets),
        },
      ];
    }
    if (others <= 0) return [];
    return [
      {
        id: 'roll',
        label: `Apply look to ${others} other picture${others === 1 ? '' : 's'}`,
        hint: 'this picture’s look onto the rest of the roll, each as its own copy, their develops untouched',
        run: write(otherIds),
      },
    ];
  }, [openId, others, otherIds, selectionTargets, update, markWritten]);

  // The border's own verbs, apart from the crop's: a roll can wear ONE border
  // over crops that each differ (the maintainer's change to the prototype).
  const borderApplyTo = useMemo<BorderApplyVerb[]>(() => {
    if (!openId) return [];
    const write = (targets: readonly string[]) => (border: RollBorder | null) =>
      update((r) => copyBorderTo(r, targets, border), 'apply');
    if (selectionTargets.length > 0) {
      const n = frameSelection.length;
      if (n === 0) return [];
      return [
        {
          id: 'selection',
          label: `Apply borders to ${n} selected`,
          hint: 'the pictures marked in the filmstrip, their crops untouched — a clip takes no border',
          run: write(frameSelection),
        },
      ];
    }
    const n = frameOtherIds.length;
    if (n <= 0) return [];
    return [
      {
        id: 'roll',
        label: `Apply borders to ${n} other picture${n === 1 ? '' : 's'}`,
        hint: 'the whole roll, each keeping its own crop — a clip takes no border',
        run: write(frameOtherIds),
      },
    ];
  }, [openId, frameOtherIds, selectionTargets, frameSelection, update]);

  // --- the selection's verbs (`SelectionBar`), on every marked picture at once
  const selectedIds = useMemo(() => [...visibleSelected], [visibleSelected]);
  const selectedPictures = useMemo(() => roll.pictures.filter((p) => visibleSelected.has(p.id)), [roll.pictures, visibleSelected]);
  // What the band SHOWS — the same reading as the band's own — for ⌘A.
  const shownIds = useMemo(
    () =>
      roll.pictures
        .filter((p) => p.id === openId || ((showIgnored || !isIgnored(p)) && (!filtering || passesStripFilter(p, stripFilter, culling.byPicture.get(p.id)))))
        .map((p) => p.id),
    [roll.pictures, openId, showIgnored, filtering, culling.byPicture, stripFilter],
  );
  const selectAll = useCallback(() => setSelected(new Set(shownIds)), [shownIds]);

  // --- the roll as a DECK under the stage (`stage-deck.ts`) -----------------
  // The two pictures beside the open one, exactly as ←/→ would step — an
  // ignored picture and one the band's filter has taken off are stepped over
  // — drawn in the slots a swipe reveals from their cells' own stills, and
  // the open one's still under its stage until it has decoded. The object
  // URLs are made HERE, above the workbench the open picture keys, so the
  // still a landed page opens on is the very URL its slot just showed: the
  // browser has it decoded, and the swap shows no seam.
  const deckIds = useMemo(() => {
    if (!openId) return null;
    const skip = (p: RollPicture) => isIgnored(p) || !passesStripFilter(p, stripFilter, culling.byPicture.get(p.id));
    const beside = (by: -1 | 1) => {
      const id = stepPicture(roll.pictures, openId, by, skip);
      return id && id !== openId ? id : null;
    };
    return { previous: beside(-1), next: beside(1) };
  }, [roll.pictures, openId, stripFilter, culling.byPicture]);
  const deckBlobs = useMemo(() => {
    const out = new Map<string, Blob>();
    for (const id of [deckIds?.previous, openId, deckIds?.next]) {
      const blob = id ? thumbs.get(id) : undefined;
      if (id && blob) out.set(id, blob);
    }
    return out;
  }, [deckIds, openId, thumbs]);
  const deckUrls = useObjectUrls(deckBlobs);
  const deckNeighbours = useMemo(() => {
    if (!deckIds) return null;
    const beside = (id: string | null): DeckNeighbour | null => {
      const p = id ? roll.pictures.find((x) => x.id === id) : undefined;
      if (!p) return null;
      const url = deckUrls.get(p.id) ?? null;
      // No cell of its own yet: the instance's thumbnail, as the band draws it.
      const remote = url ? null : remoteThumb(p);
      return {
        id: p.id,
        name: pictureLabel(p),
        src: url ?? (remote ? remote.client.thumbUrl(remote.id) : null),
        credentialed: !url && Boolean(remote),
      };
    };
    // A roll of one has no deck at all — nothing to reveal either way.
    const previous = beside(deckIds.previous);
    const next = beside(deckIds.next);
    return previous || next ? { previous, next } : null;
  }, [deckIds, roll.pictures, deckUrls, remoteThumb]);
  const deckStill = openId ? (deckUrls.get(openId) ?? null) : null;
  const ignoreSelection = useCallback(() => {
    if (exportRunning.current) {
      setNotice(LOCKED_DELIVERY);
      return;
    }
    const ids = selectedIds;
    const back = selectedPictures.every(isIgnored);
    update((r) => setDelivery(r, ids, back ? 'auto' : 'ignore'));
    setNotice(`${ids.length} picture${ids.length === 1 ? '' : 's'} ${back ? 'back into the roll’s work' : 'ignored — the arrows step over them'}`);
  }, [selectedIds, selectedPictures, update]);
  const ruleSelection = useCallback(() => {
    if (exportRunning.current) {
      setNotice(LOCKED_DELIVERY);
      return;
    }
    const ids = selectedPictures.filter((p) => !isIgnored(p)).map((p) => p.id);
    update((r) => setDelivery(r, ids, 'auto'));
    setNotice(`${ids.length} picture${ids.length === 1 ? '' : 's'} back on the roll’s rule — each leaves if it is edited`);
  }, [selectedPictures, update]);
  const pasteSectionsTo = useCallback((ids: readonly string[]) => void pasteOnto(ids), [pasteOnto]);
  /**
   * ⌘V and the paste glyph: onto the pictures marked in the band when some
   * are, else onto the open one — Lightroom's paste and its sync, one key.
   */
  const selectionRef = useRef(selectionTargets);
  selectionRef.current = selectionTargets;
  const pastePicture = useCallback((): VerbOutcome | null => {
    const marked = selectionRef.current;
    return marked.length > 0 ? pasteOnto(marked) : pasteSections();
  }, [pasteOnto, pasteSections]);
  const variantsOf = useCallback(
    (ids: readonly string[]) => {
      // One id per source, decided before the write, so the thumbnails can
      // follow their pictures; nothing is opened — a batch is not a start.
      const made = ids.map((from) => [from, newRollId()] as const);
      update((r) => made.reduce((acc, [from, id]) => addVariant(acc, from, 'clone', id), r));
      setThumbs((cur) => {
        const next = new Map(cur);
        for (const [from, id] of made) {
          const blob = cur.get(from);
          if (blob) next.set(id, blob);
        }
        return next;
      });
      setNotice(`${made.length} variant${made.length === 1 ? '' : 's'} made, each after its picture`);
    },
    [update],
  );
  // The delivery keys (P, U, M) act on the selection while it is on and
  // holds something; else on the open picture, as they always did.
  const deliverSelection = useCallback(
    (action: DeliverAction) => {
      if (action === 'ignore') ignoreSelection();
      else if (action === 'auto') ruleSelection();
      else handleDeliverAll(selectedIds, !selectedPictures.every(delivers));
    },
    [ignoreSelection, ruleSelection, handleDeliverAll, selectedIds, selectedPictures],
  );
  const selectionVerbs = useMemo<SelectionVerbs>(
    () => ({
      count: selectedIds.length,
      openLabel: open ? pictureLabel(open) : null,
      applyCount: open ? selectionTargets.length : 0,
      allIgnored: selectedPictures.length > 0 && selectedPictures.every(isIgnored),
      canPaste: copied !== null,
      onAll: selectAll,
      onNone: () => setSelected(new Set()),
      onSend: () => handleDeliverAll(selectedIds, true),
      onHold: () => handleDeliverAll(selectedIds, false),
      onIgnore: ignoreSelection,
      onRule: ruleSelection,
      onApply: () => {
        if (open) writeDevelopTo(selectionTargets, open.develop);
      },
      onPaste: () => pasteSectionsTo(selectedIds),
      onVariants: () => variantsOf(selectedIds),
      onRemove: () => removeAsked(selectedIds),
      onDone: stopSelecting,
    }),
    // `removeAsked` is a plain function over refs; it reads nothing stale.
    [selectedIds, selectedPictures, open, selectionTargets, copied, selectAll, handleDeliverAll, ignoreSelection, ruleSelection, writeDevelopTo, pasteSectionsTo, variantsOf, stopSelecting],
  );
  // --- the band's size: the device's preference, held to what the column allows
  const drawerBand = compact && sheetOpen;
  // Where the band stands on THIS device (`StripPrefs.place`, his Q1): under
  // the picture by default, or a COLUMN at its left or right on a desktop —
  // a phone's preference is read as `bottom` whatever it says.
  const side = !compact && strip.place !== 'bottom';
  const left = side && strip.place === 'left';
  // What the column holds besides the picture and the band: the grid's row
  // gap, the workbench's toolbar (one 28 px row and an 8 px gap on a desktop;
  // the name row, the verbs row and their gaps on a phone — its own markup's
  // numbers) and whatever status lines sit over the band in its cell.
  const toolbarAbove = compact ? 76 : 36;
  const statusAbove = statusBox.height > 0 ? statusBox.height + 4 : 0;
  const columnHeight = Math.max(0, columnBox.height - 8 - toolbarAbove - statusAbove);
  // Beside the picture the room is the grid's width less the inspector's
  // column (22rem, 18rem under the 880 px container query) and the two gaps.
  const roomBeside = Math.max(0, columnBox.width - (columnBox.width > 880 ? 352 : 288) - 2 * 16);
  const maxBand = side
    ? columnBox.width > 0
      ? maxBandWidth(roomBeside, stripMetrics)
      : Number.POSITIVE_INFINITY
    : columnHeight > 0
      ? maxBandHeight(columnHeight, stripMetrics)
      : Number.POSITIVE_INFINITY;
  const rollAspect = useMemo(
    () => medianAspect(roll.pictures.map((p) => ({ id: p.id, aspect: cellAspect(p, thumbAspects.get(p.id)) }))),
    [roll.pictures, thumbAspects],
  );
  /** The band's extent on its axis: its height under the picture, its width beside it. */
  const bandSizeNow = drawerBand
    ? // With a phone's drawer up every row is the photograph's: one short row
      // of cells and no header, the size the strip had before it could be pulled.
      56 + 2 * stripMetrics.pad
    : strip.folded
      ? side
        ? stripMetrics.rail
        : stripMetrics.head
      : side
        ? Math.min(maxBand, Math.max(stripMetrics.columnMin, strip.width ?? widthForColumns(1, stripMetrics)))
        : strip.auto && bandBox.width > 0 && columnHeight > 0
          ? Math.round(autoBandHeight({ columnWidth: bandBox.width, columnHeight, aspect: rollAspect, metrics: stripMetrics }))
          : Math.min(maxBand, strip.height ?? heightForRows(1, stripMetrics, strip.thumb));
  const dragFrom = useRef<number | null>(null);
  const onGripDrag = useCallback(
    ({ dx, dy }: { dx: number; dy: number }) => {
      dragFrom.current ??= bandSizeNow;
      // Under the picture the grip is the band's top edge, so up is more; at
      // the left its right edge, so right is more; at the right, left is.
      const travel = side ? (left ? dx : -dx) : -dy;
      const { folded, size } = bandAfterDrag(dragFrom.current + travel, stripMetrics, side, maxBand);
      patchStrip({ folded, auto: false, ...(size === null ? {} : side ? { width: size } : { height: size }) });
    },
    // `bandSizeNow` is read only to seed the drag; the ref holds it after.
    [bandSizeNow, side, left, stripMetrics, maxBand, patchStrip],
  );
  const onGripEnd = useCallback(() => {
    dragFrom.current = null;
  }, []);
  const toggleFolded = useCallback(() => patchStrip({ folded: !strip.folded }), [patchStrip, strip.folded]);
  // A column's cells are sized by how many stand side by side (`columnLayout`
  // takes no thumbnail height): what the band shows as one, two or three.
  const columnsNow = side && !strip.folded ? columnsForWidth(bandSizeNow, stripMetrics) : 0;
  const setColumns = useCallback(
    (n: number) => patchStrip({ folded: false, auto: false, width: Math.min(maxBand, widthForColumns(n, stripMetrics)) }),
    [patchStrip, maxBand, stripMetrics],
  );
  // `-` / `=` step whichever thumbnails are on screen: the sheet's while it
  // is open, else the band's — a column one column narrower or wider.
  const stepThumbs = useCallback(
    (direction: 1 | -1) =>
      contactOpen
        ? patchStrip({ sheet: stepThumb(strip.sheet, direction, stripMetrics, 'sheet') })
        : side
          ? setColumns(Math.max(1, columnsNow + direction))
          : patchStrip({ thumb: stepThumb(strip.thumb, direction, stripMetrics, 'band') }),
    [patchStrip, strip.thumb, strip.sheet, stripMetrics, contactOpen, side, columnsNow, setColumns],
  );
  const toggleSheet = useCallback(() => setContactOpen((o) => !o), []);
  // A finger's size under a finger, a phone's shell or a tablet's (C5).
  const chipSize = finger;
  const rowsNow = side || strip.folded || strip.auto ? 0 : rowsForHeight(bandSizeNow - stripMetrics.head, stripMetrics, strip.thumb);
  const COUNT = ['One', 'Two', 'Three'];
  // The band's settings as a panel of glyphed rows (his pick B of the band
  // menu lab): where it stands, how many rows or columns, the thumbnails'
  // size and the height that follows the roll, then folding alone at the
  // foot. A choice applies and closes, like a menu.
  const countIcons = side ? [Icons.colsOne, Icons.colsTwo, Icons.colsThree] : [Icons.rowsOne, Icons.rowsTwo, Icons.rowsThree];
  const bandSections: SettingsSection[] = [
    // Where the band stands, remembered per device (his Q1): a phone's is
    // always under the picture, so the choice is a desktop's alone.
    ...(compact
      ? []
      : [
          {
            kind: 'choice' as const,
            id: 'place',
            label: 'Where',
            value: strip.place,
            options: (
              [
                ['bottom', Icons.bandUnder, 'Under the picture'],
                ['left', Icons.bandLeft, 'A column at the left'],
                ['right', Icons.bandRight, 'A column at the right'],
              ] as const
            ).map(([id, icon, label]) => ({ id, icon, label })),
            onPick: (place: string) => patchStrip({ place: place as StripPlace, folded: false }),
          },
        ]),
    side
      ? {
          kind: 'choice' as const,
          id: 'columns',
          label: 'Columns',
          value: columnsNow ? String(columnsNow) : null,
          options: [1, 2, 3].map((n) => ({
            id: String(n),
            icon: countIcons[n - 1],
            label: `${COUNT[n - 1]} column${n === 1 ? '' : 's'}`,
            disabled: widthForColumns(n, stripMetrics) > maxBand ? `No room for ${n} columns beside the picture on this screen` : false,
          })),
          onPick: (n: string) => setColumns(Number(n)),
        }
      : {
          kind: 'choice' as const,
          id: 'rows',
          label: 'Rows',
          value: rowsNow ? String(rowsNow) : null,
          options: [1, 2, 3].map((n) => ({ id: String(n), icon: countIcons[n - 1], label: `${COUNT[n - 1]} row${n === 1 ? '' : 's'}` })),
          onPick: (n: string) =>
            patchStrip({ folded: false, auto: false, height: Math.min(maxBand, heightForRows(Number(n), stripMetrics, strip.thumb)) }),
        },
    ...(side
      ? []
      : [
          {
            kind: 'choice' as const,
            id: 'thumbs',
            label: 'Thumbnails',
            value: null,
            options: [
              { id: '-1', icon: Icons.thumbSmaller, label: 'Smaller thumbnails (−)', disabled: strip.thumb <= stripMetrics.thumbMin ? 'Already the smallest' : false },
              { id: '1', icon: Icons.thumbLarger, label: 'Larger thumbnails (=)', disabled: strip.thumb >= stripMetrics.thumbMax ? 'Already the largest' : false },
            ],
            onPick: (d: string) => stepThumbs(Number(d) as 1 | -1),
          },
          {
            kind: 'switch' as const,
            id: 'auto',
            label: 'Height',
            text: 'Follows the roll',
            on: strip.auto,
            title: 'The band takes the room the roll’s typical picture leaves under itself — sized on the roll, so stepping to a portrait moves nothing',
            onToggle: () => patchStrip({ auto: !strip.auto, folded: false }),
          },
        ]),
    { kind: 'rule', id: 'fold-rule' },
    {
      kind: 'action',
      id: 'fold',
      icon: side ? Icons.foldSide : Icons.foldUnder,
      label: strip.folded ? 'Show the band' : 'Fold to its rail',
      hint: 'B',
      onSelect: toggleFolded,
    },
  ];
  // What each filter would show, written beside its row in the panel —
  // counted only while the panel can be opened, never per slider tick.
  const filterCounts = useMemo(
    () => stripFilterCounts(roll.pictures, (id) => culling.byPicture.get(id), showIgnored),
    [roll.pictures, culling.byPicture, showIgnored],
  );
  const filterRow = (f: (typeof STRIP_FILTERS)[number]) => {
    const cull = cullFilterOf(f.key);
    return {
      id: f.key,
      icon: FILTER_ICONS[f.key] ?? (cull?.kind === 'picks' ? Icons.flag : cull?.kind === 'unrejected' ? Icons.circleCheck : Icons.star),
      label: cull ? cullFilterLabel(cull) : f.label,
      on: stripFilter === f.key,
      note: String(filterCounts.get(f.key) ?? 0),
      onSelect: () => setStripFilter(f.key),
    };
  };
  const filterSections: SettingsSection[] = [
    { kind: 'list', id: 'roll', items: STRIP_FILTERS.filter((f) => !f.winnow).map(filterRow) },
    ...(culling.reachable
      ? ([
          { kind: 'rule', id: 'r-winnow' },
          { kind: 'list', id: 'winnow', heading: 'Winnow', items: STRIP_FILTERS.filter((f) => f.winnow).map(filterRow) },
        ] satisfies SettingsSection[])
      : []),
    { kind: 'rule', id: 'r-ignored' },
    {
      kind: 'switch',
      id: 'ignored-view',
      label: 'Ignored',
      text: showIgnored ? 'Shown, dimmed' : 'Hidden',
      on: showIgnored,
      title: showIgnored ? 'Leave the ignored pictures out' : 'Show the ignored pictures, dimmed',
      onToggle: () => setShowIgnored(!showIgnored),
    },
    ...(culling.reachable
      ? ([
          {
            kind: 'action',
            id: 'refresh',
            icon: Icons.refresh,
            label: culling.asking ? 'Asking Winnow…' : 'Ask Winnow again',
            title: 'Winnow’s picks, stars and labels are asked by themselves when you come back to this tab',
            onSelect: () => {
              if (!culling.asking) culling.refresh();
            },
          },
        ] satisfies SettingsSection[])
      : []),
  ];
  // ONE filter chip, drawn in the band's header and in the sheet's.
  const filterChip = (
    <SettingsMenu
      label="What the band shows"
      sections={filterSections}
      align="start"
      trigger={{ text: stripFilterLabel(stripFilter), icon: Icons.filter, size: chipSize, variant: filtering ? 'primary' : 'default' }}
    />
  );
  // The band's header: where it stands in its pictures, what the roll holds,
  // what the band shows and the way into the selection — or, the selection
  // on, its bar of verbs.
  const bandHeader = useCallback(
    ({ at, shown, width }: { at: number; shown: number; width: number }) => {
      if (selecting) return <SelectionBar compact={compact} dense={width < 800} narrow={side} verbs={selectionVerbs} />;
      const size = finger;
      if (side && strip.folded) {
        // The column's RAIL: a stack of three — unfold, the count read down
        // the rail, the sheet — and the menu, so the band can be moved from here.
        return (
          <>
            <IconButton size={size} variant="ghost" label="Show the band (B)" onClick={toggleFolded}>
              {left ? Icons.chevronRight : Icons.back}
            </IconButton>
            <span className="[writing-mode:vertical-rl] font-mono text-2xs text-ink tabular-nums whitespace-nowrap" aria-live="polite">
              {at >= 0 ? at + 1 : '–'} / {shown}
            </span>
            <IconButton size={size} variant="ghost" label="Contact sheet (G)" onClick={toggleSheet}>
              {Icons.grid}
            </IconButton>
            <SettingsMenu label="The band: where, how many, how big" sections={bandSections} size={size} side="below" />
          </>
        );
      }
      const progress = rollProgress(roll);
      const leaving = roll.pictures.filter(delivers).length;
      const changed = roll.pictures.filter((p) => !isIgnored(p) && exportState(p, exportMarks) === 'changed').length;
      const looks = roll.pictures.filter((p) => p.grade).length;
      const cull = culling.reachable ? countCulling(roll.pictures.map((p) => culling.byPicture.get(p.id))) : null;
      const summary = [
        `${progress.developed} edited`,
        `${leaving} to export`,
        changed > 0 ? `${changed} changed since exported` : '',
        progress.ignored > 0 ? `${progress.ignored} ignored` : '',
        looks > 0 ? `${looks} with a look` : '',
        cull
          ? cull.known === 0 && culling.asking
            ? 'asking Winnow…'
            : `Winnow ${[cull.picks > 0 ? `${cull.picks} pick${cull.picks === 1 ? '' : 's'}` : '', cull.rejects > 0 ? `${cull.rejects} rejected` : ''].filter(Boolean).join(', ') || 'nothing culled'}`
          : '',
        filtering ? `${shown} shown` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      return (
        <>
          <IconButton size={size} variant="ghost" label={strip.folded ? 'Show the band (B)' : 'Fold the band to its rail (B)'} onClick={toggleFolded}>
            {side ? (left ? Icons.back : Icons.chevronRight) : strip.folded ? Icons.up : Icons.down}
          </IconButton>
          <span className="flex-none font-mono text-2xs text-ink tabular-nums whitespace-nowrap" aria-live="polite">
            {at >= 0 ? at + 1 : '–'} / {shown}
          </span>
          {!compact && !side && (
            <span className="min-w-0 truncate font-mono text-2xs text-muted tabular-nums" title={summary}>
              · {summary}
            </span>
          )}
          {filterChip}
          <span className="flex-1" />
          <Button size={size} onClick={() => startSelecting()} title="Pick several pictures, then act on them all (S)">
            Select
          </Button>
          {compact || side ? (
            <IconButton size={size} label="Contact sheet (G)" onClick={toggleSheet}>
              {Icons.grid}
            </IconButton>
          ) : (
            <Button size="sm" icon={Icons.grid} onClick={toggleSheet} title="The whole roll large over the picture, to sort and to act on many (G)">
              Sheet
            </Button>
          )}
          <SettingsMenu label="The band: where, how many, how big" sections={bandSections} size={size} side={side ? 'below' : 'above'} />
        </>
      );
    },
    // The menus are rebuilt per render on purpose: they read the band's state.
    [selecting, compact, finger, side, left, selectionVerbs, startSelecting, roll, exportMarks, culling, filtering, stripFilter, strip.folded, toggleFolded, toggleSheet, showIgnored, bandSizeNow, strip.thumb, strip.auto, strip.place],
  );

  // A clip has three tabs (`workbenchTabsFor`): stepping from a photograph's
  // Detail or Layers tab onto a clip lands on Adjust, and back on the
  // photograph the tab is whatever it was last on a picture that had it.
  const openIsClip = open ? isClipPicture(open) : false;
  const tabs = workbenchTabsFor(openIsClip);
  useEffect(() => {
    if (open && !tabs.some((t) => t.id === tab)) setTab('adjust');
  }, [open, tabs, tab]);

  // On a phone the inspector is a sheet, opened from the shell's bottom bar;
  // picking a section is also what raises it — the Studio's own convention.
  usePublishSectionBar(
    useMemo(
      () =>
        compact && open
          ? {
              sections: tabs,
              active: sheetOpen ? tab : null,
              label: 'Develop inspector',
              onSelect: (id: string) => {
                setTab(id as WorkbenchTab);
                setSheetOpen(true);
                // A section asked for from the bar is the drawer asked for: the focus ends.
                setFocus(false);
              },
            }
          : null,
      [compact, open, sheetOpen, tab, tabs],
    ),
  );

  const addLabel =
    newPhotos.length === 0 ? 'Add from Library' : `Add ${newPhotos.length} from the Library`;
  // The ways a picture gets onto the roll. One is a button; two are a menu.
  const addItems: OverflowItem[] = [
    ...(newPhotos.length > 0
      ? [{ id: 'library', label: `${newPhotos.length} ticked in the Library`, onSelect: () => void addSelected() }]
      : []),
    ...(connection
      ? [{ id: 'winnow', label: `A day on ${connection.id}…`, onSelect: () => setPickingDay(true) }]
      : []),
    { id: 'folder', label: 'A folder on this computer…', onSelect: () => void addFolder() },
    // A variant is MADE from the picture on the stage, never added from a
    // file (item 30): the roll still refuses a file it holds.
    ...(open
      ? [
          {
            id: 'variant-clone',
            label: `A variant of ${pictureLabel(open)}, as edited`,
            title: "Lightroom's virtual copy — the same file with its own develop, crop, look and words (⌘')",
            onSelect: () => makeVariant('clone'),
          },
          {
            id: 'variant-fresh',
            label: `A variant of ${pictureLabel(open)}, as shot`,
            title: 'The same file, started again from as shot — its RAW base and lens profile kept',
            onSelect: () => makeVariant('fresh'),
          },
        ]
      : []),
  ];
  const addButtonLabel: Record<string, string> = {
    library: addLabel,
    winnow: 'Add a day…',
    folder: 'Add a folder…',
  };
  const dayLabel = connection ? `Add a day from ${connection.id}` : '';
  const initialDay = pictureDay(open?.ref.lastModified ?? roll.pictures[roll.pictures.length - 1]?.ref.lastModified ?? 0);
  // What the picker marks in its month and draws "on the roll" — stable
  // across renders, or it re-derives a day's rows on every one.
  const heldRefs = useMemo(() => roll.pictures.map((p) => p.ref), [roll.pictures]);
  const rollSpan = useMemo(() => {
    const days = roll.pictures.flatMap((p) => (p.ref.lastModified > 0 ? [pictureDay(p.ref.lastModified)] : [])).sort();
    return days.length ? { from: days[0], to: days[days.length - 1] } : null;
  }, [roll.pictures]);
  const removing = confirmRemove ? roll.pictures.filter((p) => confirmRemove.includes(p.id)) : [];
  // The status lines: in the band's cell under the picture; a grid item of
  // their own under the stage once the band stands beside it (the band's
  // cell spans both rows then). Drawn once, in whichever place.
  const statusLines = (
    <div
      ref={statusRef}
      className={`flex flex-col gap-1 empty:hidden ${side ? `${left ? 'col-start-2' : 'col-start-1'} row-start-2 mt-2` : ''}`}
    >
    {/* What STATE is in the band's header now (how far the roll has
        got, what it shows); this line keeps what asks for a click —
        a fetch that failed, a folder to reopen, a notice — and is
        not drawn at all when nothing does. */}
    {(reach.fetching + reach.failed + reach.gone + reach.unconnected + reach.previewed + reach.local > 0 || notice || culling.problem) && (
    <p className="m-0 font-mono text-2xs text-muted tabular-nums">
      {culling.problem && (
        <span className="text-danger">
          Winnow {culling.problem}{' '}
          <button type="button" onClick={culling.refresh} disabled={culling.asking} className="underline underline-offset-2 cursor-pointer">
            {culling.asking ? 'asking…' : 'Try again'}
          </button>{' '}
        </span>
      )}
      {reach.fetching > 0 && (
        <span className="text-ink-soft">
          {' '}
          · fetching {reach.fetching} from {availabilityHost(availability, 'fetching')}
        </span>
      )}
      {reach.failed > 0 && (
        <span className="text-danger">
          {' '}
          · {reach.failed} could not be fetched — {reach.problem}{' '}
          {reach.loginUrl && (
            <a href={reach.loginUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">
              Sign in
            </a>
          )}{' '}
          <button type="button" onClick={retryFailed} className="underline underline-offset-2 cursor-pointer">
            Try again
          </button>
        </span>
      )}
      {reach.gone > 0 && (
        <span className="text-danger">
          {' '}
          · {reach.gone} no longer on {reach.sourceId}
        </span>
      )}
      {reach.unconnected > 0 && (
        <span className="text-ink-soft">
          {' '}
          · {reach.unconnected} on {reach.unconnectedSourceId}, not connected —{' '}
          <a href="#/sources" className="underline underline-offset-2">
            Sources
          </a>
        </span>
      )}
      {reach.previewed > 0 && (
        <span className="text-ink-soft">
          {' '}
          · {reach.previewed} from {reach.previewed === 1 ? 'its' : 'their'} working preview
          {reach.previewed === 1 ? '' : 's'} — reopen the folder for full size
        </span>
      )}
      {reach.local > 0 && (
        <span className="text-ink-soft">
          {' '}
          · {reach.local} from this computer, not open —{' '}
          {folders.waiting.length > 0 ? (
            <button
              type="button"
              onClick={() => void folders.reopen()}
              className="underline underline-offset-2 cursor-pointer text-accent-ink"
            >
              Reopen {folders.waiting.length === 1 ? folders.waiting[0].name : `${folders.waiting.length} folders`}
            </button>
          ) : (
            'drop their folder here'
          )}
        </span>
      )}
      {notice && <span className="text-ink-soft"> · {notice}</span>}
      {/* The shortcuts used to run along here as a seventh clause.
          They are behind `H` and the stage bar's `?` now
          (`DevelopShortcuts.tsx`): a legend read once still cost the
          photograph three wrapped lines every day after. What stays
          on this line is STATE — how far the roll has got, and what
          could not be reached, which is the half that asks for a
          click. */}
    </p>
    )}
    {/* Housekeeping, and it wraps to three lines at 390px: on a
        phone with the drawer up those are three lines taken off the
        photograph. It is back as soon as the drawer is down, which
        is when a roll's upkeep is read anyway. */}
    {localCount > 0 && !(compact && sheetOpen) && (
      <p className="m-0 font-mono text-2xs text-faint tabular-nums">
        working previews ·{' '}
        {previews.enabled ? (
          <>
            {previews.files.size} of {localCount} kept · {formatBytes(previews.bytes)}
            {previews.pending > 0 && ` · making ${previews.pending}`} ·{' '}
            <button
              type="button"
              onClick={() => previews.setEnabled(false)}
              className="underline underline-offset-2 cursor-pointer"
              title="Delete this roll's working previews from this browser"
            >
              Stop keeping them
            </button>
          </>
        ) : (
          <>
            off ·{' '}
            <button
              type="button"
              onClick={() => previews.setEnabled(true)}
              className="underline underline-offset-2 cursor-pointer text-accent-ink"
              title="Keep a 2048 px copy of each picture from this computer, in this browser, so the roll can be developed while its files are away"
            >
              Keep them
            </button>{' '}
            (≈ {formatBytes(localCount * WORKING_PREVIEW_ESTIMATE_BYTES)} for {localCount} picture
            {localCount === 1 ? '' : 's'} from this computer)
          </>
        )}
      </p>
    )}
    </div>
  );

  return (
    <div
      className="relative flex flex-col flex-1 min-h-0 gap-2"
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
      }}
      onDrop={onDrop}
    >
      {dropping && (
        <div
          className="absolute inset-0 z-30 grid place-items-center rounded-paper-lg border-2 border-dashed border-accent bg-[rgba(20,18,15,0.55)] pointer-events-none"
          aria-hidden="true"
        >
          <p className="m-0 max-w-[28rem] px-6 text-center text-sm text-on-media">
            Drop photographs, clips or their folder: pictures already on the roll are found again, the others are added.
          </p>
        </div>
      )}
      {/* On a phone the bar must hold ONE row — back, name, history, Add — or
          it wraps to two and the photograph pays ~50px for it: the back is its
          chevron, the name one step smaller, and Add is its glyph (the menu
          still names every way in). The Trips overview's bar, the same fix. */}
      {/* In focus the bar goes with the band and the inspector: the picture, its own row, nothing else. */}
      {!focus && (
        <PageBar
          back={{ label: 'Rolls', onClick: onBack, iconOnly: compact }}
          trailing={
            <>
              {headerExtra}
              {/* Develop's settings open from inside the roll (his pick): the
                  device's choices, not the roll's — encoder, rendering, device, network. */}
              <IconButton label="Develop settings" onClick={() => openDevelopSettings()}>
                {Icons.settings}
              </IconButton>
              {/* The Library's item only when it holds something the roll does
                  not: a ticked picture already on the roll is nothing to add. */}
              {adding ? (
                <Button variant="primary" icon={Icons.plus} disabled aria-label="Adding…">
                  {compact ? null : 'Adding…'}
                </Button>
              ) : addItems.length > 1 ? (
                <OverflowMenu
                  label="Add pictures to this roll"
                  items={addItems}
                  trigger={{ text: compact ? null : 'Add', icon: Icons.plus, variant: newPhotos.length > 0 ? 'primary' : 'default' }}
                />
              ) : addItems[0] ? (
                <Button
                  icon={Icons.plus}
                  onClick={addItems[0].onSelect}
                  aria-label={compact ? addButtonLabel[addItems[0].id] : undefined}
                  title={compact ? addButtonLabel[addItems[0].id] : undefined}
                >
                  {compact ? null : addButtonLabel[addItems[0].id]}
                </Button>
              ) : null}
            </>
          }
        >
          <span className="min-w-0 flex-1">
            <RollTitle
              name={roll.name}
              size={compact ? 'md' : 'lg'}
              onRename={(name) => update((r) => ({ ...r, name, updatedAt: Date.now() }))}
            />
          </span>
        </PageBar>
      )}

      {!open ? (
        <EmptyState
          title="No pictures on this roll yet"
          actions={
            <>
              {connection && (
                <Button variant="primary" onClick={() => setPickingDay(true)}>
                  {dayLabel}
                </Button>
              )}
              <Button variant={connection ? 'default' : 'primary'} onClick={() => void addFolder()}>
                Add a folder…
              </Button>
              {newPhotos.length > 0 && (
                <Button variant="default" onClick={() => void addSelected()}>
                  {addLabel}
                </Button>
              )}
            </>
          }
        >
          Pick a day on your Winnow, a folder of your own, or drop photographs and clips here. The roll
          keeps a reference to each and its own numbers, never a copy of the file.
        </EmptyState>
      ) : (
        // The container is the wrapper and the queried grid its CHILD: a
        // container cannot query its own size (`frontend.md`, the Library eats
        // width a viewport query cannot see).
        <div className="@container flex-1 min-h-0 flex flex-col">
          <div
            ref={columnRef}
            className={
              compact
                ? 'flex-1 min-h-0 flex flex-col gap-2'
                : focus
                  ? 'flex-1 min-h-0 grid grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto] gap-y-2'
                  : // The band standing beside the stage is a column of its own
                    // (sized by its content: the band's own width), both rows tall;
                    // the status lines then sit under the stage in row 2.
                    left
                    ? 'flex-1 min-h-0 grid grid-cols-[auto_minmax(0,1fr)_22rem] @max-[880px]:grid-cols-[auto_minmax(0,1fr)_18rem] grid-rows-[minmax(0,1fr)_auto] gap-x-4'
                    : side
                      ? 'flex-1 min-h-0 grid grid-cols-[minmax(0,1fr)_auto_22rem] @max-[880px]:grid-cols-[minmax(0,1fr)_auto_18rem] grid-rows-[minmax(0,1fr)_auto] gap-x-4'
                      : 'flex-1 min-h-0 grid grid-cols-[minmax(0,1fr)_22rem] @max-[880px]:grid-cols-[minmax(0,1fr)_18rem] grid-rows-[minmax(0,1fr)_auto] gap-x-4 gap-y-2'
            }
          >
            <PictureWorkbench
              key={open.id}
              picture={open}
              file={files.get(open.id) ?? null}
              stack={stack}
              compact={compact}
              sheetOpen={sheetOpen}
              onSheetOpen={setSheetOpen}
              tab={tabs.some((t) => t.id === tab) ? tab : 'adjust'}
              tabs={tabs}
              onTabChange={setTab}
              brush={brush}
              onBrush={patchBrush}
              repairTool={repairTool}
              onRepairTool={patchRepairTool}
              applyTo={applyTo}
              lookApplyTo={lookApplyTo}
              cropApplyTo={cropApplyTo}
              borderApplyTo={borderApplyTo}
              onBorder={(border) => handleBorder(open.id, border)}
              onDevelop={(develop, via) => handleDevelop(open.id, develop, via)}
              onFraming={(framing, via) => handleFraming(open.id, framing, via)}
              onKeystone={(keystone, via) => handleKeystone(open.id, keystone, via)}
              onLens={(lens) => handleLens(open.id, lens)}
              onLensProfile={(profile) => handleLensProfile(open.id, profile)}
              onDetail={(detail, via) => handleDetail(open.id, detail, via)}
              onVignette={(vignette) => handleVignette(open.id, vignette)}
              onRepair={(repair) => handleRepair(open.id, repair)}
              onLayers={(layers) => handleLayers(open.id, layers)}
              onAspect={(aspect, via) => handleAspect(open.id, aspect, via)}
              onRendition={(rendition) => handleRendition(open.id, rendition)}
              rollChoice={roll.opensOn ?? null}
              onRollChoice={handleRollChoice}
              rollPhotos={rollPhotos}
              siblings={openSiblings}
              exportSettings={roll.export}
              onExportSettings={handleExportSettings}
              proxiesOnly={proxiesOnly}
              onProxiesOnly={setProxiesOnly}
              exports={exports}
              exportVerbs={exportVerbs}
              onSnapshot={(blob, aspect) => handleSnapshot(open.id, blob, aspect)}
              onStep={step}
              neighbours={deckNeighbours}
              still={deckStill}
              onDeliver={(action) => (selecting && selectedIds.length > 0 ? deliverSelection(action) : handleDeliver(open.id, action))}
              selecting={selecting}
              onSelectMode={() => (selecting ? stopSelecting() : startSelecting())}
              onSelectAll={selectAll}
              onBand={toggleFolded}
              onThumbs={stepThumbs}
              onSheet={toggleSheet}
              focused={focus}
              onFocusMode={toggleFocus}
              columns={side && !focus ? (left ? { stage: 2, panel: 3 } : { stage: 1, panel: 3 }) : undefined}
              onEscape={() => {
                // In order: the selection, then the sheet, then the focus — each one step back.
                if (selecting) {
                  stopSelecting();
                  return true;
                }
                if (contactOpen) {
                  setContactOpen(false);
                  return true;
                }
                if (focus) {
                  setFocus(false);
                  return true;
                }
                return false;
              }}
              onWords={(words) => handleWords(open.id, words)}
              onSettings={() => setSettingsOpen(true)}
              timelapseOpen={timelapseOpen}
              onTimelapseOpen={setTimelapseOpen}
              onMakingOf={(change) => handleMakingOf(open.id, change)}
              onVariant={() => makeVariant('clone')}
              onLook={(look) => update((r) => copyGradeTo(r, [open.id], look))}
              clipboard={clip}
              onCopy={copyPicture}
              onPaste={pastePicture}
              deliveryTable={
                <DeliveryTable
                  pictures={roll.pictures}
                  openId={openId}
                  lines={exports.lines}
                  thumbs={thumbs}
                  onDeliver={handleDeliver}
                  onDeliverAll={handleDeliverAll}
                  onOpen={onOpenPicture}
                  marks={exportMarks}
                  culling={culling.reachable ? culling.byPicture : undefined}
                />
              }
              emptyText={availabilityText(open.ref.name, availability.get(open.id))}
            />
            {side && statusLines}
            <div
              ref={bandRef}
              className={
                focus
                  ? 'hidden'
                  : compact
                    ? 'flex flex-col gap-1 min-w-0 flex-none'
                    : side
                      ? `flex min-w-0 min-h-0 ${left ? 'col-start-1' : 'col-start-2'} row-start-1 row-span-2`
                      : 'flex flex-col gap-1 min-w-0 col-start-1 row-start-2'
              }
            >
              {!side && statusLines}
              {/* V4: the band is the run's queue — each cell marked, and the
                  run's own hairline along its top (`TaskEdge`, the run's scope). */}
              <div className={side ? `relative flex-1 min-h-0 min-w-0 flex ${left ? 'flex-row-reverse' : 'flex-row'}` : 'relative flex-none flex flex-col'}>
                {/* The grip: the band's size by a drag, its rail by a
                    double-click (`BandGrip`); gone with a phone's drawer up,
                    where the band is one fixed row. Beside the stage it is
                    the band's edge that faces the picture. */}
                {!drawerBand && (
                  <BandGrip axis={side ? 'x' : 'y'} size={stripMetrics.grip} label="Resize the band" onDrag={onGripDrag} onEnd={onGripEnd} onToggle={toggleFolded} />
                )}
                <div className={side ? 'relative min-h-0 h-full' : 'relative'}>
                  <TaskEdge scope={runScope(roll.id)} edge="top" />
                  <RollBand
                    pictures={roll.pictures}
                    run={exports.progress}
                    openId={openId}
                    selectedIds={visibleSelected}
                    thumbs={thumbs}
                    aspects={thumbAspects}
                    availability={availability}
                    remoteThumb={remoteThumb}
                    kind={stripKind}
                    place={side ? strip.place : 'bottom'}
                    size={bandSizeNow}
                    folded={!drawerBand && strip.folded}
                    thumb={strip.thumb}
                    header={drawerBand ? null : bandHeader}
                    selecting={selecting}
                  onOpen={(id) => onOpenPicture(id)}
                  onSelectClick={handleSelectClick}
                  onPress={startSelecting}
                  onSelect={startSelecting}
                    onRemove={(p) => removeAsked([p.id])}
                    onDeliver={handleDeliver}
                    onVariant={(id) => makeVariantOf(id, 'clone')}
                    hideIgnored={!showIgnored}
                    culling={culling.byPicture}
                    rollChoice={roll.opensOn ?? null}
                    shows={filtering ? passesFilter : undefined}
                    heldId={copied?.from.id ?? null}
                    written={written}
                  />
                </div>
              </div>
            </div>
            {contactOpen && (
              <ContactSheet
                compact={compact}
                span={side ? 2 : 1}
                pictures={roll.pictures}
                run={exports.progress}
                openId={openId}
                selectedIds={visibleSelected}
                thumbs={thumbs}
                aspects={thumbAspects}
                availability={availability}
                remoteThumb={remoteThumb}
                kind={stripKind}
                selecting={selecting}
                thumb={strip.sheet}
                onSize={(px) => patchStrip({ sheet: px })}
                filter={filterChip}
                bar={selecting ? <SelectionBar compact={compact} dense={bandBox.width < 800} verbs={selectionVerbs} /> : null}
                onSelecting={() => startSelecting()}
                onClose={() => setContactOpen(false)}
                onOpen={(id) => {
                  onOpenPicture(id);
                  setContactOpen(false);
                }}
                onSelectClick={handleSelectClick}
                onPress={startSelecting}
                onSelect={startSelecting}
                onRemove={(p) => removeAsked([p.id])}
                onDeliver={handleDeliver}
                onVariant={(id) => makeVariantOf(id, 'clone')}
                hideIgnored={!showIgnored}
                culling={culling.byPicture}
                rollChoice={roll.opensOn ?? null}
                shows={filtering ? passesFilter : undefined}
                heldId={copied?.from.id ?? null}
                written={written}
              />
            )}
          </div>
        </div>
      )}

      {pickingDay && connection && client && (
        <RollPicker
          connection={connection}
          client={client}
          rollName={roll.name}
          day={initialDay}
          rollSpan={rollSpan}
          held={heldRefs}
          onAdd={addRefs}
          onClose={() => setPickingDay(false)}
        />
      )}

      {settingsOpen && open && (
        <SettingsSheet
          picture={open}
          copied={copied}
          selectedIds={selectionTargets.filter((id) => !roll.pictures.find((p) => p.id === id && isIgnored(p)))}
          otherIds={otherIds}
          onCopy={copySectionsOf}
          onPaste={() => void pasteSections()}
          onApply={applySectionsTo}
          onReset={resetSectionsOf}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {deviceSettingsOpen && <DevelopSettingsSheet onClose={closeDevelopSettings} />}
      {confirmRemove && removing.length > 0 && (
        <ConfirmDialog
          title={removing.length === 1 ? `Take ${pictureLabel(removing[0])} off the roll?` : `Take ${removing.length} pictures off the roll?`}
          confirmLabel="Remove"
          danger
          onCancel={() => setConfirmRemove(null)}
          onConfirm={() => {
            removeMany(confirmRemove);
            setConfirmRemove(null);
          }}
        >
          <p>
            {removing.length === 1
              ? `What was done to it goes with it — ${pictureEdits(removing[0]).join(', ')}. The file stays where it is.`
              : `What was done to them goes with them — ${removing.filter(isEdited).length} of them carry work. The files stay where they are.`}
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}

/**
 * The roll's name on the bar, renamed in place — the trip title's rule: an
 * emptied field gives the old name back rather than saving a blank.
 */
function RollTitle({
  name,
  onRename,
  size = 'lg',
}: {
  name: string;
  onRename: (name: string) => void;
  /** `md` in a phone's one-row bar, `lg` as a wide screen's heading. */
  size?: 'lg' | 'md';
}) {
  const face = size === 'lg' ? 'text-2xl' : 'text-xl';
  const [draft, setDraft] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const editing = draft !== null;
  useEffect(() => {
    if (editing) inputRef.current?.select();
    // Select on entry only, so typing replaces a name rather than appending.
  }, [editing]);

  function commit() {
    const next = (draft ?? '').trim();
    if (next && next !== name) onRename(next);
    setDraft(null);
  }

  if (draft !== null) {
    return (
      <input
        ref={inputRef}
        value={draft}
        aria-label="Roll name"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            e.stopPropagation();
            setDraft(null);
          }
        }}
        className={`w-full min-w-0 max-w-[28rem] font-serif ${face} leading-tight px-1.5 py-0.5 border border-line-strong rounded-control bg-paper text-ink focus:outline-none focus:border-accent`}
      />
    );
  }
  return (
    <h1 className="m-0 min-w-0 max-w-[28rem]">
      <button
        type="button"
        onClick={() => setDraft(name)}
        title="Rename the roll"
        className={`w-full p-0 border-0 bg-transparent font-serif ${face} leading-tight text-ink text-left truncate cursor-text hover:text-accent-ink`}
      >
        {name || 'Untitled roll'}
      </button>
    </h1>
  );
}

/** The instance named by the first picture in `kind`, for a status line. */
function availabilityHost(availability: ReadonlyMap<string, PictureAvailability>, kind: 'fetching'): string {
  for (const a of availability.values()) {
    if (a.kind === kind) return a.sourceId;
  }
  return 'its instance';
}
