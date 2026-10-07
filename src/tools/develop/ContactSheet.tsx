import { useMemo, type ReactNode } from 'react';
import { STRIP_METRICS, sheetLayout, sheetSizeIndex } from '../../shared/develop/roll-strip';
import Button from '../../shared/ui/Button';
import IconButton from '../../shared/ui/IconButton';
import SettingsMenu from '../../shared/ui/SettingsMenu';
import { Icons } from '../../shared/ui/icons';
import { StripCells, shownPictures, stripItems, useScrollToOpen, useScrollView, type StripCellsProps } from './RollBand';
import { fingerSize } from '../../shared/ui/press';
import { useCoarsePointer } from '../../shared/ui/use-coarse-pointer';

/**
 * The roll laid out LARGE over the stage (`docs/develop-roll-browser.md`,
 * face C's half of D): the same cells as the band at a size of their own,
 * every caption drawn, the same filter, the same selection and its bar — a
 * place to sort and to act on many, opened with `G` or the band's ▦ and
 * closed by a click that opens a picture, by ✕, by `G` or by Escape. It
 * covers the stage and the band and leaves the inspector, so the numbers
 * about to be applied stay in view; on a phone it is the whole screen.
 */
const SIZE_GLYPHS: readonly (readonly [ReactNode, string])[] = [
  [Icons.sizeS, 'Small'],
  [Icons.sizeM, 'Medium'],
  [Icons.sizeL, 'Large'],
  [Icons.sizeXL, 'Extra large'],
];

export default function ContactSheet({
  compact,
  span = 1,
  thumb,
  onSize,
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
  /** Set it to one of the four sizes (`StripMetrics.sheetSizes`); `−` / `=` step them from the keyboard. */
  onSize: (px: number) => void;
  /** The band's filter chip, drawn here too. */
  filter: ReactNode;
  /** The selection's bar while it is on, else null. */
  bar: ReactNode | null;
  onSelecting: () => void;
  onClose: () => void;
}) {
  const metrics = STRIP_METRICS[cells.kind];
  const [bodyRef, view] = useScrollView<HTMLDivElement>();
  const width = view.w;
  const { pictures, openId, hideIgnored = false, shows = ALWAYS, aspects } = cells;
  const shown = useMemo(() => shownPictures(pictures, openId, hideIgnored, shows), [pictures, openId, hideIgnored, shows]);
  const items = useMemo(() => stripItems(shown, aspects), [shown, aspects]);
  const layout = useMemo(() => sheetLayout({ items, width, thumb, metrics }), [items, width, thumb, metrics]);
  useScrollToOpen(bodyRef, openId, layout, metrics.pad);
  const size = fingerSize(compact, useCoarsePointer());
  const title = (
    <>
      <h2 className="m-0 font-serif text-xl leading-none whitespace-nowrap">Contact sheet</h2>
      <span className="font-mono text-2xs text-muted tabular-nums whitespace-nowrap">
        {shown.length} of {pictures.length}
      </span>
    </>
  );
  // The sheet's settings, the band's panel (his pick A): the four sizes as
  // glyphs and the way out — a pick applies and closes it.
  const sizeNow = sheetSizeIndex(thumb, metrics);
  const settings = (
    <SettingsMenu
      label="The sheet: thumbnail size"
      size={size}
      className="flex-none"
      sections={[
        {
          kind: 'choice',
          id: 'size',
          label: 'Thumbnails',
          value: String(sizeNow),
          onPick: (i) => onSize(metrics.sheetSizes[Number(i)]),
          options: SIZE_GLYPHS.map(([icon, name], i) => ({ id: String(i), icon, label: `${name} thumbnails` })),
        },
        { kind: 'rule', id: 'r' },
        { kind: 'action', id: 'close', icon: Icons.sheetClose, label: 'Close the sheet', hint: 'G', onSelect: onClose },
      ]}
    />
  );
  const select = (
    <Button size={size} className="flex-none" onClick={onSelecting} title="Pick several pictures, then act on them all (S)">
      Select
    </Button>
  );
  const close = (
    <IconButton size={size} variant="ghost" className="flex-none" label="Close the contact sheet (G or Esc)" onClick={onClose}>
      {Icons.close}
    </IconButton>
  );
  // On a phone the header is TWO rows — what this is and the way out, then
  // what to do with it. One row put Select and ✕ past the screen's right edge
  // (it could not wrap: the row was `flex-none`, as wide as its content).
  const head = compact ? (
    <div className="flex-1 min-w-0 flex flex-col gap-2">
      <div className="flex items-center gap-2 min-w-0">
        {title}
        <span className="flex-1" />
        {close}
      </div>
      <div className="flex items-center gap-2 min-w-0">
        {filter}
        <span className="flex-1" />
        {settings}
        {select}
      </div>
    </div>
  ) : (
    <div className="flex-1 flex flex-wrap items-center gap-x-2 gap-y-1.5 min-w-0">
      {title}
      {filter}
      <span className="flex-1" />
      {settings}
      {select}
      {close}
    </div>
  );
  return (
    <div
      role="dialog"
      aria-modal={compact ? 'true' : undefined}
      aria-label="Contact sheet"
      className={
        compact
          ? // No bottom padding HERE: a gutter under a scroller is paper the
            // last row is clipped against (`frontend.md`); the room is paid
            // inside the scroller, where it scrolls away with the last row.
            'fixed inset-0 z-50 flex flex-col gap-2 bg-paper px-3 pt-[max(0.5rem,env(safe-area-inset-top))]'
          : // A grid item over the stage's cells, both rows: later in tree
            // order, so it paints over them; the inspector keeps its column.
            `col-start-1 ${span === 2 ? 'col-span-2' : ''} row-start-1 row-span-2 z-10 min-h-0 min-w-0 flex flex-col gap-2 bg-paper`
      }
    >
      <div className="flex-none flex items-center min-w-0" style={{ minHeight: metrics.head }}>
        {bar ?? head}
      </div>
      <div
        ref={bodyRef}
        className={`relative flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden overscroll-contain border-t border-line pt-1 [scrollbar-width:thin] ${
          compact ? 'pb-[max(1rem,env(safe-area-inset-bottom))]' : 'pb-3'
        }`}
      >
        <StripCells shown={shown} layout={layout} view={view} {...cells} />
      </div>
    </div>
  );
}

const ALWAYS = () => true;
