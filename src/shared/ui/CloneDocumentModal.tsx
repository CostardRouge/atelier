/**
 * "Clone this document": its name and where the copy is kept, in one small
 * sheet (variant A of the lab, the maintainer's pick, 2026-10-09).
 *
 * The NAME is prefilled with the first free one in the chosen source
 * (`doc-name.ts`: `Maroc` → `Maroc (2)`; no suffix where nothing else wears
 * the name) and stays editable — the automatic answer is the starting point,
 * never a verdict. What the author types is not rewritten as they type; the
 * line under the field says what will be saved, and a name already used in the
 * chosen source is numbered at the moment of saving by the same rule. Picking
 * another source re-suggests, until the name has been typed by hand.
 *
 * The destination is a choice only where there is one — with this browser
 * alone the sheet asks for a name and nothing else, as `ImportDocumentModal`
 * and the new-trip sheet already do. The sources offered are the ones that can
 * HOLD the kind, so an instance that cannot is not listed at all.
 *
 * Engine-level, like the import sheet beside it: Trips uses it today, and a
 * Studio project is the same gesture with other nouns.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_SOURCE_ID, type SourceInfo } from '../sources/source';
import { sourceLabel } from '../sources/document-gallery';
import { uniqueDocName } from '../sources/doc-name';
import InfoDot from './InfoDot';
import { Icons } from './icons';
import useDialogKeys from './use-dialog-keys';

export interface CloneChoice {
  /** Already numbered against the chosen source's own names. */
  name: string;
  sourceId: string;
}

export interface CloneDocumentModalProps {
  /** The word the sentences use: "trip", "project". */
  noun: string;
  /** The name of the document being cloned. */
  original: string;
  /** Where it is kept — the destination the sheet opens on, the usual case. */
  originalSourceId: string;
  /** The sources that can hold this kind of document. */
  sources: readonly SourceInfo[];
  /** The names a source already holds, as the gallery knows them. */
  namesIn: (sourceId: string) => readonly string[];
  /** What comes along, behind the ⓘ. */
  note: ReactNode;
  onCancel: () => void;
  /** Resolves when the copy is written (or refused): the sheet shows "Cloning…" until then. */
  onConfirm: (choice: CloneChoice) => Promise<void> | void;
}

const legend = 'font-mono text-2xs tracking-[0.14em] uppercase text-muted';

function openingSource(sources: readonly SourceInfo[], original: string): string {
  if (sources.some((s) => s.id === original)) return original;
  if (sources.some((s) => s.id === DEFAULT_SOURCE_ID)) return DEFAULT_SOURCE_ID;
  return sources[0]?.id ?? DEFAULT_SOURCE_ID;
}

export default function CloneDocumentModal({
  noun,
  original,
  originalSourceId,
  sources,
  namesIn,
  note,
  onCancel,
  onConfirm,
}: CloneDocumentModalProps) {
  const [sourceId, setSourceId] = useState(() => openingSource(sources, originalSourceId));
  // Null until the author types: the field then FOLLOWS the suggestion, which
  // is what lets a change of destination re-suggest without ever overwriting
  // something they wrote.
  const [typed, setTyped] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.select();
    // Mount-only: the sheet is short-lived.
  }, []);

  const taken = namesIn(sourceId);
  const suggestion = uniqueDocName(original, taken);
  const name = typed ?? suggestion;
  const trimmed = name.trim();
  const effective = trimmed ? uniqueDocName(trimmed, taken) : '';
  const where = sourceLabel(sourceId);

  async function submit() {
    if (!effective || busy) return;
    setBusy(true);
    try {
      await onConfirm({ name: effective, sourceId });
    } finally {
      setBusy(false);
    }
  }

  // Escape closes the sheet, Enter clones — except while the request is out,
  // when neither can do anything honest.
  useDialogKeys({
    onCancel: busy ? undefined : onCancel,
    onConfirm: effective && !busy ? () => void submit() : null,
  });

  let hint: ReactNode;
  let hintTone = 'text-muted';
  if (!trimmed) {
    hint = `A ${noun} needs a name.`;
    hintTone = 'text-danger';
  } else if (effective !== trimmed) {
    hint = (
      <>
        “{trimmed}” is already used in {where} → saved as <strong>“{effective}”</strong>
      </>
    );
    hintTone = 'text-warn';
  } else if (typed === null && suggestion !== original.trim()) {
    hint = (
      <>
        “{original.trim()}” is already used in {where}. Suggested: <strong>“{suggestion}”</strong>
      </>
    );
    hintTone = 'text-warn';
  } else {
    hint = (
      <>
        <span className="inline-flex align-[-2px] mr-1">{Icons.check}</span>Free in {where}
      </>
    );
    hintTone = 'text-ok';
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center max-[560px]:items-end p-4 max-[560px]:p-0 bg-[rgba(20,18,15,0.45)] backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label={`Clone a ${noun}`}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div className="w-full max-w-[26rem] max-[560px]:max-w-none flex flex-col gap-4 bg-surface border border-line rounded-paper-lg max-[560px]:rounded-b-none shadow-paper p-6 max-[560px]:pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]">
        <div>
          <h2 className="m-0 font-serif text-2xl">Clone a {noun}</h2>
          <p className="m-0 mt-1 text-sm text-muted">
            A copy of <strong className="font-semibold text-ink-soft">{original}</strong>, kept as its
            own {noun}.{' '}
            <InfoDot about={`what comes along in a ${noun} clone`}>{note}</InfoDot>
          </p>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className={legend}>Name</span>
          <input
            ref={inputRef}
            value={name}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            // 16px on a phone, or iOS zooms the page on focus — the rule every
            // field in the suite follows.
            className="font-sans text-base px-3.5 py-2 border border-line-strong rounded-paper bg-paper text-ink focus:outline-none focus:border-accent max-[560px]:text-base"
          />
        </label>
        <p className={`m-0 -mt-2 text-xs min-h-[1.1em] ${hintTone}`} role="status">
          {hint}
        </p>

        {/* Only when there is a choice, like the new-trip sheet. */}
        {sources.length > 1 && (
          <div className="flex flex-col gap-1.5">
            <span className={legend} id="clone-keep-on">
              Keep on
            </span>
            <div role="radiogroup" aria-labelledby="clone-keep-on" className="flex flex-col gap-2">
              {sources.map((s) => {
                const on = s.id === sourceId;
                const local = s.id === DEFAULT_SOURCE_ID;
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setSourceId(s.id)}
                    className={`flex flex-col items-start gap-0.5 text-left px-3.5 py-2 border rounded-paper cursor-pointer transition-colors duration-150 ease-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                      on
                        ? 'border-accent bg-accent-wash'
                        : 'border-line-strong bg-paper hover:border-ink-soft'
                    }`}
                  >
                    <span className="text-sm font-semibold">{local ? 'This browser' : s.label}</span>
                    <span className="text-2xs text-muted">
                      {local ? 'Stays on this device' : 'Resumes from any connected device'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-4 pt-1 border-t border-line">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="p-0 mt-4 border-0 bg-transparent text-sm text-muted cursor-pointer hover:text-ink disabled:opacity-50 disabled:cursor-default"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            aria-disabled={!effective || busy}
            className="mt-4 px-[1.1rem] py-2 inline-flex items-center border border-ink rounded-full bg-ink text-paper cursor-pointer text-sm font-semibold transition-colors duration-200 ease-paper hover:bg-accent hover:border-accent aria-disabled:opacity-50 aria-disabled:cursor-default aria-disabled:hover:bg-ink aria-disabled:hover:border-ink"
          >
            {busy ? 'Cloning…' : 'Clone'}
          </button>
        </div>
      </div>
    </div>
  );
}
