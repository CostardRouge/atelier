import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
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
  const thumbUrl = useObjectUrl(doc.thumbnail);
  const [confirming, setConfirming] = useState<'delete' | 'move' | null>(null);
  const [moveTo, setMoveTo] = useState(moveTargets[0]?.id ?? '');
  const aspect = ASPECT_PRESETS.find((a) => a.id === doc.settings.aspectId);

  return (
    <div
      className={`flex flex-col overflow-hidden bg-surface border rounded-paper-lg shadow-paper-soft transition-[transform,box-shadow,border-color] duration-300 ease-paper hover:-translate-y-1 hover:shadow-paper ${
        isOpen ? 'border-accent' : 'border-line hover:border-line-strong'
      } ${remoteOnly ? 'opacity-75' : ''}`}
    >
      <button
        type="button"
        onClick={onOpen}
        disabled={busy !== null}
        className="block w-full p-0 border-0 bg-frame cursor-pointer leading-[0] disabled:cursor-default"
        aria-label={`Open ${doc.name}`}
      >
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt=""
            className="block w-full aspect-video object-cover"
          />
        ) : (
          <div className="w-full aspect-video flex items-center justify-center text-[#8c8576] font-mono text-[0.72rem]">
            {remoteOnly ? 'preview drawn once opened here' : 'no preview yet'}
          </div>
        )}
      </button>

      <div className="flex flex-col gap-[0.55rem] p-[0.9rem_1rem_1rem]">
        <div className="flex items-center gap-2 min-w-0">
          <h3
            className="m-0 flex-1 min-w-0 text-[0.95rem] font-semibold whitespace-nowrap overflow-hidden text-ellipsis"
            title={doc.name}
          >
            {doc.name}
          </h3>
          {aspect && (
            <span className="flex-none font-mono text-[0.62rem] tracking-[0.08em] px-2 py-[2px] rounded-full border border-line text-muted">
              {aspect.id}
            </span>
          )}
        </div>

        <p className="m-0 font-mono text-[0.7rem] tabular-nums text-muted flex flex-wrap items-center gap-x-2">
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
          <p className="m-0 font-mono text-[0.66rem] text-faint">
            on {sourceLabel(doc.sourceId)} · not yet on this device
          </p>
        )}
        {busy && (
          <p className="m-0 font-mono text-[0.66rem] text-muted" role="status">
            {busy}
          </p>
        )}

        <div className="flex items-center gap-3 pt-1 flex-wrap">
          <button
            type="button"
            onClick={onOpen}
            disabled={busy !== null}
            className="px-3.5 py-[0.45rem] inline-flex items-center border border-ink rounded-full bg-ink text-paper cursor-pointer text-[0.78rem] font-semibold transition-colors duration-200 ease-paper hover:bg-accent hover:border-accent disabled:opacity-50"
          >
            {isOpen ? 'Resume' : remoteOnly ? 'Open here' : 'Open'}
          </button>
          {!remoteOnly && confirming === null && (
            <button
              type="button"
              onClick={onDuplicate}
              className="p-0 border-0 bg-transparent text-[0.75rem] text-muted cursor-pointer underline underline-offset-[3px] hover:text-accent-ink"
              title="New project reusing this one's overlays, look and settings"
            >
              Use as template
            </button>
          )}
          <span className="flex-1" />
          {confirming === null && (
            <>
              {moveTargets.length > 0 && !remoteOnly && (
                <button
                  type="button"
                  onClick={() => setConfirming('move')}
                  className="p-0 border-0 bg-transparent text-[0.75rem] text-faint cursor-pointer hover:text-accent-ink"
                  title="Keep this project on another source"
                >
                  Move…
                </button>
              )}
              <button
                type="button"
                onClick={() => setConfirming('delete')}
                className="p-0 border-0 bg-transparent text-[0.75rem] text-faint cursor-pointer hover:text-[#9a3a23]"
                aria-label={`Delete ${doc.name}`}
              >
                Delete
              </button>
            </>
          )}
          {confirming === 'delete' && (
            <span className="flex items-center gap-2 text-[0.75rem]">
              <button
                type="button"
                onClick={() => {
                  setConfirming(null);
                  onDelete();
                }}
                className="p-0 border-0 bg-transparent text-[#9a3a23] font-semibold cursor-pointer underline underline-offset-[3px]"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={() => setConfirming(null)}
                className="p-0 border-0 bg-transparent text-muted cursor-pointer"
              >
                Keep
              </button>
            </span>
          )}
          {confirming === 'move' && (
            <span className="flex items-center gap-2 text-[0.75rem] flex-wrap">
              <label className="inline-flex items-center gap-1.5 text-muted">
                to
                <select
                  value={moveTo}
                  onChange={(e) => setMoveTo(e.target.value)}
                  className="font-sans text-[0.75rem] px-2 py-0.5 border border-line rounded-full bg-paper text-ink focus:outline-none focus:border-accent"
                  aria-label="Move this project to"
                >
                  {moveTargets.map((s) => (
                    <option key={s.id} value={s.id}>
                      {sourceLabel(s.id)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => {
                  setConfirming(null);
                  if (moveTo) onMove(moveTo);
                }}
                className="p-0 border-0 bg-transparent text-accent-ink font-semibold cursor-pointer underline underline-offset-[3px]"
              >
                Move
              </button>
              <button
                type="button"
                onClick={() => setConfirming(null)}
                className="p-0 border-0 bg-transparent text-muted cursor-pointer"
              >
                Cancel
              </button>
            </span>
          )}
        </div>
      </div>
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
  const [notice, setNotice] = useState<string | null>(null);
  const [remoteLists, setRemoteLists] = useState<Record<string, RemoteList>>({});
  const [busy, setBusy] = useState<Record<string, string>>({});

  const connections = useSyncExternalStore(subscribeWinnowConnections, listWinnowConnections);
  const documentSources = useMemo(() => documentSourcesFor(connections), [connections]);
  const remoteSourceIds = useMemo(
    () => documentSources.filter((s) => isRemoteSource(s.id)).map((s) => s.id),
    [documentSources],
  );
  // Where an imported file lands. Only offered when there is a choice.
  const [importTarget, setImportTarget] = useState(DEFAULT_SOURCE_ID);

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
      // A template carries no in/out points: they belong to the footage.
      trims: {},
    };
    setCreating(false);
    if (await createOn(doc, 'created')) onCreated(doc, choices.folder?.files ?? []);
  }

  /**
   * A project file becomes a NEW project rather than overwriting anything —
   * the common case is a settings file someone sent you. (Replacing the open
   * project's settings is the other half, in the editor's settings modal.)
   */
  async function handleImport() {
    const picked = await pickFile(PROJECT_FILE_ACCEPT);
    if (!picked) return;
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
    doc.sourceId = documentSources.some((s) => s.id === importTarget)
      ? importTarget
      : DEFAULT_SOURCE_ID;
    if (await createOn(doc, 'imported')) refresh();
  }

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
      className="flex flex-col flex-1 min-h-0 gap-5 overflow-auto"
      aria-label="Studio projects"
    >
      <div className="flex items-center gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="m-0 font-serif text-[1.6rem] leading-tight">Projects</h1>
          <p className="m-0 text-[0.84rem] text-muted">
            Compositions live here — media stays in your folders, never copied.
          </p>
        </div>
        <span className="flex-1" />
        {documentSources.length > 1 && (
          <label className="inline-flex items-center gap-2 font-mono text-[0.66rem] tracking-[0.12em] uppercase text-muted">
            import to
            <select
              value={importTarget}
              onChange={(e) => setImportTarget(e.target.value)}
              className="font-sans normal-case tracking-normal text-[0.8rem] px-2.5 py-1 border border-line rounded-full bg-paper text-ink focus:outline-none focus:border-accent"
              aria-label="Where an imported project is kept"
            >
              {documentSources.map((s) => (
                <option key={s.id} value={s.id}>
                  {sourceLabel(s.id)}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="button"
          onClick={() => void handleImport()}
          className="px-[1.1rem] py-2 inline-flex items-center gap-2 border border-line-strong rounded-full bg-paper text-ink-soft cursor-pointer text-[0.84rem] transition-colors hover:border-accent hover:text-accent-ink"
          title={`Create a project from an exported settings file (${PROJECT_FILE_EXTENSION})`}
        >
          ↑ Import a project file
        </button>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="px-[1.1rem] py-2 inline-flex items-center gap-2 border border-ink rounded-full bg-ink text-paper cursor-pointer text-[0.84rem] font-semibold transition-[transform,background-color,color] duration-200 ease-paper hover:bg-accent hover:border-accent active:scale-[0.98]"
        >
          + New project
        </button>
      </div>

      {notice && (
        <p className="m-0 text-[0.8rem] text-[#9a3a23]" role="alert">
          {notice}
        </p>
      )}

      {projects === null ? (
        <p className="m-0 text-[0.85rem] text-muted font-mono">Loading projects…</p>
      ) : nothingAnywhere && remoteSourceIds.every((id) => remoteLists[id]?.status === 'ok') ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-[42ch] flex flex-col items-center gap-3 border border-dashed border-line-strong rounded-paper-lg px-8 py-10">
            <p className="m-0 font-serif text-[1.25rem]">No projects yet</p>
            <p className="m-0 text-[0.85rem] text-muted leading-relaxed">
              A project keeps your overlays, look and layout — and remembers
              which folder its media lives in, so it reopens in one click.
            </p>
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="mt-1 px-[1.1rem] py-2 inline-flex items-center gap-2 border border-ink rounded-full bg-ink text-paper cursor-pointer text-[0.84rem] font-semibold hover:bg-accent hover:border-accent"
            >
              Create the first one
            </button>
            <button
              type="button"
              onClick={() => void handleImport()}
              className="p-0 border-0 bg-transparent text-[0.78rem] text-muted cursor-pointer underline underline-offset-[3px] hover:text-accent-ink"
            >
              or import a project file
            </button>
          </div>
        </div>
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
                <p className="m-0 mb-3 font-mono text-[0.66rem] tracking-[0.14em] uppercase text-muted">
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
                {count === 0 ? (
                  <p className="m-0 text-[0.8rem] text-faint">Nothing kept here yet.</p>
                ) : (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-5">
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
