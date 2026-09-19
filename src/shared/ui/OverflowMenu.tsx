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
 * `click`, so unmounting there would swallow the item being pressed.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Button, { type ButtonSize, type ButtonVariant } from './Button';
import IconButton from './IconButton';
import { Icons } from './icons';

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
  /** Where the menu opens relative to the button. */
  side?: 'below' | 'above';
  align?: 'end' | 'start';
  className?: string;
  /**
   * A worded trigger instead of the ⋯ — for a menu that is a screen's VERB
   * ("Add ▾") rather than a card's secondary actions. `label` still names it
   * for a screen reader.
   */
  trigger?: { text: ReactNode; icon?: ReactNode; variant?: ButtonVariant };
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

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
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
      className={`text-left font-sans text-sm border-0 bg-transparent px-2.5 py-2 rounded-[8px] cursor-pointer whitespace-nowrap disabled:opacity-45 disabled:cursor-default ${
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
        <Button
          variant={trigger.variant ?? 'default'}
          icon={trigger.icon}
          trailing={Icons.down}
          aria-label={label}
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
        >
          {trigger.text}
        </Button>
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
      {open && (
        <div
          role="menu"
          onClick={(e) => e.stopPropagation()}
          className={`absolute z-20 min-w-[12rem] flex flex-col p-1.5 bg-surface border border-line-strong rounded-paper shadow-paper ${
            side === 'below' ? 'top-full mt-1.5' : 'bottom-full mb-1.5'
          } ${align === 'end' ? 'right-0' : 'left-0'}`}
        >
          {plain.map(item)}
          {dangerous.length > 0 && plain.length > 0 && (
            <span className="block h-px bg-line mx-2 my-1.5" />
          )}
          {dangerous.map(item)}
        </div>
      )}
    </div>
  );
}
