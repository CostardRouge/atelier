import { useEffect, useRef, useState } from 'react';
import { DEFAULT_SOURCE_ID, type SourceInfo } from '../../shared/sources/source';
import useDialogKeys from '../../shared/ui/use-dialog-keys';

export interface NewRollChoices {
  name: string;
  sourceId: string;
  /** Start with the photos ticked in the Library. */
  withSelected: boolean;
}

const legend = 'font-mono text-2xs tracking-[0.14em] uppercase text-muted';
const field =
  'font-sans text-base px-3.5 py-2 border border-line-strong rounded-paper bg-paper text-ink focus:outline-none focus:border-accent';

/** "Roll · 15 Sep" — a name to replace, never a blank one to fill in. */
function defaultName(now = new Date()): string {
  return `Roll · ${now.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
}

/**
 * A new roll in one sheet: its name, where it is kept (asked only when a
 * second source can keep rolls — the trip and project pickers' rule), and
 * whether it starts with the photos already ticked in the Library, which is
 * how most rolls begin.
 */
export default function NewRollModal({
  sources,
  selectedCount,
  onCancel,
  onCreate,
}: {
  sources: readonly SourceInfo[];
  selectedCount: number;
  onCancel: () => void;
  onCreate: (choices: NewRollChoices) => void;
}) {
  const [name, setName] = useState(defaultName);
  const [sourceId, setSourceId] = useState(DEFAULT_SOURCE_ID);
  const [withSelected, setWithSelected] = useState(selectedCount > 0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  const create = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate({ name: trimmed, sourceId, withSelected: withSelected && selectedCount > 0 });
  };
  useDialogKeys({ onCancel, onConfirm: name.trim() ? create : null });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgba(20,18,15,0.45)] backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="New roll"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      {/* Not a <form>: Enter is `useDialogKeys`' on the window, and a native
          submit would run the same create a second time. */}
      <div className="w-full max-w-[26rem] flex flex-col gap-5 bg-surface border border-line rounded-paper-lg shadow-paper p-6">
        <div>
          <h2 className="m-0 font-serif text-2xl">New roll</h2>
          <p className="m-0 mt-1 text-sm text-muted">
            The photographs you mean to develop, each keeping its own light and colour.
          </p>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className={legend}>Name</span>
          <input ref={inputRef} value={name} onChange={(e) => setName(e.target.value)} className={field} />
        </label>

        {sources.length > 1 && (
          <label className="flex flex-col gap-1.5">
            <span className={legend}>Keep on</span>
            <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} className={field}>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.id === DEFAULT_SOURCE_ID ? 'this browser (local)' : s.label}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className={`flex items-center gap-2 text-sm ${selectedCount === 0 ? 'text-faint' : 'text-ink'}`}>
          <input
            type="checkbox"
            checked={withSelected && selectedCount > 0}
            disabled={selectedCount === 0}
            onChange={(e) => setWithSelected(e.target.checked)}
          />
          {selectedCount === 0
            ? 'Nothing ticked in the Library — add pictures once it is open'
            : `Start with the ${selectedCount === 1 ? 'photo' : `${selectedCount} photos`} ticked in the Library`}
        </label>

        <div className="flex items-center justify-end gap-4 pt-1 border-t border-line">
          <button
            type="button"
            onClick={onCancel}
            className="p-0 mt-4 border-0 bg-transparent text-sm text-muted cursor-pointer hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={create}
            disabled={!name.trim()}
            className="mt-4 px-[1.1rem] py-2 inline-flex items-center border border-ink rounded-full bg-ink text-paper cursor-pointer text-sm font-semibold transition-colors duration-200 ease-paper hover:bg-accent hover:border-accent disabled:opacity-40 disabled:cursor-default"
          >
            Create roll
          </button>
        </div>
      </div>
    </div>
  );
}
