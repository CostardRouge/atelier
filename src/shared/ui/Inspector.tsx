/**
 * The inspector's grammar: SECTIONS of ROWS.
 *
 * Every side panel in the suite grew its own layout — a mono legend over a
 * control here, a card of choices there, a slider whose value sat in its
 * label — so no two panels read alike, and a long one was a column of
 * unrelated shapes. The maintainer asked for one grammar (2026-09-13), the
 * one the interface audit drew:
 *
 * - an `InspectorSection` is a titled block, parted from the next by a rule
 *   and FOLDED with the chevron beside its title; its standing prose sits
 *   behind an ⓘ, and whether it is open is remembered per section;
 * - inside it, a `FieldRow` is a label at the left and ITS control at the
 *   right, on one line, with an optional sentence under the control;
 * - `RangeField`, `SelectField` and `ToggleField` are the three controls a
 *   row most often holds, so the sliders, the selects and the switches look
 *   the same in every panel.
 *
 * A section is a rule and not a card on purpose: the inspector is one column,
 * and a card per block would be the boxes-in-boxes the audit removed.
 */

import { useId, useState, type ReactNode } from 'react';
import InfoDot from './InfoDot';
import { Icons } from './icons';

const OPEN_KEY = 'atelier.inspector.';

function readOpen(id: string, fallback: boolean): boolean {
  try {
    const stored = localStorage.getItem(OPEN_KEY + id);
    return stored === null ? fallback : stored === '1';
  } catch {
    return fallback;
  }
}

interface InspectorSectionProps {
  /** Stable id — what remembers whether the section is folded. */
  id: string;
  title: string;
  /** A small tag after the title: "Trip" for a setting the whole trip wears. */
  badge?: ReactNode;
  /** The standing prose, folded behind an ⓘ beside the title. */
  info?: ReactNode;
  /** Controls pinned at the right of the header, before the chevron. */
  actions?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function InspectorSection({
  id,
  title,
  badge,
  info,
  actions,
  defaultOpen = true,
  children,
}: InspectorSectionProps) {
  const [open, setOpen] = useState(() => readOpen(id, defaultOpen));
  const bodyId = useId();
  const toggle = () =>
    setOpen((o) => {
      try {
        localStorage.setItem(OPEN_KEY + id, o ? '0' : '1');
      } catch {
        /* storage disabled: the fold lasts the session */
      }
      return !o;
    });

  return (
    <section className="flex flex-col border-t border-line first:border-t-0 py-3 first:pt-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0 min-h-7">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={bodyId}
          className="min-w-0 p-0 border-0 bg-transparent text-left font-sans text-sm font-semibold text-ink cursor-pointer truncate hover:text-accent-ink focus:outline-none focus-visible:underline"
        >
          {title}
        </button>
        {badge && (
          <span className="flex-none font-mono text-3xs tracking-[0.1em] uppercase text-muted border border-line-strong rounded-[5px] px-1.5 py-px">
            {badge}
          </span>
        )}
        {info && <InfoDot about={title.toLowerCase()}>{info}</InfoDot>}
        <span className="flex-1" />
        {open && actions}
        <button
          type="button"
          onClick={toggle}
          tabIndex={-1}
          aria-hidden="true"
          className={`flex-none grid place-items-center w-7 h-7 -mr-1.5 p-0 border-0 rounded-[8px] bg-transparent text-muted cursor-pointer hover:bg-paper-2 hover:text-ink transition-transform duration-200 ease-paper [&>svg]:w-4 [&>svg]:h-4 ${
            open ? '' : '-rotate-90'
          }`}
        >
          {Icons.down}
        </button>
      </div>
      {open && (
        <div id={bodyId} className="flex flex-col gap-2.5 pt-2.5">
          {children}
        </div>
      )}
    </section>
  );
}

interface FieldRowProps {
  label: ReactNode;
  children: ReactNode;
  /** A sentence under the control — what it will really do, or why it cannot. */
  hint?: ReactNode;
  /** `start` for a control taller than one line (a list, a grid of choices). */
  align?: 'center' | 'start';
  /** Ties the label to a single input, when there is one. */
  htmlFor?: string;
}

/** A label at the left, its control at the right, on one line. */
export function FieldRow({ label, children, hint, align = 'center', htmlFor }: FieldRowProps) {
  const Label = htmlFor ? 'label' : 'span';
  return (
    <div
      className={`grid grid-cols-[5.75rem_minmax(0,1fr)] gap-x-3 gap-y-1 ${
        align === 'start' ? 'items-start' : 'items-center'
      }`}
    >
      <Label
        htmlFor={htmlFor}
        className={`text-sm text-ink-soft leading-tight ${align === 'start' ? 'pt-1.5' : ''}`}
      >
        {label}
      </Label>
      <div className="min-w-0 flex items-center gap-2">{children}</div>
      {hint && <div className="col-start-2 text-xs leading-relaxed text-muted [&>p]:m-0">{hint}</div>}
    </div>
  );
}

/** A value to read, not to edit — a range, a length, a count. */
export function Readout({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return (
    <span className={`font-mono text-sm tabular-nums truncate ${muted ? 'text-muted' : 'text-ink'}`}>
      {children}
    </span>
  );
}

interface RangeFieldProps {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  /** How the value reads beside the track. */
  format: (value: number) => string;
  label: string;
  disabled?: boolean;
}

/** A slider with its value beside it — never inside the label, where it moved the row. */
export function RangeField({ value, min, max, step, onChange, format, label, disabled }: RangeFieldProps) {
  return (
    <>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        className="flex-1 min-w-0 accent-accent disabled:opacity-45"
      />
      <span className="flex-none w-[3.25rem] text-right font-mono text-xs tabular-nums text-ink-soft">
        {format(value)}
      </span>
    </>
  );
}

export interface SelectOption<T extends string> {
  id: T;
  label: string;
  disabled?: boolean;
}

interface SelectFieldProps<T extends string> {
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  label: string;
}

/** A native select in the suite's dress: the keyboard and the phone wheel for free. */
export function SelectField<T extends string>({ value, options, onChange, label }: SelectFieldProps<T>) {
  return (
    <span className="relative flex-1 min-w-0 inline-flex">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        aria-label={label}
        className="w-full appearance-none font-sans text-sm h-[2.125rem] pl-3 pr-9 border border-line-strong rounded-control bg-surface text-ink truncate cursor-pointer focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      <span
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 inline-flex text-muted [&>svg]:w-4 [&>svg]:h-4"
        aria-hidden="true"
      >
        {Icons.down}
      </span>
    </span>
  );
}

interface ToggleFieldProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  /** The words beside the switch; `label` stays the accessible name. */
  children?: ReactNode;
}

/** A switch, for a setting that is on or off. */
export function ToggleField({ checked, onChange, label, children }: ToggleFieldProps) {
  return (
    <label className="inline-flex items-center gap-2 min-w-0 cursor-pointer select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative flex-none w-9 h-5 p-0 border-0 rounded-full cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 ${
          checked ? 'bg-accent' : 'bg-line-strong'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-surface shadow-[0_1px_2px_rgba(27,24,19,0.25)] transition-transform duration-150 ease-paper ${
            checked ? 'translate-x-4' : ''
          }`}
        />
      </button>
      {children && <span className="text-sm text-ink-soft truncate">{children}</span>}
    </label>
  );
}
