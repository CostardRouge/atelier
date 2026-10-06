/**
 * The ⋯ on a card: its secondary verbs, folded behind one button.
 *
 * A card's row of actions — Open · Use as template · Move… · Delete — was a
 * line of grey links under every card, the destructive one among them. Now
 * the whole card opens, and everything else lives here: an `IconButton`
 * carrying the accessible name, a menu that closes on Escape or a press
 * outside it, and a `danger` item drawn apart in red.
 *
 * A menu that only closes on its own items is a menu you cannot dismiss — but
 * it must not close on a press INSIDE itself: `pointerdown` lands before
 * `click`, so unmounting there would swallow the item being pressed. The menu
 * being portalled, "inside" is two elements now: the trigger's box and the
 * menu's own, in two different places in the document.
 *
 * **It is drawn in a PORTAL, at fixed coordinates** (`menu-anchor.ts` does the
 * arithmetic). An `absolute` menu inside a gallery card is painted with that
 * card, so the next card in the grid — a positioned sibling, later in tree
 * order — paints over it whatever its `z-index`, and the page's scroll
 * container clips it on the bottom row. Both were reported on the Develop
 * gallery. A portal answers the two at once, and makes the same menu safe in a
 * rail, a header or a sheet, which no per-card `z-index` could.
 *
 * The portalled half is its own component, `AnchoredMenu`, anchored to any
 * rect the caller measures — a right-click's point on a filmstrip cell as well
 * as a trigger button — so a menu that opens from a gesture rather than a
 * button is the same menu, not a second one.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import Button, { type ButtonSize, type ButtonVariant } from './Button';
import IconButton from './IconButton';
import { Icons } from './icons';
import { menuAnchor, type AnchorRect, type MenuAnchor } from './menu-anchor';

export interface OverflowItem {
  id: string;
  label: ReactNode;
  onSelect: () => void;
  title?: string;
  /** Painted red, and separated from the rest by a rule. */
  danger?: boolean;
  disabled?: boolean;
  /**
   * A TOGGLE rather than a verb: drawn with its tick, announced as a
   * `menuitemcheckbox`, and the menu stays open so several can be set in one
   * visit — closing per tick is a menu reopened for every row.
   */
  checked?: boolean;
  /** Drawn after a rule: the first item of a second group of the same kind. */
  rule?: boolean;
}

export interface AnchoredMenuProps {
  /** Where the menu hangs from, measured by the caller — called again on scroll and resize. */
  anchorRect: () => AnchorRect | null;
  items: readonly OverflowItem[];
  /** Asked to close: Escape, a press outside, or an item taken. */
  onClose: () => void;
  /** Where the menu PREFERS to open — it flips when the screen says otherwise. */
  side?: 'below' | 'above';
  align?: 'end' | 'start';
  /** An element a press inside of does NOT close the menu — the trigger that opened it. */
  within?: RefObject<HTMLElement | null>;
  /** Names the menu for a screen reader. */
  label?: string;
}

/**
 * The menu itself, in a portal at fixed coordinates, placed by `menuAnchor`
 * from whatever rect the caller hands it. `OverflowMenu` is a trigger over
 * this; a filmstrip cell opens it from a right-click.
 */
export function AnchoredMenu({ anchorRect, items, onClose, side = 'below', align = 'end', within, label }: AnchoredMenuProps) {
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const latest = useRef({ onClose, anchorRect });
  latest.current = { onClose, anchorRect };

  useEffect(() => {
    const close = (e: PointerEvent) => {
      const target = e.target as Node;
      if (within?.current?.contains(target) || menuRef.current?.contains(target)) return;
      latest.current.onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') latest.current.onClose();
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [within]);

  /** Measure the anchor and the menu, and say where the menu goes. */
  const place = useCallback(() => {
    const rect = latest.current.anchorRect();
    const el = menuRef.current;
    if (!rect || !el) return;
    setAnchor(
      menuAnchor({
        trigger: rect,
        // `scrollHeight` stays the menu's natural height once `maxHeight`
        // clamps it, so re-placing cannot chase its own output.
        menu: { width: el.offsetWidth, height: el.scrollHeight },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        side,
        align,
      }),
    );
  }, [side, align]);

  // A fixed menu is attached to an anchor that travels: the gallery under it
  // scrolls, the window resizes, a phone rotates. `capture` is what sees a
  // scroll in an ancestor — a scroll event does not bubble to the window.
  useLayoutEffect(() => {
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [place]);

  const plain = items.filter((i) => !i.danger);
  const dangerous = items.filter((i) => i.danger);

  const item = (it: OverflowItem) => [
    it.rule && <span key={`${it.id}:rule`} className="block flex-none h-px bg-line mx-2 my-1.5" />,
    <button
      key={it.id}
      type="button"
      role={it.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
      aria-checked={it.checked}
      disabled={it.disabled}
      title={it.title}
      onClick={(e) => {
        e.stopPropagation();
        if (it.checked === undefined) latest.current.onClose();
        it.onSelect();
      }}
      className={`shrink-0 text-left font-sans text-sm border-0 bg-transparent px-2.5 py-2 rounded-[8px] cursor-pointer whitespace-nowrap disabled:opacity-45 disabled:cursor-default ${
        it.danger
          ? 'text-danger hover:bg-danger-wash hover:text-danger-ink data-pressed:bg-danger-wash data-pressed:text-danger-ink'
          : 'text-ink-soft hover:bg-paper-2 hover:text-ink data-pressed:bg-paper-2 data-pressed:text-ink'
      }`}
    >
      {it.checked === undefined ? (
        it.label
      ) : (
        <span className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={`flex-none grid place-items-center w-4 h-4 rounded-[4px] border-[1.5px] ${it.checked ? 'bg-accent border-accent text-white' : 'border-line-strong'}`}
          >
            {it.checked && <span className="inline-flex text-3xs">{Icons.check}</span>}
          </span>
          <span className="min-w-0 flex-1">{it.label}</span>
        </span>
      )}
    </button>,
  ];

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={label}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      // A menu is above every other overlay by construction: modals and
      // the shell's own sheets are z-50 (the library sheet z-[60]), and
      // a menu opened from one of them must not be swallowed by it.
      className="fixed z-[70] min-w-[12rem] flex flex-col p-1.5 overflow-y-auto bg-surface border border-line-strong rounded-paper shadow-paper"
      style={
        anchor
          ? { left: anchor.left, top: anchor.top, maxHeight: anchor.maxHeight }
          : // The first paint of a menu nobody has measured yet: the
            // layout effect places it before the browser draws.
            { left: 0, top: 0, visibility: 'hidden' }
      }
    >
      {plain.map(item)}
      {dangerous.length > 0 && plain.length > 0 && <span className="block flex-none h-px bg-line mx-2 my-1.5" />}
      {dangerous.map(item)}
    </div>,
    document.body,
  );
}

interface OverflowMenuProps {
  /** Names the button: "More actions for Zoom trip". */
  label: string;
  items: readonly OverflowItem[];
  size?: ButtonSize;
  /** Where the menu PREFERS to open — it flips when the screen says otherwise. */
  side?: 'below' | 'above';
  align?: 'end' | 'start';
  className?: string;
  /**
   * A worded trigger instead of the ⋯ — for a menu that is a screen's VERB
   * ("Add ▾") rather than a card's secondary actions. `label` still names it
   * for a screen reader.
   *
   * `bare` is for a trigger that is the screen's OWN text rather than a
   * control of its own: the file name above a photograph, the percentage
   * inside a zoom pill. `className` is then the WHOLE recipe — none of
   * `Button`'s font, height, padding or `shrink-0` is in the way, and the
   * caller writes its own chevron into `text`. Not the same thing as a
   * `Button` with overrides: two utilities of one property are resolved by
   * Tailwind's order, not by the class list's (`frontend.md`).
   */
  trigger?: {
    text: ReactNode;
    icon?: ReactNode;
    variant?: ButtonVariant;
    size?: ButtonSize;
    bare?: boolean;
    className?: string;
    /** The tooltip, for a bare trigger whose text is truncated. */
    title?: string;
  };
  /**
   * The glyph on the icon-only trigger (ignored once `trigger` is set) —
   * `Icons.more` by default, for a menu that IS a rail's own verb rather
   * than a card's secondary actions (the collapsed library's Add).
   */
  icon?: ReactNode;
  /** The icon-only trigger's variant — `ghost` by default, the ⋯'s own. */
  variant?: ButtonVariant;
  disabled?: boolean;
}

export default function OverflowMenu({
  label,
  items,
  size = 'sm',
  side = 'below',
  align = 'end',
  className = '',
  trigger,
  icon,
  variant,
  disabled = false,
}: OverflowMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const anchorRect = useCallback(() => rootRef.current?.getBoundingClientRect() ?? null, []);
  const close = useCallback(() => setOpen(false), []);

  return (
    <div ref={rootRef} className={`relative inline-flex ${className}`}>
      {trigger ? (
        trigger.bare ? (
          <button
            type="button"
            className={trigger.className}
            title={trigger.title}
            aria-label={label}
            aria-expanded={open}
            aria-haspopup="menu"
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation();
              setOpen((o) => !o);
            }}
          >
            {trigger.text}
          </button>
        ) : (
          <Button
            variant={trigger.variant ?? 'default'}
            size={trigger.size}
            icon={trigger.icon}
            trailing={Icons.down}
            aria-label={label}
            aria-expanded={open}
            aria-haspopup="menu"
            disabled={disabled}
            className={trigger.className}
            onClick={(e) => {
              e.stopPropagation();
              setOpen((o) => !o);
            }}
          >
            {trigger.text}
          </Button>
        )
      ) : (
        <IconButton
          size={size}
          variant={variant ?? 'ghost'}
          label={label}
          aria-expanded={open}
          aria-haspopup="menu"
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
          className={open ? 'bg-paper-2 text-ink' : ''}
        >
          {icon ?? Icons.more}
        </IconButton>
      )}
      {open && <AnchoredMenu anchorRect={anchorRect} items={items} onClose={close} side={side} align={align} within={rootRef} />}
    </div>
  );
}
