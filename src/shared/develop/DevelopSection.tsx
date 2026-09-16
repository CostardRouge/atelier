import type { ReactNode } from 'react';
import Button from '../ui/Button';
import IconButton from '../ui/IconButton';
import { FieldRow, InspectorSection } from '../ui/Inspector';
import { Icons } from '../ui/icons';
import { describeDevelop, type DevelopSettings } from './develop';

/**
 * A picture's correction as ONE settled inspector row: the sentence the
 * workbench writes, the way in (`Develop…`) and the way back to as shot. The
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
}) {
  return (
    <InspectorSection id={id} title="Develop" badge={badge} info={info}>
      <FieldRow label="Correction">
        <span
          className={`flex-1 min-w-0 truncate font-mono text-xs ${develop ? 'text-ink-soft' : 'text-muted'}`}
          title={describeDevelop(develop)}
        >
          {describeDevelop(develop)}
        </span>
        {develop && (
          <IconButton size="sm" variant="ghost" label="Back to as shot" onClick={onReset}>
            {Icons.reset}
          </IconButton>
        )}
        <Button size="sm" onClick={onOpen} disabled={!canOpen} title={openTitle}>
          Develop…
        </Button>
      </FieldRow>
    </InspectorSection>
  );
}
