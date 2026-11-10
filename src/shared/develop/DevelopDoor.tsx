import Button from '../ui/Button';
import IconButton from '../ui/IconButton';
import { Icons } from '../ui/icons';
import { describeDevelop, type DevelopSettings } from './develop';

/**
 * The way into the Develop sheet, wherever a picture is in hand outside the
 * Develop tool — Recap's place, Trips' Picture tab, the Studio's Grade tab
 * (2026-11-10, his report on Recap's «Develop…» pill among three verbs in
 * three dresses). ONE wide control that says its own state:
 *
 * - **as shot**, it is the thing to do: the primary button, «Develop»;
 * - **developed**, it steps back to a quiet button wearing the accent dot the
 *   inspector marks an edit with, the correction's own sentence inside it —
 *   where a separate «Correction» line used to say it — and the way back to
 *   as shot beside it.
 *
 * No «…»: the chevron says it opens something, and the row has no second
 * target for the same verb.
 */
export default function DevelopDoor({
  develop,
  onOpen,
  onReset,
  disabled = false,
  title = 'Open the Develop sheet — its own correction, and the look',
  size = 'md',
}: {
  develop: DevelopSettings | null | undefined;
  onOpen: () => void;
  /** Back to as shot — offered only once developed, and only where the host can do it in one gesture. */
  onReset?: () => void;
  /** No picture to develop is in hand yet. */
  disabled?: boolean;
  title?: string;
  size?: 'sm' | 'md';
}) {
  const developed = Boolean(develop);
  return (
    <span className="flex items-stretch gap-1 min-w-0">
      <Button
        size={size}
        variant={developed ? 'default' : 'primary'}
        icon={Icons.sliders}
        trailing={Icons.chevronRight}
        onClick={onOpen}
        disabled={disabled}
        title={developed ? `${describeDevelop(develop)} — ${title}` : title}
        className="flex-1 min-w-0 justify-start text-left"
      >
        {developed ? (
          <>
            <span className="flex-none inline-flex items-center gap-1.5">
              Developed
              <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-accent" />
            </span>
            <span className="flex-1 min-w-0 truncate font-mono text-2xs font-normal text-muted">{describeDevelop(develop)}</span>
          </>
        ) : (
          <span className="flex-1 min-w-0 truncate">Develop</span>
        )}
      </Button>
      {developed && onReset && (
        <IconButton size={size} variant="ghost" label="Back to as shot" onClick={onReset} className="flex-none">
          {Icons.reset}
        </IconButton>
      )}
    </span>
  );
}
