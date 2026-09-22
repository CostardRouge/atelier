/**
 * The transcode affordance shown when a clip can't be decoded: a button to
 * convert it to H.264 in-browser, a readout while it runs, and the failure
 * reason if it errors. Presentational only — the caller owns the
 * {@link useTranscode} state and swaps the source once `transcoded` is ready.
 *
 * The BAR is not drawn here since T5 (`tasks.md`): the run is a task, so the
 * masthead's pill and the media's edge carry it; this row keeps the number
 * and the Cancel beside the button that started it.
 */

import type { UseTranscode } from './use-transcode';

const buttonClass =
  'inline-flex items-center gap-2 px-[0.9rem] py-[0.45rem] border border-accent rounded-full bg-accent-wash text-accent-ink cursor-pointer font-semibold text-xs transition-[background-color,color] duration-200 ease-paper hover:bg-accent hover:text-white';

export default function TranscodeControl({
  state,
}: {
  state: UseTranscode;
}) {
  if (state.status === 'running') {
    return (
      <div className="flex items-center gap-[0.7rem] w-full max-w-[22rem]" role="status">
        <span className="font-mono text-xs tracking-[0.02em] tabular-nums flex-1 min-w-0">
          Transcoding…{' '}
          {state.ratio != null ? `${Math.round(state.ratio * 100)}%` : ''}
        </span>
        <button
          type="button"
          className="flex-none p-0 border-0 bg-transparent font-semibold cursor-pointer underline underline-offset-[3px] decoration-[1.5px] hover:opacity-80"
          onClick={state.cancel}
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <button type="button" className={buttonClass} onClick={state.request}>
        {state.status === 'error' ? 'Retry transcode to H.264' : 'Transcode to H.264'}
      </button>
      {state.status === 'error' && state.error && (
        <span className="font-mono text-xs leading-snug text-danger text-center">
          {state.error}
        </span>
      )}
    </div>
  );
}
