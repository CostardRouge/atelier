import type { ReactNode } from 'react';
import { InspectorSection } from '../ui/Inspector';
import DevelopDoor from './DevelopDoor';
import type { DevelopSettings } from './develop';

/**
 * A picture's correction as ONE settled inspector row (`DevelopDoor`): the way
 * in, wearing the sentence the workbench writes, and the way back to as shot. The
 * sliders live in the workbench, never here — an inspector that grew nine
 * sliders would be the accordion the editors retired.
 *
 * Shared by Trips' Picture tab and the Studio's Grade tab, which carried the
 * same row twice; only the id, the ⓘ and what "open" does differ.
 */
export default function DevelopSection({
  id,
  badge,
  info,
  develop,
  canOpen,
  openTitle = 'Open the Develop sheet',
  onOpen,
  onReset,
  children,
}: {
  /** The section's id, which keeps its fold remembered per editor. */
  id: string;
  /** A small tag after the title — which cell of a collage the row is about. */
  badge?: ReactNode;
  info: ReactNode;
  develop: DevelopSettings | null;
  /** A picture to develop is in hand. */
  canOpen: boolean;
  openTitle?: string;
  onOpen: () => void;
  onReset: () => void;
  /** Rows after the correction — where it came from in Develop (`FromDevelopRow`). */
  children?: ReactNode;
}) {
  return (
    <InspectorSection id={id} title="Develop" badge={badge} info={info}>
      <DevelopDoor develop={develop} onOpen={onOpen} onReset={onReset} disabled={!canOpen} title={openTitle} size="sm" />
      {children}
    </InspectorSection>
  );
}
