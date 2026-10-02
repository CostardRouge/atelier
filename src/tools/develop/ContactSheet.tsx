import { useMemo, type ReactNode } from 'react';
import { STRIP_METRICS, sheetLayout } from '../../shared/develop/roll-strip';
import Button from '../../shared/ui/Button';
import IconButton from '../../shared/ui/IconButton';
import { Icons } from '../../shared/ui/icons';
import { useElementWidth } from '../../shared/ui/use-element-width';
import { StripCells, shownPictures, stripItems, useScrollToOpen, type StripCellsProps } from './RollBand';

/**
 * The roll laid out LARGE over the stage (`docs/develop-roll-browser.md`,
 * face C's half of D): the same cells as the band at a size of their own,
 * every caption drawn, the same filter, the same selection and its bar — a
 * place to sort and to act on many, opened with `G` or the band's ▦ and
 * closed by a click that opens a picture, by ✕, by `G` or by Escape. It
 * covers the stage and the band and leaves the inspector, so the numbers
 * about to be applied stay in view; on a phone it is the whole screen.
 */
export default function ContactSheet({
  compact,
  span = 1,
  thumb,
  onThumb,
  filter,
  bar,
  onSelecting,
  onClose,
  ...cells
}: StripCellsProps & {
  compact: boolean;
  /** How many of the host's grid columns it covers — the stage's, and the band's when that stands beside it. */
  span?: 1 | 2;
  /** The sheet's thumbnail height (`StripPrefs.sheet`), and the way to step it. */
  thumb: number;
  onThumb: (direction: 1 | -1) => void;
  /** The band's filter chip, drawn here too. */
  filter: ReactNode;
  /** The selection's bar while it is on, else null. */
  bar: ReactNode | null;
  onSelecting: () => void;
  onClose: () => void;
}) {
  const metrics = STRIP_METRICS[cells.kind];
  const [bodyRef, width] = useElementWidth<HTMLDivElement>();
  const { pictures, openId, hideIgnored = false, shows = ALWAYS, aspects } = cells;
  const shown = useMemo(() => shownPictures(pictures, openId, hideIgnored, shows), [pictures, openId, hideIgnored, shows]);
  const items = useMemo(() => stripItems(shown, aspects), [shown, aspects]);
  const layout = useMemo(() => sheetLayout({ items, width, thumb, metrics }), [items, width, thumb, metrics]);
  useScrollToOpen(bodyRef, openId);
  const size = compact ? 'md' : 'sm';
  const head = (
    <div className="flex-none flex flex-wrap items-center gap-x-2 gap-y-1.5 min-w-0">
      <h2 className="m-0 font-serif text-xl leading-none whitespace-nowrap">Contact sheet</h2>
      <span className="font-mono text-2xs text-muted tabular-nums whitespace-nowrap">
        {shown.length} of {pictures.length}
      </span>
      {filter}
      <span className="flex-1" />
      <span className="inline-flex items-center rounded-control border border-line-strong bg-surface overflow-hidden" role="group" aria-label="Thumbnail size">
        <IconButton size={size} variant="ghost" label="Smaller thumbnails (−)" className="rounded-none" onClick={() => onThumb(-1)} disabled={thumb <= metrics.sheetMin}>
          {Icons.minus}
        </IconButton>
        <span className="font-mono text-3xs text-muted tabular-nums px-1.5 select-none" aria-hidden="true">
          {Math.round(thumb)} px
        </span>
        <IconButton size={size} variant="ghost" label="Larger thumbnails (=)" className="rounded-none" onClick={() => onThumb(1)} disabled={thumb >= metrics.sheetMax}>
          {Icons.plus}
        </IconButton>
      </span>
      <Button size={size} onClick={onSelecting} title="Pick several pictures, then act on them all (S)">
        Select
      </Button>
      <IconButton size={size} variant="ghost" label="Close the contact sheet (G or Esc)" onClick={onClose}>
        {Icons.close}
      </IconButton>
    </div>
  );
  return (
    <div
      role="dialog"
      aria-modal={compact ? 'true' : undefined}
      aria-label="Contact sheet"
      className={
        compact
          ? 'fixed inset-0 z-50 flex flex-col gap-2 bg-paper px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))]'
          : // A grid item over the stage's cells, both rows: later in tree
            // order, so it paints over them; the inspector keeps its column.
            `col-start-1 ${span === 2 ? 'col-span-2' : ''} row-start-1 row-span-2 z-10 min-h-0 min-w-0 flex flex-col gap-2 bg-paper`
      }
    >
      <div className="flex-none flex items-center min-w-0" style={{ minHeight: metrics.head }}>
        {bar ?? head}
      </div>
      <div ref={bodyRef} className="relative flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden overscroll-contain border-t border-line pt-1 [scrollbar-width:thin]">
        <StripCells shown={shown} layout={layout} {...cells} />
      </div>
    </div>
  );
}

const ALWAYS = () => true;
