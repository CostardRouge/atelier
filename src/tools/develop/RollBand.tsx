import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { describeDevelop } from '../../shared/develop/develop';
import type { SelectionModifiers } from '../../shared/develop/roll-editor';
import type { PictureAvailability } from '../../shared/develop/roll-media';
import {
  STRIP_METRICS,
  bandLayout,
  cellAspect,
  columnLayout,
  type StripCell,
  type StripItem,
  type StripKind,
  type StripLayout,
  type StripPlace,
} from '../../shared/develop/roll-strip';
import {
  deliverState,
  delivers,
  isClipPicture,
  isIgnored,
  pictureEdits,
  pictureLabel,
  variantNumber,
  type PictureEdit,
  type RollPicture,
} from '../../shared/develop/roll-types';
import { useObjectUrl } from '../../shared/media/use-object-url';
import { runStateOf, type RunUnitState, type RunProgress } from '../../shared/tasks/run-progress';
import RunMark, { RUN_WORDS } from '../../shared/ui/RunMark';
import type { WinnowClient } from '../../shared/sources/winnow/client';
import { describeCulling, type Culling } from '../../shared/sources/winnow/culling';
import WinnowThumb from '../../shared/sources/winnow/WinnowThumb';
import CullMark from '../../shared/sources/winnow/CullMark';
import { Icons } from '../../shared/ui/icons';
import { AnchoredMenu, type OverflowItem } from '../../shared/ui/OverflowMenu';
import { CHOICE_WORDS, departsFromRoll, type RollChoice } from '../../shared/develop/roll-choice';
import type { AnchorRect } from '../../shared/ui/menu-anchor';
import { LONG_PRESS_MS, PRESS_SLOP } from '../../shared/ui/press-intent';
import { useElementWidth } from '../../shared/ui/use-element-width';
import type { DeliverAction } from './PictureWorkbench';

/**
 * What the band and the contact sheet both take about the roll's pictures,
 * and what they both answer: the cells' facts, and the host's verbs on one
 * picture. The selection's verbs are the host's bar, not a cell's.
 */
export interface StripCellsProps {
  pictures: readonly RollPicture[];
  /** A running export (`run-progress.ts`): each cell says where its picture stands in it. */
  run?: RunProgress | null;
  openId: string | null;
  selectedIds: ReadonlySet<string>;
  thumbs: ReadonlyMap<string, Blob>;
  /** Each thumbnail's measured aspect (`use-thumb-aspects.ts`) — the shape its cell takes. */
  aspects: ReadonlyMap<string, number>;
  /** Where each picture's bytes stand — a cell says it, the stage explains it. */
  availability: ReadonlyMap<string, PictureAvailability>;
  /** The instance's thumbnail, for a cell that has none of its own yet. */
  remoteThumb: (picture: RollPicture) => { client: WinnowClient; id: number } | null;
  kind: StripKind;
  /** The selection is on: a plain click marks, the cells wear a ring to tick, the ⋯ stands down. */
  selecting?: boolean;
  onOpen: (id: string) => void;
  onSelectClick: (id: string, mods: SelectionModifiers) => void;
  /** A finger held on a cell: the selection on, with that picture. */
  onPress: (id: string) => void;
  /** The menu's Select: the same, from a pointer. */
  onSelect: (id: string) => void;
  onRemove: (picture: RollPicture) => void;
  /** The delivery verbs of the menu — `RollEditor.handleDeliver`. */
  onDeliver: (id: string, action: DeliverAction) => void;
  /** A variant of this picture as it stands (⌘' on the open one). */
  onVariant: (id: string) => void;
  /** Leave ignored pictures out (the open one always stays). */
  hideIgnored?: boolean;
  /** Winnow's word on each picture it answered for (`use-roll-culling.ts`). */
  culling?: ReadonlyMap<string, Culling>;
  /** Whether a picture passes the filter. The open one always stays. */
  shows?: (picture: RollPicture) => boolean;
  /** The roll's choice of file (`RollDoc.opensOn`): a cell whose picture chose otherwise marks it. */
  rollChoice?: RollChoice | null;
  /**
   * The picture the clipboard HOLDS: its cell wears the copy mark for as long
   * as it is held, so ⌘V's source is in sight (`docs/press-feedback.md` C4).
   */
  heldId?: string | null;
  /** The pictures a verb has just written: each cell ticks for a moment — the echo of a paste or an Apply to. */
  written?: ReadonlySet<string>;
}

/** The pictures a band or a sheet SHOWS: the filter's, the ignored where asked, the open one always. */
export function shownPictures(
  pictures: readonly RollPicture[],
  openId: string | null,
  hideIgnored: boolean,
  shows: (picture: RollPicture) => boolean,
): RollPicture[] {
  return pictures.filter((p) => p.id === openId || ((!hideIgnored || !isIgnored(p)) && shows(p)));
}

/** Those pictures as the geometry takes them, each at its cell's aspect. */
export function stripItems(shown: readonly RollPicture[], aspects: ReadonlyMap<string, number>): StripItem[] {
  return shown.map((p) => ({ id: p.id, aspect: cellAspect(p, aspects.get(p.id)) }));
}

/**
 * The roll's pictures in a BAND under the stage (`docs/develop-roll-browser.md`,
 * face D): cells at their pictures' own aspects, laid out by `roll-strip.ts`
 * and drawn at the rectangles it answers — one row scrolling sideways at the
 * band's smallest, a justified grid once the band is pulled up, the header
 * alone once it is folded. Or STANDING beside the stage, where this device
 * prefers it (`place`): the same cells in one, two or three columns, the
 * same header wrapped, a rail once folded.
 *
 * A cell is CALM: it carries what is READ — one pill with the picture's state
 * (● edited, ↑ leaves at export, – held back, ⊘ ignored, its variant number,
 * ▶ a clip, ≠ its own file where the roll chose another, ! not reachable), Winnow's word in the other corner, the run's
 * mark at its centre — and nothing that is DONE. What used to be three
 * buttons on 72 px (the delivery badge, the ×, and on a phone two targets
 * covering 43 % of the cell) is the picture's MENU now: ⋯ under the pointer,
 * or a right-click anywhere on the cell — and, for several at once, the
 * SELECTION: a mode the host owns (`S`, the header's Select, a Shift or
 * ⌘/Ctrl-click, a finger held on a cell), in which a plain click marks a
 * cell instead of opening it and the header becomes the bar of verbs that
 * act on every marked picture. Outside it a plain click opens the picture
 * (outlined, kept in view as ←/→ step), Shift or ⌘/Ctrl marks it for a batch
 * (D7 of `docs/develop-tool.md`) and turns the mode on.
 *
 * While an export runs the band is its QUEUE (his pick V4): a cell still to
 * leave is veiled, the one in hand turns, a written one says ✓ and one that
 * did not leave says ! — over the picture's centre, pointer-transparent.
 */
export default function RollBand({
  place = 'bottom',
  size,
  header,
  folded = false,
  thumb,
  ...cells
}: StripCellsProps & {
  /** Under the picture (a band of rows), or standing beside it (a column) — `StripPrefs.place`. */
  place?: StripPlace;
  /** The band's whole extent on its axis: its height under the picture, its width beside it. */
  size: number;
  /**
   * The header's content, handed where the band stands in its pictures and
   * how wide it is; none draws no header at all — with a phone's drawer up,
   * where every row is the photograph's. One row under the picture; wrapped
   * beside it, where the column is narrow; a stack once folded to a rail.
   */
  header?: ((info: { at: number; shown: number; width: number }) => ReactNode) | null;
  /** Folded to its rail: the header alone, no cell laid out or drawn. */
  folded?: boolean;
  /** The thumbnail height a grid aims at (`StripPrefs.thumb`); the metrics' own by default. */
  thumb?: number;
}) {
  const metrics = STRIP_METRICS[cells.kind];
  const side = place !== 'bottom';
  const [bodyRef, width] = useElementWidth<HTMLDivElement>();
  const { pictures, openId, hideIgnored = false, shows = ALWAYS, aspects } = cells;
  const shown = useMemo(() => shownPictures(pictures, openId, hideIgnored, shows), [pictures, openId, hideIgnored, shows]);
  const items = useMemo(() => stripItems(shown, aspects), [shown, aspects]);
  const bodyHeight = folded || side ? 0 : size - (header ? metrics.head : 0);
  const target = thumb ?? metrics.thumb;
  const layout = useMemo(
    () =>
      side
        ? columnLayout({ items: folded ? [] : items, width, metrics })
        : bandLayout({ items: folded ? [] : items, width, bodyHeight, metrics, thumb: target }),
    [side, items, folded, width, bodyHeight, metrics, target],
  );
  useScrollToOpen(bodyRef, openId);
  const at = openId ? shown.findIndex((p) => p.id === openId) : -1;
  return (
    <div
      className={`flex flex-col min-w-0 min-h-0 ${side ? 'h-full' : ''}`}
      style={side ? { width: size } : { height: size }}
      role="group"
      aria-label="Pictures on this roll"
    >
      {header && (
        <div
          className={`flex-none min-w-0 ${
            side && folded
              ? 'flex flex-col items-center gap-2 py-1'
              : side
                ? 'flex flex-wrap items-center gap-1.5 px-0.5 py-0.5'
                : 'flex items-center gap-1.5'
          }`}
          style={side ? undefined : { height: metrics.head }}
        >
          {header({ at, shown: shown.length, width: side ? size : width })}
        </div>
      )}
      <div
        ref={bodyRef}
        // An ORDINARY scroll box declares no `touch-action` (`frontend.md`):
        // the browser already does both axes, and the gestures a cell takes
        // (a click, a press) write no drag.
        className={`relative flex-1 min-h-0 min-w-0 overscroll-contain [scrollbar-width:thin] ${
          folded ? 'hidden' : layout.axis === 'x' ? 'overflow-x-auto overflow-y-hidden' : 'overflow-y-auto overflow-x-hidden'
        }`}
      >
        {!folded && <StripCells shown={shown} layout={layout} {...cells} />}
      </div>
    </div>
  );
}

const ALWAYS = () => true;

/** The open picture's cell kept in view as ←/→ step along the roll. */
export function useScrollToOpen(ref: RefObject<HTMLElement | null>, openId: string | null) {
  useEffect(() => {
    const cell = openId ? ref.current?.querySelector<HTMLElement>(`[data-picture="${CSS.escape(openId)}"]`) : null;
    cell?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [openId, ref]);
}

/**
 * The cells themselves, at the rectangles a layout answers, with the one
 * menu they share — the band's body and the contact sheet's alike. Drawn in
 * a `<ol>` the size of the layout, inside whichever scroller the host gives.
 */
export function StripCells({
  shown,
  layout,
  run = null,
  openId,
  selectedIds,
  thumbs,
  availability,
  remoteThumb,
  selecting = false,
  onOpen,
  onSelectClick,
  onPress,
  onSelect,
  onRemove,
  onDeliver,
  onVariant,
  culling,
  rollChoice = null,
  heldId = null,
  written,
}: StripCellsProps & { shown: readonly RollPicture[]; layout: StripLayout }) {
  // The cells are MEMOISED, so what they are handed must be stable: the
  // host's callbacks are read through a ref, and every cell gets the same
  // handlers for the life of the strip. Without this every cell re-rendered
  // on every tick of the open picture's sliders (the audit of 2026-09-22),
  // a roll of hundreds of cells for one picture's change.
  const latest = useRef({ onOpen, onSelectClick, onPress, onSelect, onRemove, onDeliver, onVariant });
  latest.current = { onOpen, onSelectClick, onPress, onSelect, onRemove, onDeliver, onVariant };
  const [menu, setMenu] = useState<{ id: string; rect: AnchorRect } | null>(null);
  const handlers = useMemo<CellHandlers>(
    () => ({
      open: (id) => latest.current.onOpen(id),
      selectClick: (id, mods) => latest.current.onSelectClick(id, mods),
      press: (id) => latest.current.onPress(id),
      menu: (id, rect) => setMenu({ id, rect }),
    }),
    [],
  );
  const cellById = useMemo(() => new Map(layout.cells.map((c) => [c.id, c])), [layout]);
  const menuPicture = menu ? shown.find((p) => p.id === menu.id) ?? null : null;
  const menuRect = useCallback(() => menu?.rect ?? null, [menu]);
  const closeMenu = useCallback(() => setMenu(null), []);
  return (
    <>
      <ol className="relative m-0 p-0 list-none" style={{ width: layout.width, height: layout.height }}>
        {shown.map((p) => {
          const cell = cellById.get(p.id);
          if (!cell) return null;
          // Handed as two values, not a fresh object per render, so the memo holds.
          const remote = thumbs.has(p.id) ? null : remoteThumb(p);
          return (
            <Cell
              key={p.id}
              picture={p}
              cell={cell}
              open={p.id === openId}
              selected={selectedIds.has(p.id)}
              thumb={thumbs.get(p.id) ?? null}
              // The kind alone: the map is rebuilt per roll change, its objects with it.
              availabilityKind={availability.get(p.id)?.kind ?? 'local'}
              culling={culling?.get(p.id)}
              runState={runStateOf(run, p.id)}
              remoteClient={remote?.client ?? null}
              remoteId={remote?.id ?? null}
              menuOpen={menu?.id === p.id}
              selecting={selecting}
              departs={rollChoice && departsFromRoll(rollChoice, p) ? CHOICE_WORDS[rollChoice] : null}
              held={p.id === heldId}
              written={written?.has(p.id) ?? false}
              handlers={handlers}
            />
          );
        })}
      </ol>
      {menu && menuPicture && (
        <AnchoredMenu
          anchorRect={menuRect}
          items={pictureMenu(menuPicture, menuPicture.id === openId, selecting, latest.current)}
          onClose={closeMenu}
          align="start"
          label={`Actions for ${pictureLabel(menuPicture)}`}
        />
      )}
    </>
  );
}

/** The gestures on a cell, one set for every cell and for the strip's life. */
interface CellHandlers {
  open: (id: string) => void;
  selectClick: (id: string, mods: SelectionModifiers) => void;
  press: (id: string) => void;
  menu: (id: string, rect: AnchorRect) => void;
}

/**
 * The picture's verbs, as a menu: what the cell used to wear as buttons.
 * The delivery ones say the state they lead TO, with the key that does the
 * same from the keyboard; the roll's rule is offered back only where the
 * author decided; removal is apart, in red, and confirms where it costs.
 */
function pictureMenu(
  p: RollPicture,
  open: boolean,
  selecting: boolean,
  host: {
    onOpen: (id: string) => void;
    onSelect: (id: string) => void;
    onDeliver: (id: string, action: DeliverAction) => void;
    onVariant: (id: string) => void;
    onRemove: (p: RollPicture) => void;
  },
): OverflowItem[] {
  const ignored = isIgnored(p);
  const leaves = delivers(p);
  const state = deliverState(p);
  const items: OverflowItem[] = [];
  if (!open) items.push({ id: 'open', label: 'Open', onSelect: () => host.onOpen(p.id) });
  if (!selecting) items.push({ id: 'select', label: 'Select…', title: 'S — pick several pictures, then act on them all', onSelect: () => host.onSelect(p.id) });
  if (ignored) {
    items.push({ id: 'back', label: 'Bring it back into the roll’s work', title: 'M', onSelect: () => host.onDeliver(p.id, 'ignore') });
  } else {
    items.push({
      id: 'toggle',
      label: leaves ? 'Hold it back from the export' : 'Send it at export',
      title: `P — ${leaves ? 'it leaves' : 'it stays'} today${state === 'auto' ? ' by the roll’s rule' : ''}`,
      onSelect: () => host.onDeliver(p.id, 'toggle'),
    });
    if (state === 'yes' || state === 'no') {
      items.push({ id: 'rule', label: 'Back to the roll’s rule', title: 'U — it leaves if it is edited', onSelect: () => host.onDeliver(p.id, 'auto') });
    }
    items.push({ id: 'ignore', label: 'Ignore it', title: 'M — never exported, stepped over by ← / →', onSelect: () => host.onDeliver(p.id, 'ignore') });
  }
  items.push({
    id: 'variant',
    label: 'A variant, as edited',
    title: "Lightroom's virtual copy — the same file with its own develop, crop, look and words (⌘' on the open picture)",
    onSelect: () => host.onVariant(p.id),
  });
  items.push({ id: 'remove', label: 'Take it off the roll…', title: 'The file stays where it is', danger: true, onSelect: () => host.onRemove(p) });
  return items;
}

const Cell = memo(function Cell({
  picture,
  cell,
  open,
  selected,
  thumb,
  availabilityKind,
  culling,
  runState,
  remoteClient,
  remoteId,
  menuOpen,
  selecting,
  departs,
  held,
  written,
  handlers,
}: {
  picture: RollPicture;
  cell: StripCell;
  open: boolean;
  selected: boolean;
  thumb: Blob | null;
  availabilityKind: PictureAvailability['kind'];
  culling: Culling | undefined;
  /** Where this picture stands in a running export, or null outside one. */
  runState: RunUnitState | null;
  remoteClient: WinnowClient | null;
  remoteId: number | null;
  menuOpen: boolean;
  selecting: boolean;
  /** The roll's choice, in words, when this picture chose another file — else null. */
  departs: string | null;
  /** The clipboard holds this picture: the copy mark. */
  held: boolean;
  /** A verb has just written this picture: a tick, for a moment. */
  written: boolean;
  handlers: CellHandlers;
}) {
  const remote = remoteClient && remoteId !== null ? { client: remoteClient, id: remoteId } : null;
  const url = useObjectUrl(thumb);
  // A finger HELD on the cell turns the selection on with it (the gesture
  // every phone means "pick this up" by, `press-intent.ts`): a timer from the
  // touch, dropped the moment the finger travels past the slop (that is a
  // scroll) or lifts. The click that ends a hold is swallowed — it is not a
  // second gesture — and so is the browser's own long-press context menu.
  const press = useRef<{ x: number; y: number; timer: number } | null>(null);
  const swallow = useRef(false);
  const lastPointer = useRef<string>('mouse');
  const clearPress = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  };
  useEffect(() => clearPress, []);
  const onPointerDown = (e: ReactPointerEvent) => {
    lastPointer.current = e.pointerType;
    if (e.pointerType !== 'touch' || selecting) return;
    clearPress();
    const timer = window.setTimeout(() => {
      press.current = null;
      swallow.current = true;
      handlers.press(picture.id);
    }, LONG_PRESS_MS);
    press.current = { x: e.clientX, y: e.clientY, timer };
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const p = press.current;
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > PRESS_SLOP) clearPress();
  };
  const ignored = isIgnored(picture);
  // The roll's one answer (`pictureEdits`): the pill, the progress line and the
  // remove confirmation cannot disagree about what counts.
  const edits = pictureEdits(picture);
  const developed = edits.length > 0;
  const kind = availabilityKind;
  const label = pictureLabel(picture);
  const variant = variantNumber(picture);
  const clip = isClipPicture(picture);
  const leaves = delivers(picture);
  const fetching = kind === 'fetching';
  const unreachable = kind === 'failed' || kind === 'gone' || kind === 'unconnected' || kind === 'local';
  const moreRef = useRef<HTMLButtonElement>(null);
  const onContextMenu = (e: ReactMouseEvent) => {
    e.preventDefault();
    // A finger's long press is the selection's, never the menu's.
    if (lastPointer.current === 'touch' || selecting) return;
    handlers.menu(picture.id, { left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY });
  };
  const onClick = (e: ReactMouseEvent) => {
    if (swallow.current) {
      swallow.current = false;
      return;
    }
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      handlers.selectClick(picture.id, { shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey });
    } else if (selecting) {
      // In the selection a plain click MARKS: one more, or one less — ⌘'s own reading.
      handlers.selectClick(picture.id, { shiftKey: false, metaKey: true, ctrlKey: false });
    } else {
      handlers.open(picture.id);
    }
  };
  const pills = statePills({ developed, leaves, ignored, held: !leaves && deliverState(picture) === 'no', variant, clip, departs, unreachable: unreachable && !!url });
  return (
    <li
      className={`group absolute select-none [-webkit-touch-callout:none] ${ignored && !open ? 'opacity-35 hover:opacity-70' : ''}`}
      style={{ left: cell.x, top: cell.y, width: cell.w, height: cell.h + cell.cap }}
      data-picture={picture.id}
      onContextMenu={onContextMenu}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={clearPress}
      onPointerCancel={clearPress}
      onPointerLeave={clearPress}
    >
      <button
        type="button"
        onClick={onClick}
        aria-current={open ? 'true' : undefined}
        aria-selected={selected ? 'true' : undefined}
        aria-label={`${label}${clip ? ', a clip' : ''}${developed ? ', developed' : ''}${selected ? ', selected' : ''}${
          fetching ? ', fetching' : unreachable ? ', not available' : ''
        }${runState ? `, ${RUN_WORDS[runState]}` : ''}`}
        title={`${label}${clip ? ' (a clip)' : ''}${variant > 1 ? ' (a variant)' : ''}${developed ? ` — ${editSummary(picture.develop, edits)}` : ' — as shot'}${
          culling && describeCulling(culling) ? ` — Winnow: ${describeCulling(culling)}` : ''
        }${selecting ? ' — click to mark it' : ' — Shift or ⌘/Ctrl-click to select for a batch · right-click for its actions'}`}
        className="relative block w-full p-0 rounded-[6px] overflow-hidden bg-frame cursor-pointer border-0"
        style={{ height: cell.h }}
      >
        {url ? (
          <img
            src={url}
            alt=""
            className={`block w-full h-full object-cover ${unreachable ? 'opacity-45 grayscale' : ''}`}
            draggable={false}
          />
        ) : remote && (kind === 'waiting' || kind === 'fetching') ? (
          <WinnowThumb client={remote.client} id={remote.id} label={CELL_WORDS[kind]} box="w-full h-full" />
        ) : (
          <span className="absolute inset-0 grid place-items-center px-1 text-center font-mono text-3xs leading-tight text-muted">
            {CELL_WORDS[kind]}
          </span>
        )}
        {/* The outline is INSIDE the box: a border would move every cell's
            picture by its width. A marked cell wears the accent and a wash;
            marked AND open, a paper ring inside the accent tells the two. */}
        <span
          className={`absolute inset-0 rounded-[6px] pointer-events-none ${
            selected && open
              ? 'shadow-[inset_0_0_0_3px_var(--color-accent),inset_0_0_0_5px_var(--color-on-media)] bg-accent/15'
              : selected
                ? 'shadow-[inset_0_0_0_3px_var(--color-accent)] bg-accent/15'
                : open
                  ? 'shadow-[inset_0_0_0_2px_var(--color-accent),inset_0_0_0_3px_rgba(0,0,0,0.35)]'
                  : 'group-hover:shadow-[inset_0_0_0_1px_var(--color-line-strong)]'
          }`}
          aria-hidden="true"
        />
        {fetching && (
          <span className="absolute inset-0 grid place-items-center bg-[rgba(13,12,10,0.5)]" aria-hidden="true">
            <span className="w-4 h-4 rounded-full border-2 border-on-media/30 border-t-on-media/95 animate-spin motion-reduce:animate-none" />
          </span>
        )}
        {/* What is READ, and only while there is no caption to say it in: the
            state as one pill in a corner, Winnow's word in the other. */}
        {cell.cap === 0 && pills.length > 0 && (
          <span
            className="absolute left-1 bottom-1 inline-flex items-center gap-[3px] px-1.5 py-0.5 rounded-full bg-surface/85 font-mono text-3xs leading-none text-ink pointer-events-none"
            aria-hidden="true"
          >
            {pills.map((pill) => (
              <span key={pill.key} className={pill.className} title={pill.title}>
                {pill.glyph}
              </span>
            ))}
          </span>
        )}
        {cell.cap === 0 && (
          <span className={`absolute right-1 top-1 pointer-events-none ${menuOpen ? 'opacity-0' : selecting ? '' : 'pointer-fine:group-hover:opacity-0'}`}>
            <CullMark culling={culling} onMedia />
          </span>
        )}
        {/* In the selection every cell wears a ring to tick — the mark that
            says what a click does here — filled on the marked ones. */}
        {selecting && (
          <span
            className={`absolute left-1 top-1 w-[18px] h-[18px] pointer-coarse:w-[22px] pointer-coarse:h-[22px] grid place-items-center rounded-full border-[1.5px] shadow-[0_0_0_1px_rgba(0,0,0,0.25)] [&>svg]:w-3 [&>svg]:h-3 ${
              selected ? 'bg-accent border-accent text-paper' : 'border-on-media/95 bg-frame/30 text-transparent'
            }`}
            aria-hidden="true"
          >
            {Icons.check}
          </span>
        )}
        {runState && <RunMark state={runState} />}
        {/* The ECHO of a verb (`docs/press-feedback.md` C4): the picture
            ⌘V would paste FROM wears the copy mark while it is held, and a
            picture a paste or an Apply to just wrote ticks for a moment —
            the stage cannot say it when the write went to the selection. */}
        {held && (
          <span
            className="absolute right-1 bottom-1 w-[18px] h-[18px] grid place-items-center rounded-full bg-surface/85 text-ink pointer-events-none [&>svg]:w-3 [&>svg]:h-3"
            title="Copied — ⌘V pastes from this picture"
          >
            {Icons.copy}
          </span>
        )}
        {written && (
          <span
            className="absolute inset-0 grid place-items-center pointer-events-none animate-verb-tick motion-reduce:animate-none"
            aria-hidden="true"
          >
            <span className="w-7 h-7 grid place-items-center rounded-full bg-ok text-paper shadow-paper-soft [&>svg]:w-4 [&>svg]:h-4">
              {Icons.check}
            </span>
          </span>
        )}
      </button>
      {/* The picture's menu, under a pointer that can hover; a finger reaches
          the same verbs by a long press (the selection) and the bulk bar. It
          replaces Winnow's mark in that corner while shown, so the two never
          overlap — and stands down in the selection, whose bar holds them. */}
      {!selecting && (
        <button
          ref={moreRef}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            const r = moreRef.current?.getBoundingClientRect();
            if (r) handlers.menu(picture.id, r);
          }}
          className={`absolute right-1 top-1 w-[22px] h-[22px] grid place-items-center rounded-full border-0 bg-surface/85 text-ink cursor-pointer [&>svg]:w-3.5 [&>svg]:h-3.5 pointer-coarse:hidden ${
            menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
          }`}
          aria-label={`Actions for ${label}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title="Actions — or right-click the picture"
        >
          {Icons.more}
        </button>
      )}
      {cell.cap > 0 && (
        <span
          className="absolute left-0.5 right-0.5 bottom-0 flex items-center gap-1 font-mono text-3xs leading-none text-ink-soft whitespace-nowrap overflow-hidden"
          style={{ height: cell.cap }}
          aria-hidden="true"
        >
          <span className={`min-w-0 overflow-hidden text-ellipsis ${open ? 'text-accent-ink font-medium' : ''}`}>{label}</span>
          <span className="ml-auto flex-none inline-flex items-center gap-[3px] text-muted">
            {pills.map((pill) => (
              <span key={pill.key} className={pill.className} title={pill.title}>
                {pill.glyph}
              </span>
            ))}
            <CullMark culling={culling} />
          </span>
        </span>
      )}
    </li>
  );
});

/** The state glyphs a cell reads, in one order wherever they are drawn. */
function statePills({
  developed,
  leaves,
  ignored,
  held,
  variant,
  clip,
  departs,
  unreachable,
}: {
  developed: boolean;
  leaves: boolean;
  ignored: boolean;
  held: boolean;
  variant: number;
  clip: boolean;
  departs: string | null;
  unreachable: boolean;
}): { key: string; glyph: string; className: string; title: string }[] {
  const out: { key: string; glyph: string; className: string; title: string }[] = [];
  if (ignored) out.push({ key: 'ignored', glyph: '⊘', className: 'text-muted', title: 'ignored' });
  else {
    if (developed) out.push({ key: 'edited', glyph: '●', className: 'text-accent', title: 'developed' });
    if (leaves) out.push({ key: 'leaves', glyph: '↑', className: 'text-accent-ink font-medium', title: 'leaves at export' });
    else if (held) out.push({ key: 'held', glyph: '–', className: 'text-ink-soft', title: 'held back' });
  }
  if (variant > 1) out.push({ key: 'variant', glyph: String(variant), className: 'text-ink', title: `variant ${variant}` });
  if (clip) out.push({ key: 'clip', glyph: '▶', className: 'text-ink', title: 'a clip' });
  // Its own file, where the roll chose another: the one picture that will
  // not follow when the roll's choice changes.
  if (departs) out.push({ key: 'departs', glyph: '≠', className: 'text-info font-medium', title: `its own file — not the roll’s ${departs}` });
  if (unreachable) out.push({ key: 'unreachable', glyph: '!', className: 'text-danger font-medium', title: 'not available' });
  return out;
}

/** What an empty cell says, in a word or two — the stage says the rest. */
const CELL_WORDS: Record<PictureAvailability['kind'], string> = {
  ready: '…',
  preview: '…',
  fetching: '',
  waiting: 'on its instance',
  failed: 'not fetched',
  gone: 'gone',
  unconnected: 'not connected',
  local: 'not open',
};

/** `+1.2 EV · contrast +10 · look · crop` — the develop's own numbers, then every other kind of edit by name. */
function editSummary(develop: RollPicture['develop'], edits: readonly PictureEdit[]): string {
  return [describeDevelop(develop), ...edits.filter((e) => e !== 'develop')].filter(Boolean).join(' · ');
}
