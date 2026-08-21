import { useEffect, useRef, useState } from 'react';
import { ASPECT_PRESETS } from '../../shared/projects/project-types';

interface ProjectSettingsModalProps {
  name: string;
  aspectId: string;
  onCancel: () => void;
  onApply: (next: { name: string; aspectId: string }) => void;
}

const field = 'flex flex-col gap-1.5';
const legend = 'font-mono text-[0.64rem] tracking-[0.14em] uppercase text-muted';

/**
 * Project settings, DaVinci-style: everything chosen at creation stays
 * editable mid-flight. Today that's the name and the destination format;
 * future settings (frame rate, background, units) join here, not in new
 * scattered dialogs.
 */
export default function ProjectSettingsModal({
  name,
  aspectId,
  onCancel,
  onApply,
}: ProjectSettingsModalProps) {
  const [draftName, setDraftName] = useState(name);
  const [draftAspect, setDraftAspect] = useState(aspectId);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // Mount-only: the modal is short-lived.
  }, []);

  function apply() {
    onApply({ name: draftName.trim() || name, aspectId: draftAspect });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgba(20,18,15,0.45)] backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="Project settings"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-[28rem] max-h-[90vh] overflow-auto flex flex-col gap-5 bg-surface border border-line rounded-paper-lg shadow-paper p-6">
        <div>
          <h2 className="m-0 font-serif text-[1.4rem]">Project settings</h2>
        </div>

        <label className={field}>
          <span className={legend}>Name</span>
          <input
            ref={nameRef}
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') apply();
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
                onClick={() => setDraftAspect(a.id)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-paper border text-left cursor-pointer transition-colors ${
                  draftAspect === a.id
                    ? 'border-accent bg-accent-wash'
                    : 'border-line bg-paper hover:border-line-strong'
                }`}
                aria-pressed={draftAspect === a.id}
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
            The project's format seeds new export variants; the Export tab can
            still add other formats per variant.
          </p>
        </fieldset>

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
            onClick={apply}
            className="mt-4 px-[1.1rem] py-2 inline-flex items-center border border-ink rounded-full bg-ink text-paper cursor-pointer text-[0.84rem] font-semibold transition-colors duration-200 ease-paper hover:bg-accent hover:border-accent"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
