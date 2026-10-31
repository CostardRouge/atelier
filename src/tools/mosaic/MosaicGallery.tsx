import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { downloadBlob } from '../../shared/media/save';
import { useObjectUrl } from '../../shared/media/use-object-url';
import { createMosaicDoc, cleanMosaicTitle, type MosaicDoc } from '../../shared/mosaic/mosaic-doc';
import { pickFile } from '../../shared/sources/file-sources';
import { DEFAULT_SOURCE_ID, sourceById } from '../../shared/sources/source';
import { uniqueDocName } from '../../shared/sources/doc-name';
import AbsentSourceNotes from '../../shared/sources/AbsentSourceNotes';
import { useDocumentGallery } from '../../shared/sources/use-document-gallery';
import type { RemoteDocRow } from '../../shared/sources/document-gallery';
import Button from '../../shared/ui/Button';
import ConfirmDialog from '../../shared/ui/ConfirmDialog';
import EmptyState from '../../shared/ui/EmptyState';
import ImportDocumentModal from '../../shared/ui/ImportDocumentModal';
import LoadingState from '../../shared/ui/LoadingState';
import OverflowMenu, { type OverflowItem } from '../../shared/ui/OverflowMenu';
import { focusOnMount } from '../../shared/ui/focus';
import { Icons } from '../../shared/ui/icons';
import { pageScroll } from '../../shared/ui/page-scroll';
import { usePublishSectionBar } from '../../shared/ui/section-rail';
import { useIsCompact } from '../../shared/ui/use-layout-mode';
import { useSurface } from '../../shared/ui/use-surface';
import {
  MOSAIC_FILE_ACCEPT,
  MOSAIC_FILE_EXTENSION,
  backupFileName,
  mosaicFileName,
  parseMosaicFile,
  serializeMosaicFile,
  toMosaicFile,
} from './mosaic-file';
import {
  askPersistence,
  deleteMosaic,
  deleteSyncRecord,
  getSyncRecord,
  getThumb,
  listMosaics,
  putMosaic,
  storageState,
  tileStorage,
  type StorageState,
} from './mosaic-store';

/** The kind mosaics will be filed under in an instance's bucket (M8); no instance lists it yet. */
export const MOSAIC_DOC_KIND = 'mosaic';

interface MosaicGalleryProps {
  openMosaicId: string | null;
  onOpen: (doc: MosaicDoc) => void;
}

function formatWhen(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1_048_576).toFixed(n < 10 * 1_048_576 ? 1 : 0)} MB`;
  return `${(n / 1_073_741_824).toFixed(1)} GB`;
}

/** "1 240 pictures · 1 198 measured", or what a library without pictures says. */
export function pictureCountLine(doc: MosaicDoc): string {
  const n = doc.tiles.length;
  if (!n) return 'no pictures yet';
  const measured = doc.tiles.filter((t) => t.grid).length;
  const head = `${n.toLocaleString()} picture${n === 1 ? '' : 's'}`;
  return measured === n ? head : `${head} · ${measured.toLocaleString()} measured`;
}

/** The mosaic's poster, kept on this device when it was last drawn here. */
function MosaicCover({ doc }: { doc: MosaicDoc }) {
  const [blob, setBlob] = useState<Blob | null>(null);
  useEffect(() => {
    let alive = true;
    void getThumb(doc.id).then((b) => alive && setBlob(b));
    return () => {
      alive = false;
    };
  }, [doc.id, doc.updatedAt]);
  const url = useObjectUrl(blob);
  if (!url) {
    return (
      <div className="w-full aspect-video flex items-center justify-center text-muted font-mono text-xs px-4 text-center">
        {doc.tiles.length ? 'its poster is drawn once opened' : 'no pictures yet'}
      </div>
    );
  }
  return <img src={url} alt="" className="block w-full aspect-video object-cover" />;
}

function MosaicCard({
  doc,
  isOpen,
  busy,
  onOpen,
  onRename,
  onExport,
  onDelete,
}: {
  doc: MosaicDoc;
  isOpen: boolean;
  busy: string | null;
  onOpen: () => void;
  onRename: (title: string) => void;
  onExport: () => void;
  onDelete: () => void;
}) {
  const compact = useIsCompact();
  const [confirming, setConfirming] = useState<'delete' | 'rename' | null>(null);
  const [draft, setDraft] = useState(doc.title);

  // The whole card opens the mosaic (the trip, project, roll and atlas cards' rule); the rest is behind the ⋯.
  const items: OverflowItem[] = [
    { id: 'open', label: isOpen ? 'Resume' : 'Open', onSelect: onOpen },
    {
      id: 'rename',
      label: 'Rename…',
      onSelect: () => {
        setDraft(doc.title);
        setConfirming('rename');
      },
    },
    {
      id: 'export',
      label: `Export ${MOSAIC_FILE_EXTENSION}`,
      title: 'The mosaic on disk, its pictures’ colours included — a backup, and how it reaches another machine',
      onSelect: onExport,
    },
    { id: 'delete', label: 'Delete…', danger: true, onSelect: () => setConfirming('delete') },
  ];

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Open ${doc.title}`}
      data-doc-id={doc.id}
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
        isOpen ? 'border-accent' : 'border-line hover:border-line-strong'
      } ${busy !== null ? 'cursor-default' : ''}`}
    >
      <div className="block w-full bg-frame leading-[0] rounded-t-paper-lg overflow-hidden">
        <MosaicCover doc={doc} />
      </div>
      <div className={`flex flex-col ${compact ? 'gap-1.5 p-2.5' : 'gap-[0.55rem] p-[0.9rem_1rem_1rem]'}`}>
        <div className="flex items-center gap-2 min-w-0">
          <h3 className={`m-0 flex-1 min-w-0 font-semibold whitespace-nowrap overflow-hidden text-ellipsis ${compact ? 'text-sm' : 'text-base'}`} title={doc.title}>
            {doc.title}
          </h3>
          {isOpen && (
            <span className="flex-none font-mono text-3xs tracking-[0.08em] uppercase px-1.5 py-[2px] rounded-[6px] bg-accent-wash text-accent-ink">open</span>
          )}
          {busy === null && <OverflowMenu label={`More actions for ${doc.title}`} items={items} className="-mr-1.5" />}
        </div>
        <p className={`m-0 font-mono tabular-nums text-muted flex flex-wrap items-center gap-x-2 ${compact ? 'text-3xs' : 'text-2xs'}`}>
          <span className="text-ink-soft">{pictureCountLine(doc)}</span>
          <span className="text-faint">·</span>
          <span>{formatWhen(doc.updatedAt)}</span>
        </p>
        {busy && (
          <p className="m-0 font-mono text-2xs text-muted" role="status">
            {busy}
          </p>
        )}
      </div>

      {confirming === 'delete' && (
        <ConfirmDialog
          title={`Delete “${doc.title}”?`}
          confirmLabel="Delete"
          danger
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null);
            onDelete();
          }}
        >
          <p>Its list of pictures and its settings go with it. The colours and small tiles of pictures no other mosaic uses are forgotten by this device; your pictures stay on your Winnow.</p>
        </ConfirmDialog>
      )}
      {confirming === 'rename' && (
        <ConfirmDialog
          title="Rename the mosaic"
          confirmLabel="Rename"
          cancelLabel="Cancel"
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            const clean = cleanMosaicTitle(draft);
            setConfirming(null);
            if (clean && clean !== doc.title) onRename(clean);
          }}
        >
          <input
            aria-label="Title"
            value={draft}
            ref={(el) => {
              if (el) requestAnimationFrame(() => focusOnMount(el));
            }}
            onChange={(e) => setDraft(e.target.value)}
            className="w-full h-10 px-3 rounded-control border border-line-strong bg-paper text-ink text-base focus:outline-none focus:border-accent"
          />
        </ConfirmDialog>
      )}
    </div>
  );
}

/** The dashed tile that completes the grid, and the drop zone for a mosaic file. */
function NewMosaicTile({ onCreate, onDropFile }: { onCreate: () => void; onDropFile: (file: File) => void }) {
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
      <span className="text-sm font-semibold">New mosaic</span>
      <span className="text-xs">or drop a {MOSAIC_FILE_EXTENSION} file here</span>
    </button>
  );
}

/** What this device keeps, and whether the browser promised to keep it. */
function StorageLine({
  state,
  tiles,
  onPersist,
  onBackup,
}: {
  state: StorageState | null;
  tiles: { count: number; bytes: number } | null;
  onPersist: () => void;
  onBackup: () => void;
}) {
  if (!state) return null;
  const used = state.usage !== null ? formatBytes(state.usage) : null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 border border-line rounded-paper bg-surface text-xs text-muted">
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className={`w-1.5 h-1.5 rounded-full ${state.persisted ? 'bg-ok' : 'bg-warn'}`} />
        {state.persisted ? 'Kept on this device — the browser will not clear it by itself' : 'Kept on this device — the browser may clear it when the disk runs short'}
        {used && <span className="font-mono tabular-nums text-faint"> · {used} in use{state.quota ? ` of ${formatBytes(state.quota)}` : ''}</span>}
        {tiles && tiles.count > 0 && (
          <span className="font-mono tabular-nums text-faint">
            {' '}
            · {tiles.count.toLocaleString()} picture tile{tiles.count === 1 ? '' : 's'}, {formatBytes(tiles.bytes)}
          </span>
        )}
      </span>
      <span className="flex-1" />
      {!state.persisted && state.canPersist && (
        <Button size="sm" variant="ghost" onClick={onPersist} title="Ask the browser not to clear this site's data on its own">
          Keep it durable
        </Button>
      )}
      <Button size="sm" variant="ghost" icon={Icons.download} onClick={onBackup} title="Every mosaic with its pictures' colours in one file — the copy that survives a cleared browser">
        Back up everything
      </Button>
    </div>
  );
}

/**
 * The Mosaic instrument's front door: mosaics as cards, newest first, over
 * the plumbing the Trips, Studio, Develop and atlas galleries share
 * (`use-document-gallery.ts`). The cover is the mosaic's poster; the whole
 * card opens it; the ⋯ renames, exports the mosaic file and deletes. Under
 * the cards, what the device keeps (the pictures' colours and tiles
 * included), whether the browser promised to keep it, and the backup file.
 * No instance keeps a mosaic yet (M8): every mosaic is on this device.
 */
export default function MosaicGallery({ openMosaicId, onOpen }: MosaicGalleryProps) {
  useSurface('darkroom');
  const [importing, setImporting] = useState(false);
  const [storage, setStorage] = useState<StorageState | null>(null);
  const [tiles, setTiles] = useState<{ count: number; bytes: number } | null>(null);
  const gallery = useDocumentGallery<MosaicDoc, RemoteDocRow<MosaicDoc>>({
    kind: MOSAIC_DOC_KIND,
    noun: 'mosaic',
    listLocal: listMosaics,
    listRemote: async () => [],
    putDoc: putMosaic,
    pushNew: () => Promise.reject(new Error('A mosaic is kept on this device only for now.')),
    getRecord: getSyncRecord,
    deleteRecord: deleteSyncRecord,
    deleteRemote: () => Promise.reject(new Error('A mosaic is kept on this device only for now.')),
    deleteLocal: deleteMosaic,
    mirror: () => Promise.reject(new Error('A mosaic is kept on this device only for now.')),
    move: async () => ({ ok: false, error: 'A mosaic is kept on this device only for now.' }),
  });
  const { docs: mosaics, documentSources, refresh, groups, absent, nothingAnywhere, allListed, busy, notice, setNotice, createOn } = gallery;

  const readStorage = useCallback(() => {
    void storageState().then(setStorage);
    void tileStorage().then(setTiles);
  }, []);
  useEffect(readStorage, [readStorage, mosaics]);

  const namesIn = useCallback(
    (sourceId: string): string[] => {
      const group = groups.find((g) => g.id === sourceId);
      return group ? group.items.map((m) => m.title) : [];
    },
    [groups],
  );

  const [creating, setCreating] = useState(false);
  const handleCreate = useCallback(async () => {
    if (creating) return;
    setNotice(null);
    setCreating(true);
    try {
      const doc = createMosaicDoc(uniqueDocName('New mosaic', namesIn(DEFAULT_SOURCE_ID)), DEFAULT_SOURCE_ID);
      if (await createOn(doc, 'created')) onOpen(doc);
    } finally {
      setCreating(false);
    }
  }, [creating, setNotice, namesIn, createOn, onOpen]);

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
                { id: 'new', label: 'New mosaic' },
                { id: 'import', label: 'Import' },
              ],
              active: null,
              label: 'Start a mosaic',
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
    const picked = await pickFile(MOSAIC_FILE_ACCEPT);
    if (picked) await importFromFile(picked, targetSourceId);
  }

  /** A mosaic file always makes NEW mosaics. */
  async function importFromFile(picked: File, targetSourceId: string) {
    setNotice(null);
    const sourceId = documentSources.some((s) => s.id === targetSourceId) ? targetSourceId : DEFAULT_SOURCE_ID;
    const parsed = parseMosaicFile(await picked.text(), sourceId);
    if (!parsed.ok) {
      setNotice(parsed.error);
      return;
    }
    let made = 0;
    for (const doc of parsed.mosaics) if (await createOn(doc, 'imported')) made += 1;
    setNotice(made ? `${made} mosaic${made === 1 ? '' : 's'} imported.` : 'Nothing was imported.');
    refresh();
  }
  handleImportRef.current = handleImport;

  async function handleRename(doc: MosaicDoc, title: string) {
    if (!(await putMosaic({ ...doc, title, updatedAt: Date.now() }))) setNotice('This browser refused to store the new title.');
    refresh();
  }

  function handleExport(doc: MosaicDoc) {
    downloadBlob(new Blob([serializeMosaicFile(toMosaicFile([doc]))], { type: 'application/json' }), mosaicFileName(doc.title));
  }

  async function handleBackup() {
    const all = await listMosaics();
    downloadBlob(new Blob([serializeMosaicFile(toMosaicFile(all))], { type: 'application/json' }), backupFileName());
  }

  return (
    <section className={`${pageScroll} ${compact ? 'pt-3' : ''}`} aria-label="Mosaics">
      <h1 className="sr-only">Mosaics</h1>
      {!compact && (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="font-serif text-2xl leading-none" aria-hidden="true">
            Mosaics
          </span>
          {mosaics !== null && <span className="font-mono text-xs text-muted tabular-nums">{mosaics.length}</span>}
          <span className="flex-1" />
          <Button onClick={startImport} icon={Icons.import} title={`Import mosaics from a ${MOSAIC_FILE_EXTENSION} file`}>
            Import
          </Button>
          <Button variant="primary" onClick={() => void handleCreate()} icon={Icons.plus} disabled={creating}>
            New mosaic
          </Button>
        </div>
      )}

      {notice && (
        <p className="m-0 text-xs text-ink-soft" role="status">
          {notice}
        </p>
      )}

      <AbsentSourceNotes absent={absent} />

      {mosaics === null ? (
        <LoadingState label="Loading mosaics…" />
      ) : nothingAnywhere && allListed ? (
        <EmptyState
          title="No mosaics yet"
          actions={
            <>
              <Button variant="primary" onClick={() => void handleCreate()}>
                Start the first one
              </Button>
              <Button variant="ghost" onClick={startImport}>
                or import a mosaic file
              </Button>
            </>
          }
        >
          A mosaic rebuilds one picture out of hundreds of others from your Winnow, each cell a photo whose colours match — and plays
          them as the screen saver that zoomed from picture to picture. It keeps its list of pictures, their colours and its settings on
          this device.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-6 pb-4">
          {groups.map(({ id, items }) => {
            const source = sourceById(id);
            return (
              <section key={id} aria-label={`Mosaics on ${source?.label ?? id}`}>
                <p className="m-0 mb-3 font-mono text-2xs tracking-[0.14em] uppercase text-muted">
                  {id === DEFAULT_SOURCE_ID ? 'on this device' : `on ${source?.label ?? id}`}
                  <span className="text-faint"> · </span>
                  <span className="tabular-nums">
                    {items.length} mosaic{items.length === 1 ? '' : 's'}
                  </span>
                </p>
                <div className={compact ? 'grid grid-cols-2 gap-3' : 'grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-5'}>
                  {items.map((doc) => (
                    <MosaicCard
                      key={doc.id}
                      doc={doc}
                      isOpen={doc.id === openMosaicId}
                      busy={busy[doc.id] ?? null}
                      onOpen={() => onOpen(doc)}
                      onRename={(title) => void handleRename(doc, title)}
                      onExport={() => handleExport(doc)}
                      onDelete={() => void gallery.remove(doc, null)}
                    />
                  ))}
                  {id === DEFAULT_SOURCE_ID && <NewMosaicTile onCreate={() => void handleCreate()} onDropFile={(file) => void importFromFile(file, DEFAULT_SOURCE_ID)} />}
                </div>
              </section>
            );
          })}
          <StorageLine state={storage} tiles={tiles} onPersist={() => void askPersistence().then(readStorage)} onBackup={() => void handleBackup()} />
        </div>
      )}

      {importing && (
        <ImportDocumentModal
          title="Import a mosaic file"
          blurb={`Makes new mosaics from a ${MOSAIC_FILE_EXTENSION} file, their pictures' colours included — it never overwrites one you already have.`}
          sources={documentSources}
          onCancel={() => setImporting(false)}
          onChooseFile={(target) => {
            setImporting(false);
            void handleImport(target);
          }}
        />
      )}
    </section>
  );
}
