import { useState, type ReactNode } from 'react';
import SectionLegend from '../../../shared/ui/SectionLegend';
import { optionClass } from './ui';

export interface ChoiceOption<Id extends string> {
  id: Id;
  label: string;
  /** The line this option would really draw for the piece in hand, or null. */
  text: string | null;
  /** Shown in its place when there is no line — the reason, never an example. */
  otherwise: string;
  /** A word about when the mode applies, on the option's title. */
  hint?: string;
}

interface ModeChoiceProps<Id extends string> {
  label: string;
  options: readonly ChoiceOption<Id>[];
  value: Id;
  onChange: (id: Id) => void;
  /** The long-form why, folded behind the legend's ⓘ. */
  children?: ReactNode;
}

/**
 * One choice among several, shown as the line it really draws — with the
 * other ways one click away.
 *
 * The anti-fabrication rule stands (every option shows the real line for THIS
 * piece, or the reason it has none), but eight of those two-line cards for the
 * temporal line and four more for the counter were twelve permanent cards in a
 * 22rem column: the panel was mostly a list of things not chosen. Settled, a
 * mode is one row saying what the badge says; open, it is the same list as
 * before.
 */
export default function ModeChoice<Id extends string>({
  label,
  options,
  value,
  onChange,
  children,
}: ModeChoiceProps<Id>) {
  const [open, setOpen] = useState(false);
  const chosen = options.find((o) => o.id === value) ?? null;

  return (
    <div className="flex flex-col gap-2">
      <SectionLegend label={label}>{children}</SectionLegend>

      {open ? (
        <div className="flex flex-col gap-1.5">
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              title={o.hint}
              onClick={() => {
                onChange(o.id);
                setOpen(false);
              }}
              aria-pressed={o.id === value}
              className={optionClass(o.id === value)}
            >
              <span
                className={`block text-[0.78rem] ${
                  o.id === value ? 'text-accent-ink font-semibold' : 'text-ink-soft'
                }`}
              >
                {o.label}
              </span>
              <span
                className={`block font-mono text-[0.7rem] ${
                  o.text ? 'text-ink' : 'text-faint'
                }`}
              >
                {o.text ?? o.otherwise}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={false}
          className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-paper border border-accent bg-accent-wash text-left cursor-pointer"
        >
          <span className="flex-1 min-w-0">
            <span className="block text-[0.72rem] text-accent-ink">
              {chosen?.label ?? '—'}
            </span>
            <span
              className={`block font-mono text-[0.76rem] truncate ${
                chosen?.text ? 'text-ink' : 'text-muted'
              }`}
            >
              {chosen ? (chosen.text ?? chosen.otherwise) : '—'}
            </span>
          </span>
          <span className="flex-none text-[0.72rem] font-semibold text-accent-ink">
            Change
          </span>
        </button>
      )}
    </div>
  );
}
