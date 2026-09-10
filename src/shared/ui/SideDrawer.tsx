/**
 * A panel that slides in from the left edge, over the work rather than beside
 * it.
 *
 * The middle of the three placements a panel gets: docked on a wide screen, a
 * {@link BottomSheet} on a phone, and this on everything between. It exists
 * because of an arithmetic squeeze rather than a taste: the Library column is
 * 288px, and a tool's own layout splits side-by-side at an 800px CONTAINER —
 * so on a 900px tablet a docked library left the Studio 570px, under its own
 * threshold, and the editor stacked its inspector under a 240px stage. Taking
 * the library out of the flow gives the tool the whole width and the editor
 * lays out properly. That is also where the 1180px boundary comes from:
 * 1180 − 288 − gaps is the first width at which BOTH fit.
 *
 * No drag, deliberately. A sheet is dragged because its height is a control;
 * a drawer is open or shut, and inventing a half-open state would be a
 * gesture with nothing to say.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import useDialogKeys from './use-dialog-keys';

export interface SideDrawerProps {
  open: boolean;
  onClose: () => void;
  /** The drawer's accessible name — it draws no header of its own. */
  label: string;
  children: ReactNode;
}

export default function SideDrawer({ open, onClose, label, children }: SideDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Escape closes it; Enter belongs to whatever is focused inside.
  useDialogKeys({ onCancel: open ? onClose : undefined, onConfirm: null });

  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus({ preventScroll: true });
    return () => opener.current?.focus?.({ preventScroll: true });
  }, [open]);

  if (!open) return null;

  return (
    <>
      <button
        type="button"
        aria-label={`Close ${label}`}
        onClick={onClose}
        className="fixed inset-0 z-40 bg-ink/25 border-0 p-0 cursor-default animate-[sheet-scrim_.24s_var(--ease-paper)]"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="false"
        aria-label={label}
        tabIndex={-1}
        className="fixed inset-y-0 left-0 z-50 flex flex-col min-h-0 w-[min(19.5rem,90vw)] p-3 pl-[max(0.75rem,env(safe-area-inset-left))] outline-none animate-[drawer-slide_.28s_var(--ease-paper)]"
      >
        {children}
      </div>
    </>
  );
}
