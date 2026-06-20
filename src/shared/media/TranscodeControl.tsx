/**
 * The transcode affordance shown when a clip can't be decoded: a button to
 * convert it to H.264 in-browser, a progress readout while it runs, and the
 * failure reason if it errors. Presentational only — the caller owns the
 * {@link useTranscode} state and swaps the source once `transcoded` is ready.
 */

import type { UseTranscode } from './use-transcode';

const buttonClass =
  'inline-flex items-center gap-2 px-[0.9rem] py-[0.45rem] border border-accent rounded-full bg-accent-wash text-accent-ink cursor-pointer font-semibold text-[0.8rem] transition-[background-color,transform] duration-200 ease-paper hover:bg-accent hover:text-white hover:-translate-y-px';

export default function TranscodeControl({
  state,
}: {
  state: UseTranscode;
}) {
  if (state.status === 'running') {
    return (
      <div className="flex items-center gap-[0.7rem] w-full max-w-[22rem]" role="status">
        <span className="font-mono text-[0.74rem] tracking-[0.02em] flex-none">
          Transcoding…{' '}
          {state.ratio != null ? `${Math.round(state.ratio * 100)}%` : ''}
        </span>
        <progress
          className="flex-1 h-1.5 accent-accent"
          value={state.ratio ?? undefined}
          max={1}
        />
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
        <span className="font-mono text-[0.72rem] leading-snug text-[#9a3a23] text-center">
          {state.error}
        </span>
      )}
    </div>
  );
}
