import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { DevelopApplyVerb } from '../../shared/develop/develop-host';
import { isDefaultDevelop, type DevelopSettings } from '../../shared/develop/develop';
import { hasCopiedDevelop, pasteDevelop, subscribeDevelopClipboard } from '../../shared/develop/develop-clipboard';
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
import { availabilityText, summarizeAvailability, type PictureAvailability } from '../../shared/develop/roll-media';
import { deleteRollThumbs, getRollThumbs, putRollThumb } from '../../shared/develop/roll-store';
import { pictureThumbnail } from '../../shared/develop/roll-thumb';
import {
  addPictures,
  patchPicture,
  removePictures,
  rollProgress,
  sameMediaRef,
  type RollDoc,
  type RollExport,
  type RollPicture,
} from '../../shared/develop/roll-types';
import { useAssetLibrary } from '../../shared/library/AssetLibraryContext';
import { hashedMediaRefs } from '../../shared/projects/media-identity';
import { usePublishMediaActions, type MediaActions } from '../../shared/sources/media-scope';
import Button from '../../shared/ui/Button';
import ConfirmDialog from '../../shared/ui/ConfirmDialog';
import EmptyState from '../../shared/ui/EmptyState';
import PageBar from '../../shared/ui/PageBar';
import { Icons } from '../../shared/ui/icons';
import { usePublishSectionBar } from '../../shared/ui/section-rail';
import { useIsCompact } from '../../shared/ui/use-layout-mode';
import type { ExportVerb } from './ExportPanel';
import Filmstrip from './Filmstrip';
import PictureWorkbench from './PictureWorkbench';
import { useRollExport } from './use-roll-export';
import { useRollGrade } from './use-roll-grade';
import { useRollMedia } from './use-roll-media';

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
  // Which inspector tab is open — kept here, not in the workbench, so it
  // survives stepping to another picture (the workbench remounts per picture).
  const [tab, setTab] = useState<WorkbenchTab>('develop');

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
  const stack = useRollGrade(roll, update);

  const openId = openPictureId(roll.pictures, pictureId);
  const open = openId ? (roll.pictures.find((p) => p.id === openId) ?? null) : null;
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
  const { files, availability, fileFor, retryFailed, remoteThumb } = useRollMedia({
    pictures: roll.pictures,
    openId,
    libraryPhotos,
  });
  const reach = summarizeAvailability(
    roll.pictures.map((p) => p.id),
    availability,
  );

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
  const [pendingAdd, setPendingAdd] = useState(0);
  const activeFile = useMemo(() => {
    const a = lib.assets.find((x) => x.id === lib.activeId);
    return a?.kind === 'photo' && a.parts.image ? a.parts.image : null;
  }, [lib.assets, lib.activeId]);
  useEffect(() => {
    if (pendingAdd === 0) return;
    setPendingAdd(0);
    if (!activeFile) {
      setNotice('only a photograph can be developed');
      return;
    }
    void (async () => {
      const [ref] = await hashedMediaRefs([activeFile]);
      // Never added twice: a picture already on the roll is opened instead.
      update((r) => addPictures(r, [ref]));
      const found = latest.current.pictures.find((p) => sameMediaRef(p.ref, ref));
      if (found) onOpenPicture(found.id);
    })();
  }, [pendingAdd, activeFile, update, onOpenPicture]);
  const offer = useMemo<MediaActions>(
    () => ({
      heading: `Develop on ${roll.name || 'this roll'}`,
      actions: [
        {
          id: 'develop',
          label: 'Develop',
          hint: 'add this picture to the roll and open it — one already on the roll is opened, never added twice',
          run: () => setPendingAdd((n) => n + 1),
        },
      ],
    }),
    [roll.name],
  );
  usePublishMediaActions(offer);

  // --- verbs ----------------------------------------------------------------
  async function addSelected() {
    if (selectedPhotos.length === 0) return;
    setAdding(true);
    setNotice(null);
    try {
      const refs = await hashedMediaRefs(selectedPhotos);
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

  function remove(picture: RollPicture) {
    const nextOpen = openAfterRemoval(latest.current.pictures, picture.id, openId);
    update((r) => removePictures(r, [picture.id]));
    void deleteRollThumbs([picture.id]);
    if (nextOpen !== openId) onOpenPicture(nextOpen);
  }

  const step = useCallback(
    (by: number) => {
      const next = stepPicture(latest.current.pictures, openIdRef.current, by);
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
  const handleAspect = useCallback(
    (id: string, aspect: string) => update((r) => patchPicture(r, id, { aspect })),
    [update],
  );
  const handleExportSettings = useCallback(
    (patch: Partial<RollExport>) => update((r) => ({ ...r, export: { ...r.export, ...patch }, updatedAt: Date.now() })),
    [update],
  );

  // --- the still export (D9): each picture through its own cube --------------
  const { composeWith } = stack;
  const lutFor = useCallback((p: RollPicture) => composeWith(p.develop), [composeWith]);
  const exports = useRollExport({ roll, files, fileFor, openId, lutFor });
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
    if (roll.pictures.length > 1) {
      verbs.push({
        id: 'roll',
        label: `Export the roll · ${roll.pictures.length}`,
        hint: 'every picture on the roll, in the strip’s order',
        run: () => void exportPictures(roll.pictures.map((p) => p.id)),
      });
    }
    return verbs;
  }, [openId, visibleSelected, roll.pictures, exportPictures]);

  const writeDevelopTo = useCallback(
    (targets: readonly string[], develop: DevelopSettings | null) =>
      update((r) => ({
        ...r,
        pictures: r.pictures.map((p) => (targets.includes(p.id) ? { ...p, develop: develop ? { ...develop } : null } : p)),
        updatedAt: Date.now(),
      })),
    [update],
  );
  const canPaste = useSyncExternalStore(subscribeDevelopClipboard, hasCopiedDevelop);
  const others = roll.pictures.length - 1;
  const applyTo = useMemo<DevelopApplyVerb[]>(() => {
    if (!openId) return [];
    if (selectionTargets.length > 0) {
      const n = selectionTargets.length;
      const verbs: DevelopApplyVerb[] = [
        {
          id: 'selection',
          label: `Apply to ${n} selected`,
          hint: 'the pictures marked in the filmstrip, each as its own copy',
          run: (settings: DevelopSettings) => writeDevelopTo(selectionTargets, isDefaultDevelop(settings) ? null : settings),
        },
      ];
      if (canPaste) {
        verbs.push({
          id: 'paste-selection',
          label: `Paste to ${n} selected`,
          hint: 'the copied numbers, written onto each marked picture',
          run: () => {
            const pasted = pasteDevelop();
            if (pasted) writeDevelopTo(selectionTargets, isDefaultDevelop(pasted) ? null : pasted);
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
          writeDevelopTo(
            roll.pictures.filter((p) => p.id !== openId).map((p) => p.id),
            isDefaultDevelop(settings) ? null : settings,
          ),
      },
    ];
  }, [openId, others, roll.pictures, selectionTargets, canPaste, writeDevelopTo]);

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
  const addLabel = selectedPhotos.length === 0 ? 'Add from Library' : `Add ${selectedPhotos.length} selected`;

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-2">
      <PageBar
        back={{ label: 'Rolls', onClick: onBack }}
        trailing={
          <>
            {headerExtra}
            <Button
              variant={roll.pictures.length === 0 ? 'primary' : 'default'}
              icon={Icons.plus}
              onClick={() => void addSelected()}
              disabled={selectedPhotos.length === 0 || adding}
              title={
                selectedPhotos.length === 0
                  ? 'Tick photos in the Library first — they are added here in that order'
                  : 'Add the photos ticked in the Library; a picture already on the roll is not added twice'
              }
            >
              {adding ? 'Adding…' : addLabel}
            </Button>
          </>
        }
      >
        <RollTitle name={roll.name} onRename={(name) => update((r) => ({ ...r, name, updatedAt: Date.now() }))} />
      </PageBar>

      {!open ? (
        <EmptyState
          title="No pictures on this roll yet"
          actions={
            <Button variant="primary" onClick={() => void addSelected()} disabled={selectedPhotos.length === 0}>
              {addLabel}
            </Button>
          }
        >
          Tick the photos you mean to develop in the Library — a folder, or a day on your Winnow — then add
          them here. The roll keeps a reference to each and its own numbers, never a copy of the file.
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
              applyTo={applyTo}
              onDevelop={(develop) => handleDevelop(open.id, develop)}
              onFraming={(framing) => handleFraming(open.id, framing)}
              onAspect={(aspect) => handleAspect(open.id, aspect)}
              exportSettings={roll.export}
              onExportSettings={handleExportSettings}
              exports={exports}
              exportVerbs={exportVerbs}
              onSnapshot={(blob) => handleSnapshot(open.id, blob)}
              onStep={step}
              emptyText={availabilityText(open.ref.name, availability.get(open.id))}
            />
            <div className={`flex flex-col gap-1 min-w-0 ${compact ? 'flex-none' : 'col-start-1 row-start-2'}`}>
              <p className="m-0 font-mono text-2xs text-muted tabular-nums">
                {progress.developed} of {progress.total} developed
                {roll.grade && <span className="text-faint"> · the roll has a look</span>}
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
                {reach.local > 0 && (
                  <span className="text-ink-soft">
                    {' '}
                    · {reach.local} from this computer, not open
                  </span>
                )}
                {notice && <span className="text-ink-soft"> · {notice}</span>}
                {!compact && (
                  <span className="text-faint">
                    {' '}
                    · ←/→ picture · {'\\'} before · Z closer · R crop · D develop · Shift/⌘-click to select
                  </span>
                )}
              </p>
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
                onRemove={(p) => (p.develop || p.framing ? setConfirmRemove(p) : remove(p))}
              />
            </div>
          </div>
        </div>
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
          <p>Its develop goes with it. The file stays where it is.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

/**
 * The roll's name on the bar, renamed in place — the trip title's rule: an
 * emptied field gives the old name back rather than saving a blank.
 */
function RollTitle({ name, onRename }: { name: string; onRename: (name: string) => void }) {
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
        className="w-full min-w-0 max-w-[28rem] font-serif text-2xl leading-tight px-1.5 py-0.5 border border-line-strong rounded-control bg-paper text-ink focus:outline-none focus:border-accent"
      />
    );
  }
  return (
    <h1 className="m-0 min-w-0 max-w-[28rem]">
      <button
        type="button"
        onClick={() => setDraft(name)}
        title="Rename the roll"
        className="w-full p-0 border-0 bg-transparent font-serif text-2xl leading-tight text-ink text-left truncate cursor-text hover:text-accent-ink"
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
