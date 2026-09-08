import { useEffect, useRef } from 'react';
import { describeDialogTarget, dialogKeyAction } from './dialog-keys';

export interface DialogKeysOptions {
  /** Escape, and the sheet's dismissal. */
  onCancel?: () => void;
  /**
   * The sheet's primary action. Pass `null` when there is nothing to run right
   * now — a disabled CTA, or a confirmation already on screen — and Enter does
   * nothing instead of guessing.
   */
  onConfirm?: (() => void) | null;
}

/**
 * Escape dismisses a sheet, Enter runs its primary action.
 *
 * Bound on `window` rather than on the sheet, like the transport's space key:
 * a modal covers the viewport, so wherever the press lands it is meant for the
 * sheet — and `dialog-keys.ts` decides whether the focused element owns it
 * first. A field that handles Enter itself (`PlaceSearchField` looks a place
 * up) calls `preventDefault`, which is what keeps its press from reaching the
 * CTA as well.
 *
 * The callbacks are read through a ref, so a sheet whose CTA changes with its
 * own state (a disabled Save, a pending import) does not re-bind the listener
 * on every keystroke.
 */
export default function useDialogKeys({ onCancel, onConfirm }: DialogKeysOptions) {
  const latest = useRef({ onCancel, onConfirm });
  latest.current = { onCancel, onConfirm };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { onCancel: cancel, onConfirm: confirm } = latest.current;
      const action = dialogKeyAction(
        {
          key: e.key,
          repeat: e.repeat,
          defaultPrevented: e.defaultPrevented,
          altKey: e.altKey,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          shiftKey: e.shiftKey,
          target: describeDialogTarget(e.target),
        },
        { hasConfirm: Boolean(confirm) },
      );
      if (action === 'cancel') cancel?.();
      else if (action === 'confirm' && confirm) {
        // Nothing else may act on this press — a field inside a real <form>
        // would submit it twice otherwise.
        e.preventDefault();
        confirm();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // Mount-only: the handlers are read through the ref above.
  }, []);
}
