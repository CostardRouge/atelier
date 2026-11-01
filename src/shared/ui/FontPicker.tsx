import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { AnchoredPopover } from './OverflowMenu';
import type { AnchorRect } from './menu-anchor';
import { Icons } from './icons';
import { revealInScroller } from './reveal';
import { flatRows, fontCss, fontGroups, fontMeta, fontProbe, stepActive, type FontChoice, type PickerKey } from './font-picker';

/**
 * Choosing a face by SEEING it (the maintainer's ask, lab
 * https://claude.ai/artifact/XyZeK8TMvTKT3uJY1xJxFZ, his picks: an anchored
 * menu on a phone too, the row's sample is the field's own text, the picture
 * tries a face while the list is browsed).
 *
 * A trigger written in the chosen face opens a list in a portal (the suite's
 * `AnchoredPopover`): each row names its face IN that face, over a line of the
 * field's own text, under its group. It is placed by `menuAnchor`'s rules —
 * below, above when below cannot hold it, scrolling when nothing can — inside
 * the SCROLLER it was opened from when that is tall enough, so it never covers
 * the picture `onPreview` is trying the face on. Typing searches; ↑ ↓ (Page,
 * Home, End) walk and preview; Enter keeps; Escape, Tab or a press outside go
 * back to the face it opened on.
 *
 * Faces are the suite's own, shipped from our origin and usually loaded
 * already where a picker is drawn; a row whose face is not loaded yet loads
 * it when it scrolls into sight, a grey bar holding its place meanwhile.
 */

export interface FontPickerProps {
  value: string;
  options: readonly FontChoice[];
  onChange: (id: string) => void;
  /** The field's accessible name. */
  label: string;
  /** The line each row writes in its face — the field's own words; a pangram when absent. */
  sample?: string;
  /** The field's weight: rows are written at the nearest each face ships. */
  weight?: number;
  /** A face being tried (hovered or walked to), null when the list closes without one kept. */
  onPreview?: (id: string | null) => void;
  /** The trigger's words when `value` names no choice (`As drawn`). */
  emptyLabel?: string;
  disabled?: boolean;
}

const PANGRAM = 'Portez ce vieux whisky au juge blond · 0123456789';
/** A scroller shorter than this is no room for a list: the screen is. */
const MIN_ROOM_PX = 260;

const triggerClass =
  'relative w-full min-w-0 flex items-center gap-2 h-[2.125rem] pointer-coarse:h-11 pl-3 pr-8 border border-line-strong rounded-control bg-surface text-ink text-left cursor-pointer focus:outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 aria-expanded:border-accent aria-expanded:ring-2 aria-expanded:ring-accent/20 disabled:opacity-50 disabled:cursor-default';

/** The nearest ancestor that scrolls — the inspector a field sits in. */
function scroller(el: HTMLElement | null): HTMLElement | null {
  for (let at = el?.parentElement ?? null; at; at = at.parentElement) {
    const y = getComputedStyle(at).overflowY;
    if (y === 'auto' || y === 'scroll') return at;
  }
  return null;
}

export default function FontPicker({ value, options, onChange, label, sample, weight = 400, onPreview, emptyLabel = 'Choose a face', disabled }: FontPickerProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const current = options.find((o) => o.id === value) ?? null;
  const preview = useRef(onPreview);
  preview.current = onPreview;

  const close = useCallback(() => {
    setOpen(false);
    preview.current?.(null);
    triggerRef.current?.focus({ preventScroll: true });
  }, []);
  const choose = useCallback(
    (id: string) => {
      setOpen(false);
      // The kept face is the change itself: the preview stands down after it, never before (no flash back).
      onChange(id);
      preview.current?.(null);
      triggerRef.current?.focus({ preventScroll: true });
    },
    [onChange],
  );

  return (
    <span className="relative flex-1 min-w-0 inline-flex">
      <button
        ref={triggerRef}
        type="button"
        className={triggerClass}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${current?.label ?? emptyLabel}`}
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={(e) => {
          if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span
          className="flex-1 min-w-0 truncate text-sm max-[820px]:text-base"
          style={current ? { font: fontCss(current, Math.min(Math.max(weight, 400), 600), 15) } : undefined}
        >
          {current?.label ?? emptyLabel}
        </span>
        {current?.note ? <span className="flex-none font-mono text-3xs text-muted">{current.note}</span> : null}
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 inline-flex text-muted [&>svg]:w-4 [&>svg]:h-4" aria-hidden="true">
          {Icons.down}
        </span>
      </button>
      {open ? (
        <FontList
          triggerRef={triggerRef}
          value={value}
          options={options}
          sample={sample}
          weight={weight}
          onPreview={(id) => preview.current?.(id)}
          onChoose={choose}
          onClose={close}
        />
      ) : null}
    </span>
  );
}

interface FontListProps {
  triggerRef: RefObject<HTMLButtonElement | null>;
  value: string;
  options: readonly FontChoice[];
  sample?: string;
  weight: number;
  onPreview: (id: string) => void;
  onChoose: (id: string) => void;
  onClose: () => void;
}

/** The open list — mounted only while open, so a closed picker draws nothing and loads nothing. */
function FontList({ triggerRef, value, options, sample, weight, onPreview, onChoose, onClose }: FontListProps) {
  const id = useId();
  const listId = `${id}-list`;
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'own' | 'pangram'>(sample ? 'own' : 'pangram');
  const groups = useMemo(() => fontGroups(options, query), [options, query]);
  const rows = useMemo(() => flatRows(groups), [groups]);
  const [active, setActive] = useState(() => rows.findIndex((r) => r.id === value));
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const line = mode === 'own' && sample ? sample : PANGRAM;

  // A search keeps the active row on the same face when it is still listed, else the first.
  useEffect(() => {
    setActive((was) => {
      const keep = rows.findIndex((r) => r.id === (rows[was]?.id ?? value));
      return keep >= 0 ? keep : rows.length ? 0 : -1;
    });
  }, [rows, value]);

  const anchorRect = useCallback((): AnchorRect | null => triggerRef.current?.getBoundingClientRect() ?? null, [triggerRef]);
  // Its room is the scroller it opened from (the inspector), so the picture stays in sight; too short, the screen.
  const room = useCallback((): AnchorRect | null => {
    const box = scroller(triggerRef.current)?.getBoundingClientRect();
    return box && box.height >= MIN_ROOM_PX ? box : null;
  }, [triggerRef]);

  // Opened on the kept face, in the middle of the list; the search has the keys (not under a finger: no keyboard pops up).
  useLayoutEffect(() => {
    revealInScroller(panelRef.current?.querySelector<HTMLElement>('[aria-selected="true"]'), { block: 'center' });
    // A frame later: the popover's first paint is hidden until placed, and a hidden field takes no focus.
    if (window.matchMedia?.('(pointer: coarse)').matches) return;
    const raf = requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(raf);
  }, []);

  const go = (next: number, scroll: boolean) => {
    setActive(next);
    const row = rows[next];
    if (!row) return;
    onPreview(row.id);
    // Kept clear of the sticky search above it (and of the foot below).
    if (scroll) revealInScroller(document.getElementById(`${id}-o-${next}`), { margin: (panelRef.current?.firstElementChild as HTMLElement | null)?.offsetHeight ?? 0 });
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (rows[active]) onChoose(rows[active].id);
      return;
    }
    if (e.key === 'Tab') {
      onClose();
      return;
    }
    const keys: PickerKey[] = ['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'];
    if (!keys.includes(e.key as PickerKey)) return;
    // Home and End belong to the search text while it holds some.
    if ((e.key === 'Home' || e.key === 'End') && query) return;
    e.preventDefault();
    go(stepActive(active, rows.length, e.key as PickerKey), true);
  };

  return (
    <AnchoredPopover
      anchorRect={anchorRect}
      room={room}
      onClose={onClose}
      within={triggerRef}
      side="below"
      align="start"
      role="dialog"
      label="Faces"
      className="w-[20rem] max-w-[calc(100vw-1rem)] p-0 overscroll-contain"
    >
      <div ref={panelRef} className="flex flex-col">
        <div className="sticky top-0 z-[1] flex flex-col gap-1.5 p-2 border-b border-line bg-surface">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Find a face"
            aria-label="Find a face"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? `${id}-o-${active}` : undefined}
            autoComplete="off"
            spellCheck={false}
            className="w-full h-[2.125rem] pointer-coarse:h-11 px-2.5 border border-line-strong rounded-control bg-paper text-ink text-sm max-[820px]:text-base placeholder:text-muted focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
          {sample ? (
            <div className="flex gap-1" role="group" aria-label="Sample line">
              {(
                [
                  ['own', 'Your text'],
                  ['pangram', 'Pangram'],
                ] as const
              ).map(([m, text]) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={mode === m}
                  onClick={() => setMode(m)}
                  className="px-2.5 py-0.5 rounded-full border border-line text-2xs font-medium text-ink-soft cursor-pointer aria-pressed:border-ink aria-pressed:text-ink"
                >
                  {text}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div id={listId} role="listbox" aria-label="Faces" className="py-1">
          {groups.length === 0 ? <p className="m-0 px-3.5 py-4 text-xs text-muted">No face matches “{query}”.</p> : null}
          {groups.map((g) => (
            <div key={g.group} role="group" aria-label={g.group}>
              <p aria-hidden="true" className="m-0 px-3.5 pt-2.5 pb-1 font-mono text-3xs uppercase tracking-[0.14em] text-muted">
                {g.group}
              </p>
              {g.items.map(({ choice, index }) => (
                <FontRow
                  key={choice.id}
                  id={`${id}-o-${index}`}
                  choice={choice}
                  weight={weight}
                  line={line}
                  selected={choice.id === value}
                  active={index === active}
                  rootRef={panelRef}
                  onHover={() => go(index, false)}
                  onChoose={() => onChoose(choice.id)}
                />
              ))}
            </div>
          ))}
        </div>
        <p className="m-0 sticky bottom-0 flex justify-between gap-2 px-3 py-1.5 border-t border-line bg-surface font-mono text-3xs text-muted pointer-coarse:hidden">
          <span>↑↓ try · ↵ keep · esc back</span>
          <span>{rows.length} face{rows.length === 1 ? '' : 's'}</span>
        </p>
      </div>
    </AnchoredPopover>
  );
}

interface FontRowProps {
  id: string;
  choice: FontChoice;
  weight: number;
  line: string;
  selected: boolean;
  active: boolean;
  rootRef: RefObject<HTMLDivElement | null>;
  onHover: () => void;
  onChoose: () => void;
}

/** Whether `choice`'s face can be drawn now: a system font always; a declared face once the document holds it. */
function faceReady(choice: FontChoice, weight: number): boolean {
  if (choice.system || typeof document === 'undefined' || !document.fonts) return true;
  try {
    return document.fonts.check(fontProbe(choice, weight));
  } catch {
    return true;
  }
}

function FontRow({ id, choice, weight, line, selected, active, rootRef, onHover, onChoose }: FontRowProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(() => faceReady(choice, weight));

  // A face not loaded yet is loaded when its row comes into sight — one weight, from our own origin.
  useEffect(() => {
    if (ready) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setReady(true);
      return;
    }
    let alive = true;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        io.disconnect();
        void document.fonts
          .load(fontProbe(choice, weight))
          .catch(() => undefined)
          .then(() => alive && setReady(true));
      },
      { root: rootRef.current?.parentElement ?? null, rootMargin: '48px 0px' },
    );
    io.observe(el);
    return () => {
      alive = false;
      io.disconnect();
    };
  }, [ready, choice, weight, rootRef]);

  return (
    <div
      ref={ref}
      id={id}
      role="option"
      aria-selected={selected}
      onPointerEnter={(e) => e.pointerType === 'mouse' && onHover()}
      onClick={onChoose}
      className={`grid grid-cols-[1.125rem_minmax(0,1fr)_auto] gap-x-2 items-center px-3 py-1.5 min-h-[3.25rem] pointer-coarse:min-h-14 cursor-pointer ${active ? 'bg-paper-2' : ''}`}
    >
      <span className={`row-start-1 col-start-1 text-xs ${selected ? 'text-accent' : 'text-transparent'}`} aria-hidden="true">
        ✓
      </span>
      {ready ? (
        <>
          <span className="row-start-1 col-start-2 min-w-0 truncate text-ink leading-tight" style={{ font: fontCss(choice, Math.min(Math.max(weight, 400), 600), 18) }}>
            {choice.label}
          </span>
          <span className="row-start-2 col-start-2 col-span-2 min-w-0 truncate text-ink-soft" style={{ font: fontCss(choice, weight, 13) }}>
            {line}
          </span>
        </>
      ) : (
        <>
          <span className="row-start-1 col-start-2 block h-2.5 w-1/2 rounded bg-line animate-pulse motion-reduce:animate-none" aria-label={`${choice.label}, loading`} />
          <span className="row-start-2 col-start-2 col-span-2 block h-2 w-3/4 mt-1.5 rounded bg-line/70" aria-hidden="true" />
        </>
      )}
      <span className="row-start-1 col-start-3 self-start pt-1 font-mono text-3xs text-muted whitespace-nowrap">{fontMeta(choice)}</span>
    </div>
  );
}
