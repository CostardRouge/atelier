import { useEffect, useRef, useState } from 'react';
import { RECIPES, aboutLine, type RecapTemplate } from '../../shared/recap/recap-doc';
import { weekStartOf } from '../../shared/recap/recap-days';
import { addDays, todayIso } from '../../shared/roadtrip/trip-days';
import { DEFAULT_SOURCE_ID, type SourceInfo } from '../../shared/sources/source';
import { useWinnowConnection } from '../../shared/sources/winnow/use-connection';
import WhenCalendar, { type When } from './WhenCalendar';
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
  // Last month by default — a recap looks back; on this day and a week start from today.
  const [when, setWhen] = useState<When>(() =>
    template === 'month'
      ? { anchor: lastMonth, range: null }
      : template === 'week'
        ? { anchor: weekStartOf(today) ?? today, range: null }
        : template === 'onThisDay'
          ? { anchor: today, range: null }
          : template === 'wrapped'
            ? // A Wrapped is a year by default: this one, so far.
              { anchor: `${today.slice(0, 4)}-01-01`, range: { from: `${today.slice(0, 4)}-01-01`, to: today } }
            : { anchor: lastMonth, range: { from: lastMonth, to: monthEnd(lastMonth) } },
  );
  const { connection, client } = useWinnowConnection();
  const [target, setTarget] = useState(sources.some((s) => s.id === DEFAULT_SOURCE_ID) ? DEFAULT_SOURCE_ID : (sources[0]?.id ?? DEFAULT_SOURCE_ID));
  const recipe = RECIPES[template];
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => buttonRef.current?.focus({ preventScroll: true }), []);

  const choice = (): NewRecapChoice => ({ template, anchor: when.anchor, range: when.range, sourceId: target });
  useDialogKeys({ onCancel, onConfirm: () => onCreate(choice()) });

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
      <div className="w-full max-w-[40rem] max-h-[calc(var(--app-h,100dvh)-2rem)] overflow-auto flex gap-5 bg-surface border border-line rounded-paper-lg shadow-paper p-5 max-[560px]:flex-col">
        <div className="flex-none flex justify-center">
          <TemplatePreview template={template} anchor={when.anchor} height={220} playing />
        </div>
        <div className="flex-1 min-w-0 flex flex-col gap-4">
          <div>
            <h2 className="m-0 font-serif text-2xl">{recipe.label}</h2>
            <p className="m-0 mt-1 text-sm text-muted">{recipe.rule}</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className={legend}>{template === 'month' ? 'Which month' : template === 'week' ? 'Which week' : template === 'onThisDay' ? 'Which day' : 'From which period'}</span>
            <span className="text-sm font-semibold">{aboutLine({ template, anchor: when.anchor, range: when.range })}</span>
            <WhenCalendar template={template} when={when} client={connection ? client : null} onChange={(w) => setWhen(w)} />
          </div>

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
