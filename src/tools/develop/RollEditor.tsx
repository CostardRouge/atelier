import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { DevelopApplyVerb } from '../../shared/develop/develop-host';
import { DEFAULT_DEVELOP, isDefaultDevelop, isRawDevelop, withoutBase, type DevelopSettings } from '../../shared/develop/develop';
import { hasCopiedDevelop, pasteDevelop, subscribeDevelopClipboard } from '../../shared/develop/develop-clipboard';
import type { Keystone } from '../../shared/render/geometry';
import type { LensCorrection } from '../../shared/render/lens';
import type { DetailSettings } from '../../shared/render/detail';
import type { Patch } from '../../shared/render/repair';
import type { AdjustLayer } from '../../shared/develop/layer';
import type { Framing } from '../../shared/media/framing';
import {
  WORKBENCH_TABS,
  openAfterRemoval,
  openPictureId,
  sameDevelop,
  selectionAfterClick,
  stepPicture,
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
import { deleteRollThumbs, getRollThumbs, putRollThumb } from '../../shared/develop/roll-store';
import { WORKING_PREVIEW_ESTIMATE_BYTES } from '../../shared/develop/working-preview';
import { formatBytes } from '../../shared/lib/format';
import { pictureThumbnail } from '../../shared/develop/roll-thumb';
import {
  addPictures,
  copyBorderTo,
  copyCropTo,
  copyGradeTo,
  delivers,
  isEdited,
  isIgnored,
  setDelivery,
  toggledDelivery,
  patchPicture,
  pictureEdits,
  removePictures,
  rollProgress,
  sameMediaRef,
  type RollDoc,
  type RollExport,
  type RollPicture,
} from '../../shared/develop/roll-types';
import { useAssetLibrary } from '../../shared/library/AssetLibraryContext';
import { fileBaseName } from '../../shared/library/assets';
import { hashedMediaRefs, mediaOrigin } from '../../shared/projects/media-identity';
import type { SavedMediaRef } from '../../shared/projects/project-types';
import { dropDirectoryHandles, filesFromDataTransfer } from '../../shared/sources/file-sources';
import { useWinnowConnection } from '../../shared/sources/winnow/use-connection';
import { usePublishMediaActions, type MediaActions, type MediaView } from '../../shared/sources/media-scope';
import Button from '../../shared/ui/Button';
import ConfirmDialog from '../../shared/ui/ConfirmDialog';
import EmptyState from '../../shared/ui/EmptyState';
import OverflowMenu, { type OverflowItem } from '../../shared/ui/OverflowMenu';
import PageBar from '../../shared/ui/PageBar';
import { Icons } from '../../shared/ui/icons';
import { usePublishSectionBar } from '../../shared/ui/section-rail';
import { useIsCompact } from '../../shared/ui/use-layout-mode';
import type { ExportVerb } from './ExportPanel';
import Filmstrip from './Filmstrip';
import type { CropApplyVerb } from './CropPanel';
import type { BorderApplyVerb } from './BorderSection';
import type { RollBorder } from '../../shared/develop/border-layout';
import PictureWorkbench, { DEFAULT_BRUSH_TOOL, type BrushTool, type DeliverAction, type LookApplyVerb } from './PictureWorkbench';
import { DEFAULT_REPAIR_TOOL, type RepairTool } from './RepairPanel';
import { useLutInterpolation } from '../../shared/lut/use-lut-interpolation';
import { useRollExport } from './use-roll-export';
import { useRollGrade } from './use-roll-grade';
import { useRollFolders } from './use-roll-folders';
import { useRollMedia } from './use-roll-media';
import { useRollPreviews } from './use-roll-previews';
import WinnowDaySheet from './WinnowDaySheet';

/** One empty answer, so a memo keyed on it holds. */
const NO_SIBLINGS: readonly File[] = [];

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
export default function RollEditor({ roll, pictureId, onBack, onChange, onOpenPicture, headerExtra }: RollEditorProps) {
  const lib = useAssetLibrary();
  const compact = useIsCompact();
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<RollPicture | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pickingDay, setPickingDay] = useState(false);
  const { connection } = useWinnowConnection();
  // Which inspector tab is open — kept here, not in the workbench, so it
  // survives stepping to another picture (the workbench remounts per picture).
  const [tab, setTab] = useState<WorkbenchTab>('adjust');
  // The brush and the heal disc are TOOLS, not the picture's: held here with
  // the tab, so the size set on one picture is the size on the next.
  const [brush, setBrush] = useState<BrushTool>({ ...DEFAULT_BRUSH_TOOL });
  const [repairTool, setRepairTool] = useState<RepairTool>({ ...DEFAULT_REPAIR_TOOL });
  const patchBrush = useCallback((patch: Partial<BrushTool>) => setBrush((b) => ({ ...b, ...patch })), []);
  const patchRepairTool = useCallback((patch: Partial<RepairTool>) => setRepairTool((t) => ({ ...t, ...patch })), []);

  const latest = useRef(roll);
  latest.current = roll;
  const update = useCallback(
    (change: (r: RollDoc) => RollDoc) => {
      const next = change(latest.current);
      if (next === latest.current) return;
      latest.current = next;
      onChange(next);
    },
    [onChange],
  );
  const openId = openPictureId(roll.pictures, pictureId);
  const open = openId ? (roll.pictures.find((p) => p.id === openId) ?? null) : null;
  // The look is the OPEN picture's (roll v5): the stack follows the strip.
  const stack = useRollGrade(open, update);
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
    },
    [anchor],
  );
  const selectionTargets = useMemo(
    () => [...visibleSelected].filter((id) => id !== openId),
    [visibleSelected, openId],
  );

  // --- the Library's photos, and where each picture's bytes are ------------
  const libraryPhotos = useMemo(
    () => lib.assets.filter((a) => a.kind === 'photo' && a.parts.image).map((a) => a.parts.image!),
    [lib.assets],
  );
  const selectedPhotos = useMemo(
    () =>
      lib.assets
        .filter((a) => lib.selection.has(a.id) && a.kind === 'photo' && a.parts.image)
        .map((a) => a.parts.image!),
    [lib.assets, lib.selection],
  );
  // The Library's file when it holds the picture, else the roll's own fetch
  // from the instance its ref names — never a trip through the sidebar.
  // A local picture is found in the Library OR in the folders the roll
  // remembers and the files dropped on it (F4) — the same name-then-hash match.
  const folders = useRollFolders(roll.id);
  const localPhotos = useMemo(() => [...libraryPhotos, ...folders.photos], [libraryPhotos, folders.photos]);
  // The capture files BESIDE the local photographs — a JPEG's DNG, an ARW's
  // HIF (`AssetParts.siblings`, R2): the workbench offers them as the open
  // picture's other renditions, found by base name. A LOCAL picture's only:
  // a file an instance handed over has its own companion (`MediaOrigin`).
  const localSiblings = useMemo(
    () => [...lib.assets.flatMap((a) => (a.kind === 'photo' ? (a.parts.siblings ?? []) : [])), ...folders.siblings],
    [lib.assets, folders.siblings],
  );
  const media = useRollMedia({ pictures: roll.pictures, openId, localPhotos });
  const { retryFailed, remoteThumb } = media;
  // A local picture whose file is away is developed from its working preview
  // when the roll keeps them (F5); the real file always wins.
  const previews = useRollPreviews({ rollId: roll.id, pictures: roll.pictures, realFiles: media.files });
  const files = useMemo(() => {
    const out = new Map(media.files);
    for (const [id, file] of previews.files) if (!out.has(id)) out.set(id, file);
    return out;
  }, [media.files, previews.files]);
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
  const localCount = roll.pictures.filter((p) => !p.ref.assetId).length;
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
    void hashedMediaRefs(selectedPhotos).then((refs) => {
      if (!alive) return;
      const held = latest.current.pictures;
      setNewPhotos(selectedPhotos.filter((_, i) => !held.some((p) => sameMediaRef(p.ref, refs[i]))));
    });
    return () => {
      alive = false;
    };
  }, [selectedPhotos, pictureKey]);

  // --- thumbnails: stored, else baked as shot; the open one redraws graded --
  const [thumbs, setThumbs] = useState<ReadonlyMap<string, Blob>>(new Map());
  const thumbsRef = useRef(thumbs);
  thumbsRef.current = thumbs;
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const idsKey = roll.pictures.map((p) => p.id).join('|');
  useEffect(() => {
    let alive = true;
    void getRollThumbs(latest.current.pictures.map((p) => p.id)).then((stored) => {
      if (!alive) return;
      setThumbs((cur) => new Map([...cur, ...stored]));
      setLoadedFor(idsKey);
    });
    return () => {
      alive = false;
    };
  }, [idsKey]);

  /** Tried once per picture per visit, so a file the browser cannot decode is not retried on every render. */
  const tried = useRef(new Set<string>());
  useEffect(() => {
    if (loadedFor !== idsKey) return;
    const due = latest.current.pictures.filter(
      (p) => files.has(p.id) && !thumbsRef.current.has(p.id) && !tried.current.has(p.id),
    );
    if (due.length === 0) return;
    let alive = true;
    void (async () => {
      // One decode at a time: a roll of big stills never holds two at once.
      for (const p of due) {
        if (!alive) return;
        tried.current.add(p.id);
        // The open picture draws its own, graded, from the stage.
        if (p.id === openIdRef.current) continue;
        const blob = await pictureThumbnail(files.get(p.id)!);
        if (!blob || thumbsRef.current.has(p.id)) continue;
        await putRollThumb(p.id, blob);
        setThumbs((cur) => new Map(cur).set(p.id, blob));
      }
    })();
    return () => {
      alive = false;
    };
  }, [files, loadedFor, idsKey]);

  const handleSnapshot = useCallback((id: string, blob: Blob) => {
    tried.current.add(id);
    void putRollThumb(id, blob);
    setThumbs((cur) => new Map(cur).set(id, blob));
  }, []);

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
  const activeFile = useMemo(() => {
    const a = lib.assets.find((x) => x.id === lib.activeId);
    return a?.kind === 'photo' && a.parts.image ? a.parts.image : null;
  }, [lib.assets, lib.activeId]);
  useEffect(() => {
    if (pendingAdd === 0) return;
    setPendingAdd(0);
    const view = pendingView.current;
    pendingView.current = null;
    if (!activeFile) {
      setNotice('only a photograph can be developed');
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
      setNotice('no photographs in what was given');
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

  function remove(picture: RollPicture) {
    const nextOpen = openAfterRemoval(latest.current.pictures, picture.id, openId);
    update((r) => removePictures(r, [picture.id]));
    void deleteRollThumbs([picture.id]);
    previews.forget([picture.id]);
    if (nextOpen !== openId) onOpenPicture(nextOpen);
  }

  const step = useCallback(
    (by: number) => {
      // The arrows walk the roll's WORK: an ignored picture is stepped over.
      const next = stepPicture(latest.current.pictures, openIdRef.current, by, isIgnored);
      if (next && next !== openIdRef.current) onOpenPicture(next);
    },
    [onOpenPicture],
  );

  const handleDevelop = useCallback(
    (id: string, develop: DevelopSettings | null) =>
      update((r) => {
        const p = r.pictures.find((x) => x.id === id);
        return !p || sameDevelop(p.develop, develop) ? r : patchPicture(r, id, { develop });
      }),
    [update],
  );

  const handleFraming = useCallback(
    (id: string, framing: Framing | null) => update((r) => patchPicture(r, id, { framing })),
    [update],
  );
  const handleKeystone = useCallback(
    (id: string, keystone: Keystone | null) => update((r) => patchPicture(r, id, { keystone })),
    [update],
  );
  const handleRepair = useCallback(
    (id: string, repair: Patch[]) => update((r) => patchPicture(r, id, { repair })),
    [update],
  );
  const handleDetail = useCallback(
    (id: string, detail: DetailSettings | null) => update((r) => patchPicture(r, id, { detail })),
    [update],
  );
  const handleLens = useCallback(
    (id: string, lens: LensCorrection | null) => update((r) => patchPicture(r, id, { lens })),
    [update],
  );
  const handleLayers = useCallback(
    (id: string, layers: AdjustLayer[]) => update((r) => patchPicture(r, id, { layers })),
    [update],
  );
  const handleAspect = useCallback(
    (id: string, aspect: string) => update((r) => patchPicture(r, id, { aspect })),
    [update],
  );
  const handleRendition = useCallback(
    (id: string, rendition: string | null) => update((r) => patchPicture(r, id, { rendition })),
    [update],
  );
  const handleBorder = useCallback(
    (id: string, border: RollBorder | null) => update((r) => copyBorderTo(r, [id], border)),
    [update],
  );
  // The delivery keys, answered from the roll as it stands (the state depends on
  // whether the picture is edited), and said in the status line.
  const handleDeliver = useCallback(
    (id: string, action: DeliverAction) => {
      const picture = latest.current.pictures.find((p) => p.id === id);
      if (!picture) return;
      const next =
        action === 'toggle' ? toggledDelivery(picture) : action === 'auto' ? 'auto' : isIgnored(picture) ? 'auto' : 'ignore';
      update((r) => setDelivery(r, [id], next));
      const after = { ...picture, deliver: next };
      setNotice(
        next === 'ignore'
          ? `${picture.ref.name} ignored — the arrows step over it`
          : `${picture.ref.name} ${delivers(after) ? 'will be exported' : 'stays out of the export'}${next === 'auto' ? ' (the roll’s rule)' : ''}`,
      );
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
  const exports = useRollExport({ roll, files, fileFor, openId, interpolation, siblingsOf: siblingsFor, proxiesOnly });
  const { exportPictures } = exports;
  const exportVerbs = useMemo<ExportVerb[]>(() => {
    if (!openId) return [];
    const verbs: ExportVerb[] = [
      { id: 'open', label: 'Export this picture', run: () => void exportPictures([openId]) },
    ];
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
    }
    return verbs;
  }, [openId, visibleSelected, roll.pictures, exportPictures]);

  const writeDevelopTo = useCallback(
    (targets: readonly string[], develop: DevelopSettings | null) => {
      // The NUMBERS travel, never the material: a base and its metered gain
      // are facts about the one picture they were measured on. A target's
      // own base is kept, so a batch onto a RAW keeps it on the RAW.
      const numbers = develop ? withoutBase(develop) : null;
      const value = numbers && !isDefaultDevelop(numbers) ? numbers : null;
      update((r) => ({
        ...r,
        pictures: r.pictures.map((p) => {
          if (!targets.includes(p.id)) return p;
          const own = p.develop && isRawDevelop(p.develop) ? { base: p.develop.base, rawGain: p.develop.rawGain } : null;
          return { ...p, develop: value || own ? { ...(value ?? DEFAULT_DEVELOP), ...(own ?? {}) } : null };
        }),
        updatedAt: Date.now(),
      }));
    },
    [update],
  );
  const canPaste = useSyncExternalStore(subscribeDevelopClipboard, hasCopiedDevelop);
  // "The others" are the pictures still in the roll's WORK: an ignored one is
  // never written by an Apply-to-all (`docs/lightroom-gaps.md` §10) — a picture
  // the author marked explicitly still is.
  const otherIds = useMemo(
    () => roll.pictures.filter((p) => p.id !== openId && !isIgnored(p)).map((p) => p.id),
    [roll.pictures, openId],
  );
  const others = otherIds.length;
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
            if (pasted) writeDevelopTo(selectionTargets, pasted);
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
    const write = (targets: readonly string[]) => (crop: { aspect: string; framing: Framing }) =>
      update((r) => copyCropTo(r, targets, crop));
    if (selectionTargets.length > 0) {
      const n = selectionTargets.length;
      return [
        {
          id: 'selection',
          label: `Apply crop to ${n} selected`,
          hint: 'the pictures marked in the filmstrip, each as its own copy',
          run: write(selectionTargets),
        },
      ];
    }
    if (others <= 0) return [];
    return [
      {
        id: 'roll',
        label: `Apply crop to ${others} other picture${others === 1 ? '' : 's'}`,
        hint: 'the rest of this roll, each as its own copy',
        run: write(otherIds),
      },
    ];
  }, [openId, others, otherIds, selectionTargets, update]);

  // The look's own verbs, apart from the develop's: a look is chosen per
  // picture, and this is the one gesture that dresses others with it. They
  // copy the open picture's STORED look, which the stack writes through.
  const lookApplyTo = useMemo<LookApplyVerb[]>(() => {
    if (!openId) return [];
    const write = (targets: readonly string[]) => () =>
      update((r) => copyGradeTo(r, targets, r.pictures.find((p) => p.id === openId)?.grade ?? null));
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
  }, [openId, others, otherIds, selectionTargets, update]);

  // The border's own verbs, apart from the crop's: a roll can wear ONE border
  // over crops that each differ (the maintainer's change to the prototype).
  const borderApplyTo = useMemo<BorderApplyVerb[]>(() => {
    if (!openId) return [];
    const write = (targets: readonly string[]) => (border: RollBorder | null) =>
      update((r) => copyBorderTo(r, targets, border));
    if (selectionTargets.length > 0) {
      const n = selectionTargets.length;
      return [
        {
          id: 'selection',
          label: `Apply borders to ${n} selected`,
          hint: 'the pictures marked in the filmstrip, their crops untouched',
          run: write(selectionTargets),
        },
      ];
    }
    if (others <= 0) return [];
    return [
      {
        id: 'roll',
        label: `Apply borders to ${others} other picture${others === 1 ? '' : 's'}`,
        hint: 'the whole roll, each keeping its own crop',
        run: write(otherIds),
      },
    ];
  }, [openId, others, otherIds, selectionTargets, update]);

  // On a phone the inspector is a sheet, opened from the shell's bottom bar;
  // picking a section is also what raises it — the Studio's own convention.
  usePublishSectionBar(
    useMemo(
      () =>
        compact && open
          ? {
              sections: WORKBENCH_TABS,
              active: sheetOpen ? tab : null,
              label: 'Develop inspector',
              onSelect: (id: string) => {
                setTab(id as WorkbenchTab);
                setSheetOpen(true);
              },
            }
          : null,
      [compact, open, sheetOpen, tab],
    ),
  );

  const progress = rollProgress(roll);
  const withLook = roll.pictures.filter((p) => p.grade).length;
  const leavingCount = roll.pictures.filter(delivers).length;
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
  ];
  const addButtonLabel: Record<string, string> = {
    library: addLabel,
    winnow: 'Add a day…',
    folder: 'Add a folder…',
  };
  const dayLabel = connection ? `Add a day from ${connection.id}` : '';
  const initialDay = pictureDay(open?.ref.lastModified ?? roll.pictures[roll.pictures.length - 1]?.ref.lastModified ?? 0);

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
            Drop photographs or their folder: pictures already on the roll are found again, the others are added.
          </p>
        </div>
      )}
      {/* On a phone the bar must hold ONE row — back, name, history, Add — or
          it wraps to two and the photograph pays ~50px for it: the back is its
          chevron, the name one step smaller, and Add is its glyph (the menu
          still names every way in). The Trips overview's bar, the same fix. */}
      <PageBar
        back={{ label: 'Rolls', onClick: onBack, iconOnly: compact }}
        trailing={
          <>
            {headerExtra}
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
          Pick a day on your Winnow, a folder of your own, or drop photographs here. The roll keeps a
          reference to each and its own numbers, never a copy of the file.
        </EmptyState>
      ) : (
        // The container is the wrapper and the queried grid its CHILD: a
        // container cannot query its own size (`frontend.md`, the Library eats
        // width a viewport query cannot see).
        <div className="@container flex-1 min-h-0 flex flex-col">
          <div
            className={
              compact
                ? 'flex-1 min-h-0 flex flex-col gap-2'
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
              tab={tab}
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
              onDevelop={(develop) => handleDevelop(open.id, develop)}
              onFraming={(framing) => handleFraming(open.id, framing)}
              onKeystone={(keystone) => handleKeystone(open.id, keystone)}
              onLens={(lens) => handleLens(open.id, lens)}
              onDetail={(detail) => handleDetail(open.id, detail)}
              onRepair={(repair) => handleRepair(open.id, repair)}
              onLayers={(layers) => handleLayers(open.id, layers)}
              onAspect={(aspect) => handleAspect(open.id, aspect)}
              onRendition={(rendition) => handleRendition(open.id, rendition)}
              siblings={openSiblings}
              exportSettings={roll.export}
              onExportSettings={handleExportSettings}
              proxiesOnly={proxiesOnly}
              onProxiesOnly={setProxiesOnly}
              exports={exports}
              exportVerbs={exportVerbs}
              onSnapshot={(blob) => handleSnapshot(open.id, blob)}
              onStep={step}
              onDeliver={(action) => handleDeliver(open.id, action)}
              emptyText={availabilityText(open.ref.name, availability.get(open.id))}
            />
            <div className={`flex flex-col gap-1 min-w-0 ${compact ? 'flex-none' : 'col-start-1 row-start-2'}`}>
              <p className="m-0 font-mono text-2xs text-muted tabular-nums">
                {progress.developed} of {progress.total} developed
                {leavingCount > 0 && <span className="text-faint"> · {leavingCount} to export</span>}
                {progress.ignored > 0 && <span className="text-faint"> · {progress.ignored} ignored</span>}
                {withLook > 0 && (
                  <span className="text-faint">
                    {' '}
                    · {withLook} with a look
                  </span>
                )}
                {visibleSelected.size > 0 && (
                  <span className="text-accent-ink">
                    {' '}
                    · {visibleSelected.size} selected{' '}
                    <button
                      type="button"
                      onClick={() => setSelected(new Set())}
                      className="underline underline-offset-2 cursor-pointer"
                    >
                      Clear
                    </button>
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
              <Filmstrip
                pictures={roll.pictures}
                openId={openId}
                selectedIds={visibleSelected}
                thumbs={thumbs}
                availability={availability}
                remoteThumb={remoteThumb}
                compact={compact}
                onOpen={(id) => onOpenPicture(id)}
                onSelectClick={handleSelectClick}
                onRemove={(p) => (isEdited(p) ? setConfirmRemove(p) : remove(p))}
              />
            </div>
          </div>
        </div>
      )}

      {pickingDay && (
        <WinnowDaySheet
          initialDay={initialDay}
          held={roll.pictures.map((p) => p.ref)}
          onCancel={() => setPickingDay(false)}
          onAdd={addRefs}
        />
      )}

      {confirmRemove && (
        <ConfirmDialog
          title={`Take ${confirmRemove.ref.name} off the roll?`}
          confirmLabel="Remove"
          danger
          onCancel={() => setConfirmRemove(null)}
          onConfirm={() => {
            remove(confirmRemove);
            setConfirmRemove(null);
          }}
        >
          <p>
            What was done to it goes with it — {pictureEdits(confirmRemove).join(', ')}. The file stays where it
            is.
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
