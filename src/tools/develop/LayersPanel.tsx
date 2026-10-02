import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import SectionLegend from '../../shared/ui/SectionLegend';
import Button from '../../shared/ui/Button';
import IconButton from '../../shared/ui/IconButton';
import OverflowMenu from '../../shared/ui/OverflowMenu';
import { Icons } from '../../shared/ui/icons';
import { developLines } from '../../shared/develop/develop';
import { MAX_LAYERS, type AdjustLayer } from '../../shared/develop/layer';
import type { MaskKind } from '../../shared/render/mask';
import KindPalette from './KindPalette';
import { kindLabel, type PaletteKind } from './kind-palette';
import MaskThumb from './MaskThumb';
import type { LayerThumb } from './use-layer-thumbs';

const HINT =
  'A layer is an ordinary develop that applies only where its mask says. Linear is a straight edge with a soft transition — a darkened sky; radial is an ellipse — a face lifted out of its surround, or a vignette drawn on purpose; shade is the shape a Trips shade draws — an edge, a corner, a band or a pool of light picked on a grid, with its core and its falloff; brightness picks a band of tone wherever it falls in the frame; colour picks the colours you tap, wherever they are; painted is drawn by hand on the picture; subject is found by a model from a point you tap. A layer’s mask can be COMBINED with further ones — added, subtracted or intersected — in the layer’s own mask panel. Everything on the Develop tab works inside a layer, so a local exposure, a local white balance and a local curve are the same controls you already know. Layers apply on top of the picture as you see it, after its own develop and its look, so what a slider does here is what you are looking at.';

/** The drag's own type, so a layer dragged in the list is never a picture dropped on a cell. */
const LAYER_DRAG = 'application/x-atelier-layer';
/** How many change chips a row shows before it says how many more. */
const MAX_CHIPS = 3;

/** A row's name: the one given, else what its mask is. */
export function rowName(l: AdjustLayer): string {
  return l.name.trim() || kindLabel(l.mask?.kind ?? 'whole');
}

/** The small word beside a name: the kind, turned and combined — `not radial +2 − subject`. */
export function rowKind(l: AdjustLayer): string {
  const kind = kindLabel(l.mask?.kind ?? 'whole').toLowerCase();
  const parts = (l.parts ?? []).length;
  return `${l.invert ? 'not ' : ''}${kind}${parts ? ` +${parts}` : ''}${l.except ? ' − subject' : ''}`;
}

/** What a layer changes, as chips — or none, which the row says. */
export function rowChips(l: AdjustLayer): { chips: string[]; more: number } {
  const lines = developLines(l.develop);
  if (lines.length === 1 && lines[0] === 'As shot') return { chips: [], more: 0 };
  return { chips: lines.slice(0, MAX_CHIPS), more: Math.max(0, lines.length - MAX_CHIPS) };
}

/**
 * The stack, drawn TOP FIRST.
 *
 * The array is bottom to top — entry 0 is applied first and everything after
 * reads what it wrote — but every layer UI since Photoshop shows the top of the
 * stack at the top of the list, so this renders reversed. Nothing else does:
 * `layer.ts`'s helpers all speak the real order and are addressed by id, so the
 * reversal cannot leak into an index.
 *
 * A row READS (2026-10-02, `docs/mask-ui-redesign.md` §3.2): a grip, the eye,
 * a thumbnail of the layer's REAL combined mask, its name beside its kind,
 * chips of what it changes, its opacity as a slim bar, and a ⋯ for the rest —
 * where a row used to be one truncated line and three icon buttons.
 */
export default function LayersPanel({
  layers,
  selectedId,
  thumbs,
  onSelect,
  onAdd,
  onRemove,
  onMove,
  onMoveTo,
  onDuplicate,
  onKind,
  onPatch,
}: {
  layers: readonly AdjustLayer[];
  selectedId: string | null;
  /** Each layer's mask, small (`use-layer-thumbs.ts`). */
  thumbs: ReadonlyMap<string, LayerThumb>;
  onSelect: (id: string | null) => void;
  onAdd: (kind: MaskKind | null) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, delta: number) => void;
  /** To an index of the stack, bottom to top — a drag's landing. */
  onMoveTo: (id: string, index: number) => void;
  onDuplicate: (id: string) => void;
  /** A layer's kind changed from its row's ⋯. */
  onKind: (id: string, kind: PaletteKind) => void;
  onPatch: (id: string, patch: Partial<Omit<AdjustLayer, 'id'>>) => void;
}) {
  const full = layers.length >= MAX_LAYERS;
  // Top of the stack first, the way a layer list has always read.
  const rows = [...layers].reverse();
  // ONE way to add a layer: the palette of kinds (`kind-palette.ts`), where a
  // grid of eight `+ Kind` buttons used to be.
  const addRef = useRef<HTMLButtonElement>(null);
  const [palette, setPalette] = useState(false);
  // A row's kind changed from its ⋯: the same palette, hung from the row.
  const [typeFor, setTypeFor] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const typeRow = { current: typeFor ? rowRefs.current.get(typeFor) ?? null : null };
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);

  const drop = (targetId: string) => {
    const moving = dragId;
    setDragId(null);
    setDropOn(null);
    if (!moving || moving === targetId) return;
    // The list is top first: dropped ON a row, the layer goes just ABOVE it
    // in the stack.
    const rest = layers.filter((l) => l.id !== moving);
    onMoveTo(moving, rest.findIndex((l) => l.id === targetId) + 1);
  };
  /** ⌥↑ / ⌥↓ move the focused row — the keyboard's twin of the drag. */
  const moveKeys = (id: string) => (e: KeyboardEvent) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    onMove(id, e.key === 'ArrowUp' ? 1 : -1);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <SectionLegend label="Layers · top first">
          <p>{HINT}</p>
        </SectionLegend>
        <Button
          ref={addRef}
          size="sm"
          variant="primary"
          disabled={full}
          aria-haspopup="dialog"
          aria-expanded={palette}
          onClick={() => setPalette((on) => !on)}
        >
          + Layer
        </Button>
      </div>
      {palette && (
        <KindPalette
          mode="new"
          anchorRect={() => addRef.current?.getBoundingClientRect() ?? null}
          within={addRef}
          onClose={() => setPalette(false)}
          onPick={(kind) => {
            setPalette(false);
            onAdd(kind === 'whole' ? null : kind);
          }}
        />
      )}
      {typeFor && (
        <KindPalette
          mode="type"
          current={layers.find((l) => l.id === typeFor)?.mask?.kind ?? 'whole'}
          anchorRect={() => typeRow.current?.getBoundingClientRect() ?? null}
          within={typeRow}
          onClose={() => setTypeFor(null)}
          onPick={(kind) => {
            const id = typeFor;
            setTypeFor(null);
            onKind(id, kind);
          }}
        />
      )}
      {full && (
        <span className="font-mono text-3xs text-faint">
          {MAX_LAYERS} layers is the limit — each one is a pass over the whole picture
        </span>
      )}

      {rows.length === 0 ? (
        <p className="m-0 rounded-paper border border-dashed border-line-strong p-3 text-center text-xs text-muted leading-relaxed">
          No layers yet. <b className="font-medium text-ink-soft">+ Layer</b> picks where a change goes: a subject you tap, a sky, an edge.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {rows.map((layer) => {
            const selected = layer.id === selectedId;
            const name = rowName(layer);
            const { chips, more } = rowChips(layer);
            const index = layers.indexOf(layer);
            return (
              <li
                key={layer.id}
                ref={(el) => {
                  if (el) rowRefs.current.set(layer.id, el);
                  else rowRefs.current.delete(layer.id);
                }}
                onDragOver={(e: DragEvent) => {
                  if (!dragId || !e.dataTransfer.types.includes(LAYER_DRAG)) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (dropOn !== layer.id) setDropOn(layer.id);
                }}
                onDrop={(e: DragEvent) => {
                  if (!dragId) return;
                  e.preventDefault();
                  drop(layer.id);
                }}
                onClick={(e) => {
                  // The row opens its layer — except where a control was hit.
                  if ((e.target as HTMLElement).closest('button, input, [role="menu"]')) return;
                  onSelect(selected ? null : layer.id);
                }}
                className={`grid grid-cols-[18px_26px_64px_minmax(0,1fr)_28px] items-center gap-x-1.5 gap-y-1 rounded-paper border pl-0.5 pr-1 py-1.5 cursor-pointer ${
                  selected ? 'border-accent bg-surface-raised shadow-[inset_3px_0_0_var(--color-accent)]' : 'border-line hover:border-line-strong'
                } ${dragId === layer.id ? 'opacity-40' : ''} ${dropOn === layer.id && dragId !== layer.id ? 'shadow-[0_-3px_0_var(--color-accent)]' : ''}`}
              >
                <button
                  type="button"
                  draggable
                  aria-label={`Drag ${name} to reorder — or ⌥↑ / ⌥↓`}
                  title="Drag to reorder · ⌥↑ / ⌥↓"
                  onKeyDown={moveKeys(layer.id)}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData(LAYER_DRAG, layer.id);
                    const row = rowRefs.current.get(layer.id);
                    if (row) e.dataTransfer.setDragImage(row, 12, 12);
                    setDragId(layer.id);
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setDropOn(null);
                  }}
                  className="row-span-2 grid h-8 w-[18px] place-items-center border-0 bg-transparent p-0 text-faint cursor-grab hover:text-ink-soft [&>svg]:h-4 [&>svg]:w-4"
                >
                  {Icons.grip}
                </button>
                {/* Visibility is a VERB, not a field: an eye crossed out says
                    which state it is in, where a bare checkbox read as
                    "include this one" (`develop-roll.md`). */}
                <IconButton
                  size="sm"
                  label={layer.enabled ? `Hide ${name}` : `Show ${name}`}
                  aria-pressed={!layer.enabled}
                  className={`row-span-2 ${layer.enabled ? '' : 'text-faint'}`}
                  onClick={() => onPatch(layer.id, { enabled: !layer.enabled })}
                >
                  {layer.enabled ? Icons.eye : Icons.eyeOff}
                </IconButton>
                <MaskThumb
                  thumb={thumbs.get(layer.id)}
                  className={`row-span-2 h-[43px] w-16 rounded-[6px] ${layer.enabled ? '' : 'opacity-45'}`}
                />
                <div className={`flex min-w-0 items-baseline gap-1.5 ${layer.enabled ? '' : 'opacity-45'}`}>
                  {renaming === layer.id ? (
                    <RenameField
                      value={layer.name}
                      placeholder={kindLabel(layer.mask?.kind ?? 'whole')}
                      onDone={(next) => {
                        setRenaming(null);
                        if (next !== null && next !== layer.name) onPatch(layer.id, { name: next });
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      aria-pressed={selected}
                      title="Open · double-click to rename"
                      onClick={() => onSelect(selected ? null : layer.id)}
                      onDoubleClick={() => setRenaming(layer.id)}
                      onKeyDown={moveKeys(layer.id)}
                      className="min-w-0 truncate border-0 bg-transparent p-0 text-left text-sm font-medium text-ink cursor-pointer"
                    >
                      {name}
                    </button>
                  )}
                  <span className="shrink-0 font-mono text-3xs text-muted">{rowKind(layer)}</span>
                </div>
                <OverflowMenu
                  label={`More for ${name}`}
                  size="sm"
                  items={[
                    { id: 'rename', label: 'Rename', onSelect: () => setRenaming(layer.id) },
                    { id: 'dup', label: 'Duplicate', disabled: full, onSelect: () => onDuplicate(layer.id) },
                    { id: 'up', label: 'Move up', disabled: index === layers.length - 1, onSelect: () => onMove(layer.id, 1) },
                    { id: 'down', label: 'Move down', disabled: index === 0, onSelect: () => onMove(layer.id, -1) },
                    {
                      id: 'invert',
                      label: layer.invert ? 'Un-invert the mask' : 'Invert the mask',
                      onSelect: () => onPatch(layer.id, { invert: !layer.invert }),
                    },
                    { id: 'type', label: 'Change type…', onSelect: () => setTypeFor(layer.id) },
                    { id: 'delete', label: 'Delete layer', danger: true, onSelect: () => onRemove(layer.id) },
                  ]}
                />
                <div className={`col-start-4 col-span-2 flex min-w-0 flex-wrap gap-1 ${layer.enabled ? '' : 'opacity-45'}`}>
                  {chips.length === 0 ? (
                    <span className="rounded-full border border-dashed border-line px-1.5 font-mono text-3xs text-faint">no change yet</span>
                  ) : (
                    <>
                      {chips.map((c) => (
                        <span key={c} className="whitespace-nowrap rounded-full border border-line bg-paper-2 px-1.5 font-mono text-3xs text-ink-soft">
                          {c}
                        </span>
                      ))}
                      {more > 0 && <span className="font-mono text-3xs text-muted">+{more}</span>}
                    </>
                  )}
                </div>
                <div className="col-start-2 col-span-4 flex h-3.5 items-center gap-1.5">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={layer.opacity}
                    aria-label={`Opacity of ${name}`}
                    onChange={(e) => onPatch(layer.id, { opacity: Number(e.target.value) })}
                    className="h-3.5 flex-1 accent-ink cursor-pointer"
                  />
                  <output className="w-9 text-right font-mono text-3xs tabular-nums text-muted">{Math.round(layer.opacity * 100)} %</output>
                </div>
              </li>
            );
          })}
        </ul>
      )}

    </div>
  );
}

/** The name, edited in place: Enter or a click away keeps it, Escape leaves it as it was. */
function RenameField({
  value,
  placeholder,
  onDone,
}: {
  value: string;
  placeholder: string;
  onDone: (next: string | null) => void;
}) {
  const [text, setText] = useState(value);
  const done = useRef(false);
  const finish = (next: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(next === null ? null : next.trim());
  };
  return (
    <input
      autoFocus
      value={text}
      placeholder={placeholder}
      aria-label="Layer name"
      onChange={(e) => setText(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={() => finish(text)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(text);
        if (e.key === 'Escape') finish(null);
      }}
      className="min-w-0 flex-1 rounded-[6px] border border-line-strong bg-paper px-1 text-sm text-ink"
    />
  );
}
