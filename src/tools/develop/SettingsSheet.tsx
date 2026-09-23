import { useState } from 'react';
import {
  DEFAULT_COPY_SECTIONS,
  PICTURE_SECTIONS,
  readSections,
  sectionsWithEdits,
  type CopiedSettings,
  type PictureSection,
} from '../../shared/develop/picture-sections';
import type { RollPicture } from '../../shared/develop/roll-types';
import Button from '../../shared/ui/Button';
import { Icons } from '../../shared/ui/icons';
import useDialogKeys from '../../shared/ui/use-dialog-keys';

const STORE_KEY = 'atelier.develop.sections';

function readStored(): PictureSection[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return readSections(raw ? JSON.parse(raw) : null);
  } catch {
    return [...DEFAULT_COPY_SECTIONS];
  }
}

function store(sections: readonly PictureSection[]) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(sections));
  } catch {
    /* a private window: the choice lasts this sheet */
  }
}

/**
 * The one picker for every verb that carries MORE than the develop
 * (`picture-sections.ts`): copy (⌘⇧C), paste what was copied (⌘⇧V), apply to
 * the marked pictures or to the others. Lightroom's Copy Settings dialog, as
 * one sheet — the per-tab Apply-to verbs stay for the one-section gesture.
 *
 * The ticks are remembered in this browser, a convenience like a remembered
 * tab. Each row says whether THIS picture has anything in that section, so a
 * copy of an untouched section reads as what it is: a reset of the others.
 */
export default function SettingsSheet({
  picture,
  copied,
  selectedIds,
  otherIds,
  onCopy,
  onPaste,
  onApply,
  onClose,
}: {
  picture: RollPicture;
  copied: CopiedSettings | null;
  /** The pictures marked in the filmstrip, the open one excluded. */
  selectedIds: readonly string[];
  /** Every other picture of the roll that is not ignored. */
  otherIds: readonly string[];
  onCopy: (sections: PictureSection[]) => void;
  onPaste: () => void;
  onApply: (ids: readonly string[], sections: PictureSection[]) => void;
  onClose: () => void;
}) {
  const [ticked, setTicked] = useState<PictureSection[]>(readStored);
  useDialogKeys({ onCancel: onClose });
  const edited = sectionsWithEdits(picture);
  const set = (next: PictureSection[]) => {
    const ordered = readSections(next);
    setTicked(ordered);
    store(ordered);
  };
  const toggle = (id: PictureSection) => set(ticked.includes(id) ? ticked.filter((x) => x !== id) : [...ticked, id]);
  const none = ticked.length === 0;
  const pasteFrom = copied;
  const act = (fn: () => void) => () => {
    fn();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgba(20,18,15,0.55)] backdrop-blur-[2px] max-[820px]:p-0"
      role="dialog"
      aria-modal="true"
      aria-label="Picture settings"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-[30rem] max-h-[min(90dvh,44rem)] overflow-y-auto overscroll-contain flex flex-col gap-3 bg-surface border border-line rounded-paper-lg shadow-paper p-4 max-[820px]:max-w-none max-[820px]:h-[var(--app-h)] max-[820px]:max-h-none max-[820px]:rounded-none max-[820px]:border-0 max-[820px]:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex-none flex items-center gap-2.5 min-w-0">
          <h2 className="m-0 font-serif text-lg min-w-0 truncate">Settings of {picture.ref.name}</h2>
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

        {pasteFrom && (
          <div className="flex items-center gap-2 min-w-0 p-2 rounded-control border border-line bg-paper-2">
            <span className="flex-1 min-w-0 font-mono text-2xs text-ink-soft leading-snug">
              Copied from <span className="text-ink">{pasteFrom.from.ref.name}</span>:{' '}
              {pasteFrom.sections.map((id) => PICTURE_SECTIONS.find((s) => s.id === id)?.label).join(', ')}
            </span>
            <Button size="sm" icon={Icons.paste} onClick={act(onPaste)} title="Paste ⌘⇧V — these sections onto this picture">
              Paste
            </Button>
          </div>
        )}

        <div className="flex items-center gap-1.5 font-mono text-3xs" role="group" aria-label="Tick">
          <span className="text-faint uppercase tracking-[0.12em] mr-1">Tick</span>
          {[
            { label: 'All', value: PICTURE_SECTIONS.map((s) => s.id) },
            { label: 'Edited here', value: PICTURE_SECTIONS.map((s) => s.id).filter((id) => edited.has(id)) },
            { label: 'Shared', value: [...DEFAULT_COPY_SECTIONS] },
            { label: 'None', value: [] as PictureSection[] },
          ].map((q) => (
            <button
              key={q.label}
              type="button"
              onClick={() => set(q.value)}
              className="px-2 py-0.5 rounded-full border border-line-strong text-muted hover:text-ink cursor-pointer"
            >
              {q.label}
            </button>
          ))}
        </div>

        <div className="flex flex-col border-t border-line">
          {PICTURE_SECTIONS.map((s) => {
            const on = ticked.includes(s.id);
            return (
              <button
                key={s.id}
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => toggle(s.id)}
                className="flex items-center gap-2.5 min-h-11 px-1 border-0 border-b border-line bg-transparent text-left select-none cursor-pointer hover:bg-paper focus-visible:outline-2 focus-visible:outline-accent"
              >
                <span
                  aria-hidden="true"
                  className={`flex-none grid place-items-center w-5 h-5 rounded-[5px] border-2 ${on ? 'bg-accent border-accent text-white' : 'border-line-strong'}`}
                >
                  {on && <span className="inline-flex text-xs">{Icons.check}</span>}
                </span>
                <span className="flex-1 min-w-0 flex flex-col">
                  <span className={`text-sm leading-tight ${on ? 'text-ink' : 'text-muted'}`}>{s.label}</span>
                  <span className="text-xs leading-snug text-faint">{s.hint}</span>
                </span>
                <span className={`flex-none font-mono text-3xs ${edited.has(s.id) ? 'text-accent-ink' : 'text-faint'}`}>
                  {edited.has(s.id) ? 'edited' : 'as shot'}
                </span>
              </button>
            );
          })}
        </div>

        <p className="m-0 text-xs leading-relaxed text-muted">
          A ticked section that is <em>as shot</em> here resets it on the pictures it reaches. Never carried: which file
          a picture is developed from, its RAW base, its title and caption, whether it leaves.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" icon={Icons.copy} disabled={none} onClick={act(() => onCopy(ticked))} title="Copy ⌘⇧C — hold these sections for another picture, in this session">
            Copy
          </Button>
          {selectedIds.length > 0 && (
            <Button size="sm" disabled={none} onClick={act(() => onApply(selectedIds, ticked))}>
              Apply to {selectedIds.length} selected
            </Button>
          )}
          {otherIds.length > 0 && (
            <Button size="sm" disabled={none} onClick={act(() => onApply(otherIds, ticked))} title="Every other picture of the roll that is not ignored">
              Apply to {otherIds.length} other picture{otherIds.length === 1 ? '' : 's'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
