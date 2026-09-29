import type { RunUnitState } from '../tasks/run-progress';
import { Icons } from './icons';

/** A cell's place in a running export, for a screen reader. */
export const RUN_WORDS: Record<RunUnitState, string> = {
  queued: 'waiting to be exported',
  active: 'being exported',
  done: 'exported',
  failed: 'not exported',
};

/**
 * A cell's mark in a running export (his pick V4: a tool's own strip is the
 * run's queue) — a veil on what waits, a turning ring on the unit in hand,
 * ✓ or ! on what is finished, over the cell's CENTRE, the one spot no badge
 * owns. Pointer-transparent: the cell stays a click to open its unit. Sits in
 * a `relative` cell drawn over a picture, so its ink is the fixed media ink.
 */
export default function RunMark({ state, ratio = null }: { state: RunUnitState; ratio?: number | null }) {
  return (
    <span
      className={`absolute inset-0 grid place-items-center pointer-events-none ${
        state === 'queued' ? 'bg-[rgba(13,12,10,0.45)]' : state === 'active' ? 'bg-[rgba(13,12,10,0.25)]' : ''
      }`}
      aria-hidden="true"
    >
      {state === 'active' && (
        <span className="w-5 h-5 rounded-full border-2 border-on-media/30 border-t-on-media/95 animate-spin motion-reduce:animate-none" />
      )}
      {state === 'active' && ratio !== null && (
        // A step that knows how far it is (an encode) says so on the cell too.
        <span className="absolute left-1 right-1 bottom-1 h-[3px] rounded-full bg-on-media/30 overflow-hidden">
          <span className="block h-full bg-on-media" style={{ width: `${ratio * 100}%` }} />
        </span>
      )}
      {state === 'done' && <span className="w-5 h-5 grid place-items-center rounded-full bg-ok text-white text-2xs">{Icons.check}</span>}
      {state === 'failed' && <span className="w-5 h-5 grid place-items-center rounded-full bg-danger text-white font-mono text-2xs">!</span>}
    </span>
  );
}
