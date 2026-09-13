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

import { useCallback, type ReactNode } from 'react';
import Segmented from '../../ui/Segmented';
import {
  FieldRow,
  RangeField,
  SelectField,
  SwitchRow,
  ToggleField,
} from '../../ui/Inspector';
import type { HookContext, HookDay, HookPanelProps, HookPicture, HookVariant } from './hook-variant';
import { paintScrub } from './scrub-paint';
import {
  EASINGS,
  EASING_IDS,
  KIT_IDS,
  SCRUB_KITS,
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
      <span className="absolute left-[40%] bottom-0 h-[13px] w-[2px] -translate-x-1/2 rounded-full bg-accent shadow-[0_0_5px_rgba(217,68,42,0.8)] motion-safe:animate-[scrub-sketch_2.8s_cubic-bezier(0.2,0,0,1)_infinite]" />
    </span>
  );
}

/** A small mono legend over a group of rows — the panel's sub-sections. */
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <span className="font-mono text-2xs tracking-[0.14em] uppercase text-muted">{title}</span>
      {children}
    </div>
  );
}

/**
 * One day's tile in the picture strip: the picture that WOULD flash for it,
 * when the shell has decoded one (only the days in the sweep are decoded — the
 * rule that keeps a 250-piece trip from decoding 250 thumbnails), else the day
 * number on a dark tile. Cover-cropped the way the flash is.
 */
function DayTile({
  day,
  picture,
  inSweep,
  chosen,
  onToggle,
}: {
  day: HookDay;
  picture: HookPicture | undefined;
  inSweep: boolean;
  /** `chosen` mode: the tile is a toggle. `auto`: it only reports. */
  chosen: boolean;
  onToggle?: () => void;
}) {
  // A callback ref, not an effect: the tile's wrapper is a <span> that reports
  // in `auto` and a <button> that toggles in `chosen`, so flipping the mode
  // REMOUNTS the canvas — and an effect keyed on the unchanged picture would
  // never repaint the new, blank node. The ref runs on every attach.
  const paintInto = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      if (!canvas || !picture) return;
      const g = canvas.getContext('2d');
      if (!g) return;
      const { width: w, height: h } = canvas;
      const scale = Math.max(w / picture.width, h / picture.height);
      const dw = picture.width * scale;
      const dh = picture.height * scale;
      try {
        g.clearRect(0, 0, w, h);
        g.drawImage(picture.image, (w - dw) / 2, (h - dh) / 2, dw, dh);
      } catch {
        // A bitmap released under us: the tile stays dark rather than throwing.
      }
    },
    [picture],
  );

  const body = (
    <>
      {picture ? (
        <canvas ref={paintInto} width={54} height={96} className="block w-full h-full" aria-hidden="true" />
      ) : (
        <span className="absolute inset-0 grid place-items-center font-mono text-xs text-white/70">
          {day.dayNumber}
        </span>
      )}
      <span className="absolute left-1 top-1 rounded-[3px] bg-black/55 px-1 font-mono text-3xs text-white">
        {day.dayNumber}
      </span>
      {day.legStart && (
        <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
      )}
    </>
  );
  const shell = `relative flex-none w-[2.25rem] aspect-[9/16] overflow-hidden rounded-[5px] bg-frame border transition-colors ${
    inSweep ? 'border-accent' : 'border-line-strong'
  } ${chosen ? 'cursor-pointer' : ''} ${!inSweep && chosen ? 'opacity-55' : ''}`;
  return chosen ? (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={inSweep}
      aria-label={`Day ${day.dayNumber}${inSweep ? ', in the sweep' : ''}`}
      className={`${shell} p-0`}
    >
      {body}
    </button>
  ) : (
    <span className={shell} aria-label={`Day ${day.dayNumber}${inSweep ? ', in the sweep' : ''}`}>
      {body}
    </span>
  );
}

/** The days this piece could sweep through: told, before its own. */
function candidateDays(ctx: HookContext): HookDay[] {
  const calendar = ctx.calendar ?? [];
  const heroIndex = calendar.findIndex((day) => day.date === ctx.date);
  return calendar.slice(0, heroIndex < 0 ? 0 : heroIndex).filter((day) => day.told);
}

function ScrubPanel({ options, onChange, ctx }: HookPanelProps) {
  const o = scrubOptions(options);
  const set = (patch: Partial<ScrubOptions>) => onChange({ ...o, ...patch });
  const plan = ctx.calendar ? scrubPlan(ctx.calendar, ctx.date, o) : null;
  const inSweep = new Set(plan?.stops.filter((s) => !s.hero).map((s) => s.date) ?? []);
  const candidates = candidateDays(ctx);

  // The panel says what the sweep WILL do for this piece — the counter modes'
  // rule: the real line, or the reason there is none.
  const flashes = plan ? plan.stops.filter((s) => s.told).length : 0;
  const summary = !plan
    ? null
    : plan.stops.length < 2
      ? o.days === 'chosen' && candidates.length > 0
        ? 'No day is chosen yet — pick the days below and the sweep will run through them.'
        : 'This is the first day of the trip — there is nothing to sweep from.'
      : `${plan.stops.length} stops from day ${plan.stops[0].dayNumber} · ${
          !o.flash
            ? 'no pictures flash'
            : flashes === 0
              ? 'no other day told yet, so nothing flashes'
              : `${flashes} told ${flashes === 1 ? 'day flashes' : 'days flash'}`
        } · ${plan.sweepSeconds.toFixed(1)}s${plan.delaySeconds > 0 ? ` after ${plan.delaySeconds.toFixed(1)}s` : ''}`;
  // The hook's screen time is a separate setting; say so when it would cut the
  // sweep short, rather than delivering a scrub that never lands.
  const cut = plan && ctx.screenSeconds !== undefined && plan.endSeconds > ctx.screenSeconds;
  // Past ~3 frames a flash, the pictures stop registering as pictures.
  const perStop = plan && plan.stops.length > 1 ? plan.sweepSeconds / (plan.stops.length - 1) : 1;

  const toggleDay = (date: string) =>
    set({
      chosenDays: o.chosenDays.includes(date)
        ? o.chosenDays.filter((d) => d !== date)
        : [...o.chosenDays, date],
    });
  // Days in the sweep with more than one piece: a picture to choose.
  const choosable = candidates.filter((day) => inSweep.has(day.date) && day.pieces.length > 1);

  return (
    <div className="flex flex-col gap-4 pl-3 border-l-2 border-line">
      {summary && <p className="m-0 text-xs text-ink-soft">{summary}</p>}
      {cut && (
        <p className="m-0 text-xs text-accent-ink">
          The hook is on screen for {ctx.screenSeconds?.toFixed(1)}s, shorter than the
          sweep — the export would cut it before it lands. Lengthen the hook in Export, or
          shorten the sweep.
        </p>
      )}
      {plan && plan.stops.length > 2 && perStop < 0.1 && (
        <p className="m-0 text-xs text-accent-ink">
          {Math.round(perStop * 1000)}ms a stop — under three frames, so the pictures read
          as a flicker rather than as pictures. Fewer stops or a longer sweep.
        </p>
      )}

      <Group title="Sweep">
        <FieldRow label="Days" align="start">
          <Segmented
            size="sm"
            fill
            label="Which days the sweep visits"
            value={o.days}
            onChange={(days) => set({ days })}
            options={[
              { id: 'auto', label: 'Sampled' },
              { id: 'chosen', label: 'Chosen' },
            ]}
          />
        </FieldRow>
        {o.days === 'auto' && (
          <FieldRow label="From">
            <Segmented
              size="sm"
              fill
              label="Where the sweep starts"
              value={o.mode}
              onChange={(mode) => set({ mode })}
              options={[
                { id: 'from-start', label: 'Day 1' },
                { id: 'run-up', label: 'Run-up' },
              ]}
            />
          </FieldRow>
        )}
        {o.days === 'auto' && o.mode === 'run-up' && (
          <FieldRow label="Run-up">
            <RangeField
              label="Told days before this one"
              min={SCRUB_LIMITS.runUpDays.min}
              max={SCRUB_LIMITS.runUpDays.max}
              step={1}
              value={o.runUpDays}
              onChange={(runUpDays) => set({ runUpDays })}
              format={(v) => `${v} days`}
            />
          </FieldRow>
        )}
        {o.days === 'auto' && (
          <FieldRow label="Stops">
            <RangeField
              label="Most stops"
              min={SCRUB_LIMITS.maxStops.min}
              max={SCRUB_LIMITS.maxStops.max}
              step={1}
              value={o.maxStops}
              onChange={(maxStops) => set({ maxStops })}
              format={(v) => `≤ ${v}`}
            />
          </FieldRow>
        )}
        <FieldRow label="Length">
          <RangeField
            label="Sweep length"
            min={SCRUB_LIMITS.sweepSeconds.min}
            max={SCRUB_LIMITS.sweepSeconds.max}
            step={0.1}
            value={o.sweepSeconds}
            onChange={(sweepSeconds) => set({ sweepSeconds })}
            format={(v) => `${v.toFixed(1)}s`}
          />
        </FieldRow>
        <FieldRow label="Motion" hint={EASINGS[o.easing].hint}>
          <SelectField
            label="How the head travels"
            value={o.easing}
            onChange={(easing) => set({ easing })}
            options={EASING_IDS.map((id) => ({ id, label: EASINGS[id].label }))}
          />
        </FieldRow>
        <FieldRow
          label="Hold first"
          hint={
            o.delaySeconds > 0
              ? 'The frame sits on the first stop this long before the head moves.'
              : undefined
          }
        >
          <RangeField
            label="Hold on the first stop"
            min={SCRUB_LIMITS.delaySeconds.min}
            max={SCRUB_LIMITS.delaySeconds.max}
            step={0.1}
            value={o.delaySeconds}
            onChange={(delaySeconds) => set({ delaySeconds })}
            format={(v) => (v === 0 ? 'none' : `${v.toFixed(1)}s`)}
          />
        </FieldRow>
      </Group>

      <Group title="Pictures">
        <SwitchRow
          label="Flash the told days’ pictures as the head passes"
          name="Flash pictures"
          checked={o.flash}
          onChange={(flash) => set({ flash })}
        />
        {candidates.length > 0 ? (
          <>
            <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-0.5 px-0.5" role="list" aria-label="Told days before this one">
              {candidates.map((day) => (
                <DayTile
                  key={day.date}
                  day={day}
                  picture={ctx.pictures?.get(day.date)}
                  inSweep={inSweep.has(day.date)}
                  chosen={o.days === 'chosen'}
                  onToggle={() => toggleDay(day.date)}
                />
              ))}
            </div>
            <p className="m-0 text-xs text-muted">
              {o.days === 'chosen'
                ? `Tap a day to put it in the sweep or take it out — ${inSweep.size} of ${candidates.length} chosen. A vermilion dot marks a day a leg starts on.`
                : 'The days the sweep visits are outlined. Switch to “Chosen” to name them yourself.'}
            </p>
            {choosable.length > 0 && (
              <div className="flex flex-col gap-2">
                {choosable.map((day) => {
                  const named = o.pieceByDay[day.date];
                  const current = day.pieces.find((piece) => piece.id === named)
                    ? named
                    : (day.pieces.find((piece) => piece.published) ?? day.pieces[0]).id;
                  return (
                    <FieldRow key={day.date} label={`Day ${day.dayNumber}`}>
                      <SelectField
                        label={`Piece for day ${day.dayNumber}`}
                        value={current}
                        onChange={(id) => set({ pieceByDay: { ...o.pieceByDay, [day.date]: id } })}
                        options={day.pieces.map((piece, i) => ({
                          id: piece.id,
                          label: `${piece.title || `Piece ${i + 1}`}${piece.published ? ' · published' : ''}`,
                        }))}
                      />
                    </FieldRow>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <p className="m-0 text-xs text-muted">
            No other piece tells a day before this one yet, so there is nothing to flash.
          </p>
        )}
      </Group>

      <Group title="Tape">
        <FieldRow label="Runs">
          <Segmented
            size="sm"
            fill
            label="Where the tape runs"
            value={o.tape}
            onChange={(tape) => set({ tape })}
            options={[
              { id: 'bottom', label: 'Bottom' },
              { id: 'top', label: 'Top' },
            ]}
          />
        </FieldRow>
      </Group>

      <Group title="Sound">
        <SwitchRow
          label="Tick at every day it lands on"
          name="Tick at every landing"
          checked={o.sound}
          onChange={(sound) => set({ sound })}
          hint="A photo, or a clip recorded without sound (most drone footage), takes the ticks as its sound. Most feeds play muted: the sweep says everything without them."
        />
        {o.sound && (
          <FieldRow label="Voice" hint={SCRUB_KITS[o.kit].hint}>
            <SelectField
              label="The voices the ticks play on"
              value={o.kit}
              onChange={(kit) => set({ kit })}
              options={KIT_IDS.map((id) => ({ id, label: SCRUB_KITS[id].label }))}
            />
          </FieldRow>
        )}
        {o.sound && (
          <FieldRow label="Pitch">
            <RangeField
              label="Ticks pitch"
              min={SCRUB_LIMITS.tickPitch.min}
              max={SCRUB_LIMITS.tickPitch.max}
              step={0.05}
              value={o.tickPitch}
              onChange={(tickPitch) => set({ tickPitch })}
              format={(v) => (v === 1 ? 'as designed' : `${v < 1 ? '' : '+'}${Math.round(12 * Math.log2(v))} st`)}
            />
          </FieldRow>
        )}
        {o.sound && (
          <FieldRow
            label="Drift"
            hint={
              o.pitchDrift === 'flat'
                ? undefined
                : `The ticks ${o.pitchDrift === 'rising' ? 'climb' : 'fall'} about three semitones from the first landing to the last; the seat keeps its own pitch.`
            }
          >
            <Segmented
              size="sm"
              fill
              label="How the pitch moves along the sweep"
              value={o.pitchDrift}
              onChange={(pitchDrift) => set({ pitchDrift })}
              options={[
                { id: 'flat', label: 'Steady' },
                { id: 'rising', label: 'Climbing' },
                { id: 'falling', label: 'Falling' },
              ]}
            />
          </FieldRow>
        )}
        {o.sound && (
          <FieldRow
            label="Volume"
            hint={o.tickVolume === 0 ? 'At 0% no sound track is written for the ticks at all.' : undefined}
          >
            <RangeField
              label="Ticks volume"
              min={SCRUB_LIMITS.tickVolume.min}
              max={SCRUB_LIMITS.tickVolume.max}
              step={0.05}
              value={o.tickVolume}
              onChange={(tickVolume) => set({ tickVolume })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          </FieldRow>
        )}
        {o.sound && (
          <FieldRow
            label="Mix in"
            hint="Off, a clip that has sound keeps it bit-for-bit and goes out without the ticks. On, its sound is decoded, the ticks are added, and it is re-encoded."
          >
            <ToggleField
              label="Mix the ticks into a clip’s own sound"
              checked={o.mixWithClip}
              onChange={(mixWithClip) => set({ mixWithClip })}
            >
              Into a clip’s own sound
            </ToggleField>
          </FieldRow>
        )}
      </Group>

      {ctx.counterMode && ctx.counterMode !== 'day' && (
        <p className="m-0 text-xs text-faint">
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
  wantsPictures(options, ctx) {
    const o = scrubOptions(options);
    if (!o.flash || !ctx.calendar) return [];
    const days = scrubStopDays(ctx.calendar, ctx.date, o) ?? [];
    // The hero's own picture is already on the frame, and an untold day has
    // nothing to fetch: only the told stops before it are wanted — each with
    // the piece the author named for it, where they named one.
    return days
      .slice(0, -1)
      .filter((day) => day.told)
      .map((day) => ({ date: day.date, postId: o.pieceByDay[day.date] }));
  },
  prepare(options, ctx) {
    const o = scrubOptions(options);
    const plan = ctx.calendar ? scrubPlan(ctx.calendar, ctx.date, o) : null;
    if (!plan) return { seconds: 0 };
    const end = plan.endSeconds;
    return {
      seconds: end,
      // Only under the trip-day counter, and only while the head moves: once
      // it rests the badge says its own value — a range post's "27–29" too.
      content:
        ctx.counterMode === 'day' && end > 0
          ? (t) => (t < end ? { headline: String(plan.stops[plan.stopAt(t)].dayNumber) } : {})
          : undefined,
      paint: (g, t, frame) => paintScrub(g, plan, o, ctx.pictures, t, frame),
      score: o.sound
        ? () => scrubScore(plan, o.tickVolume, { kit: o.kit, pitch: o.tickPitch, drift: o.pitchDrift })
        : undefined,
      mixWithSource: o.sound && o.mixWithClip,
    };
  },
  Sketch: ScrubSketch,
  Panel: ScrubPanel,
};
