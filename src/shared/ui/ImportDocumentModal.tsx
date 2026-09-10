/**
 * "Where does an imported document land?", asked once, at the moment it is
 * actually being decided.
 *
 * It used to be a `<select>` sitting permanently in a gallery's header — a
 * control useful for the two seconds of a rare gesture and in the way the rest
 * of the time, on a phone especially, where that header has to share one line
 * with the title. Folding it in here also means it can simply not appear when
 * there is nothing to choose: with one document source the modal is a
 * sentence and a button.
 *
 * Engine-level since the Studio became its second consumer, the same move
 * `StylePanel`, `GradePanel` and `SectionLegend` each made — a tool never
 * reaches into another tool, so the generic half moves out rather than being
 * copied. Everything specific to a document KIND is a prop: its noun, the
 * extension it reads, and what the sentence promises.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_SOURCE_ID, type SourceInfo } from '../sources/source';
import useDialogKeys from './use-dialog-keys';

export interface ImportDocumentModalProps {
  /** The sheet's own heading — "Import a trip file". */
  title: string;
  /** One line saying what it will do, in the caller's own nouns. */
  blurb: ReactNode;
  /**
   * The sources that can hold it. With ONE the picker is not drawn at all —
   * the modal must not grow for a choice that does not exist.
   */
  sources: readonly SourceInfo[];
  onCancel: () => void;
  /** Chosen target in hand: the caller opens the native file dialog next. */
  onChooseFile: (targetSourceId: string) => void;
}

const legend = 'font-mono text-[0.64rem] tracking-[0.14em] uppercase text-muted';

export default function ImportDocumentModal({
  title,
  blurb,
  sources,
  onCancel,
  onChooseFile,
}: ImportDocumentModalProps) {
  const [target, setTarget] = useState(() =>
    sources.some((s) => s.id === DEFAULT_SOURCE_ID)
      ? DEFAULT_SOURCE_ID
      : (sources[0]?.id ?? DEFAULT_SOURCE_ID),
  );
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    buttonRef.current?.focus();
    // Mount-only: the modal is short-lived.
  }, []);

  // The CTA starts focused, so Enter usually fires it natively; this is for
  // the press that lands anywhere else — the source picker, mostly.
  useDialogKeys({ onCancel, onConfirm: () => onChooseFile(target) });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgba(20,18,15,0.45)] backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-[26rem] flex flex-col gap-5 bg-surface border border-line rounded-paper-lg shadow-paper p-6">
        <div>
          <h2 className="m-0 font-serif text-[1.4rem]">{title}</h2>
          <p className="m-0 mt-1 text-[0.82rem] text-muted">{blurb}</p>
        </div>

        {sources.length > 1 && (
          <label className="flex flex-col gap-1.5">
            <span className={legend}>Keep on</span>
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              // 16px on a phone, or iOS zooms the page on focus and never
              // zooms back — the rule every field in the suite follows.
              className="font-sans text-[0.95rem] px-3.5 py-2 border border-line-strong rounded-paper bg-paper text-ink focus:outline-none focus:border-accent max-[560px]:text-[1rem]"
            >
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.id === DEFAULT_SOURCE_ID ? 'this browser (local)' : s.label}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="flex items-center justify-end gap-4 pt-1 border-t border-line">
          <button
            type="button"
            onClick={onCancel}
            className="p-0 mt-4 border-0 bg-transparent text-[0.84rem] text-muted cursor-pointer hover:text-ink"
          >
            Cancel
          </button>
          <button
            ref={buttonRef}
            type="button"
            onClick={() => onChooseFile(target)}
            className="mt-4 px-[1.1rem] py-2 inline-flex items-center border border-ink rounded-full bg-ink text-paper cursor-pointer text-[0.84rem] font-semibold transition-colors duration-200 ease-paper hover:bg-accent hover:border-accent"
          >
            Choose file…
          </button>
        </div>
      </div>
    </div>
  );
}
