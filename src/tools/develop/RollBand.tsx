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
import { createPortal } from 'react-dom';
import { describeDevelop } from '../../shared/develop/develop';
import type { SelectionModifiers } from '../../shared/develop/roll-editor';
import type { PictureAvailability } from '../../shared/develop/roll-media';
import {
  STRIP_METRICS,
  bandLayout,
  cellAspect,
  cellsInView,
  columnLayout,
  dropAnchor,
  stripDrop,
  type StripDrop,
  type StripItem,
  type StripKind,
  type StripLayout,
  type StripPlace,
  type ViewBox,
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
  type RollMoveAnchor,
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
import { useElementSize } from '../../shared/ui/use-element-width';
import type { DeliverAction } from './PictureWorkbench';
import { rulerWindow } from './roll-ruler';

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
  /**
   * Carry pictures to another place on the roll (item 29): a cell dragged —
   * a mouse past the slop, a finger after its hold — or the menu's Move
   * verbs. A selected cell carries the shown selection with it. Absent,
   * nothing moves.
   */
  onMove?: (ids: string[], anchor: RollMoveAnchor) => void;
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
  header?: ((info: { at: number; shown: number; width: number; inView: readonly [number, number] | null }) => ReactNode) | null;
  /** Folded to its rail: the header alone, no cell laid out or drawn. */
  folded?: boolean;
  /** The thumbnail height a grid aims at (`StripPrefs.thumb`); the metrics' own by default. */
  thumb?: number;
}) {
  const metrics = STRIP_METRICS[cells.kind];
  const side = place !== 'bottom';
  const [bodyRef, view] = useScrollView<HTMLDivElement>();
  const width = view.w;
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
  useScrollToOpen(bodyRef, openId, layout, metrics.pad);
  const at = openId ? shown.findIndex((p) => p.id === openId) : -1;
  const inView = useCellsInView(bodyRef, layout, shown, folded);
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
          {header({ at, shown: shown.length, width: side ? size : width, inView })}
        </div>
      )}
      <div
        ref={bodyRef}
        // An ORDINARY scroll box declares no `touch-action` (`frontend.md`):
        // the browser already does both axes, and the gestures a cell takes
        // (a click, a press) write no drag.
        //
        // A band of ROWS rests on a row (`snap-y`): scrolled freely it stopped
        // with one row sliced flush under the header and another against the
        // screen's bottom bar — no breathing room at either end. The snap
        // keeps the layout's own padding (`scroll-padding`) at rest.
        className={`relative flex-1 min-h-0 min-w-0 overscroll-contain [scrollbar-width:thin] ${
          folded ? 'hidden' : layout.axis === 'x' ? 'overflow-x-auto overflow-y-hidden' : 'overflow-y-auto overflow-x-hidden snap-y snap-mandatory'
        }`}
        style={layout.axis === 'y' ? { scrollPaddingBlock: metrics.pad } : undefined}
      >
        {!folded && <StripCells shown={shown} layout={layout} view={view} {...cells} />}
      </div>
    </div>
  );
}

const ALWAYS = () => true;

/**
 * The pictures the band has ON SCREEN, as indices into what it shows — for
 * the ruler's frame on a phone (`roll-ruler.ts`). Read on scroll once per
 * frame, exactly (`useScrollView` publishes only every quarter box, which is
 * the cells' business), and handed up only when the first or last changes.
 */
function useCellsInView(
  bodyRef: RefObject<HTMLDivElement>,
  layout: StripLayout,
  shown: readonly { id: string }[],
  folded: boolean,
): readonly [number, number] | null {
  const [inView, setInView] = useState<readonly [number, number] | null>(null);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || folded) {
      setInView(null);
      return;
    }
    const index = new Map(shown.map((p, i) => [p.id, i]));
    let frame = 0;
    const read = () => {
      frame = 0;
      const x = layout.axis === 'x';
      const w = rulerWindow(layout.cells, x ? el.scrollLeft : el.scrollTop, x ? el.clientWidth : el.clientHeight, layout.axis);
      const next: readonly [number, number] | null = w
        ? [index.get(layout.cells[w[0]].id) ?? w[0], index.get(layout.cells[w[1]].id) ?? w[1]]
        : null;
      setInView((cur) => (cur?.[0] === next?.[0] && cur?.[1] === next?.[1] ? cur : next));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    read();
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [bodyRef, layout, shown, folded]);
  return inView;
}

/**
 * What a scroller SHOWS of its content — its scroll position and its box,
 * in layout pixels — for the cells to be drawn from (`cellsInView`). The
 * position is read on scroll, once per frame, and published only once it
 * has moved a quarter of the box since the last reading: the drawn set
 * carries one box of margin on each side, so a fling re-renders the strip
 * a few times and never per frame. The box is the `ResizeObserver`'s.
 */
export function useScrollView<T extends HTMLElement>(): [RefObject<T>, ViewBox] {
  const [ref, size] = useElementSize<T>();
  const [scroll, setScroll] = useState({ x: 0, y: 0 });
  const last = useRef({ x: 0, y: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const read = (force: boolean) => {
      frame = 0;
      const x = el.scrollLeft;
      const y = el.scrollTop;
      if (!force && Math.abs(x - last.current.x) < el.clientWidth / 4 && Math.abs(y - last.current.y) < el.clientHeight / 4) return;
      last.current = { x, y };
      setScroll((cur) => (cur.x === x && cur.y === y ? cur : { x, y }));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(() => read(false));
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    read(true);
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ref]);
  // A box that changes SIZE can clamp its scroll without a scroll event (a
  // band pulled up into a grid and folded back to one row): read it again, or
  // the window stays on cells far from what is shown and the view is blank.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const x = el.scrollLeft;
    const y = el.scrollTop;
    if (x === last.current.x && y === last.current.y) return;
    last.current = { x, y };
    setScroll((cur) => (cur.x === x && cur.y === y ? cur : { x, y }));
  }, [ref, size.width, size.height]);
  const view = useMemo(() => ({ x: scroll.x, y: scroll.y, w: size.width, h: size.height }), [scroll, size]);
  return [ref, view];
}

/**
 * The open picture's cell kept in view as ←/→ step along the roll: scrolled
 * to by the RECTANGLE the layout answers, to the nearest edge with `margin`
 * of breathing room (a cell already in view moves nothing), once per open
 * picture on each axis — the cell is not asked of the DOM, since the first
 * layout is laid at no width and a later one must not pull the band back
 * under a hand that scrolled away. The band's body and nothing else is
 * scrolled — never `scrollIntoView`, which also scrolled the clipping frame
 * and the locked page under the band and lifted the whole tool (`reveal.ts`).
 */
export function useScrollToOpen(ref: RefObject<HTMLElement | null>, openId: string | null, layout: StripLayout, margin = 0) {
  const cell = openId ? layout.cells.find((c) => c.id === openId) : undefined;
  const box = cell && cell.w > 0 && cell.h > 0 ? `${cell.x},${cell.y},${cell.w},${cell.h + cell.cap}` : null;
  const axis = layout.axis;
  const done = useRef<string | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !openId || !box) return;
    const key = `${openId}:${axis}`;
    if (done.current === key) return;
    const [x, y, w, h] = box.split(',').map(Number);
    if (axis === 'x') {
      if (!(el.clientWidth > 0)) return;
      if (x - margin < el.scrollLeft) el.scrollLeft = Math.max(0, x - margin);
      else if (x + w + margin > el.scrollLeft + el.clientWidth) el.scrollLeft = x + w + margin - el.clientWidth;
    } else {
      if (!(el.clientHeight > 0)) return;
      if (y - margin < el.scrollTop) el.scrollTop = Math.max(0, y - margin);
      else if (y + h + margin > el.scrollTop + el.clientHeight) el.scrollTop = y + h + margin - el.clientHeight;
    }
    done.current = key;
  }, [ref, openId, box, axis, margin]);
}

/**
 * The cells themselves, at the rectangles a layout answers, with the one
 * menu they share — the band's body and the contact sheet's alike. Drawn in
 * a `<ol>` the size of the layout, inside whichever scroller the host gives
 * — and only the cells NEAR what that scroller shows (`cellsInView`, one box
 * of margin each side, the open cell always): a roll of hundreds put every
 * cell in the DOM at open (`docs/audit-2026-10-02.md`, PERF-03).
 *
 * A cell is also CARRIED to another place on the roll (item 29): a mouse
 * that presses one and travels past the slop lifts it — a click never
 * travels — and a finger lifts it by moving after the hold that turned the
 * selection on, the gesture a phone's photo grid means "pick this up" by. A
 * marked cell carries every marked picture the strip shows, in their roll
 * order. A bar says where they will land; the scroller slides at its edges
 * so a long roll can be crossed; Escape puts them back where they were.
 */
export function StripCells({
  shown,
  layout,
  view,
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
  onMove,
  pictures,
  culling,
  rollChoice = null,
  heldId = null,
  written,
}: StripCellsProps & { shown: readonly RollPicture[]; layout: StripLayout; view: ViewBox }) {
  // The cells are MEMOISED, so what they are handed must be stable: the
  // host's callbacks are read through a ref, and every cell gets the same
  // handlers for the life of the strip. Without this every cell re-rendered
  // on every tick of the open picture's sliders (the audit of 2026-09-22),
  // a roll of hundreds of cells for one picture's change.
  const latest = useRef({ onOpen, onSelectClick, onPress, onSelect, onRemove, onDeliver, onVariant, onMove });
  latest.current = { onOpen, onSelectClick, onPress, onSelect, onRemove, onDeliver, onVariant, onMove };
  // What a carry reads when it starts and lands, never a stale render's.
  const strip = useRef({ shown, layout, selectedIds });
  strip.current = { shown, layout, selectedIds };
  const [menu, setMenu] = useState<{ id: string; rect: AnchorRect } | null>(null);
  const carry = useCarry(strip, latest);
  const handlers = useMemo<CellHandlers>(
    () => ({
      open: (id) => latest.current.onOpen(id),
      selectClick: (id, mods) => latest.current.onSelectClick(id, mods),
      press: (id) => latest.current.onPress(id),
      menu: (id, rect) => setMenu({ id, rect }),
      arm: carry.arm,
    }),
    [carry.arm],
  );
  const pictureById = useMemo(() => new Map(shown.map((p) => [p.id, p])), [shown]);
  const drawn = useMemo(() => cellsInView(layout.cells, view, layout.axis, openId), [layout, view, openId]);
  const menuPicture = menu ? shown.find((p) => p.id === menu.id) ?? null : null;
  const menuRect = useCallback(() => menu?.rect ?? null, [menu]);
  const closeMenu = useCallback(() => setMenu(null), []);
  const lift = carry.lift;
  const lifted = useMemo(() => new Set(lift?.ids ?? []), [lift]);
  const ends = { first: pictures[0]?.id ?? null, last: pictures[pictures.length - 1]?.id ?? null };
  return (
    <>
      <ol
        ref={carry.olRef}
        className={`relative m-0 p-0 list-none ${lift ? 'cursor-grabbing' : ''}`}
        style={{ width: layout.width, height: layout.height }}
        data-carry={lift ? `${lift.ids.join(',')}>${lift.drop?.slot ?? '-'}` : undefined}
      >
        {drawn.map((cell) => {
          const p = pictureById.get(cell.id);
          if (!p) return null;
          // Handed as plain values, not a fresh object per render, so the
          // memo holds: the layout is rebuilt as thumbnails land, and a cell
          // whose rectangle did not move must not redraw for it.
          const remote = thumbs.has(p.id) ? null : remoteThumb(p);
          return (
            <Cell
              key={p.id}
              picture={p}
              x={cell.x}
              y={cell.y}
              w={cell.w}
              h={cell.h}
              cap={cell.cap}
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
              lifted={lifted.has(p.id)}
              movable={Boolean(onMove)}
              handlers={handlers}
            />
          );
        })}
        {/* Where a carried picture will land: a bar in the gap of its slot. */}
        {lift?.drop && !lift.still && (
          <li
            aria-hidden="true"
            className="absolute rounded-full bg-accent pointer-events-none shadow-[0_0_0_1px_var(--color-paper)]"
            style={{ left: lift.drop.bar.x, top: lift.drop.bar.y, width: lift.drop.bar.w, height: lift.drop.bar.h }}
          />
        )}
      </ol>
      {lift && <CarryGhost lift={lift} thumbs={thumbs} pictures={pictureById} />}
      {menu && menuPicture && (
        <AnchoredMenu
          anchorRect={menuRect}
          items={pictureMenu(menuPicture, menuPicture.id === openId, selecting, ends, latest.current)}
          onClose={closeMenu}
          align="start"
          label={`Actions for ${pictureLabel(menuPicture)}`}
        />
      )}
    </>
  );
}

/** A carry in flight: what moves, where the pointer is, where it would land. */
interface Lift {
  ids: string[];
  x: number;
  y: number;
  drop: StripDrop | null;
  /** The slot is where the pictures already are: a drop there moves nothing, and no bar is drawn. */
  still: boolean;
}

/** How near the scroller's edge a carried picture slides it, and how fast at the very edge (px per frame). */
const CARRY_EDGE = 40;
const CARRY_SPEED = 14;

/**
 * The carry's machine (item 29), apart from the cells so a cell only ARMS
 * it: a press arms, travelling past the slop lifts, the window follows the
 * pointer wherever it goes (a cell scrolled out of the drawn window is
 * unmounted under it), and letting go lands the pictures through the host's
 * `onMove`. A finger reaches here only after its hold, and the strip's own
 * non-passive `touchmove` keeps the scroller from taking the gesture from
 * then on — an `ol` asking the browser to wait on every touch, the one cost.
 */
function useCarry(
  strip: RefObject<{ shown: readonly RollPicture[]; layout: StripLayout; selectedIds: ReadonlySet<string> }>,
  host: RefObject<{ onMove?: (ids: string[], anchor: RollMoveAnchor) => void }>,
) {
  const olRef = useRef<HTMLOListElement>(null);
  const [lift, setLiftState] = useState<Lift | null>(null);
  // The live value, written at once: the edge's frame loop and the pointer
  // both move the lift between two renders and must not undo each other.
  const liftRef = useRef<Lift | null>(null);
  const setLift = (next: Lift | null) => {
    liftRef.current = next;
    setLiftState(next);
  };
  const armed = useRef<{ id: string; x: number; y: number; pointerId: number; touch: boolean } | null>(null);
  const raf = useRef(0);
  const quiet = useRef(false);
  const off = useRef<(() => void) | null>(null);

  const place = (ids: string[], x: number, y: number): Lift => {
    const ol = olRef.current;
    const { shown, layout } = strip.current!;
    const r = ol?.getBoundingClientRect();
    const drop = r ? stripDrop(layout.cells, { x: x - r.left, y: y - r.top }) : null;
    // Where the pictures already stand among those shown: a slot inside or
    // beside an unbroken run of them moves nothing.
    const at = ids.map((id) => shown.findIndex((p) => p.id === id)).filter((i) => i >= 0).sort((a, b) => a - b);
    const run = at.length > 0 && at[at.length - 1] - at[0] === at.length - 1;
    const still = !drop || (run && drop.slot >= at[0] && drop.slot <= at[at.length - 1] + 1);
    return { ids, x, y, drop, still };
  };

  const end = (land: boolean) => {
    cancelAnimationFrame(raf.current);
    raf.current = 0;
    off.current?.();
    off.current = null;
    const was = liftRef.current;
    armed.current = null;
    if (!was) return;
    setLift(null);
    // The click a mouse's release ends on is the carry's, not an open: it is
    // dispatched in the same task as the release, so the quiet ends after it.
    quiet.current = true;
    window.setTimeout(() => {
      quiet.current = false;
    }, 0);
    if (!land || !was.drop || was.still) return;
    const anchor = dropAnchor(
      strip.current!.shown.map((p) => p.id),
      new Set(was.ids),
      was.drop.slot,
    );
    if (anchor) host.current!.onMove?.(was.ids, anchor);
  };

  // At either edge of its scroller the strip slides under the carried
  // picture, faster the deeper the pointer, so a long roll is crossed.
  const tick = () => {
    raf.current = 0;
    const l = liftRef.current;
    const box = olRef.current?.parentElement;
    if (!l || !box) return;
    const r = box.getBoundingClientRect();
    const axis = strip.current!.layout.axis;
    const [p, lo, hi] = axis === 'x' ? [l.x, r.left, r.right] : [l.y, r.top, r.bottom];
    const depth = p < lo + CARRY_EDGE ? -(lo + CARRY_EDGE - p) : p > hi - CARRY_EDGE ? p - (hi - CARRY_EDGE) : 0;
    if (depth === 0) return;
    const by = Math.sign(depth) * Math.min(CARRY_SPEED, Math.ceil((Math.abs(depth) / CARRY_EDGE) * CARRY_SPEED));
    if (axis === 'x') box.scrollLeft += by;
    else box.scrollTop += by;
    setLift(place(l.ids, l.x, l.y));
    raf.current = requestAnimationFrame(tick);
  };

  const arm = useCallback((id: string, at: { x: number; y: number; pointerId: number; touch: boolean }) => {
    if (!host.current?.onMove) return;
    off.current?.();
    armed.current = { id, ...at };
    const onMoveEvent = (e: PointerEvent) => {
      const a = armed.current;
      if (!a || e.pointerId !== a.pointerId) return;
      if (!liftRef.current) {
        if (Math.hypot(e.clientX - a.x, e.clientY - a.y) <= PRESS_SLOP) return;
        // What is carried: the marked pictures the strip shows, in roll
        // order, when the grabbed one is among them — else that one alone.
        const { shown, selectedIds } = strip.current!;
        const ids = selectedIds.has(a.id) ? shown.filter((p) => selectedIds.has(p.id)).map((p) => p.id) : [a.id];
        setLift(place(ids, e.clientX, e.clientY));
      } else {
        setLift(place(liftRef.current.ids, e.clientX, e.clientY));
      }
      if (!raf.current) raf.current = requestAnimationFrame(tick);
    };
    const onUp = (e: PointerEvent) => {
      if (armed.current && e.pointerId === armed.current.pointerId) end(e.type === 'pointerup');
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !liftRef.current) return;
      // Put back: the editor's own Escape must not also step out of the selection.
      e.preventDefault();
      e.stopPropagation();
      end(false);
    };
    window.addEventListener('pointermove', onMoveEvent);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('keydown', onKey, true);
    off.current = () => {
      window.removeEventListener('pointermove', onMoveEvent);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('keydown', onKey, true);
    };
    // `strip` and `host` are refs, and the helpers read only refs: one arm for the strip's life.
  }, []);

  useEffect(() => {
    const ol = olRef.current;
    if (!ol) return;
    // A finger that held a cell owns the gesture from then on: the scroller
    // would otherwise start panning on its first move and cancel the pointer.
    const onTouchMove = (e: TouchEvent) => {
      if (armed.current?.touch && e.cancelable) e.preventDefault();
    };
    // The click a carry ends on opens nothing and marks nothing.
    const onClick = (e: MouseEvent) => {
      if (quiet.current) {
        e.stopPropagation();
        e.preventDefault();
      }
    };
    ol.addEventListener('touchmove', onTouchMove, { passive: false });
    ol.addEventListener('click', onClick, true);
    return () => {
      ol.removeEventListener('touchmove', onTouchMove);
      ol.removeEventListener('click', onClick, true);
      off.current?.();
      cancelAnimationFrame(raf.current);
    };
  }, []);

  return { olRef, lift, arm };
}

/** What follows the pointer while pictures are carried: the first one's thumbnail, and how many go. */
function CarryGhost({ lift, thumbs, pictures }: { lift: Lift; thumbs: ReadonlyMap<string, Blob>; pictures: ReadonlyMap<string, RollPicture> }) {
  const first = lift.ids[0];
  const url = useObjectUrl(thumbs.get(first) ?? null);
  const picture = pictures.get(first);
  return createPortal(
    <div
      aria-hidden="true"
      className="fixed z-[80] pointer-events-none -translate-x-1/2 -translate-y-full"
      style={{ left: lift.x, top: lift.y - 12 }}
    >
      <div className="relative h-16 rounded-[6px] overflow-hidden bg-frame shadow-paper-soft ring-2 ring-accent">
        {url ? (
          <img src={url} alt="" className="block h-full w-auto max-w-[8rem] object-cover" draggable={false} />
        ) : (
          <span className="grid h-full w-24 place-items-center px-1 font-mono text-3xs text-on-media">{picture ? pictureLabel(picture) : ''}</span>
        )}
        {lift.ids.length > 1 && (
          <span className="absolute right-1 top-1 min-w-[18px] h-[18px] px-1 grid place-items-center rounded-full bg-accent text-paper font-mono text-3xs tabular-nums">
            {lift.ids.length}
          </span>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** The gestures on a cell, one set for every cell and for the strip's life. */
interface CellHandlers {
  open: (id: string) => void;
  selectClick: (id: string, mods: SelectionModifiers) => void;
  press: (id: string) => void;
  menu: (id: string, rect: AnchorRect) => void;
  /** A press that may become a carry (`useCarry`): a mouse at once, a finger after its hold. */
  arm: (id: string, at: { x: number; y: number; pointerId: number; touch: boolean }) => void;
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
  ends: { first: string | null; last: string | null },
  host: {
    onOpen: (id: string) => void;
    onSelect: (id: string) => void;
    onDeliver: (id: string, action: DeliverAction) => void;
    onVariant: (id: string) => void;
    onRemove: (p: RollPicture) => void;
    onMove?: (ids: string[], anchor: RollMoveAnchor) => void;
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
  // A finger's way to carry one picture far, and a mouse's to skip the trip.
  const move = host.onMove;
  if (move && ends.first !== p.id) {
    items.push({ id: 'move-start', label: 'Move to the start of the roll', title: 'Or drag it along the band — ⌥← / ⌥→ carry the open picture one place', onSelect: () => move([p.id], 'start') });
  }
  if (move && ends.last !== p.id) {
    items.push({ id: 'move-end', label: 'Move to the end of the roll', title: 'Or drag it along the band — ⌥← / ⌥→ carry the open picture one place', onSelect: () => move([p.id], 'end') });
  }
  items.push({ id: 'remove', label: 'Take it off the roll…', title: 'The file stays where it is', danger: true, onSelect: () => host.onRemove(p) });
  return items;
}

const Cell = memo(function Cell({
  picture,
  x,
  y,
  w,
  h,
  cap,
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
  lifted,
  movable,
  handlers,
}: {
  picture: RollPicture;
  /** The cell's rectangle (`StripCell`): the picture's box, the caption's height under it. */
  x: number;
  y: number;
  w: number;
  h: number;
  cap: number;
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
  /** Carried elsewhere right now: its cell is left as a faint mark of where it was. */
  lifted: boolean;
  /** The host takes a carry: a press is armed for it. */
  movable: boolean;
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
    // A new gesture: a hold's swallow that no click consumed (the finger
    // carried the picture away and never tapped) is spent.
    swallow.current = false;
    const at = { x: e.clientX, y: e.clientY, pointerId: e.pointerId, touch: e.pointerType === 'touch' };
    if (e.pointerType !== 'touch') {
      // A mouse arms a carry at once — travelling past the slop is what a
      // click never does; a modified press is the selection's alone.
      if (movable && e.button === 0 && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) handlers.arm(picture.id, at);
      return;
    }
    clearPress();
    const timer = window.setTimeout(() => {
      press.current = null;
      swallow.current = true;
      // Held outside the selection, it turns the selection on with this
      // picture; held inside it, it marks the picture if it was not. Either
      // way the finger may now carry it.
      if (!selecting) handlers.press(picture.id);
      else if (!selected) handlers.selectClick(picture.id, { shiftKey: false, metaKey: true, ctrlKey: false });
      if (movable) handlers.arm(picture.id, at);
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
      className={`group absolute snap-start select-none [-webkit-touch-callout:none] ${
        lifted ? 'opacity-30' : ignored && !open ? 'opacity-35 hover:opacity-70' : ''
      }`}
      style={{ left: x, top: y, width: w, height: h + cap }}
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
        style={{ height: h }}
      >
        {url ? (
          // Eager: the strip already draws only the cells near its view
          // (`cellsInView`), and a lazy `<img>` inside a scroller is one
          // iOS Safari may never start — no load, no error, an empty frame.
          <img
            src={url}
            alt=""
            decoding="async"
            className={`block w-full h-full object-cover ${unreachable ? 'opacity-45 grayscale' : ''}`}
            draggable={false}
          />
        ) : remote ? (
          // The instance's thumbnail whatever the picture's state: a picture
          // fetched into the pool (the open one and its neighbours, `ready`)
          // used to swap it for "…" until its own bake landed — one decode at
          // a time on a phone, and never if the bake failed.
          <WinnowThumb client={remote.client} id={remote.id} label={CELL_WORDS[kind]} box="w-full h-full" eager />
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
        {cap === 0 && pills.length > 0 && (
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
        {cap === 0 && (
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
      {cap > 0 && (
        <span
          className="absolute left-0.5 right-0.5 bottom-0 flex items-center gap-1 font-mono text-3xs leading-none text-ink-soft whitespace-nowrap overflow-hidden"
          style={{ height: cap }}
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
