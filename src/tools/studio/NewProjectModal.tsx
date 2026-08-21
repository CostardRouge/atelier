import { useEffect, useRef, useState } from 'react';
import {
  pickDirectoryWithHandle,
  type PersistedDirectoryHandle,
} from '../../shared/sources/file-sources';
import {
  ASPECT_PRESETS,
  savedMediaRef,
  type ProjectDoc,
  type SavedMediaRef,
} from '../../shared/projects/project-types';

export interface NewProjectChoices {
  name: string;
  aspectId: string;
  /** Reuse another project's overlays/look/guides. */
  templateId: string | null;
  /** The media folder picked in the modal, if any. */
  folder: {
    handle: PersistedDirectoryHandle | null;
    files: File[];
    refs: SavedMediaRef[];
  } | null;
}

interface NewProjectModalProps {
  templates: ProjectDoc[];
  onCancel: () => void;
  onCreate: (choices: NewProjectChoices) => void;
}

const field = 'flex flex-col gap-1.5';
const legend = 'font-mono text-[0.64rem] tracking-[0.14em] uppercase text-muted';

/**
 * The After-Effects-style intro: name the project, pick the destination
 * aspect, optionally start from a template and point the media folder. Aspect
 * presets are destination-named — a creator thinks "Reels", not "1080×1920".
 * (The aspect drives real composition framing when templates land; until then
 * it's stored and shown on the gallery card.)
 */
export default function NewProjectModal({
  templates,
  onCancel,
  onCreate,
}: NewProjectModalProps) {
  const [name, setName] = useState('Untitled project');
  const [aspectId, setAspectId] = useState(ASPECT_PRESETS[0].id);
  const [templateId, setTemplateId] = useState<string>('');
  const [folder, setFolder] = useState<NewProjectChoices['folder']>(null);
  const [picking, setPicking] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // Mount-only: the modal is short-lived.
  }, []);

  async function pickFolder() {
    setPicking(true);
    try {
      const picked = await pickDirectoryWithHandle();
      if (picked.files.length || picked.handle) {
        setFolder({
          handle: picked.handle,
          files: picked.files,
          refs: picked.files.map(savedMediaRef),
        });
      }
    } finally {
      setPicking(false);
    }
  }

  function submit() {
    onCreate({
      name: name.trim() || 'Untitled project',
      aspectId,
      templateId: templateId || null,
      folder,
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgba(20,18,15,0.45)] backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="New project"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-[30rem] max-h-[90vh] overflow-auto flex flex-col gap-5 bg-surface border border-line rounded-paper-lg shadow-paper p-6">
        <div>
          <h2 className="m-0 font-serif text-[1.4rem]">New project</h2>
          <p className="m-0 mt-1 text-[0.82rem] text-muted">
            Everything can be changed later.
          </p>
        </div>

        <label className={field}>
          <span className={legend}>Name</span>
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
            className="font-sans text-[0.95rem] px-3.5 py-2 border border-line-strong rounded-paper bg-paper text-ink focus:outline-none focus:border-accent"
          />
        </label>

        <fieldset className="m-0 p-0 border-0 flex flex-col gap-1.5">
          <span className={legend}>Format</span>
          <div className="grid grid-cols-2 gap-2">
            {ASPECT_PRESETS.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setAspectId(a.id)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-paper border text-left cursor-pointer transition-colors ${
                  aspectId === a.id
                    ? 'border-accent bg-accent-wash'
                    : 'border-line bg-paper hover:border-line-strong'
                }`}
                aria-pressed={aspectId === a.id}
              >
                <span
                  className="flex-none border-[1.5px] border-ink-soft rounded-[2px]"
                  style={{
                    width: a.w >= a.h ? 26 : Math.round((26 * a.w) / a.h),
                    height: a.w >= a.h ? Math.round((26 * a.h) / a.w) : 26,
                  }}
                  aria-hidden="true"
                />
                <span className="min-w-0">
                  <span className="block font-semibold text-[0.82rem]">{a.id}</span>
                  <span className="block text-[0.7rem] text-muted truncate">
                    {a.label}
                  </span>
                </span>
              </button>
            ))}
          </div>
          <p className="m-0 text-[0.7rem] text-faint">
            Shown on the project card; drives composition framing when export
            templates land.
          </p>
        </fieldset>

        {templates.length > 0 && (
          <label className={field}>
            <span className={legend}>Start from</span>
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="font-sans text-[0.9rem] px-3 py-2 border border-line-strong rounded-paper bg-paper text-ink cursor-pointer focus:outline-none focus:border-accent"
            >
              <option value="">Blank</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} — overlays, look &amp; settings
                </option>
              ))}
            </select>
          </label>
        )}

        <div className={field}>
          <span className={legend}>Media folder (optional)</span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void pickFolder()}
              disabled={picking}
              className="px-3.5 py-2 inline-flex items-center gap-2 border border-line-strong rounded-full bg-paper text-[0.82rem] font-semibold text-ink cursor-pointer hover:border-accent disabled:opacity-60"
            >
              {picking ? 'Opening…' : folder ? 'Change folder…' : 'Choose folder…'}
            </button>
            {folder && (
              <span className="text-[0.78rem] text-muted min-w-0 truncate">
                {folder.handle?.name ?? 'folder'} · {folder.files.length} file
                {folder.files.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
          <p className="m-0 text-[0.7rem] text-faint">
            The folder is remembered (never copied) so the project reopens in
            one click. You can also just drop files in the Library later.
          </p>
        </div>

        <div className="flex items-center justify-end gap-4 pt-1 border-t border-line">
          <button
            type="button"
            onClick={onCancel}
            className="p-0 mt-4 border-0 bg-transparent text-[0.84rem] text-muted cursor-pointer hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            className="mt-4 px-[1.1rem] py-2 inline-flex items-center border border-ink rounded-full bg-ink text-paper cursor-pointer text-[0.84rem] font-semibold transition-colors duration-200 ease-paper hover:bg-accent hover:border-accent"
          >
            Create project
          </button>
        </div>
      </div>
    </div>
  );
}
