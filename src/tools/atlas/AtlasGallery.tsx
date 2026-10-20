import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAssetLibrary } from '../../shared/library/AssetLibraryContext';
import { selectedUsableAssets } from '../../shared/library/capabilities';
import { downloadBlob } from '../../shared/media/save';
import { useObjectUrl } from '../../shared/media/use-object-url';
import { pickFile } from '../../shared/sources/file-sources';
import { DEFAULT_SOURCE_ID, sourceById, type SourceInfo } from '../../shared/sources/source';
import { sourceLabel } from '../../shared/sources/document-gallery';
import { uniqueDocName } from '../../shared/sources/doc-name';
import AbsentSourceNotes from '../../shared/sources/AbsentSourceNotes';
import { useDocumentGallery } from '../../shared/sources/use-document-gallery';
import Button from '../../shared/ui/Button';
import CloneDocumentModal, { type CloneChoice } from '../../shared/ui/CloneDocumentModal';
import ClonedNotice from '../../shared/ui/ClonedNotice';
import ConfirmDialog from '../../shared/ui/ConfirmDialog';
import EmptyState from '../../shared/ui/EmptyState';
import ImportDocumentModal from '../../shared/ui/ImportDocumentModal';
import LoadingState from '../../shared/ui/LoadingState';
import OverflowMenu, { type OverflowItem } from '../../shared/ui/OverflowMenu';
import { focusOnMount } from '../../shared/ui/focus';
import { Icons } from '../../shared/ui/icons';
import { pageScroll } from '../../shared/ui/page-scroll';
import { usePublishSectionBar } from '../../shared/ui/section-rail';
import useFreshClone from '../../shared/ui/use-fresh-clone';
import { useIsCompact } from '../../shared/ui/use-layout-mode';
import { useSurface } from '../../shared/ui/use-surface';
import { cleanAtlasName, cloneAtlas, createAtlasDoc, flightCountLine, withFlights, type AtlasDoc } from './atlas-doc';
import {
  ATLAS_FILE_ACCEPT,
  ATLAS_FILE_EXTENSION,
  atlasFileName,
  backupFileName,
  parseAtlasFile,
  serializeAtlasFile,
  toAtlasFile,
} from './atlas-file';
import { ensureFirstAtlas } from './atlas-first';
import { ingestLogs, type IngestItem } from './atlas-ingest';
import { exportLogos, importLogos } from './atlas-logos';
import {
  ATLAS_DOC_KIND,
  deleteRemoteAtlas,
  listRemoteAtlases,
  mirrorAtlas,
  moveAtlas,
  pushAtlas,
  type RemoteAtlasRow,
} from './atlas-remote';
import {
  askPersistence,
  copyThumb,
  deleteAtlas,
  deleteSyncRecord,
  getLogs,
  getSyncRecord,
  getThumb,
  listAtlases,
  logHashes,
  putAtlas,
  putLogs,
  storageState,
  type StorageState,
} from './atlas-store';
import { ATLAS_KINDS } from './AtlasEditor';
import { allPresets, mergePresets } from './use-atlas-presets';

interface AtlasGalleryProps {
  openAtlasId: string | null;
  onOpen: (atlas: AtlasDoc) => void;
}

function formatWhen(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1_048_576).toFixed(n < 10 * 1_048_576 ? 1 : 0)} MB`;
  return `${(n / 1_073_741_824).toFixed(1)} GB`;
}

/** The atlas's poster, kept on this device when it was last opened here. */
function AtlasCover({ atlas, remoteOnly }: { atlas: AtlasDoc; remoteOnly: boolean }) {
  const [blob, setBlob] = useState<Blob | null>(null);
  useEffect(() => {
    let alive = true;
    void getThumb(atlas.id).then((b) => alive && setBlob(b));
    return () => {
      alive = false;
    };
  }, [atlas.id, atlas.updatedAt]);
  const url = useObjectUrl(blob);
  if (!url) {
    return (
      <div className="w-full aspect-[4/3] flex items-center justify-center text-muted font-mono text-xs px-4 text-center">
        {remoteOnly ? 'drawn once opened here' : atlas.flights.length ? 'its poster is drawn once opened' : 'no flights yet'}
      </div>
    );
  }
  return <img src={url} alt="" className="block w-full aspect-[4/3] object-cover" />;
}

function AtlasCard({
  atlas,
  isOpen,
  fresh = false,
  remoteOnly,
  missing,
  moveTargets,
  busy,
  onOpen,
  onRename,
  onExport,
  onClone,
  onDelete,
  onMove,
}: {
  atlas: AtlasDoc;
  isOpen: boolean;
  fresh?: boolean;
  remoteOnly: boolean;
  /** Its flights whose log this device does not keep. */
  missing: number;
  moveTargets: readonly SourceInfo[];
  busy: string | null;
  onOpen: () => void;
  onRename: (name: string) => void;
  onExport: () => void;
  onClone: () => void;
  onDelete: () => void;
  onMove: (targetSourceId: string) => void;
}) {
  const compact = useIsCompact();
  const [confirming, setConfirming] = useState<{ kind: 'delete' } | { kind: 'rename' } | { kind: 'move'; to: SourceInfo } | null>(null);
  const [draft, setDraft] = useState(atlas.name);

  // The whole card opens the atlas (the trip, project and roll cards' rule); the rest is behind the ⋯.
  const items: OverflowItem[] = [
    { id: 'open', label: isOpen ? 'Resume' : remoteOnly ? 'Open here' : 'Open', onSelect: onOpen },
    ...(!remoteOnly
      ? [
          {
            id: 'rename',
            label: 'Rename…',
            onSelect: () => {
              setDraft(atlas.name);
              setConfirming({ kind: 'rename' });
            },
          },
        ]
      : []),
    {
      id: 'clone',
      label: 'Clone…',
      title: remoteOnly ? 'Open it here first — a clone is made from the copy this device holds' : 'Make a copy of this atlas — its flights, its look, its words',
      disabled: remoteOnly,
      onSelect: onClone,
    },
    ...(!remoteOnly
      ? [
          {
            id: 'export',
            label: `Export ${ATLAS_FILE_EXTENSION}`,
            title: 'The whole atlas on disk, its logs included — a backup, and how it reaches another machine',
            onSelect: onExport,
          },
          ...moveTargets.map((target) => ({
            id: `move:${target.id}`,
            label: target.id === DEFAULT_SOURCE_ID ? 'Keep on this device only…' : `Keep on ${sourceLabel(target.id)}…`,
            onSelect: () => setConfirming({ kind: 'move', to: target }),
          })),
        ]
      : []),
    { id: 'delete', label: 'Delete…', danger: true, onSelect: () => setConfirming({ kind: 'delete' }) },
  ];

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Open ${atlas.name}`}
      data-doc-id={atlas.id}
      aria-disabled={busy !== null}
      onClick={(e) => {
        if (busy !== null) return;
        if ((e.target as HTMLElement).closest('button, select, input, a, [role="menu"], [role="alertdialog"]')) return;
        onOpen();
      }}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
          e.preventDefault();
          if (busy === null) onOpen();
        }
      }}
      className={`group relative flex flex-col bg-surface border rounded-paper-lg shadow-paper-soft cursor-pointer transition-[box-shadow,border-color] duration-300 ease-paper hover:shadow-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
        isOpen || fresh ? 'border-accent' : 'border-line hover:border-line-strong'
      } ${remoteOnly ? 'opacity-75' : ''} ${busy !== null ? 'cursor-default' : ''}`}
    >
      <div className="block w-full bg-frame leading-[0] rounded-t-paper-lg overflow-hidden">
        <AtlasCover atlas={atlas} remoteOnly={remoteOnly} />
      </div>
      <div className={`flex flex-col ${compact ? 'gap-1.5 p-2.5' : 'gap-[0.55rem] p-[0.9rem_1rem_1rem]'}`}>
        <div className="flex items-center gap-2 min-w-0">
          <h3 className={`m-0 flex-1 min-w-0 font-semibold whitespace-nowrap overflow-hidden text-ellipsis ${compact ? 'text-sm' : 'text-base'}`} title={atlas.name}>
            {atlas.name}
          </h3>
          {(isOpen || fresh) && (
            <span className="flex-none font-mono text-3xs tracking-[0.08em] uppercase px-1.5 py-[2px] rounded-[6px] bg-accent-wash text-accent-ink">
              {isOpen ? 'open' : 'new'}
            </span>
          )}
          {busy === null && <OverflowMenu label={`More actions for ${atlas.name}`} items={items} className="-mr-1.5" />}
        </div>
        <p className={`m-0 font-mono tabular-nums text-muted flex flex-wrap items-center gap-x-2 ${compact ? 'text-3xs' : 'text-2xs'}`}>
          <span className="text-ink-soft">{flightCountLine(atlas)}</span>
          <span className="text-faint">·</span>
          <span>{formatWhen(atlas.updatedAt)}</span>
        </p>
        {!remoteOnly && missing > 0 && (
          <p className="m-0 font-mono text-2xs text-warn">
            {missing} log{missing === 1 ? '' : 's'} not on this device
          </p>
        )}
        {remoteOnly && <p className="m-0 font-mono text-2xs text-faint">on {sourceLabel(atlas.sourceId)} · not yet on this device</p>}
        {busy && (
          <p className="m-0 font-mono text-2xs text-muted" role="status">
            {busy}
          </p>
        )}
      </div>

      {confirming?.kind === 'delete' && (
        <ConfirmDialog
          title={`Delete “${atlas.name}”?`}
          confirmLabel="Delete"
          danger
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null);
            onDelete();
          }}
        >
          <p>Its look, its words and its list of flights go with it. A log no other atlas draws is forgotten by this device; your files stay where they are.</p>
        </ConfirmDialog>
      )}
      {confirming?.kind === 'rename' && (
        <ConfirmDialog
          title="Rename the atlas"
          confirmLabel="Rename"
          cancelLabel="Cancel"
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            const clean = cleanAtlasName(draft);
            setConfirming(null);
            if (clean && clean !== atlas.name) onRename(clean);
          }}
        >
          <input
            aria-label="Name"
            value={draft}
            // After the dialog has focused its own Cancel: the name is what is being written.
            ref={(el) => {
              if (el) requestAnimationFrame(() => focusOnMount(el));
            }}
            onChange={(e) => setDraft(e.target.value)}
            className="w-full h-10 px-3 rounded-control border border-line-strong bg-paper text-ink text-base focus:outline-none focus:border-accent"
          />
        </ConfirmDialog>
      )}
      {confirming?.kind === 'move' && (
        <ConfirmDialog
          title={confirming.to.id === DEFAULT_SOURCE_ID ? `Keep “${atlas.name}” on this device only?` : `Keep “${atlas.name}” on ${sourceLabel(confirming.to.id)}?`}
          confirmLabel="Move"
          cancelLabel="Cancel"
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            const to = confirming.to.id;
            setConfirming(null);
            onMove(to);
          }}
        >
          <p>
            {confirming.to.id === DEFAULT_SOURCE_ID
              ? 'It will be kept in this browser alone, and taken off the instance.'
              : 'It will reopen from any device connected to that instance. Its logs stay on this device: elsewhere, the flights that came from Winnow are fetched back there, and the others are asked for.'}
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}

/** The dashed tile that completes the grid, and the drop zone for an atlas file. */
function NewAtlasTile({ onCreate, onDropFile, ticked }: { onCreate: () => void; onDropFile: (file: File) => void; ticked: number }) {
  const [over, setOver] = useState(false);
  return (
    <button
      type="button"
      onClick={onCreate}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const file = Array.from(e.dataTransfer.files).find((f) => /\.json$/i.test(f.name));
        if (file) onDropFile(file);
      }}
      className={`min-h-[12rem] flex flex-col items-center justify-center gap-2 p-6 border-[1.5px] border-dashed rounded-paper-lg bg-transparent cursor-pointer text-center transition-colors ${
        over ? 'border-accent bg-accent-wash text-accent-ink' : 'border-line-strong text-muted hover:border-accent hover:text-accent-ink'
      }`}
    >
      <span className="inline-flex text-2xl">{Icons.plus}</span>
      <span className="text-sm font-semibold">New atlas</span>
      <span className="text-xs">{ticked ? `with the ${ticked} flight${ticked === 1 ? '' : 's'} ticked in the Library` : `or drop a ${ATLAS_FILE_EXTENSION} file here`}</span>
    </button>
  );
}

/** What this device keeps, and whether the browser promised to keep it. */
function StorageLine({ state, onPersist, onBackup }: { state: StorageState | null; onPersist: () => void; onBackup: () => void }) {
  if (!state) return null;
  const used = state.usage !== null ? formatBytes(state.usage) : null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 border border-line rounded-paper bg-surface text-xs text-muted">
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className={`w-1.5 h-1.5 rounded-full ${state.persisted ? 'bg-ok' : 'bg-warn'}`} />
        {state.persisted ? 'Kept on this device — the browser will not clear it by itself' : 'Kept on this device — the browser may clear it when the disk runs short'}
        {used && <span className="font-mono tabular-nums text-faint"> · {used} in use{state.quota ? ` of ${formatBytes(state.quota)}` : ''}</span>}
      </span>
      <span className="flex-1" />
      {!state.persisted && state.canPersist && (
        <Button size="sm" variant="ghost" onClick={onPersist} title="Ask the browser not to clear this site's data on its own">
          Keep it durable
        </Button>
      )}
      <Button size="sm" variant="ghost" icon={Icons.download} onClick={onBackup} title="Every atlas, its logs, the presets and the makers' logos in one file — the copy that survives a cleared browser">
        Back up everything
      </Button>
    </div>
  );
}

/**
 * The Flight Atlas's front door (his ask, 2026-10-17): atlases as cards, newest
 * first, grouped by where they are kept — the Trips, Studio and Develop
 * galleries over the same plumbing (`use-document-gallery.ts`). The cover is
 * the atlas's poster; the whole card opens it; the ⋯ renames, clones, exports
 * the atlas file, moves and deletes. Under the cards, what the device keeps,
 * whether the browser promised to keep it, and the one copy that survives a
 * cleared browser: the backup file.
 */
export default function AtlasGallery({ openAtlasId, onOpen }: AtlasGalleryProps) {
  useSurface('darkroom');
  const lib = useAssetLibrary();
  const [importing, setImporting] = useState(false);
  const [cloning, setCloning] = useState<AtlasDoc | null>(null);
  const [storage, setStorage] = useState<StorageState | null>(null);
  const [kept, setKept] = useState<ReadonlySet<string> | null>(null);
  const gallery = useDocumentGallery<AtlasDoc, RemoteAtlasRow>({
    kind: ATLAS_DOC_KIND,
    noun: 'atlas',
    listLocal: listAtlases,
    listRemote: listRemoteAtlases,
    putDoc: putAtlas,
    pushNew: (remote, doc) => pushAtlas(remote, doc, null),
    getRecord: getSyncRecord,
    deleteRecord: deleteSyncRecord,
    deleteRemote: deleteRemoteAtlas,
    deleteLocal: deleteAtlas,
    mirror: mirrorAtlas,
    move: moveAtlas,
  });
  const { docs: atlases, documentSources, refresh, groups, absent, nothingAnywhere, allListed, busy, notice, setNotice, createOn } = gallery;
  const { cloned, setCloned, freshId } = useFreshClone(atlases);

  const ticked = useMemo<IngestItem[]>(
    () =>
      selectedUsableAssets(ATLAS_KINDS, lib.assets, lib.selection).flatMap((a) =>
        a.parts.srt ? [{ file: a.parts.srt, name: a.baseName, video: a.parts.video ?? null, was: a.id }] : [],
      ),
    [lib.assets, lib.selection],
  );

  // The first visit since atlases exist: today's page becomes the first atlas.
  const tickedRef = useRef(ticked);
  tickedRef.current = ticked;
  useEffect(() => {
    void ensureFirstAtlas(tickedRef.current, DEFAULT_SOURCE_ID).then((doc) => doc && refresh());
    // The preset book moves into the atlas store now, not the first time the Presets panel opens.
    void allPresets();
  }, [refresh]);

  const readStorage = useCallback(() => {
    void storageState().then(setStorage);
    void logHashes().then(setKept);
  }, []);
  useEffect(readStorage, [readStorage, atlases]);

  const namesIn = useCallback(
    (sourceId: string): string[] => {
      const group = groups.find((g) => g.id === sourceId);
      return group ? [...group.items, ...group.remoteOnly.map((r) => r.doc)].map((r) => r.name) : [];
    },
    [groups],
  );

  const [creating, setCreating] = useState(false);
  const handleCreate = useCallback(async () => {
    if (creating) return;
    setNotice(null);
    setCreating(true);
    try {
      let doc = createAtlasDoc(uniqueDocName('New atlas', namesIn(DEFAULT_SOURCE_ID)), DEFAULT_SOURCE_ID);
      if (ticked.length) doc = withFlights(doc, (await ingestLogs(ticked)).refs);
      if (await createOn(doc, 'created')) onOpen(doc);
    } finally {
      setCreating(false);
    }
  }, [creating, setNotice, namesIn, ticked, createOn, onOpen]);

  const handleImportRef = useRef<(sourceId: string) => Promise<void>>(async () => {});
  const startImport = useCallback(() => {
    if (documentSources.length > 1) setImporting(true);
    else void handleImportRef.current(DEFAULT_SOURCE_ID);
  }, [documentSources.length]);

  const compact = useIsCompact();
  usePublishSectionBar(
    useMemo(
      () =>
        compact
          ? {
              sections: [
                { id: 'new', label: 'New atlas' },
                { id: 'import', label: 'Import' },
              ],
              active: null,
              label: 'Start an atlas',
              role: 'actions' as const,
              onSelect: (id: string) => {
                if (id === 'new') void handleCreate();
                else startImport();
              },
            }
          : null,
      [compact, startImport, handleCreate],
    ),
  );

  async function handleImport(targetSourceId: string) {
    const picked = await pickFile(ATLAS_FILE_ACCEPT);
    if (picked) await importFromFile(picked, targetSourceId);
  }

  /** An atlas file always makes NEW atlases; its presets and logos join what this device keeps. */
  async function importFromFile(picked: File, targetSourceId: string) {
    setNotice(null);
    setCloned(null);
    const sourceId = documentSources.some((s) => s.id === targetSourceId) ? targetSourceId : DEFAULT_SOURCE_ID;
    const parsed = await parseAtlasFile(await picked.text(), sourceId);
    if (!parsed.ok) {
      setNotice(parsed.error);
      return;
    }
    const { atlases: incoming, logs, presets, logos, rejected } = parsed.file;
    if (!(await putLogs(logs))) {
      setNotice('This browser refused to keep the logs (a private window, or the disk is full) — nothing was imported.');
      return;
    }
    let made = 0;
    for (const doc of incoming) if (await createOn(doc, 'imported')) made += 1;
    const addedPresets = presets.length ? await mergePresets(presets) : 0;
    const addedLogos = logos.length ? await importLogos(logos) : 0;
    const parts = [
      made ? `${made} atlas${made === 1 ? '' : 'es'} imported` : '',
      addedPresets ? `${addedPresets} preset${addedPresets === 1 ? '' : 's'}` : '',
      addedLogos ? `${addedLogos} logo${addedLogos === 1 ? '' : 's'}` : '',
      rejected ? `${rejected} log${rejected === 1 ? '' : 's'} left out (damaged)` : '',
    ].filter(Boolean);
    setNotice(parts.length ? `${parts.join(' · ')}.` : 'Nothing new in that file — what it holds is already here.');
    refresh();
  }
  handleImportRef.current = handleImport;

  async function handleClone(source: AtlasDoc, choice: CloneChoice) {
    setNotice(null);
    const doc = cloneAtlas(source, { name: choice.name, sourceId: choice.sourceId });
    const ok = await createOn(doc, 'cloned');
    setCloning(null);
    if (!ok) return;
    await copyThumb(source.id, doc.id);
    setCloned(doc);
    refresh();
  }

  async function handleRename(atlas: AtlasDoc, name: string) {
    // An atlas kept on an instance is renamed in the editor, where its sync runs.
    if (atlas.sourceId !== DEFAULT_SOURCE_ID) {
      onOpen(atlas);
      return;
    }
    if (!(await putAtlas({ ...atlas, name, updatedAt: Date.now() }))) setNotice('This browser refused to store the new name.');
    refresh();
  }

  async function handleExport(atlas: AtlasDoc) {
    const logs = await getLogs(atlas.flights.map((f) => f.log));
    downloadBlob(new Blob([serializeAtlasFile(toAtlasFile([atlas], logs))], { type: 'application/json' }), atlasFileName(atlas.name));
  }

  async function handleBackup() {
    const all = await listAtlases();
    const logs = await getLogs(all.flatMap((a) => a.flights.map((f) => f.log)));
    const file = toAtlasFile(all, logs, { presets: await allPresets(), logos: await exportLogos() });
    downloadBlob(new Blob([serializeAtlasFile(file)], { type: 'application/json' }), backupFileName());
  }

  const missingOf = (atlas: AtlasDoc) => (kept ? atlas.flights.filter((f) => !kept.has(f.log)).length : 0);

  return (
    <section className={`${pageScroll} ${compact ? 'pt-3' : ''}`} aria-label="Flight atlases">
      <h1 className="sr-only">Atlases</h1>
      {!compact && (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="font-serif text-2xl leading-none" aria-hidden="true">
            Atlases
          </span>
          {atlases !== null && <span className="font-mono text-xs text-muted tabular-nums">{atlases.length}</span>}
          <span className="font-mono text-3xs uppercase tracking-[0.12em] px-1.5 py-0.5 rounded border border-warn-line bg-warn-wash text-warn">
            Experimental
          </span>
          <span className="flex-1" />
          <Button onClick={startImport} icon={Icons.import} title={`Import atlases from a ${ATLAS_FILE_EXTENSION} file`}>
            Import
          </Button>
          <Button variant="primary" onClick={() => void handleCreate()} icon={Icons.plus} disabled={creating}>
            New atlas
          </Button>
        </div>
      )}

      {notice && (
        <p className="m-0 text-xs text-ink-soft" role="status">
          {notice}
        </p>
      )}

      {cloned && (
        <ClonedNotice
          name={cloned.name}
          sourceId={cloned.sourceId}
          onOpen={() => {
            const doc = cloned;
            setCloned(null);
            onOpen(doc);
          }}
          onUndo={() => {
            const doc = cloned;
            setCloned(null);
            void gallery.remove(doc, null);
          }}
        />
      )}

      <AbsentSourceNotes absent={absent} />

      {atlases === null ? (
        <LoadingState label="Loading atlases…" />
      ) : nothingAnywhere && allListed ? (
        <EmptyState
          title="No atlases yet"
          actions={
            <>
              <Button variant="primary" onClick={() => void handleCreate()}>
                {ticked.length ? `Start one with the ${ticked.length} ticked flight${ticked.length === 1 ? '' : 's'}` : 'Start the first one'}
              </Button>
              <Button variant="ghost" onClick={startImport}>
                or import an atlas file
              </Button>
            </>
          }
        >
          An atlas draws a set of drone flights together on one map and animates them. It keeps its look, its words and each log&rsquo;s
          GPS track on this device, so it reopens here without the files.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-6 pb-4">
          {groups.map(({ id, items, list, remoteOnly }) => {
            const source = sourceById(id);
            const count = items.length + remoteOnly.length;
            const moveTargets = documentSources.filter((s) => s.id !== id);
            return (
              <section key={id} aria-label={`Atlases on ${source?.label ?? id}`}>
                <p className="m-0 mb-3 font-mono text-2xs tracking-[0.14em] uppercase text-muted">
                  {id === DEFAULT_SOURCE_ID ? 'on this device' : `on ${source?.label ?? id}`}
                  <span className="text-faint"> · </span>
                  <span className="tabular-nums">
                    {count} atlas{count === 1 ? '' : 'es'}
                  </span>
                  {!source && <span className="text-faint"> · not connected</span>}
                  {list?.status === 'loading' && <span className="text-faint"> · checking…</span>}
                  {list?.status === 'failed' && <span className="text-faint normal-case tracking-normal"> · {list.text}</span>}
                </p>
                {count === 0 && id !== DEFAULT_SOURCE_ID ? (
                  <p className="m-0 text-xs text-faint">Nothing kept here yet.</p>
                ) : (
                  <div className={compact ? 'grid grid-cols-2 gap-3' : 'grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-5'}>
                    {items.map((atlas) => (
                      <AtlasCard
                        key={atlas.id}
                        atlas={atlas}
                        isOpen={atlas.id === openAtlasId}
                        fresh={atlas.id === freshId}
                        remoteOnly={false}
                        missing={missingOf(atlas)}
                        moveTargets={moveTargets}
                        busy={busy[atlas.id] ?? null}
                        onOpen={() => onOpen(atlas)}
                        onRename={(name) => void handleRename(atlas, name)}
                        onExport={() => void handleExport(atlas)}
                        onClone={() => setCloning(atlas)}
                        onDelete={() => {
                          setCloned(null);
                          void gallery.remove(atlas, null);
                        }}
                        onMove={(target) => void gallery.moveTo(atlas, target)}
                      />
                    ))}
                    {id === DEFAULT_SOURCE_ID && (
                      <NewAtlasTile ticked={ticked.length} onCreate={() => void handleCreate()} onDropFile={(file) => void importFromFile(file, DEFAULT_SOURCE_ID)} />
                    )}
                    {remoteOnly.map((row) => (
                      <AtlasCard
                        key={row.doc.id}
                        atlas={row.doc}
                        isOpen={false}
                        remoteOnly
                        missing={0}
                        moveTargets={[]}
                        busy={busy[row.doc.id] ?? null}
                        onOpen={() => void gallery.mirrorRemote(row).then((doc) => doc && onOpen(doc))}
                        onRename={() => undefined}
                        onExport={() => undefined}
                        onClone={() => setCloning(row.doc)}
                        onDelete={() => void gallery.remove(row.doc, row.etag)}
                        onMove={() => undefined}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
          <StorageLine
            state={storage}
            onPersist={() => void askPersistence().then(readStorage)}
            onBackup={() => void handleBackup()}
          />
        </div>
      )}

      {importing && (
        <ImportDocumentModal
          title="Import an atlas file"
          blurb={`Makes new atlases from a ${ATLAS_FILE_EXTENSION} file, logs included — it never overwrites one you already have.`}
          sources={documentSources}
          onCancel={() => setImporting(false)}
          onChooseFile={(target) => {
            setImporting(false);
            void handleImport(target);
          }}
        />
      )}

      {cloning && (
        <CloneDocumentModal
          noun="atlas"
          original={cloning.name}
          originalSourceId={cloning.sourceId}
          sources={documentSources}
          namesIn={namesIn}
          note={
            <>
              <p>Its flights, every setting — its look, title, place, intro and outro — and the hidden flights come along.</p>
              <p>The logs are not copied: both atlases draw the ones this device keeps.</p>
            </>
          }
          onCancel={() => setCloning(null)}
          onConfirm={(choice) => handleClone(cloning, choice)}
        />
      )}
    </section>
  );
}
