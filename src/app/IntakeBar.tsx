import type { ReactNode } from 'react';
import type { MediaIntake } from '../shared/sources/media-scope';
import { PRESS_LOOK } from '../shared/ui/press';

const PILL = `h-8 px-3 rounded-full border text-xs cursor-pointer transition-colors ${PRESS_LOOK}`;
const PILL_OFF = 'border-line-strong bg-paper text-ink hover:border-accent hover:text-accent-ink';
const PILL_ON = 'border-ink bg-ink text-paper';

/**
 * The foot of the Library in Select mode: ONE verb — «Add 5 slides» — and,
 * folded into three pills beside it, how the batch lands: in the order it was
 * ticked or the order it was taken, at the end or after the open slide, a
 * slide each or one collage. Everything else on the Library stays as it was;
 * leaving the mode drops the ticks.
 */
export default function IntakeBar({
  intake,
  count,
  byTime,
  onByTime,
  afterOpen,
  onAfterOpen,
  together,
  onTogether,
  busy,
  onCommit,
  onCancel,
  extra,
}: {
  intake: MediaIntake;
  count: number;
  byTime: boolean;
  onByTime: (on: boolean) => void;
  afterOpen: boolean;
  onAfterOpen: (on: boolean) => void;
  together: boolean;
  onTogether: (on: boolean) => void;
  /** The batch's pictures are on their way — fetched from an instance, then written. */
  busy: string | null;
  onCommit: () => void;
  onCancel: () => void;
  /** A control the tab adds — Suggest, on an instance's day. */
  extra?: ReactNode;
}) {
  const canTogether = intake.together !== null && count >= 2 && count <= intake.together.max;
  const asOne = together && canTogether;
  const noun = intake.noun;
  const verb = asOne
    ? `Add 1 ${noun} · ${intake.together!.word} of ${count}`
    : count === 1
      ? `Add 1 ${noun}`
      : `Add ${count} ${noun}s`;
  const blocked = count === 0 || busy !== null || intake.locked !== null;
  return (
    <div className="flex-none border-t border-line bg-surface px-3 pt-2.5 pb-3 flex flex-col gap-2">
      <div className="flex items-center gap-1.5 flex-wrap">
        {extra}
        {count > 0 && (
          <>
            <button type="button" onClick={() => onByTime(!byTime)} className={`${PILL} ${PILL_OFF}`}>
              {byTime ? 'Order: by time taken' : 'Order: as ticked'}
            </button>
            {intake.afterOpen && (
              <button type="button" onClick={() => onAfterOpen(!afterOpen)} className={`${PILL} ${PILL_OFF}`}>
                {afterOpen ? intake.afterOpen : 'At the end'}
              </button>
            )}
            {canTogether && (
              <button
                type="button"
                aria-pressed={asOne}
                onClick={() => onTogether(!together)}
                className={`${PILL} ${asOne ? PILL_ON : PILL_OFF}`}
              >
                One {intake.together!.word}
              </button>
            )}
          </>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onCancel}
          className={`h-11 px-4 rounded-[12px] border border-line-strong bg-paper text-sm text-ink cursor-pointer ${PRESS_LOOK}`}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => !blocked && onCommit()}
          aria-disabled={blocked}
          title={intake.locked ?? (count === 0 ? 'Tick pictures in the order you want them' : undefined)}
          className={`flex-1 h-11 rounded-[12px] border-0 text-sm font-semibold cursor-pointer ${
            count === 0 ? 'bg-paper-2 text-ink-soft' : 'bg-accent text-paper'
          } aria-disabled:cursor-not-allowed ${PRESS_LOOK}`}
        >
          {busy ?? (count === 0 ? 'Tick pictures in the order you want them' : verb)}
        </button>
      </div>
    </div>
  );
}
