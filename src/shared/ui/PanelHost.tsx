/**
 * One panel, two placements: a docked column, or a sheet over the stage.
 *
 * An editor's inspector is a column beside the picture wherever there is width
 * for one, and a {@link BottomSheet} where there is not. The CONTENT is
 * identical either way — the same tabs, the same controls, the same state — so
 * this exists to keep it written once rather than branched at the call site,
 * which is how two copies of a panel start disagreeing.
 *
 * It takes children, not a render prop: the panel's body must not be rebuilt
 * when the placement changes, or an open dropdown and a half-typed field would
 * be thrown away by a rotation.
 */

import type { ReactNode } from 'react';
import BottomSheet from './BottomSheet';

export interface PanelHostProps {
  /** True to host it as a sheet — the shell's compact mode. */
  asSheet: boolean;
  /** Whether the sheet is up. Ignored when docked, which is always visible. */
  open: boolean;
  onClose: () => void;
  /** The sheet's header. Docked, the panel titles itself. */
  title: string;
  /** The docked box's own classes. Unused as a sheet, which draws its frame. */
  className?: string;
  children: ReactNode;
}

export default function PanelHost({
  asSheet,
  open,
  onClose,
  title,
  className,
  children,
}: PanelHostProps) {
  if (!asSheet) return <div className={className}>{children}</div>;
  return (
    // The panel scrolls its own body (an inspector is a stack of sections),
    // so the sheet must not scroll as well — two nested scroll containers give
    // a finger two things to move and neither of them reliably.
    <BottomSheet open={open} onClose={onClose} title={title} bodyScrolls={false}>
      <div className="flex-1 min-h-0 flex flex-col gap-3 px-3 pt-2 pb-3 overflow-y-auto overscroll-contain">
        {children}
      </div>
    </BottomSheet>
  );
}
