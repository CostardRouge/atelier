/**
 * «&nbsp;Défilé&nbsp;» — the trip runs past and stops on this day.
 *
 * The trip's measuring tape sweeps from where it starts to the day this piece
 * tells, decelerating; every day another piece already tells flashes its
 * picture as the head passes, an untold day goes dark, and the badge's numeral
 * steps with the head. When it comes to rest, the piece's own picture is the
 * frame and the tape stays under it, reading today.
 *
 * The arithmetic is `scrub-plan.ts`, the drawing `scrub-paint.ts`; this file is
 * the variant's face — what it needs, when it cannot run, and its options.
 * It ticks at every landing (`scrubScore`), the seat on today. The bed is the
 * sound of a video painted from a still and of a clip recorded without any; a
 * clip with sound of its own keeps it untouched unless the author asks for the
 * ticks to be mixed in (`mixWithClip`, see `audio-plan.ts`).
 */

import type { ReactNode } from 'react';
import type { HookPanelProps, HookVariant } from './hook-variant';
import { paintScrub } from './scrub-paint';
import {
  SCRUB_DEFAULTS,
  SCRUB_LIMITS,
  scrubOptions,
  scrubPlan,
  scrubScore,
  scrubStopDays,
  type ScrubOptions,
} from './scrub-plan';

function ScrubSketch() {
  return (
    <span className="relative block w-[3.6rem] h-[1.2rem]" aria-hidden="true">
      <span className="absolute left-0 right-0 bottom-[3px] h-px bg-white/55" />
      <span className="absolute left-0 bottom-[3px] h-[5px] w-[40%] bg-[repeating-linear-gradient(90deg,#d9442a_0_1px,transparent_1px_5px)]" />
      <span className="absolute left-[40%] right-0 bottom-[3px] h-[5px] bg-[repeating-linear-gradient(90deg,rgba(255,255,255,0.5)_0_1px,transparent_1px_5px)]" />
      <span className="absolute left-[40%] bottom-0 h-[13px] w-[2px] -translate-x-1/2 rounded-full bg-[#d9442a] shadow-[0_0_5px_rgba(217,68,42,0.8)] motion-safe:animate-[scrub-sketch_2.8s_cubic-bezier(0.2,0,0,1)_infinite]" />
    </span>
  );
}

const chip = (on: boolean) =>
  `px-2 py-1.5 rounded-paper border text-center cursor-pointer text-[0.74rem] transition-colors ${
    on
      ? 'border-accent bg-accent-wash text-accent-ink font-semibold'
      : 'border-line bg-paper text-ink-soft hover:border-line-strong'
  }`;
const label = 'font-mono text-[0.62rem] tracking-[0.14em] uppercase text-muted';

function Row({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className={label}>{title}</span>
      {children}
    </div>
  );
}

function ScrubPanel({ options, onChange, ctx }: HookPanelProps) {
  const o = scrubOptions(options);
  const set = (patch: Partial<ScrubOptions>) => onChange({ ...o, ...patch });
  const plan = ctx.calendar ? scrubPlan(ctx.calendar, ctx.date, o) : null;

  // The panel says what the sweep WILL do for this piece — the counter modes'
  // rule: the real line, or the reason there is none.
  const flashes = plan ? plan.stops.filter((s) => s.told).length : 0;
  const summary = !plan
    ? null
    : plan.stops.length < 2
      ? 'This is the first day of the trip — there is nothing to sweep from.'
      : `${plan.stops.length} stops from day ${plan.stops[0].dayNumber} · ${
          !o.flash
            ? 'no pictures flash'
            : flashes === 0
              ? 'no other day told yet, so nothing flashes'
              : `${flashes} told ${flashes === 1 ? 'day flashes' : 'days flash'}`
        } · ${plan.sweepSeconds.toFixed(1)}s`;
  // The hook's screen time is a separate setting; say so when it would cut the
  // sweep short, rather than delivering a scrub that never lands.
  const cut =
    plan && ctx.screenSeconds !== undefined && plan.sweepSeconds > ctx.screenSeconds;

  return (
    <div className="flex flex-col gap-3 pl-3 border-l-2 border-line">
      {summary && <p className="m-0 text-[0.76rem] text-ink-soft">{summary}</p>}
      {cut && (
        <p className="m-0 text-[0.72rem] text-accent-ink">
          The hook is on screen for {ctx.screenSeconds?.toFixed(1)}s, shorter than the
          sweep — the export would cut it before it lands. Lengthen the hook in Export, or
          shorten the sweep.
        </p>
      )}

      <Row title="Sweep">
        <div className="grid grid-cols-2 gap-1.5">
          <button type="button" className={chip(o.mode === 'from-start')} aria-pressed={o.mode === 'from-start'} onClick={() => set({ mode: 'from-start' })}>
            From day 1
          </button>
          <button type="button" className={chip(o.mode === 'run-up')} aria-pressed={o.mode === 'run-up'} onClick={() => set({ mode: 'run-up' })}>
            Run-up
          </button>
        </div>
      </Row>

      {o.mode === 'run-up' && (
        <Row title={`Told days before this one · ${o.runUpDays}`}>
          <input
            type="range"
            min={SCRUB_LIMITS.runUpDays.min}
            max={SCRUB_LIMITS.runUpDays.max}
            step={1}
            value={o.runUpDays}
            onChange={(e) => set({ runUpDays: Number(e.target.value) })}
            className="accent-accent"
          />
        </Row>
      )}

      <Row title={`Most stops · ${o.maxStops}`}>
        <input
          type="range"
          min={SCRUB_LIMITS.maxStops.min}
          max={SCRUB_LIMITS.maxStops.max}
          step={1}
          value={o.maxStops}
          onChange={(e) => set({ maxStops: Number(e.target.value) })}
          className="accent-accent"
        />
      </Row>

      <Row title={`Sweep length · ${o.sweepSeconds.toFixed(1)}s`}>
        <input
          type="range"
          min={SCRUB_LIMITS.sweepSeconds.min}
          max={SCRUB_LIMITS.sweepSeconds.max}
          step={0.1}
          value={o.sweepSeconds}
          onChange={(e) => set({ sweepSeconds: Number(e.target.value) })}
          className="accent-accent"
        />
      </Row>

      <Row title="Tape">
        <div className="grid grid-cols-2 gap-1.5">
          <button type="button" className={chip(o.tape === 'bottom')} aria-pressed={o.tape === 'bottom'} onClick={() => set({ tape: 'bottom' })}>
            Along the bottom
          </button>
          <button type="button" className={chip(o.tape === 'top')} aria-pressed={o.tape === 'top'} onClick={() => set({ tape: 'top' })}>
            Along the top
          </button>
        </div>
      </Row>

      <label className="flex items-center gap-2 text-[0.78rem] text-ink-soft cursor-pointer">
        <input
          type="checkbox"
          checked={o.flash}
          onChange={(e) => set({ flash: e.target.checked })}
          className="accent-accent"
        />
        Flash the told days’ pictures as the head passes
      </label>

      <label className="flex items-start gap-2 text-[0.78rem] text-ink-soft cursor-pointer">
        <input
          type="checkbox"
          checked={o.sound}
          onChange={(e) => set({ sound: e.target.checked })}
          className="accent-accent mt-[3px]"
        />
        <span>
          Tick at every day it lands on
          <span className="block text-[0.7rem] text-faint">
            A photo, or a clip recorded without sound (most drone footage), takes the ticks
            as its sound. Most feeds play muted: the sweep says everything without them.
          </span>
        </span>
      </label>

      {o.sound && (
        <label className="flex items-start gap-2 text-[0.78rem] text-ink-soft cursor-pointer">
          <input
            type="checkbox"
            checked={o.mixWithClip}
            onChange={(e) => set({ mixWithClip: e.target.checked })}
            className="accent-accent mt-[3px]"
          />
          <span>
            Mix them into a clip’s own sound
            <span className="block text-[0.7rem] text-faint">
              Off, a clip that has sound keeps it bit-for-bit and goes out without the
              ticks. On, its sound is decoded, the ticks are added, and it is re-encoded.
            </span>
          </span>
        </label>
      )}

      {ctx.counterMode && ctx.counterMode !== 'day' && (
        <p className="m-0 text-[0.72rem] text-faint">
          The numeral steps with the head only when the badge counts the day of the trip;
          under this counter it keeps its own reading.
        </p>
      )}
    </div>
  );
}

export const scrubVariant: HookVariant = {
  id: 'scrub',
  name: 'Défilé',
  tagline: 'The trip runs past and stops on this day',
  defaults: { ...SCRUB_DEFAULTS },
  needs: { coverage: true, stages: true, media: 'day' },
  owns: 'frame',
  unmet(ctx) {
    // No calendar means the shell has not resolved one yet — not a refusal.
    if (!ctx.calendar) return null;
    if (ctx.calendar.length < 2) return 'Needs a trip of two days or more';
    if (!ctx.calendar.some((day) => day.date === ctx.date)) {
      return 'This piece is dated outside the trip';
    }
    return null;
  },
  wantsDays(options, ctx) {
    const o = scrubOptions(options);
    if (!o.flash || !ctx.calendar) return [];
    const days = scrubStopDays(ctx.calendar, ctx.date, o) ?? [];
    // The hero's own picture is already on the frame, and an untold day has
    // nothing to fetch: only the told stops before it are wanted.
    return days.slice(0, -1).filter((day) => day.told).map((day) => day.date);
  },
  prepare(options, ctx) {
    const o = scrubOptions(options);
    const plan = ctx.calendar ? scrubPlan(ctx.calendar, ctx.date, o) : null;
    if (!plan) return { seconds: 0 };
    const sweep = plan.sweepSeconds;
    return {
      seconds: sweep,
      // Only under the trip-day counter, and only while the head moves: once
      // it rests the badge says its own value — a range post's "27–29" too.
      content:
        ctx.counterMode === 'day' && sweep > 0
          ? (t) => (t < sweep ? { headline: String(plan.stops[plan.stopAt(t)].dayNumber) } : {})
          : undefined,
      paint: (g, t, frame) => paintScrub(g, plan, o, ctx.pictures, t, frame),
      score: o.sound ? () => scrubScore(plan) : undefined,
      mixWithSource: o.sound && o.mixWithClip,
    };
  },
  Sketch: ScrubSketch,
  Panel: ScrubPanel,
};
