import { useEffect, useRef } from 'react';

export interface CullKeyHandlers {
  onPrev: () => void;
  onNext: () => void;
  /** A number key 0–5 was pressed (0 clears the rating). */
  onRate: (n: number) => void;
  onFlag: (flag: 'pick' | 'reject') => void;
  onClearFlag: () => void;
  /** Toggle the distraction-free fullscreen loupe (F). */
  onToggleZen: () => void;
  /** Leave fullscreen (Escape). */
  onExitZen: () => void;
  /** When false, shortcuts are ignored (e.g. nothing focused). */
  enabled: boolean;
}

/**
 * Keyboard shortcuts for triage, bound on `window` (not a focusable root) so a
 * click on a star or a cell never steals focus and silences the arrows.
 *
 * `← / →` move focus · `1–5` set rating · `0` clear rating · `P` pick ·
 * `X` reject · `U` unflag · `F` fullscreen · `Esc` exit. Typing in an
 * input/textarea (e.g. the library
 * filter) and any modifier chord are left alone.
 */
export function useCullKeys(handlers: CullKeyHandlers): void {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (!handlers.enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.isContentEditable)
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const h = ref.current;
      const k = e.key;
      if (k === 'ArrowLeft') {
        e.preventDefault();
        h.onPrev();
      } else if (k === 'ArrowRight') {
        e.preventDefault();
        h.onNext();
      } else if (k >= '0' && k <= '5') {
        e.preventDefault();
        h.onRate(Number(k));
      } else if (k === 'p' || k === 'P') {
        e.preventDefault();
        h.onFlag('pick');
      } else if (k === 'x' || k === 'X') {
        e.preventDefault();
        h.onFlag('reject');
      } else if (k === 'u' || k === 'U') {
        e.preventDefault();
        h.onClearFlag();
      } else if (k === 'f' || k === 'F') {
        e.preventDefault();
        h.onToggleZen();
      } else if (k === 'Escape') {
        h.onExitZen();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handlers.enabled]);
}
