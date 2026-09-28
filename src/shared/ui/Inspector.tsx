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
 *   and FOLDED by a click anywhere on its header band — the title, the empty
 *   stretch and the chevron alike; its standing prose sits behind an ⓘ, and
 *   whether it is open is remembered per section;
 * - inside it, a `FieldRow` is a label at the left and ITS control at the
 *   right, on one line, with an optional sentence under the control;
 * - `RangeField`, `SelectField` and `ToggleField` are the three controls a
 *   row most often holds, so the sliders, the selects and the switches look
 *   the same in every panel.
 *
 * A section is a rule and not a card on purpose: the inspector is one column,
 * and a card per block would be the boxes-in-boxes the audit removed.
 */

import { createContext, useContext, useId, useState, type CSSProperties, type MouseEvent, type ReactNode, type SelectHTMLAttributes } from 'react';
import InfoDot, { InfoDotButton } from './InfoDot';
import { Icons } from './icons';

const OPEN_KEY = 'atelier.inspector.';

/** Where a fold is remembered: for good on this browser, or for this tab's session only. */
export type FoldMemory = 'local' | 'session';

function foldStore(memory: FoldMemory): Storage | null {
  try {
    return memory === 'session' ? sessionStorage : localStorage;
  } catch {
    return null;
  }
}

function readOpen(id: string, fallback: boolean, memory: FoldMemory): boolean {
  try {
    const stored = foldStore(memory)?.getItem(OPEN_KEY + id) ?? null;
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
  /**
   * Where the fold is remembered: `local` (the default) keeps it on this
   * browser; `session` keeps it for the tab's session only — the Develop
   * inspector's, where the maintainer wanted a fold to survive a change of
   * picture but not to become a lasting setting (2026-09-23).
   */
  remember?: FoldMemory;
  /**
   * An accent dot after the title: something in the section departs from
   * its default. What keeps a FOLDED section from hiding an edit.
   */
  marked?: boolean;
  /**
   * `false` draws the same header with no chevron and no fold — a section too
   * small to be worth folding (one row of verbs) still reads like its
   * neighbours.
   */
  foldable?: boolean;
  /**
   * Controlled fold, for a section whose body COSTS something while open (a
   * request to an instance): the owner decides, and nothing is remembered.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}

export function InspectorSection({
  id,
  title,
  badge,
  info,
  actions,
  defaultOpen = true,
  remember = 'local',
  marked = false,
  foldable = true,
  open: controlled,
  onOpenChange,
  children,
}: InspectorSectionProps) {
  const [remembered, setRemembered] = useState(() => readOpen(id, defaultOpen, remember));
  const open = !foldable || (controlled ?? remembered);
  const bodyId = useId();
  const toggle = () => {
    if (controlled !== undefined) {
      onOpenChange?.(!controlled);
      return;
    }
    setRemembered((o) => {
      try {
        foldStore(remember)?.setItem(OPEN_KEY + id, o ? '0' : '1');
      } catch {
        /* storage disabled: the fold lasts the session */
      }
      return !o;
    });
  };
  // The whole band folds, not only the 28px chevron the maintainer kept
  // hunting for. The band cannot be ONE button — the ⓘ and the header's
  // actions are buttons of their own — so it listens instead, and folds only
  // for a click on itself or on a part marked `data-fold` (title, badge,
  // stretch, chevron). Anything else a click lands on — an action, the ⓘ, the
  // note it unfolds, a menu portalled out of an action — is not the band's.
  // The title stays the real button, so the keyboard and a screen reader keep
  // one control with `aria-expanded`; its click bubbles here like any other.
  const onBandClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!foldable) return;
    const band = e.currentTarget;
    const hit = e.target as Element;
    if (hit !== band) {
      const part = hit.closest('[data-fold]');
      if (!part || !band.contains(part)) return;
    }
    toggle();
  };

  return (
    <section className="flex flex-col border-t border-line first:border-t-0 py-3 first:pt-1">
      <div
        onClick={onBandClick}
        className={`group/band flex flex-wrap items-center gap-x-2 gap-y-0 min-h-7 ${foldable ? 'cursor-pointer' : ''}`}
      >
        {foldable ? (
          <button
            type="button"
            data-fold
            aria-expanded={open}
            aria-controls={bodyId}
            className="min-w-0 p-0 border-0 bg-transparent text-left font-sans text-sm font-semibold text-ink cursor-pointer truncate select-none group-hover/band:text-accent-ink focus:outline-none focus-visible:underline"
          >
            {title}
          </button>
        ) : (
          <span className="min-w-0 font-sans text-sm font-semibold text-ink truncate">{title}</span>
        )}
        {marked && (
          <span
            data-fold
            role="img"
            aria-label="changed"
            title="Something here is set"
            className="flex-none w-1.5 h-1.5 rounded-full bg-accent"
          />
        )}
        {badge && (
          <span
            data-fold
            className="flex-none font-mono text-3xs tracking-[0.1em] uppercase text-muted border border-line-strong rounded-[5px] px-1.5 py-px select-none"
          >
            {badge}
          </span>
        )}
        {info && <InfoDot about={title.toLowerCase()}>{info}</InfoDot>}
        <span data-fold className="flex-1 self-stretch" />
        {open && actions}
        {foldable && (
          <span
            data-fold
            aria-hidden="true"
            className={`flex-none grid place-items-center w-7 h-7 -mr-1.5 rounded-[8px] text-muted group-hover/band:bg-paper-2 group-hover/band:text-ink transition-transform duration-200 ease-paper [&>svg]:w-4 [&>svg]:h-4 ${
              open ? '' : '-rotate-90'
            }`}
          >
            {Icons.down}
          </span>
        )}
      </div>
      {open && (
        <div id={bodyId} className="flex flex-col gap-2.5 pt-2.5">
          {children}
        </div>
      )}
    </section>
  );
}

/**
 * Whether a row's `hint` is FOLDED behind an ⓘ beside its label instead of
 * standing under the control. Off everywhere by default; the Develop
 * inspector turns it on (`FoldHints`), where the maintainer found the prose
 * under every dial — the grain's, the look's — costing the column more than
 * the dials (2026-09-24). A hint that says a STATE rather than explaining
 * (`hintShown`) stays in the open either way.
 */
const HintsFolded = createContext(false);

export function FoldHints({ children }: { children: ReactNode }) {
  return <HintsFolded.Provider value>{children}</HintsFolded.Provider>;
}

/** The hint of a row: under the control, or behind a dot the caller draws. */
function useRowHint(hint: ReactNode, shown: boolean, about: ReactNode) {
  const folded = useContext(HintsFolded) && !shown && Boolean(hint);
  const [open, setOpen] = useState(false);
  const id = useId();
  const dot = folded ? (
    <InfoDotButton
      about={typeof about === 'string' ? about.toLowerCase() : 'this setting'}
      open={open}
      controls={id}
      onToggle={() => setOpen((o) => !o)}
    />
  ) : null;
  const visible = hint && (!folded || open);
  return { dot, visible, id };
}

interface FieldRowProps {
  label: ReactNode;
  children: ReactNode;
  /** A sentence under the control — what it will really do, or why it cannot. */
  hint?: ReactNode;
  /** The hint says a STATE, not a why: never folded behind a dot (`FoldHints`). */
  hintShown?: boolean;
  /** `start` for a control taller than one line (a list, a grid of choices). */
  align?: 'center' | 'start';
  /** Ties the label to a single input, when there is one. */
  htmlFor?: string;
}

/** A label at the left, its control at the right, on one line. */
export function FieldRow({ label, children, hint, hintShown = false, align = 'center', htmlFor }: FieldRowProps) {
  const Label = htmlFor ? 'label' : 'span';
  const { dot, visible, id } = useRowHint(hint, hintShown, label);
  return (
    <div
      className={`grid grid-cols-[5.75rem_minmax(0,1fr)] gap-x-3 gap-y-1 ${
        align === 'start' ? 'items-start' : 'items-center'
      }`}
    >
      <span className={`flex items-center gap-1.5 min-w-0 ${align === 'start' ? 'pt-1.5' : ''}`}>
        <Label htmlFor={htmlFor} className="text-sm text-ink-soft leading-tight">
          {label}
        </Label>
        {dot}
      </span>
      <div className="min-w-0 flex items-center gap-2">{children}</div>
      {visible && (
        <div id={id} className="col-start-2 text-xs leading-relaxed text-muted [&>p]:m-0">
          {hint}
        </div>
      )}
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
  const clamped = Math.min(max, Math.max(min, value));
  const fraction = max > min ? (clamped - min) / (max - min) : 0;
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
        style={{ '--range-fraction': fraction } as CSSProperties}
        className="range-fill flex-1 min-w-0 disabled:opacity-45"
      />
      <span className="flex-none min-w-[3.25rem] text-right whitespace-nowrap font-mono text-xs tabular-nums text-ink-soft">
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
        className={selectClass}
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

// `max-[820px]:text-base` on every typed field and select: below 16px iOS
// zooms the page the moment the control is focused, and on a tool screen the
// document is locked so it never zooms back (`frontend.md`, «Touch sizing»).
// A viewport query rather than the layout hook because under 820px every
// inspector in the suite is a `position: fixed` sheet, the one place a raw
// breakpoint still belongs — and because these are recipe strings, not
// components.
export const fieldClass =
  'w-full min-w-0 font-sans text-sm max-[820px]:text-base h-[2.125rem] px-3 border border-line-strong rounded-control bg-surface text-ink focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-45';
const selectClass =
  'w-full appearance-none font-sans text-sm max-[820px]:text-base h-[2.125rem] pl-3 pr-9 border border-line-strong rounded-control bg-surface text-ink truncate cursor-pointer focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20';

interface NumberFieldProps {
  /** `null` draws an empty field — with `onClear`, for a value that may be absent. */
  value: number | null;
  onChange: (value: number) => void;
  label: string;
  min?: number;
  max?: number;
  step?: number;
  /** A unit written inside the field's right edge: "s", "px", "°". */
  unit?: string;
  disabled?: boolean;
  placeholder?: string;
  /** Called instead of `onChange` when the field is emptied. */
  onClear?: () => void;
}

/** A number typed rather than dragged — a time in seconds, a count. */
export function NumberField({
  value,
  onChange,
  label,
  min,
  max,
  step,
  unit,
  disabled,
  placeholder,
  onClear,
}: NumberFieldProps) {
  return (
    <span className="relative flex-1 min-w-0 inline-flex">
      <input
        type="number"
        value={value !== null && Number.isFinite(value) ? value : ''}
        placeholder={placeholder}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => {
          if (e.target.value === '' && onClear) onClear();
          else onChange(Number(e.target.value));
        }}
        className={`${fieldClass} font-mono tabular-nums ${unit ? 'pr-8' : ''}`}
      />
      {unit && (
        <span
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs text-muted"
          aria-hidden="true"
        >
          {unit}
        </span>
      )}
    </span>
  );
}

interface TextFieldProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  disabled?: boolean;
}

/** One line of text, in the inspector's dress. */
export function TextField({ value, onChange, label, placeholder, disabled }: TextFieldProps) {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={label}
      onChange={(e) => onChange(e.target.value)}
      className={fieldClass}
    />
  );
}

/** The colour swatch every row uses. */
export const swatchClass =
  'flex-none w-8 h-8 p-0 border border-line-strong rounded-[7px] bg-surface cursor-pointer disabled:opacity-40 disabled:cursor-default';

interface NativeSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  children: ReactNode;
}

/**
 * `SelectField` for a list that is already written as `<option>`s (optgroups,
 * mapped keys): the same dress, the options passed straight through.
 */
export function NativeSelect({ label, children, className = '', ...rest }: NativeSelectProps) {
  return (
    <span className="relative flex-1 min-w-0 inline-flex">
      <select
        aria-label={label}
        className={`${selectClass} ${className}`}
        {...rest}
      >
        {children}
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

interface SwitchRowProps {
  /** The setting, as a phrase — it is the row's whole label. */
  label: ReactNode;
  /** The accessible name, when `label` is not plain text. */
  name?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: ReactNode;
  /** The hint says a STATE, not a why: never folded behind a dot (`FoldHints`). */
  hintShown?: boolean;
}

/**
 * A setting that is on or off and needs a phrase to say so ("Letters at
 * N / E / S / W"): the phrase across the row, the switch at its end.
 */
export function SwitchRow({ label, name, checked, onChange, hint, hintShown = false }: SwitchRowProps) {
  const { dot, visible, id } = useRowHint(hint, hintShown, label);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-3">
        <span className="flex-1 min-w-0 flex items-center gap-1.5 text-sm text-ink-soft leading-tight">
          <span className="min-w-0">{label}</span>
          {dot}
        </span>
        <ToggleField label={name ?? (typeof label === 'string' ? label : 'Toggle')} checked={checked} onChange={onChange} />
      </div>
      {visible && (
        <div id={id} className="text-xs leading-relaxed text-muted [&>p]:m-0">
          {hint}
        </div>
      )}
    </div>
  );
}
