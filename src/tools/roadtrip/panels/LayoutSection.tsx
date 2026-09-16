import { LAYOUT_GROUPS, LAYOUT_TEMPLATES, type LayoutTemplateEntry } from '../../../shared/media/layout-templates';
import { resolveLayout } from '../../../shared/media/media-layout';
import {
  DEFAULT_COLLAGE_BACKGROUND,
  collageCellAt,
  collageCellCount,
  collageEntry,
  collageKept,
  createCollage,
  retemplateCollage,
  type CollageLead,
  type SlideCollage,
} from '../../../shared/roadtrip/collage';
import Button from '../../../shared/ui/Button';
import { FieldRow, InspectorSection, RangeField, Readout, swatchClass } from '../../../shared/ui/Inspector';
import { Icons } from '../../../shared/ui/icons';

/** The grounds a collage can sit on: the frame's black, the suite's papers, a sand, the accent. */
const BACKGROUNDS: readonly { color: string; name: string }[] = [
  { color: DEFAULT_COLLAGE_BACKGROUND, name: 'Frame black' },
  { color: '#1b1813', name: 'Ink' },
  { color: '#f4f0e7', name: 'Paper' },
  { color: '#fbf8f1', name: 'Surface' },
  { color: '#e9d7b0', name: 'Sand' },
  { color: '#d9442a', name: 'Vermilion' },
];

/** A template drawn as its cells, 26 × 46 — the same solver at glyph size. */
function LayoutGlyph({ entry }: { entry: LayoutTemplateEntry }) {
  const W = 26;
  const H = 46;
  const cells = resolveLayout(entry.template, W, H, { gap: 0.1, padding: 0.1, radius: 0 });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true" className="block">
      <rect x="0" y="0" width={W} height={H} rx="3" className="fill-line" />
      {cells.map((c, i) => (
        <rect
          key={i}
          x={c.x}
          y={c.y}
          width={c.w}
          height={c.h}
          rx="1.2"
          transform={`rotate(${c.rotation} ${c.x + c.w / 2} ${c.y + c.h / 2})`}
          className="fill-current opacity-80"
        />
      ))}
    </svg>
  );
}

/** The "one picture" tile: the frame, whole. */
function OneGlyph() {
  return (
    <svg viewBox="0 0 26 46" width={26} height={46} aria-hidden="true" className="block">
      <rect x="0" y="0" width="26" height="46" rx="3" className="fill-line" />
      <rect x="2.6" y="4.6" width="20.8" height="36.8" rx="1.2" className="fill-current opacity-80" />
    </svg>
  );
}

const tileClass = (pressed: boolean) =>
  `flex flex-col items-center gap-1 px-1 pt-1.5 pb-1 rounded-[10px] border text-2xs leading-tight text-center cursor-pointer ${
    pressed
      ? 'border-accent bg-accent-wash text-ink [&_svg]:text-accent'
      : 'border-line bg-paper text-ink-soft hover:border-line-strong [&_svg]:text-ink-soft'
  }`;

interface LayoutSectionProps {
  collage: SlideCollage | null;
  /** The slide's own picture, framing and develop — the collage's first cell. */
  lead: CollageLead;
  /** The cell the stage has selected; 0 is the lead. */
  selectedCell: number;
  onSelectCell: (i: number) => void;
  /** The Library's ticked picture, if any — what "Use it here" writes into the cell. */
  activeFile: File | null;
  /** The file each drawn cell resolves to, lead first, for the labels. */
  cellFiles: readonly (File | null)[];
  onChange: (collage: SlideCollage | null) => void;
  /** Put the ticked picture in the selected cell. */
  onUseActive: () => void;
  /** Empty the selected cell. */
  onClearCell: () => void;
}

/**
 * Several pictures in this slide's frame: which layout, how the cells are
 * spaced, what shows between them, and which cell the inspector is about.
 *
 * Picking a layout never loses a picture — a smaller one keeps the extras
 * off-stage and says so — and "One picture" hands the frame back to the lead
 * exactly as it was. The cells themselves are worked on the stage (click,
 * drag, hold to swap); the row here is the keyboard's way to the same thing.
 */
export default function LayoutSection({
  collage,
  lead,
  selectedCell,
  onSelectCell,
  activeFile,
  cellFiles,
  onChange,
  onUseActive,
  onClearCell,
}: LayoutSectionProps) {
  const entry = collage ? collageEntry(collage) : null;
  const count = collage ? collageCellCount(collage) : 1;
  const cell = collage ? collageCellAt(lead, collage, selectedCell) : null;
  const cellFile = cellFiles[selectedCell] ?? null;
  const kept = collage ? collageKept(collage) : [];
  const activeIsHere = Boolean(
    activeFile && cell?.media && cell.media.name.toLowerCase() === activeFile.name.toLowerCase(),
  );

  const pick = (id: string | null) => {
    if (id === null) {
      onChange(null);
      onSelectCell(0);
      return;
    }
    const next = collage ? retemplateCollage(collage, id) : createCollage(id);
    onChange(next);
    if (next && selectedCell >= collageCellCount(next)) onSelectCell(0);
  };

  return (
    <InspectorSection
      id="piece.layout"
      title="Layout"
      badge={entry ? `${entry.name} · ${count}` : undefined}
      info={
        <>
          <p>
            Several pictures in this slide's frame. This slide's own picture is always the
            first cell; the others are picked here or on the stage, and each keeps its own
            framing and develop.
          </p>
          <p>
            On the stage: click a cell to select it, drag to reframe the picture inside it,
            hold (or Alt-drag) to swap two cells. On a free layout a drag moves the print
            and Shift-drag reframes it.
          </p>
          <p>
            A smaller layout keeps the extra pictures rather than dropping them; an empty
            cell shows the background in the export.
          </p>
        </>
      }
      actions={
        collage ? (
          <Button size="sm" variant="ghost" onClick={() => pick(null)}>
            One picture
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-4 gap-1.5">
          <button type="button" className={tileClass(!collage)} onClick={() => pick(null)} aria-pressed={!collage}>
            <OneGlyph />
            <span>One</span>
          </button>
        </div>
        {LAYOUT_GROUPS.map((group) => (
          <div key={group} className="flex flex-col gap-1">
            <span className="font-mono text-3xs uppercase tracking-[0.08em] text-muted">{group}</span>
            <div className="grid grid-cols-4 gap-1.5" role="group" aria-label={`${group} layouts`}>
              {LAYOUT_TEMPLATES.filter((t) => t.group === group).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={tileClass(collage?.template === t.id)}
                  aria-pressed={collage?.template === t.id}
                  title={`${t.name} · ${resolveLayout(t.template, 9, 16).length} cells`}
                  onClick={() => pick(t.id)}
                >
                  <LayoutGlyph entry={t} />
                  <span>{t.name}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {collage && entry && (
        <>
          {entry.template.kind !== 'free' && (
            <>
              <FieldRow label="Gap">
                <RangeField
                  label="Gap"
                  min={0}
                  max={0.06}
                  step={0.002}
                  value={collage.spacing.gap}
                  onChange={(gap) => onChange({ ...collage, spacing: { ...collage.spacing, gap } })}
                  format={(v) => `${(v * 100).toFixed(1)}%`}
                />
              </FieldRow>
              <FieldRow label="Padding">
                <RangeField
                  label="Padding"
                  min={0}
                  max={0.1}
                  step={0.002}
                  value={collage.spacing.padding}
                  onChange={(padding) => onChange({ ...collage, spacing: { ...collage.spacing, padding } })}
                  format={(v) => `${(v * 100).toFixed(1)}%`}
                />
              </FieldRow>
              <FieldRow label="Corners">
                <RangeField
                  label="Corners"
                  min={0}
                  max={0.08}
                  step={0.002}
                  value={collage.spacing.radius}
                  onChange={(radius) => onChange({ ...collage, spacing: { ...collage.spacing, radius } })}
                  format={(v) => `${(v * 100).toFixed(1)}%`}
                />
              </FieldRow>
            </>
          )}
          <FieldRow label="Behind" hint="Shows between the cells and in an empty one.">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Background">
              {BACKGROUNDS.map((b) => (
                <button
                  key={b.color}
                  type="button"
                  className={`${swatchClass} ${collage.background === b.color ? 'ring-2 ring-accent ring-offset-2 ring-offset-surface' : ''}`}
                  style={{ background: b.color }}
                  title={b.name}
                  aria-label={b.name}
                  aria-pressed={collage.background === b.color}
                  onClick={() => onChange({ ...collage, background: b.color })}
                />
              ))}
            </div>
          </FieldRow>

          <FieldRow
            label="Cell"
            align="start"
            hint={
              selectedCell === 0
                ? 'The first cell is this slide’s own picture — the Library follows it.'
                : 'The Library follows the selected cell: tick a picture there to put it here.'
            }
          >
            <div className="flex-1 min-w-0 flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  icon={Icons.back}
                  aria-label="Previous cell"
                  disabled={count < 2}
                  onClick={() => onSelectCell((selectedCell + count - 1) % count)}
                />
                <Readout>
                  {selectedCell + 1} of {count}
                </Readout>
                <Button
                  size="sm"
                  icon={Icons.forward}
                  aria-label="Next cell"
                  disabled={count < 2}
                  onClick={() => onSelectCell((selectedCell + 1) % count)}
                />
                <Readout muted={!cellFile}>
                  <span className="truncate">{cellFile?.name ?? cell?.media?.name ?? 'Empty'}</span>
                </Readout>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  size="sm"
                  disabled={!activeFile || activeIsHere}
                  title={activeFile ? `Put ${activeFile.name} in this cell` : 'Tick a picture in the Library first'}
                  onClick={onUseActive}
                >
                  Use the ticked picture
                </Button>
                <Button size="sm" variant="ghost" disabled={!cell?.media} onClick={onClearCell}>
                  Empty this cell
                </Button>
              </div>
            </div>
          </FieldRow>

          {kept.length > 0 && (
            <FieldRow label="Kept" align="start" hint="Not drawn by this layout; a bigger one brings them back.">
              <div className="flex flex-wrap gap-1">
                {kept.map((k) => (
                  <span
                    key={k.cell}
                    className="font-mono text-2xs px-2 py-1 rounded-full bg-paper-2 border border-line text-ink-soft"
                  >
                    cell {k.cell} · {k.media.name}
                  </span>
                ))}
              </div>
            </FieldRow>
          )}
        </>
      )}
    </InspectorSection>
  );
}
