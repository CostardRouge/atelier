import { useCallback, useEffect, useState } from 'react';
import { formatDuration } from '../../shared/lib/format';
import { useObjectUrl } from '../../shared/media/use-object-url';
import {
  ASPECT_PRESETS,
  createProjectDoc,
  type ProjectDoc,
} from '../../shared/projects/project-types';
import {
  deleteProject,
  listProjects,
  putProject,
} from '../../shared/projects/project-store';
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

function ProjectCard({
  doc,
  isOpen,
  onOpen,
  onDelete,
  onDuplicate,
}: {
  doc: ProjectDoc;
  isOpen: boolean;
  onOpen: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const thumbUrl = useObjectUrl(doc.thumbnail);
  const [confirming, setConfirming] = useState(false);
  const aspect = ASPECT_PRESETS.find((a) => a.id === doc.settings.aspectId);

  return (
    <div
      className={`flex flex-col overflow-hidden bg-surface border rounded-paper-lg shadow-paper-soft transition-[transform,box-shadow,border-color] duration-300 ease-paper hover:-translate-y-1 hover:shadow-paper ${
        isOpen ? 'border-accent' : 'border-line hover:border-line-strong'
      }`}
    >
      <button
        type="button"
        onClick={onOpen}
        className="block w-full p-0 border-0 bg-frame cursor-pointer leading-[0]"
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
            no preview yet
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

        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            onClick={onOpen}
            className="px-3.5 py-[0.45rem] inline-flex items-center border border-ink rounded-full bg-ink text-paper cursor-pointer text-[0.78rem] font-semibold transition-colors duration-200 ease-paper hover:bg-accent hover:border-accent"
          >
            {isOpen ? 'Resume' : 'Open'}
          </button>
          <button
            type="button"
            onClick={onDuplicate}
            className="p-0 border-0 bg-transparent text-[0.75rem] text-muted cursor-pointer underline underline-offset-[3px] hover:text-accent-ink"
            title="New project reusing this one's overlays, look and settings"
          >
            Use as template
          </button>
          <span className="flex-1" />
          {confirming ? (
            <span className="flex items-center gap-2 text-[0.75rem]">
              <button
                type="button"
                onClick={onDelete}
                className="p-0 border-0 bg-transparent text-[#9a3a23] font-semibold cursor-pointer underline underline-offset-[3px]"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="p-0 border-0 bg-transparent text-muted cursor-pointer"
              >
                Keep
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="p-0 border-0 bg-transparent text-[0.75rem] text-faint cursor-pointer hover:text-[#9a3a23]"
              aria-label={`Delete ${doc.name}`}
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The studio's front door: saved projects as cards (thumbnail baked at save
 * time, so nothing decodes), newest first. Opening reconciles media in the
 * shell; creating goes through the modal. Deleting is a two-step confirm kept
 * inside the card.
 */
export default function ProjectGallery({
  openProjectId,
  onOpen,
  onCreated,
}: ProjectGalleryProps) {
  const [projects, setProjects] = useState<ProjectDoc[] | null>(null);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(() => {
    void listProjects().then(setProjects);
  }, []);

  useEffect(refresh, [refresh]);

  async function handleCreate(choices: NewProjectChoices) {
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
    doc.media = {
      dirHandle: choices.folder?.handle ?? null,
      files: choices.folder?.refs ?? [],
      activeId: null,
    };
    await putProject(doc);
    setCreating(false);
    onCreated(doc, choices.folder?.files ?? []);
  }

  async function handleDelete(id: string) {
    await deleteProject(id);
    refresh();
  }

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
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="px-[1.1rem] py-2 inline-flex items-center gap-2 border border-ink rounded-full bg-ink text-paper cursor-pointer text-[0.84rem] font-semibold transition-[transform,background-color,color] duration-200 ease-paper hover:bg-accent hover:border-accent active:scale-[0.98]"
        >
          + New project
        </button>
      </div>

      {projects === null ? (
        <p className="m-0 text-[0.85rem] text-muted font-mono">Loading projects…</p>
      ) : projects.length === 0 ? (
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
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-5 pb-4">
          {projects.map((doc) => (
            <ProjectCard
              key={doc.id}
              doc={doc}
              isOpen={doc.id === openProjectId}
              onOpen={() => onOpen(doc)}
              onDelete={() => void handleDelete(doc.id)}
              onDuplicate={() => handleDuplicate(doc)}
            />
          ))}
        </div>
      )}

      {creating && (
        <NewProjectModal
          templates={projects ?? []}
          onCancel={() => setCreating(false)}
          onCreate={(choices) => void handleCreate(choices)}
        />
      )}
    </section>
  );
}
