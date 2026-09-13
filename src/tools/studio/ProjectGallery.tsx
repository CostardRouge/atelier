import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { formatDuration } from '../../shared/lib/format';
import { useObjectUrl } from '../../shared/media/use-object-url';
import {
  ASPECT_PRESETS,
  createProjectDoc,
  type ProjectDoc,
} from '../../shared/projects/project-types';
import {
  deleteProject,
  deleteSyncRecord,
  getSyncRecord,
  listProjects,
  putProject,
} from '../../shared/projects/project-store';
import {
  PROJECT_FILE_ACCEPT,
  PROJECT_FILE_EXTENSION,
  applyProjectFile,
  parseProjectFile,
} from '../../shared/projects/project-file';
import {
  deleteRemoteProject,
  explainFailure,
  failureOf,
  isRemoteSource,
  listRemoteProjects,
  mirrorProject,
  moveProject,
  pushProject,
  remoteFor,
  type RemoteProjectRow,
} from '../../shared/projects/project-remote';
import { pickFile } from '../../shared/sources/file-sources';
import {
  DEFAULT_SOURCE_ID,
  groupBySource,
  listSources,
  sourceById,
  type SourceInfo,
} from '../../shared/sources/source';
import {
  listWinnowConnections,
  subscribeWinnowConnections,
} from '../../shared/sources/winnow/store';
import { DEFAULT_GUIDES } from '../../shared/overlay/guides';
import { defaultElementsPreset } from '../../shared/overlay/overlay-types';
import NewProjectModal, { type NewProjectChoices } from './NewProjectModal';
import ImportDocumentModal from '../../shared/ui/ImportDocumentModal';
import { pageScroll } from '../../shared/ui/page-scroll';
import { usePublishSectionBar } from '../../shared/ui/section-rail';
import { useIsCompact } from '../../shared/ui/use-layout-mode';
import Button from '../../shared/ui/Button';
import LoadingState from '../../shared/ui/LoadingState';
import EmptyState from '../../shared/ui/EmptyState';
import ConfirmDialog from '../../shared/ui/ConfirmDialog';
import { Icons } from '../../shared/ui/icons';
import OverflowMenu, { type OverflowItem } from '../../shared/ui/OverflowMenu';

interface ProjectGalleryProps {
  /** Project currently loaded in the editor (highlighted, opens instantly). */
  openProjectId: string | null;
  onOpen: (doc: ProjectDoc) => void;
  /** A created project (and its picked files, possibly empty) to open. */
  onCreated: (doc: ProjectDoc, files: File[]) => void;
}

function formatWhen(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * The sources that can HOLD a project: this browser, plus every connected
 * instance whose capabilities say it has a document bucket. The connection
 * list is the argument only so a memo re-runs when a connection comes or
 * goes — `listSources()` is the store's mirror and reads nothing itself.
 */
function documentSourcesFor(connections: readonly unknown[]): SourceInfo[] {
  void connections;
  return listSources().filter((s) => s.capabilities.documents);
}

/** What this device knows about one instance's list of projects. */
type RemoteList =
  | { status: 'loading' }
  | { status: 'ok'; rows: RemoteProjectRow[] }
  | { status: 'failed'; text: string; login?: string };

function sourceLabel(id: string): string {
  return id === DEFAULT_SOURCE_ID ? 'this browser' : (sourceById(id)?.label ?? id);
}

function ProjectCard({
  doc,
  isOpen,
  remoteOnly,
  moveTargets,
  busy,
  onOpen,
  onDelete,
  onDuplicate,
  onMove,
}: {
  doc: ProjectDoc;
  isOpen: boolean;
  /** Kept on an instance and not yet mirrored here: opening pulls it first. */
  remoteOnly: boolean;
  /** The other sources this project could be moved to. */
  moveTargets: readonly SourceInfo[];
  /** A sentence while a move or a delete is under way, or null. */
  busy: string | null;
  onOpen: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMove: (targetSourceId: string) => void;
}) {
  const compact = useIsCompact();
  const thumbUrl = useObjectUrl(doc.thumbnail);
  const [confirming, setConfirming] = useState<
    { kind: 'delete' } | { kind: 'move'; to: SourceInfo } | null
  >(null);
  const aspect = ASPECT_PRESETS.find((a) => a.id === doc.settings.aspectId);

  // The WHOLE card opens the project (the trip card's rule since 2026-09-07):
  // the preview and the name are the two things you pick a card by, and a
  // separate "Open" button under them was a third target for one intent.
  // Everything else is behind the ⋯, with the destructive verb apart.
  const items: OverflowItem[] = [
    { id: 'open', label: isOpen ? 'Resume' : remoteOnly ? 'Open here' : 'Open', onSelect: onOpen },
    ...(!remoteOnly
      ? [
          {
            id: 'template',
            label: 'Use as template',
            title: "New project reusing this one's overlays, look and settings",
            onSelect: onDuplicate,
          },
        ]
      : []),
    ...(!remoteOnly
      ? moveTargets.map((target) => ({
          id: `move:${target.id}`,
          label: `Move to ${sourceLabel(target.id)}…`,
          onSelect: () => setConfirming({ kind: 'move', to: target }),
        }))
      : []),
    { id: 'delete', label: 'Delete…', danger: true, onSelect: () => setConfirming({ kind: 'delete' }) },
  ];

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Open ${doc.name}`}
      aria-disabled={busy !== null}
      onClick={() => {
        if (busy === null) onOpen();
      }}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
          e.preventDefault();
          if (busy === null) onOpen();
        }
      }}
      className={`group relative flex flex-col bg-surface border rounded-paper-lg shadow-paper-soft cursor-pointer transition-[transform,box-shadow,border-color] duration-300 ease-paper hover:-translate-y-1 hover:shadow-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
        isOpen ? 'border-accent' : 'border-line hover:border-line-strong'
      } ${remoteOnly ? 'opacity-75' : ''} ${busy !== null ? 'cursor-default' : ''}`}
    >
      {/* The card no longer clips (the ⋯ menu opens past its edge), so the
          preview rounds its own top corners. */}
      <div className="block w-full bg-frame leading-[0] rounded-t-paper-lg overflow-hidden">
        {thumbUrl ? (
          <img src={thumbUrl} alt="" className="block w-full aspect-video object-cover" />
        ) : (
          <div className="w-full aspect-video flex items-center justify-center text-muted font-mono text-xs">
            {remoteOnly ? 'preview drawn once opened here' : 'no preview yet'}
          </div>
        )}
      </div>

      <div
        className={`flex flex-col ${
          compact ? 'gap-1.5 p-2.5' : 'gap-[0.55rem] p-[0.9rem_1rem_1rem]'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <h3
            className={`m-0 flex-1 min-w-0 font-semibold whitespace-nowrap overflow-hidden text-ellipsis ${
              compact ? 'text-sm' : 'text-base'
            }`}
            title={doc.name}
          >
            {doc.name}
          </h3>
          {isOpen && (
            <span className="flex-none font-mono text-3xs tracking-[0.08em] uppercase px-1.5 py-[2px] rounded-[6px] bg-accent-wash text-accent-ink">
              open
            </span>
          )}
          {busy === null && (
            <OverflowMenu label={`More actions for ${doc.name}`} items={items} className="-mr-1.5" />
          )}
        </div>

        <p
          className={`m-0 font-mono tabular-nums text-muted flex flex-wrap items-center gap-x-2 ${
            compact ? 'text-3xs' : 'text-2xs'
          }`}
        >
          {aspect && (
            <>
              <span className="text-ink-soft">{aspect.id}</span>
              <span className="text-faint">·</span>
            </>
          )}
          <span>{formatWhen(doc.updatedAt)}</span>
          {doc.durationSeconds != null && doc.durationSeconds > 0 && (
            <>
              <span className="text-faint">·</span>
              <span>{formatDuration(doc.durationSeconds)}</span>
            </>
          )}
          <span className="text-faint">·</span>
          <span>
            {doc.elements.length} element{doc.elements.length === 1 ? '' : 's'}
          </span>
          {doc.media.files.length > 0 && (
            <>
              <span className="text-faint">·</span>
              <span>
                {doc.media.files.length} file{doc.media.files.length === 1 ? '' : 's'}
              </span>
            </>
          )}
        </p>

        {remoteOnly && (
          <p className="m-0 font-mono text-2xs text-faint">
            on {sourceLabel(doc.sourceId)} · not yet on this device
          </p>
        )}
        {busy && (
          <p className="m-0 font-mono text-2xs text-muted" role="status">
            {busy}
          </p>
        )}
      </div>

      {confirming?.kind === 'delete' && (
        <ConfirmDialog
          title={`Delete “${doc.name}”?`}
          confirmLabel="Delete"
          danger
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null);
            onDelete();
          }}
        >
          <p>
            Its overlays, look and settings go with it. The media files stay
            where they are.
          </p>
        </ConfirmDialog>
      )}
      {confirming?.kind === 'move' && (
        <ConfirmDialog
          title={`Move “${doc.name}” to ${sourceLabel(confirming.to.id)}?`}
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
            The project will be kept there from now on, and reopen from any
            device connected to it. Its media never travels.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}

/**
 * The studio's front door: saved projects as cards (thumbnail baked at save
 * time, so nothing decodes), newest first, grouped by the source they are
 * kept on. Opening reconciles media in the shell; creating goes through the
 * modal. Deleting is a two-step confirm kept inside the card.
 *
 * A connected instance's list is asked for beside the local one and merged
 * by id — the same shape as the Road Trip gallery: a project mirrored here is
 * one card, a project only there is a greyed card that pulls on open (its
 * media folder is this machine's to point at once it is here). When the
 * instance cannot answer, the header says so and the mirrors stay.
 */
export default function ProjectGallery({
  openProjectId,
  onOpen,
  onCreated,
}: ProjectGalleryProps) {
  const [projects, setProjects] = useState<ProjectDoc[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [remoteLists, setRemoteLists] = useState<Record<string, RemoteList>>({});
  const [busy, setBusy] = useState<Record<string, string>>({});

  const connections = useSyncExternalStore(subscribeWinnowConnections, listWinnowConnections);
  const documentSources = useMemo(() => documentSourcesFor(connections), [connections]);
  const remoteSourceIds = useMemo(
    () => documentSources.filter((s) => isRemoteSource(s.id)).map((s) => s.id),
    [documentSources],
  );

  /**
   * Importing is two steps and the first one is a QUESTION — where the file
   * lands — so it is asked in a sheet at the moment it is decided, rather
   * than by a `<select>` that sat in the header at all times for a gesture
   * made twice a year. With one source there is nothing to ask, so the file
   * dialog opens straight away and no sheet is drawn.
   */
  const startImport = useCallback(() => {
    if (documentSources.length > 1) setImporting(true);
    else void handleImportRef.current(DEFAULT_SOURCE_ID);
  }, [documentSources.length]);

  // `handleImport` is declared below and is a fresh function every render, so
  // the bar reads it through a ref rather than listing it as a dependency.
  const handleImportRef = useRef<(sourceId: string) => Promise<void>>(async () => {});

  // On a phone the gallery's two verbs go in the thumb zone rather than in a
  // header row sharing its line with the title. They are STARTING points, not
  // sections, so the shell adds its own Library cell beside them and drops the
  // app-bar button — see `SectionBarRole`.
  const compact = useIsCompact();
  usePublishSectionBar(
    useMemo(
      () =>
        compact
          ? {
              sections: [
                { id: 'new', label: 'New project' },
                { id: 'import', label: 'Import' },
              ],
              active: null,
              label: 'Start a project',
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


  const refresh = useCallback(() => {
    void listProjects().then(setProjects);
    for (const id of remoteSourceIds) {
      const remote = remoteFor(id);
      if (!remote) continue;
      setRemoteLists((cur) => ({ ...cur, [id]: { status: 'loading' } }));
      void listRemoteProjects(remote).then(
        (rows) => setRemoteLists((cur) => ({ ...cur, [id]: { status: 'ok', rows } })),
        (err: unknown) => {
          const e = explainFailure(failureOf(err), remote);
          setRemoteLists((cur) => ({ ...cur, [id]: { status: 'failed', ...e } }));
        },
      );
    }
  }, [remoteSourceIds]);

  useEffect(refresh, [refresh]);

  const setBusyFor = (id: string, text: string | null) =>
    setBusy((cur) => {
      const next = { ...cur };
      if (text === null) delete next[id];
      else next[id] = text;
      return next;
    });

  /**
   * A project on an instance is written THERE first — one gesture, one
   * request, the result said. Nothing is kept here if the instance refused.
   */
  async function createOn(doc: ProjectDoc, verb: string): Promise<boolean> {
    if (!isRemoteSource(doc.sourceId)) {
      await putProject(doc);
      return true;
    }
    const remote = remoteFor(doc.sourceId);
    if (!remote) {
      setNotice(`${doc.sourceId} is not connected — nothing was ${verb}.`);
      return false;
    }
    const rec = await pushProject(remote, doc, null);
    if (rec.status !== 'synced') {
      await deleteSyncRecord(doc.id);
      const why = rec.error ? `: ${rec.error}` : '';
      setNotice(`Could not save to ${remote.label}${why} — nothing was ${verb}.`);
      return false;
    }
    await putProject(doc);
    return true;
  }

  async function handleCreate(choices: NewProjectChoices) {
    setNotice(null);
    const template = choices.templateId
      ? (projects ?? []).find((p) => p.id === choices.templateId)
      : undefined;
    const doc = createProjectDoc(
      choices.name,
      choices.aspectId,
      defaultElementsPreset(),
      DEFAULT_GUIDES,
      template,
    );
    doc.sourceId = choices.sourceId;
    doc.media = {
      dirHandle: choices.folder?.handle ?? null,
      files: choices.folder?.refs ?? [],
      activeId: null,
      // A template carries no in/out points, and no develop: both belong to
      // the footage.
      trims: {},
      develops: {},
    };
    setCreating(false);
    if (await createOn(doc, 'created')) onCreated(doc, choices.folder?.files ?? []);
  }

  /**
   * A project file becomes a NEW project rather than overwriting anything —
   * the common case is a settings file someone sent you. (Replacing the open
   * project's settings is the other half, in the editor's settings modal.)
   */
  async function handleImport(targetSourceId: string) {
    const picked = await pickFile(PROJECT_FILE_ACCEPT);
    if (!picked) return;
    await importFromFile(picked, targetSourceId);
  }

  /** The import itself — from the file dialog, or from a file dropped on the tile. */
  async function importFromFile(picked: File, targetSourceId: string) {
    setNotice(null);
    const parsed = parseProjectFile(await picked.text());
    if (!parsed.ok) {
      setNotice(parsed.error);
      return;
    }
    const fallback = picked.name.replace(/\.(atelier\.)?json$/i, '');
    const name = parsed.file.name.trim() || fallback || 'Imported project';
    const doc = applyProjectFile(
      createProjectDoc(name, parsed.file.settings.aspectId, [], DEFAULT_GUIDES),
      parsed.file,
    );
    doc.sourceId = documentSources.some((s) => s.id === targetSourceId)
      ? targetSourceId
      : DEFAULT_SOURCE_ID;
    if (await createOn(doc, 'imported')) refresh();
  }
  handleImportRef.current = handleImport;

  /**
   * Delete here, and there when the project is kept on an instance — guarded
   * by the revision this device holds, refused while the instance cannot be
   * reached: there are no tombstones.
   */
  async function handleDelete(doc: ProjectDoc, etagHint: string | null) {
    setNotice(null);
    if (isRemoteSource(doc.sourceId)) {
      const remote = remoteFor(doc.sourceId);
      if (!remote) {
        setNotice(`Connect ${doc.sourceId} to delete this project — it is kept there.`);
        return;
      }
      setBusyFor(doc.id, `deleting on ${remote.label}…`);
      const etag = etagHint ?? (await getSyncRecord(doc.id))?.etag ?? null;
      try {
        await deleteRemoteProject(remote, doc.id, etag);
      } catch (err) {
        const f = failureOf(err);
        if (f.kind !== 'notfound') {
          setBusyFor(doc.id, null);
          const e = explainFailure(f, remote);
          setNotice(
            f.kind === 'unreachable'
              ? `Connect to ${remote.label} to delete this project — it is kept there.`
              : `Could not delete on ${remote.label}: ${e.text}`,
          );
          return;
        }
      }
    }
    await deleteProject(doc.id);
    await deleteSyncRecord(doc.id);
    setBusyFor(doc.id, null);
    refresh();
  }

  async function handleMove(doc: ProjectDoc, targetSourceId: string) {
    setNotice(null);
    setBusyFor(doc.id, `moving to ${sourceLabel(targetSourceId)}…`);
    const r = await moveProject(doc, targetSourceId);
    setBusyFor(doc.id, null);
    if (!r.ok) setNotice(r.error);
    refresh();
  }

  /** A project kept there and not here yet: pull, mirror, then open. */
  async function handleOpenRemote(row: RemoteProjectRow) {
    setNotice(null);
    setBusyFor(row.doc.id, `fetching from ${sourceLabel(row.doc.sourceId)}…`);
    await mirrorProject(row.doc.sourceId, row.doc, row.etag);
    setBusyFor(row.doc.id, null);
    onOpen(row.doc);
  }

  /** A new LOCAL project from another's portable half — a template is from no source. */
  function handleDuplicate(source: ProjectDoc) {
    const doc = createProjectDoc(
      `${source.name} (template)`,
      source.settings.aspectId,
      [],
      DEFAULT_GUIDES,
      source,
    );
    void putProject(doc).then(refresh);
  }

  // One group per source: the local ones from `groupBySource`, plus every
  // connected instance with a bucket even when nothing of it is mirrored yet,
  // so its header can say "checking…" or why it could not answer.
  const groups = useMemo(() => {
    if (projects === null) return [];
    const base = groupBySource(projects);
    const seen = new Set(base.map((g) => g.id));
    for (const id of remoteSourceIds) {
      if (!seen.has(id)) base.push({ id, items: [] });
    }
    return base.map((g) => {
      const list = remoteLists[g.id];
      const mirrored = new Set(g.items.map((p) => p.id));
      const remoteOnly =
        list?.status === 'ok' ? list.rows.filter((r) => !mirrored.has(r.doc.id)) : [];
      return { ...g, list, remoteOnly };
    });
  }, [projects, remoteSourceIds, remoteLists]);

  const nothingAnywhere =
    projects !== null && groups.every((g) => g.items.length === 0 && g.remoteOnly.length === 0);

  return (
    <section
      // The shell leaves no gutter between the fixed masthead and this
      // scroller, on purpose (`App.tsx`): a gap there is paper the content
      // gets clipped against. Breathing room belongs HERE instead, where it
      // scrolls away with the first row rather than holding it off the edge.
      className={`${pageScroll} ${compact ? 'pt-3' : ''}`}
      aria-label="Studio projects"
    >
      {/* The masthead already says "Atelier / Studio", and the gallery IS the
          Studio's front door — so a serif heading plus a sentence of prose was
          the top fifth of a phone screen spent introducing the projects it
          then had no room to show. Trips gave the same pair back; this matches
          it. The heading stays in the document for a screen reader and an
          outline, only its ink is given up. */}
      <h1 className="sr-only">Projects</h1>
      {/* On a phone these two verbs live in the shell's bottom bar instead,
          where a thumb reaches them — offering them in both places would be
          the same verb twice on one screen — so the row itself goes with them
          rather than leaving an empty one above the cards. */}
      {!compact && (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="font-serif text-2xl leading-none" aria-hidden="true">
            Projects
          </span>
          {projects !== null && (
            <span className="font-mono text-xs text-muted tabular-nums">{projects.length}</span>
          )}
          <span className="flex-1" />
          <Button
            onClick={startImport}
            icon={Icons.import}
            title={`Create a project from an exported settings file (${PROJECT_FILE_EXTENSION})`}
          >
            Import
          </Button>
          <Button variant="primary" onClick={() => setCreating(true)} icon={Icons.plus}>
            New project
          </Button>
        </div>
      )}

      {notice && (
        <p className="m-0 text-xs text-danger" role="alert">
          {notice}
        </p>
      )}

      {projects === null ? (
        <LoadingState label="Loading projects…" />
      ) : nothingAnywhere && remoteSourceIds.every((id) => remoteLists[id]?.status === 'ok') ? (
        <EmptyState
          title="No projects yet"
          actions={
            <>
              <Button variant="primary" onClick={() => setCreating(true)}>
                Create the first one
              </Button>
              <Button variant="ghost" onClick={startImport}>
                or import a project file
              </Button>
            </>
          }
        >
          A project keeps your overlays, look and layout — and remembers which
          folder its media lives in, so it reopens in one click.
        </EmptyState>
      ) : (
        // Grouped by provenance — one group per source, `local` first, even
        // while local is the only one: the day a Winnow instance appears its
        // projects land in their own section instead of reshaping this page.
        <div className="flex flex-col gap-6 pb-4">
          {groups.map(({ id, items, list, remoteOnly }) => {
            const source = sourceById(id);
            const count = items.length + remoteOnly.length;
            const moveTargets = documentSources.filter((s) => s.id !== id);
            return (
              <section key={id} aria-label={`Projects from ${source?.label ?? id}`}>
                <p className="m-0 mb-3 font-mono text-2xs tracking-[0.14em] uppercase text-muted">
                  source: {source?.label ?? id}
                  <span className="text-faint"> · </span>
                  <span className="tabular-nums">
                    {count} project{count === 1 ? '' : 's'}
                  </span>
                  {!source && (
                    <span className="text-faint">
                      {' '}
                      · not connected — media may be unreachable
                    </span>
                  )}
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
                      // Two columns on a phone, as Trips does: a 240px minimum
                      // gives exactly one on a 374px content width, and a
                      // column of single cards wastes the half of the screen a
                      // 16:9 preview does not need.
                      compact
                        ? 'grid grid-cols-2 gap-3'
                        : 'grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-5'
                    }
                  >
                    {items.map((doc) => (
                      <ProjectCard
                        key={doc.id}
                        doc={doc}
                        isOpen={doc.id === openProjectId}
                        remoteOnly={false}
                        moveTargets={moveTargets}
                        busy={busy[doc.id] ?? null}
                        onOpen={() => onOpen(doc)}
                        onDelete={() => void handleDelete(doc, null)}
                        onDuplicate={() => handleDuplicate(doc)}
                        onMove={(target) => void handleMove(doc, target)}
                      />
                    ))}
                    {id === DEFAULT_SOURCE_ID && (
                      <NewProjectTile
                        onCreate={() => setCreating(true)}
                        onDropFile={(file) => void importFromFile(file, DEFAULT_SOURCE_ID)}
                      />
                    )}
                    {remoteOnly.map((row) => (
                      <ProjectCard
                        key={row.doc.id}
                        doc={row.doc}
                        isOpen={false}
                        remoteOnly
                        moveTargets={[]}
                        busy={busy[row.doc.id] ?? null}
                        onOpen={() => void handleOpenRemote(row)}
                        onDelete={() => void handleDelete(row.doc, row.etag)}
                        onDuplicate={() => undefined}
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
          title="Import a project file"
          blurb={`Creates a new project from an exported ${PROJECT_FILE_EXTENSION} settings file — it never overwrites one you already have.`}
          sources={documentSources}
          onCancel={() => setImporting(false)}
          onChooseFile={(target) => {
            setImporting(false);
            void handleImport(target);
          }}
        />
      )}

      {creating && (
        <NewProjectModal
          templates={projects ?? []}
          sources={documentSources}
          onCancel={() => setCreating(false)}
          onCreate={(choices) => void handleCreate(choices)}
        />
      )}
    </section>
  );
}

/**
 * The dashed tile that completes the grid: a way to start a project where the
 * next card would be, and the drop zone for an exported settings file. A file
 * dropped anywhere else on the page does what the browser does with a file —
 * opens it — so the zone is drawn, and says what it takes.
 */
function NewProjectTile({
  onCreate,
  onDropFile,
}: {
  onCreate: () => void;
  onDropFile: (file: File) => void;
}) {
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
      <span className="text-sm font-semibold">New project</span>
      <span className="text-xs">or drop a {PROJECT_FILE_EXTENSION} file here</span>
    </button>
  );
}

