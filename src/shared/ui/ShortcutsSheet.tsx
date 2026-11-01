import type { ReactNode } from 'react';
import useDialogKeys from './use-dialog-keys';

export interface Shortcut {
  /** What to press, as the key caps read on the machine. */
  keys: string;
  what: string;
}

export interface ShortcutGroup {
  title: string;
  rows: readonly Shortcut[];
}

/**
 * Every key and gesture an editor answers, as a sheet over it — Develop's
 * (`DevelopShortcuts.tsx`), shared so another editor says its own in the same
 * form: the key caps right-aligned in a column, what they do beside them,
 * grouped. Closed by Escape, Enter, its button, a press on the backdrop, or the
 * same key that opened it (the host's handler). A whole screen under 820 px.
 */
export default function ShortcutsSheet({ groups, foot, onClose }: { groups: readonly ShortcutGroup[]; foot?: ReactNode; onClose: () => void }) {
  useDialogKeys({ onCancel: onClose, onConfirm: onClose });
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgba(20,18,15,0.55)] backdrop-blur-[2px] max-[820px]:p-0"
      role="dialog"
      aria-modal="true"
      aria-label="Keys and gestures"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-[34rem] max-h-[min(calc(var(--app-h)*0.9),44rem)] overflow-y-auto overscroll-contain flex flex-col gap-4 bg-surface border border-line rounded-paper-lg shadow-paper p-4 max-[820px]:max-w-none max-[820px]:h-[var(--app-h)] max-[820px]:max-h-none max-[820px]:rounded-none max-[820px]:border-0 max-[820px]:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex-none flex items-center gap-2.5 min-w-0">
          <h2 className="m-0 font-serif text-lg min-w-0 truncate">Keys and gestures</h2>
          <span className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="flex-none inline-flex items-center h-[2.125rem] font-mono text-3xs tracking-[0.12em] uppercase text-muted border border-line rounded-full px-3.5 hover:text-accent hover:border-line-strong transition-colors cursor-pointer"
            aria-label="Close"
          >
            close ✕
          </button>
        </div>
        {groups.map((group) => (
          <section key={group.title} className="flex flex-col gap-1.5">
            <h3 className="m-0 font-mono text-2xs tracking-[0.14em] uppercase text-muted">{group.title}</h3>
            <dl className="m-0 grid grid-cols-[minmax(0,9rem)_1fr] gap-x-3 gap-y-1 items-baseline">
              {group.rows.map((row) => (
                <div key={row.keys + row.what} className="contents">
                  <dt className="m-0 font-mono text-2xs text-ink-soft text-right">{row.keys}</dt>
                  <dd className="m-0 font-mono text-2xs text-faint leading-relaxed">{row.what}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        {foot ? <p className="m-0 font-mono text-2xs text-faint leading-relaxed">{foot}</p> : null}
      </div>
    </div>
  );
}
