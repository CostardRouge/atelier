import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ROLL_FILE_ACCEPT,
  ROLL_FILE_EXTENSION,
  parseRollFile,
  rollDocFromFile,
  rollFileName,
  serializeRollFile,
  toRollFile,
} from '../../shared/develop/roll-file';
import {
  ROLL_DOC_KIND,
  deleteRemoteRoll,
  listRemoteRolls,
  mirrorRoll,
  moveRoll,
  pushRoll,
  type RemoteRollRow,
} from '../../shared/develop/roll-remote';
import {
  deleteRoll,
  deleteRollFolders,
  deleteRollPreviews,
  deleteRollThumbs,
  deleteSyncRecord,
  getRollThumbs,
  getSyncRecord,
  listRolls,
  putRoll,
} from '../../shared/develop/roll-store';
import { addPictures, createRollDoc, rollProgress, type RollDoc } from '../../shared/develop/roll-types';
import { useAssetLibrary } from '../../shared/library/AssetLibraryContext';
import { downloadBlob } from '../../shared/media/save';
import { useObjectUrl } from '../../shared/media/use-object-url';
import { hashedMediaRefs } from '../../shared/projects/media-identity';
import { pickFile } from '../../shared/sources/file-sources';
import { usePublishMediaActions, type MediaActions } from '../../shared/sources/media-scope';
import { DEFAULT_SOURCE_ID, sourceById, type SourceInfo } from '../../shared/sources/source';
import { sourceLabel } from '../../shared/sources/document-gallery';
import AbsentSourceNotes from '../../shared/sources/AbsentSourceNotes';
import { useDocumentGallery } from '../../shared/sources/use-document-gallery';
import Button from '../../shared/ui/Button';
import ConfirmDialog from '../../shared/ui/ConfirmDialog';
import EmptyState from '../../shared/ui/EmptyState';
import ImportDocumentModal from '../../shared/ui/ImportDocumentModal';
import LoadingState from '../../shared/ui/LoadingState';
import OverflowMenu, { type OverflowItem } from '../../shared/ui/OverflowMenu';
import { Icons } from '../../shared/ui/icons';
import { pageScroll } from '../../shared/ui/page-scroll';
import { usePublishSectionBar } from '../../shared/ui/section-rail';
import { useIsCompact } from '../../shared/ui/use-layout-mode';
import NewRollModal, { defaultRollName, type NewRollChoices } from './NewRollModal';

interface RollGalleryProps {
  openRollId: string | null;
  onOpen: (roll: RollDoc) => void;
}

function formatWhen(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** The first four pictures' thumbnails as a mosaic — what a roll is recognised by. */
function RollCover({ roll, remoteOnly }: { roll: RollDoc; remoteOnly: boolean }) {
  const ids = roll.pictures.slice(0, 4).map((p) => p.id);
  const idsKey = ids.join('|');
  const [blobs, setBlobs] = useState<Blob[]>([]);
  useEffect(() => {
    let alive = true;
    void getRollThumbs(idsKey ? idsKey.split('|') : []).then((map) => {
      if (alive) setBlobs(ids.flatMap((id) => map.get(id) ?? []));
    });
    return () => {
      alive = false;
    };
    // `idsKey` is `ids` joined.
  }, [idsKey]);

  if (blobs.length === 0) {
    return (
      <div className="w-full aspect-[4/3] flex items-center justify-center text-muted font-mono text-xs">
        {remoteOnly
          ? 'pictures drawn once opened here'
          : roll.pictures.length === 0
            ? 'no pictures yet'
            : 'pictures drawn once opened'}
      </div>
    );
  }
  return (
    <div className={`w-full aspect-[4/3] grid gap-px ${blobs.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
      {blobs.map((b, i) => (
        <CoverCell key={i} blob={b} span={blobs.length === 3 && i === 0} />
      ))}
    </div>
  );
}

function CoverCell({ blob, span }: { blob: Blob; span: boolean }) {
  const url = useObjectUrl(blob);
  return (
    <div className={`min-h-0 overflow-hidden bg-frame ${span ? 'row-span-2' : ''}`}>
      {url && <img src={url} alt="" className="block w-full h-full object-cover" />}
    </div>
  );
}

function RollCard({
  roll,
  isOpen,
  remoteOnly,
  moveTargets,
  busy,
  onOpen,
  onExport,
  onDelete,
  onMove,
}: {
  roll: RollDoc;
  isOpen: boolean;
  remoteOnly: boolean;
  moveTargets: readonly SourceInfo[];
  busy: string | null;
  onOpen: () => void;
  onExport: () => void;
  onDelete: () => void;
  onMove: (targetSourceId: string) => void;
}) {
  const compact = useIsCompact();
  const [confirming, setConfirming] = useState<{ kind: 'delete' } | { kind: 'move'; to: SourceInfo } | null>(null);
  const { total, developed } = rollProgress(roll);

  // The whole card opens the roll (the trip and project cards' rule); the rest
  // is behind the ⋯, the destructive verb apart.
  const items: OverflowItem[] = [
    { id: 'open', label: isOpen ? 'Resume' : remoteOnly ? 'Open here' : 'Open', onSelect: onOpen },
    ...(!remoteOnly
      ? [
          {
            id: 'export',
            label: `Export ${ROLL_FILE_EXTENSION}`,
            title: 'The whole roll on disk — a backup, and how it reaches another machine',
            onSelect: onExport,
          },
          ...moveTargets.map((target) => ({
            id: `move:${target.id}`,
            label: `Move to ${sourceLabel(target.id)}…`,
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
      aria-label={`Open ${roll.name}`}
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
      } ${remoteOnly ? 'opacity-75' : ''} ${busy !== null ? 'cursor-default' : ''}`}
    >
      <div className="block w-full bg-frame leading-[0] rounded-t-paper-lg overflow-hidden">
        <RollCover roll={roll} remoteOnly={remoteOnly} />
      </div>
      <div className={`flex flex-col ${compact ? 'gap-1.5 p-2.5' : 'gap-[0.55rem] p-[0.9rem_1rem_1rem]'}`}>
        <div className="flex items-center gap-2 min-w-0">
          <h3
            className={`m-0 flex-1 min-w-0 font-semibold whitespace-nowrap overflow-hidden text-ellipsis ${
              compact ? 'text-sm' : 'text-base'
            }`}
            title={roll.name}
          >
            {roll.name}
          </h3>
          {isOpen && (
            <span className="flex-none font-mono text-3xs tracking-[0.08em] uppercase px-1.5 py-[2px] rounded-[6px] bg-accent-wash text-accent-ink">
              open
            </span>
          )}
          {busy === null && <OverflowMenu label={`More actions for ${roll.name}`} items={items} className="-mr-1.5" />}
        </div>
        <p
          className={`m-0 font-mono tabular-nums text-muted flex flex-wrap items-center gap-x-2 ${
            compact ? 'text-3xs' : 'text-2xs'
          }`}
        >
          <span className="text-ink-soft">
            {total === 0 ? 'empty' : `${developed} of ${total} developed`}
          </span>
          <span className="text-faint">·</span>
          <span>{formatWhen(roll.updatedAt)}</span>
          {roll.grade && (
            <>
              <span className="text-faint">·</span>
              <span>a look</span>
            </>
          )}
        </p>
        {remoteOnly && (
          <p className="m-0 font-mono text-2xs text-faint">on {sourceLabel(roll.sourceId)} · not yet on this device</p>
        )}
        {busy && (
          <p className="m-0 font-mono text-2xs text-muted" role="status">
            {busy}
          </p>
        )}
      </div>

      {confirming?.kind === 'delete' && (
        <ConfirmDialog
          title={`Delete “${roll.name}”?`}
          confirmLabel="Delete"
          danger
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null);
            onDelete();
          }}
        >
          <p>Every picture's develop and the roll's look go with it. The files stay where they are.</p>
        </ConfirmDialog>
      )}
      {confirming?.kind === 'move' && (
        <ConfirmDialog
          title={`Move “${roll.name}” to ${sourceLabel(confirming.to.id)}?`}
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
            The roll will be kept there from now on, and reopen from any device connected to it. Its
            pictures never travel — only what you did to them.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}

/**
 * The Develop tool's front door: rolls as cards, newest first, grouped by the
 * source they are kept on — the Studio and Trips galleries over the same
 * shared plumbing (`use-document-gallery.ts`), whose driver here says how a
 * roll is listed, written and removed. A roll only on an instance is a greyed
 * card that mirrors on open; its thumbnails are baked here once its pictures
 * are in the Library, since thumbnails never travel.
 */
export default function RollGallery({ openRollId, onOpen }: RollGalleryProps) {
  const lib = useAssetLibrary();
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const gallery = useDocumentGallery<RollDoc, RemoteRollRow>({
    kind: ROLL_DOC_KIND,
    noun: 'roll',
    listLocal: listRolls,
    listRemote: listRemoteRolls,
    putDoc: putRoll,
    pushNew: (remote, doc) => pushRoll(remote, doc, null),
    getRecord: getSyncRecord,
    deleteRecord: deleteSyncRecord,
    deleteRemote: deleteRemoteRoll,
    deleteLocal: async (doc) => {
      await deleteRoll(doc.id);
      // The thumbnails and remembered folders go with the roll: nothing else will ever prune them.
      await deleteRollThumbs(doc.pictures.map((p) => p.id));
      await deleteRollFolders(doc.id);
        await deleteRollPreviews(doc.pictures.map((p) => p.id));
    },
    mirror: mirrorRoll,
    move: moveRoll,
  });
  const {
    docs: rolls,
    documentSources,
    refresh,
    groups,
    absent,
    nothingAnywhere,
    allListed,
    busy,
    notice,
    setNotice,
    createOn,
  } = gallery;

  const selectedPhotos = useMemo(
    () =>
      lib.assets
        .filter((a) => lib.selection.has(a.id) && a.kind === 'photo' && a.parts.image)
        .map((a) => a.parts.image!),
    [lib.assets, lib.selection],
  );

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
                { id: 'new', label: 'New roll' },
                { id: 'import', label: 'Import' },
              ],
              active: null,
              label: 'Start a roll',
              role: 'actions' as const,
              onSelect: (id: string) => {
                if (id === 'new') setCreating(true);
                else startImport();
              },
            }
          : null,
      [compact, startImport],
    ),
  );

  // --- the shell's verb: "Develop" under a picture being looked at (D10) ---
  // A new roll from that one picture, named as the New-roll sheet would name
  // it, kept in this browser, opened at once. The verb only asks; the effect
  // answers after the render, from the active asset as it then is (`run` is
  // called in the same tick as the activation — `RollEditor` has the note).
  const [pendingNew, setPendingNew] = useState(0);
  const activeFile = useMemo(() => {
    const a = lib.assets.find((x) => x.id === lib.activeId);
    return a?.kind === 'photo' && a.parts.image ? a.parts.image : null;
  }, [lib.assets, lib.activeId]);
  useEffect(() => {
    if (pendingNew === 0) return;
    setPendingNew(0);
    if (!activeFile) {
      setNotice('Only a photograph can start a roll.');
      return;
    }
    void (async () => {
      const refs = await hashedMediaRefs([activeFile]);
      const doc = addPictures(createRollDoc(defaultRollName(), DEFAULT_SOURCE_ID), refs);
      if (await createOn(doc, 'created')) onOpen(doc);
    })();
  }, [pendingNew, activeFile, createOn, onOpen, setNotice]);
  usePublishMediaActions(
    useMemo<MediaActions>(
      () => ({
        heading: 'Develop',
        actions: [
          {
            id: 'new-roll',
            label: 'Develop',
            hint: 'a new roll from this picture, opened at once',
            run: () => setPendingNew((n) => n + 1),
          },
        ],
      }),
      [],
    ),
  );

  async function handleCreate(choices: NewRollChoices) {
    setNotice(null);
    setCreating(false);
    let doc = createRollDoc(choices.name, choices.sourceId);
    if (choices.withSelected) doc = addPictures(doc, await hashedMediaRefs(selectedPhotos));
    if (await createOn(doc, 'created')) onOpen(doc);
  }

  /** A roll file always becomes a NEW roll — importing a backup twice never replaces one. */
  async function handleImport(targetSourceId: string) {
    const picked = await pickFile(ROLL_FILE_ACCEPT);
    if (!picked) return;
    await importFromFile(picked, targetSourceId);
  }

  async function importFromFile(picked: File, targetSourceId: string) {
    setNotice(null);
    const parsed = parseRollFile(await picked.text());
    if (!parsed.ok) {
      setNotice(parsed.error);
      return;
    }
    const sourceId = documentSources.some((s) => s.id === targetSourceId) ? targetSourceId : DEFAULT_SOURCE_ID;
    const doc = rollDocFromFile(parsed.file, Date.now(), sourceId);
    if (await createOn(doc, 'imported')) refresh();
  }
  handleImportRef.current = handleImport;

  function handleExport(roll: RollDoc) {
    downloadBlob(new Blob([serializeRollFile(toRollFile(roll))], { type: 'application/json' }), rollFileName(roll.name));
  }

  return (
    <section className={`${pageScroll} ${compact ? 'pt-3' : ''}`} aria-label="Develop rolls">
      <h1 className="sr-only">Rolls</h1>
      {!compact && (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="font-serif text-2xl leading-none" aria-hidden="true">
            Rolls
          </span>
          {rolls !== null && <span className="font-mono text-xs text-muted tabular-nums">{rolls.length}</span>}
          <span className="flex-1" />
          <Button onClick={startImport} icon={Icons.import} title={`Create a roll from an exported ${ROLL_FILE_EXTENSION} file`}>
            Import
          </Button>
          <Button variant="primary" onClick={() => setCreating(true)} icon={Icons.plus}>
            New roll
          </Button>
        </div>
      )}

      {notice && (
        <p className="m-0 text-xs text-danger" role="alert">
          {notice}
        </p>
      )}

      <AbsentSourceNotes absent={absent} />

      {rolls === null ? (
        <LoadingState label="Loading rolls…" />
      ) : nothingAnywhere && allListed ? (
        <EmptyState
          title="No rolls yet"
          actions={
            <>
              <Button variant="primary" onClick={() => setCreating(true)}>
                Start the first one
              </Button>
              <Button variant="ghost" onClick={startImport}>
                or import a roll file
              </Button>
            </>
          }
        >
          A roll is the set of photographs you mean to develop — from a folder or a day on your Winnow —
          each keeping its own light and colour, and the roll a look of its own.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-6 pb-4">
          {groups.map(({ id, items, list, remoteOnly }) => {
            const source = sourceById(id);
            const count = items.length + remoteOnly.length;
            const moveTargets = documentSources.filter((s) => s.id !== id);
            return (
              <section key={id} aria-label={`Rolls from ${source?.label ?? id}`}>
                <p className="m-0 mb-3 font-mono text-2xs tracking-[0.14em] uppercase text-muted">
                  source: {source?.label ?? id}
                  <span className="text-faint"> · </span>
                  <span className="tabular-nums">
                    {count} roll{count === 1 ? '' : 's'}
                  </span>
                  {!source && <span className="text-faint"> · not connected</span>}
                  {list?.status === 'loading' && <span className="text-faint"> · checking…</span>}
                  {list?.status === 'failed' && (
                    <span className="text-faint normal-case tracking-normal">
                      {' '}
                      · {list.text}
                      {list.login && (
                        <>
                          {' '}
                          <a
                            href={list.login}
                            target="_blank"
                            rel="noreferrer"
                            className="text-accent-ink underline underline-offset-[3px]"
                          >
                            Sign in
                          </a>
                        </>
                      )}
                    </span>
                  )}
                </p>
                {count === 0 && id !== DEFAULT_SOURCE_ID ? (
                  <p className="m-0 text-xs text-faint">Nothing kept here yet.</p>
                ) : (
                  <div
                    className={
                      compact ? 'grid grid-cols-2 gap-3' : 'grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-5'
                    }
                  >
                    {items.map((roll) => (
                      <RollCard
                        key={roll.id}
                        roll={roll}
                        isOpen={roll.id === openRollId}
                        remoteOnly={false}
                        moveTargets={moveTargets}
                        busy={busy[roll.id] ?? null}
                        onOpen={() => onOpen(roll)}
                        onExport={() => handleExport(roll)}
                        onDelete={() => void gallery.remove(roll, null)}
                        onMove={(target) => void gallery.moveTo(roll, target)}
                      />
                    ))}
                    {id === DEFAULT_SOURCE_ID && (
                      <NewRollTile
                        onCreate={() => setCreating(true)}
                        onDropFile={(file) => void importFromFile(file, DEFAULT_SOURCE_ID)}
                      />
                    )}
                    {remoteOnly.map((row) => (
                      <RollCard
                        key={row.doc.id}
                        roll={row.doc}
                        isOpen={false}
                        remoteOnly
                        moveTargets={[]}
                        busy={busy[row.doc.id] ?? null}
                        onOpen={() => void gallery.mirrorRemote(row).then(onOpen)}
                        onExport={() => undefined}
                        onDelete={() => void gallery.remove(row.doc, row.etag)}
                        onMove={() => undefined}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {importing && (
        <ImportDocumentModal
          title="Import a roll file"
          blurb={`Creates a new roll from an exported ${ROLL_FILE_EXTENSION} file — it never overwrites one you already have.`}
          sources={documentSources}
          onCancel={() => setImporting(false)}
          onChooseFile={(target) => {
            setImporting(false);
            void handleImport(target);
          }}
        />
      )}

      {creating && (
        <NewRollModal
          sources={documentSources}
          selectedCount={selectedPhotos.length}
          onCancel={() => setCreating(false)}
          onCreate={(choices) => void handleCreate(choices)}
        />
      )}
    </section>
  );
}

/** The dashed tile that completes the grid, and the drop zone for a roll file. */
function NewRollTile({ onCreate, onDropFile }: { onCreate: () => void; onDropFile: (file: File) => void }) {
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
        over
          ? 'border-accent bg-accent-wash text-accent-ink'
          : 'border-line-strong text-muted hover:border-accent hover:text-accent-ink'
      }`}
    >
      <span className="inline-flex text-2xl">{Icons.plus}</span>
      <span className="text-sm font-semibold">New roll</span>
      <span className="text-xs">or drop a {ROLL_FILE_EXTENSION} file here</span>
    </button>
  );
}
