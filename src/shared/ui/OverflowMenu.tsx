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
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Button, { type ButtonSize, type ButtonVariant } from './Button';
import IconButton from './IconButton';
import { Icons } from './icons';
import { menuAnchor, type MenuAnchor } from './menu-anchor';

export interface OverflowItem {
  id: string;
  label: ReactNode;
  onSelect: () => void;
  title?: string;
  /** Painted red, and separated from the rest by a rule. */
  danger?: boolean;
  disabled?: boolean;
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
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  /** Measure the trigger and the menu, and say where the menu goes. */
  const place = useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect();
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

  // A fixed menu is attached to a trigger that travels: the gallery under it
  // scrolls, the window resizes, a phone rotates. `capture` is what sees a
  // scroll in an ancestor — a scroll event does not bubble to the window.
  useLayoutEffect(() => {
    if (!open) {
      setAnchor(null);
      return;
    }
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, place]);

  const plain = items.filter((i) => !i.danger);
  const dangerous = items.filter((i) => i.danger);

  const item = (it: OverflowItem) => (
    <button
      key={it.id}
      type="button"
      role="menuitem"
      disabled={it.disabled}
      title={it.title}
      onClick={(e) => {
        e.stopPropagation();
        setOpen(false);
        it.onSelect();
      }}
      className={`shrink-0 text-left font-sans text-sm border-0 bg-transparent px-2.5 py-2 rounded-[8px] cursor-pointer whitespace-nowrap disabled:opacity-45 disabled:cursor-default ${
        it.danger
          ? 'text-danger hover:bg-danger-wash hover:text-danger-ink'
          : 'text-ink-soft hover:bg-paper-2 hover:text-ink'
      }`}
    >
      {it.label}
    </button>
  );

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
            icon={trigger.icon}
            trailing={Icons.down}
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
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            onClick={(e) => e.stopPropagation()}
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
            {dangerous.length > 0 && plain.length > 0 && (
              <span className="block flex-none h-px bg-line mx-2 my-1.5" />
            )}
            {dangerous.map(item)}
          </div>,
          document.body,
        )}
    </div>
  );
}
