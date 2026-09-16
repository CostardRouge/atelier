/**
 * One panel, three placements: a docked column, a sheet over the stage, or a
 * drawer under it.
 *
 * An editor's inspector is a column beside the picture wherever there is width
 * for one, and on a phone one of two things: a {@link BottomSheet} rising over
 * the stage, or a {@link DockedDrawer} taking a share of the height beneath
 * it. The CONTENT is identical in all three — the same tabs, the same
 * controls, the same state — so this exists to keep it written once rather
 * than branched at the call site, which is how two copies of a panel start
 * disagreeing.
 *
 * **Which of the two a phone gets is a real choice, not a preference.** A
 * sheet floats over the stage behind a wash and is the right shape for a panel
 * you pick FROM: you want all the library you can get, and the thing behind is
 * only context. A drawer is the right shape where the panel's effect is what
 * you are watching, and where that wash would falsify it — a photograph being
 * developed, whose colour is the whole question.
 *
 * It takes children, not a render prop: the panel's body must not be rebuilt
 * when the placement changes, or an open dropdown and a half-typed field would
 * be thrown away by a rotation.
 */

import type { ReactNode } from 'react';
import BottomSheet from './BottomSheet';
import DockedDrawer from './DockedDrawer';

export interface PanelHostProps {
  /** True to host it over/under the stage — the shell's compact mode. */
  asSheet: boolean;
  /**
   * Which of the two compact placements. `sheet` (the default) covers the
   * stage behind a wash; `drawer` shares the column's height with it and draws
   * no scrim at all.
   */
  compactAs?: 'sheet' | 'drawer';
  /** Whether the panel is up. Ignored when docked, which is always visible. */
  open: boolean;
  onClose: () => void;
  /** The sheet's or drawer's header. Docked, the panel titles itself. */
  title: string;
  /** The docked box's own classes. Unused compact, where the host draws its frame. */
  className?: string;
  children: ReactNode;
}

export default function PanelHost({
  asSheet,
  compactAs = 'sheet',
  open,
  onClose,
  title,
  className,
  children,
}: PanelHostProps) {
  if (!asSheet) return <div className={className}>{children}</div>;
  if (compactAs === 'drawer') {
    return (
      <DockedDrawer open={open} onClose={onClose} title={title}>
        {children}
      </DockedDrawer>
    );
  }
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
