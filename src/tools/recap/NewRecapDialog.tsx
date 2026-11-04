import { useEffect, useRef, useState } from 'react';
import { RECIPES, type RecapTemplate } from '../../shared/recap/recap-doc';
import { dayMonth, isoWeek, monthName, weekStartOf } from '../../shared/recap/recap-days';
import { addDays, formatIsoDate, todayIso } from '../../shared/roadtrip/trip-days';
import { DEFAULT_SOURCE_ID, type SourceInfo } from '../../shared/sources/source';
import { DateField } from '../../shared/ui/DateField';
import { Icons } from '../../shared/ui/icons';
import useDialogKeys from '../../shared/ui/use-dialog-keys';
import TemplatePreview from './TemplatePreview';

export interface NewRecapChoice {
  template: RecapTemplate;
  anchor: string;
  range: { from: string; to: string } | null;
  sourceId: string;
}

const legend = 'font-mono text-2xs tracking-[0.14em] uppercase text-muted';

/** The month `iso` is in, moved by `by` months: its 1st. */
function shiftMonth(iso: string, by: number): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7)) - 1 + by;
  const d = new Date(Date.UTC(y, m, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/** The last day of the month `iso` is in. */
function monthEnd(iso: string): string {
  return addDays(shiftMonth(iso, 1), -1) ?? iso;
}

/**
 * What a new recap is ABOUT, asked at the click (`frontend.md`, «a picker
 * asked at the click»): the template's own question — which month, which
 * week, which day, which period — with its card beside it, and where it is
 * kept when an instance can keep recaps. Last month is the default: a recap
 * looks back.
 */
export default function NewRecapDialog({
  template,
  sources,
  onCancel,
  onCreate,
}: {
  template: RecapTemplate;
  sources: readonly SourceInfo[];
  onCancel: () => void;
  onCreate: (choice: NewRecapChoice) => void;
}) {
  const today = todayIso();
  const lastMonth = shiftMonth(today, -1);
  const [month, setMonth] = useState(lastMonth);
  const [day, setDay] = useState(today);
  const [from, setFrom] = useState(lastMonth);
  const [to, setTo] = useState(monthEnd(lastMonth));
  const [target, setTarget] = useState(sources.some((s) => s.id === DEFAULT_SOURCE_ID) ? DEFAULT_SOURCE_ID : (sources[0]?.id ?? DEFAULT_SOURCE_ID));
  const recipe = RECIPES[template];
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => buttonRef.current?.focus({ preventScroll: true }), []);

  const choice = (): NewRecapChoice => {
    if (template === 'month') return { template, anchor: month, range: null, sourceId: target };
    if (template === 'week') return { template, anchor: weekStartOf(day) ?? day, range: null, sourceId: target };
    if (template === 'onThisDay') return { template, anchor: day, range: null, sourceId: target };
    const [a, b] = from <= to ? [from, to] : [to, from];
    return { template, anchor: a, range: { from: a, to: b }, sourceId: target };
  };
  useDialogKeys({ onCancel, onConfirm: () => onCreate(choice()) });

  const weekStart = weekStartOf(day) ?? day;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgba(20,18,15,0.45)] backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label={`New ${recipe.label}`}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-[34rem] max-h-[calc(var(--app-h,100dvh)-2rem)] overflow-auto flex gap-5 bg-surface border border-line rounded-paper-lg shadow-paper p-5 max-[560px]:flex-col">
        <div className="flex-none flex justify-center">
          <TemplatePreview template={template} anchor={template === 'month' ? month : day} height={220} playing />
        </div>
        <div className="flex-1 min-w-0 flex flex-col gap-4">
          <div>
            <h2 className="m-0 font-serif text-2xl">{recipe.label}</h2>
            <p className="m-0 mt-1 text-sm text-muted">{recipe.rule}</p>
          </div>

          {template === 'month' && (
            <div className="flex flex-col gap-1.5">
              <span className={legend}>Which month</span>
              <div className="flex items-center gap-1">
                <button type="button" aria-label="Previous month" onClick={() => setMonth((m) => shiftMonth(m, -1))} className="w-11 h-11 inline-flex items-center justify-center rounded-control border border-line hover:border-line-strong">
                  {Icons.back}
                </button>
                <span className="flex-1 text-center text-base font-semibold tabular-nums">
                  {monthName(month)} {month.slice(0, 4)}
                </span>
                <button type="button" aria-label="Next month" onClick={() => setMonth((m) => shiftMonth(m, 1))} className="w-11 h-11 inline-flex items-center justify-center rounded-control border border-line hover:border-line-strong">
                  {Icons.forward}
                </button>
              </div>
            </div>
          )}
          {(template === 'week' || template === 'onThisDay') && (
            <label className="flex flex-col gap-1.5">
              <span className={legend}>{template === 'week' ? 'A day of the week' : 'Which day'}</span>
              <DateField value={day} onChange={(v) => v && setDay(v)} label="Day" format={formatIsoDate} />
              <span className="font-mono text-2xs text-muted">
                {template === 'week' ? `Week ${isoWeek(weekStart)} · ${dayMonth(weekStart)} → ${dayMonth(addDays(weekStart, 6) ?? weekStart)}` : 'and the same day a year, a month and a week before'}
              </span>
            </label>
          )}
          {(template === 'grid' || template === 'single' || template === 'dump') && (
            <div className="flex flex-col gap-1.5">
              <span className={legend}>From which period</span>
              <div className="grid grid-cols-2 gap-2">
                <DateField value={from} onChange={(v) => v && setFrom(v)} label="From" format={formatIsoDate} />
                <DateField value={to} onChange={(v) => v && setTo(v)} label="To" format={formatIsoDate} />
              </div>
            </div>
          )}

          {sources.length > 1 && (
            <label className="flex flex-col gap-1.5">
              <span className={legend}>Keep on</span>
              <select value={target} onChange={(e) => setTarget(e.target.value)} className="font-sans text-base px-3.5 py-2 border border-line-strong rounded-paper bg-paper text-ink focus:outline-none focus:border-accent">
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.id === DEFAULT_SOURCE_ID ? 'this browser (local)' : s.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="flex items-center justify-end gap-4 pt-1 mt-auto border-t border-line">
            <button type="button" onClick={onCancel} className="p-0 mt-4 border-0 bg-transparent text-sm text-muted cursor-pointer hover:text-ink">
              Cancel
            </button>
            <button
              ref={buttonRef}
              type="button"
              onClick={() => onCreate(choice())}
              className="mt-4 px-[1.1rem] py-2 inline-flex items-center border border-ink rounded-full bg-ink text-paper cursor-pointer text-sm font-semibold transition-colors duration-200 ease-paper hover:bg-accent hover:border-accent"
            >
              Make it
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
