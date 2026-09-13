/**
 * A question with two answers, over the screen: "Delete this trip?"
 *
 * The galleries confirmed a delete with an inline "Delete · Keep" pair that
 * appeared where the verb had been — fine on a row, but a verb inside an
 * overflow menu has nowhere to unfold. This is the sheet the whole suite asks
 * such a question with: the title IS the question, one sentence says what is
 * lost, and the destructive answer is the `danger` button on the right.
 *
 * Escape keeps, Enter confirms only when the dialog is NOT destructive — a
 * stray Enter must never delete a year of tracking. Focus lands on the safe
 * answer for the same reason.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import Button from './Button';
import useDialogKeys from './use-dialog-keys';

interface ConfirmDialogProps {
  /** The question, as a question. */
  title: string;
  /** What happens if they say yes — what is lost, what cannot be undone. */
  children?: ReactNode;
  /** The yes, as the verb: "Delete", "Replace", "Forget". */
  confirmLabel: string;
  cancelLabel?: string;
  /** Paints the yes in `danger`, and keeps Enter from firing it. */
  danger?: boolean;
  /** Disables both answers while the yes is running. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  title,
  children,
  confirmLabel,
  cancelLabel = 'Keep',
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const safeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    safeRef.current?.focus();
  }, []);

  useDialogKeys({
    onCancel: busy ? undefined : onCancel,
    onConfirm: danger || busy ? null : onConfirm,
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgba(20,18,15,0.45)] backdrop-blur-[2px]"
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div className="w-full max-w-[26rem] flex flex-col gap-4 bg-surface border border-line rounded-paper-lg shadow-paper p-6">
        <h2 className="m-0 font-serif text-2xl leading-tight">{title}</h2>
        {children && <div className="text-sm text-ink-soft leading-relaxed [&>p]:m-0">{children}</div>}
        <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-line">
          <Button ref={safeRef} variant="ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={busy}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
