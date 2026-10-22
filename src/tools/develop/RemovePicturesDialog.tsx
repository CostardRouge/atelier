import { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { pictureEdits, pictureLabel, type RollPicture } from '../../shared/develop/roll-types';
import { useObjectUrl } from '../../shared/media/use-object-url';
import Button from '../../shared/ui/Button';
import { removeDialogKey, removeWords, undoChord } from './remove-ask';

/** How many pictures the question shows; past them, a count. */
const THUMBS_MAX = 6;

/**
 * The question before pictures leave the roll (his picks of 2026-10-22, lab
 * https://claude.ai/artifact/Bc1DDfFrNVFMC2U7oQoicf): B on a computer — a
 * card over the editor — and E under a finger — the same words as a sheet
 * from the bottom edge, its two answers a finger's width. Either way it
 * SHOWS what leaves (the first pictures, then a count), says what goes with
 * them and that the files stay, and how to get them back.
 *
 * It is answered from the keyboard (`removeDialogKey`): Remove holds the
 * focus, a second Delete or Enter takes the pictures, Escape keeps them —
 * allowed here because a removal is undone by ⌘Z, where `ConfirmDialog`
 * refuses Enter to a loss that is final. The keys are bound on `window` in
 * the CAPTURE phase and stopped there, so the editor's own Delete, Escape
 * and arrows never also act on the picture behind the question.
 *
 * The keys are written on the buttons on a computer; on the sheet only when
 * a key opened it — a hint drawn for a keyboard that is not there is a lie a
 * phone pays for in width (`frontend.md`).
 */
export default function RemovePicturesDialog({
  pictures,
  thumbs,
  sheet,
  keys,
  onCancel,
  onConfirm,
}: {
  pictures: readonly RollPicture[];
  thumbs: ReadonlyMap<string, Blob>;
  /** Under a finger: the sheet from the bottom edge (E), else the card (B). */
  sheet: boolean;
  /** Write each answer's key on its button. */
  keys: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const removeRef = useRef<HTMLButtonElement>(null);
  const latest = useRef({ onCancel, onConfirm });
  latest.current = { onCancel, onConfirm };
  const words = useMemo(() => removeWords(pictures, undoChord(navigator.userAgent)), [pictures]);

  useEffect(() => {
    removeRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      const action = removeDialogKey({
        key: e.key,
        repeat: e.repeat,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        onButton: e.target instanceof HTMLButtonElement,
      });
      // Every plain key is the question's while it is asked; a chord passes.
      if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key !== 'Tab') e.stopPropagation();
      if (!action) return;
      e.preventDefault();
      if (action === 'cancel') latest.current.onCancel();
      else latest.current.onConfirm();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const shown = pictures.slice(0, THUMBS_MAX);
  const more = pictures.length - shown.length;
  const size = sheet ? 'lg' : 'md';
  return createPortal(
    <div
      className={`fixed inset-0 z-50 flex bg-[rgba(20,18,15,0.45)] backdrop-blur-[2px] ${
        sheet ? 'flex-col justify-end' : 'items-center justify-center p-4'
      }`}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={words.title}
        className={
          sheet
            ? 'w-full flex flex-col gap-3.5 bg-surface border-t border-line rounded-t-paper-lg shadow-paper px-5 pt-2.5 pb-[max(1.5rem,env(safe-area-inset-bottom))]'
            : 'w-full max-w-[28rem] flex flex-col gap-4 bg-surface border border-line rounded-paper-lg shadow-paper p-6'
        }
      >
        {sheet && <span className="self-center w-9 h-1 rounded-full bg-line-strong" aria-hidden="true" />}
        <h2 className="m-0 font-serif text-2xl leading-tight break-words">{words.title}</h2>
        <ul className="m-0 p-0 list-none flex items-center gap-1.5" aria-label="What leaves">
          {shown.map((p) => (
            <Thumb key={p.id} picture={p} blob={thumbs.get(p.id) ?? null} />
          ))}
          {more > 0 && <li className="pl-1 font-mono text-xs text-ink-soft tabular-nums">+{more}</li>}
        </ul>
        <p className={`m-0 leading-relaxed text-ink-soft ${sheet ? 'text-base' : 'text-sm'}`}>
          {words.body}
          {sheet && ` ${words.back}`}
        </p>
        {sheet ? (
          <div className="flex flex-col gap-2.5 pt-1">
            <Button ref={removeRef} variant="danger" size={size} className="w-full" onClick={onConfirm}>
              Remove{keys && <Key>⌫</Key>}
            </Button>
            <Button variant="default" size={size} className="w-full" onClick={onCancel}>
              Keep{keys && <Key>Esc</Key>}
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2.5 pt-4 border-t border-line">
            <span className="flex-1 min-w-0 text-xs text-ink-soft">{words.back}</span>
            <Button variant="ghost" size={size} onClick={onCancel}>
              Keep{keys && <Key>Esc</Key>}
            </Button>
            <Button ref={removeRef} variant="danger" size={size} onClick={onConfirm}>
              Remove{keys && <Key>⌫</Key>}
            </Button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** A key's name on a button: what the keyboard presses for the same answer. */
function Key({ children }: { children: string }) {
  return (
    <kbd className="ml-1 px-1 rounded-[5px] border border-current font-mono text-3xs leading-[1.4] opacity-80" aria-hidden="true">
      {children}
    </kbd>
  );
}

/** One picture that leaves, small, with the work it carries marked. */
function Thumb({ picture, blob }: { picture: RollPicture; blob: Blob | null }) {
  const url = useObjectUrl(blob);
  const label = pictureLabel(picture);
  const edited = pictureEdits(picture).length > 0;
  return (
    <li className="relative flex-none w-[3.75rem] h-10 rounded-[5px] overflow-hidden bg-frame" title={label}>
      {url ? (
        <img src={url} alt={label} className="block w-full h-full object-cover" draggable={false} />
      ) : (
        <span className="absolute inset-0 grid place-items-center px-0.5 font-mono text-3xs leading-tight text-on-media break-all text-center">
          {label}
        </span>
      )}
      {edited && (
        <span
          className="absolute left-0.5 bottom-0.5 px-1 rounded-full bg-surface/85 font-mono text-3xs leading-none py-px text-accent-ink"
          title="carries work"
        >
          ●
        </span>
      )}
    </li>
  );
}
