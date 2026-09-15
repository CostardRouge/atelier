/**
 * «&nbsp;Défilé&nbsp;» — the trip runs past and stops on this day.
 *
 * The trip's measuring tape sweeps from where it starts to the day this piece
 * tells, decelerating; every stop flashes a real picture as the head lands —
 * the photo another piece of that day is made from, or one the author picked
 * over a span of the trip — a stop with none goes dark, and the badge's numeral
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

import { useCallback } from 'react';
import Button from '../../ui/Button';
import Segmented from '../../ui/Segmented';
import {
  FieldRow,
  RangeField,
  SelectField,
  SwitchRow,
  ToggleField,
  swatchClass,
} from '../../ui/Inspector';
import type {
  HookPanelProps,
  HookPicture,
  HookPictureStatus,
  HookVariant,
} from './hook-variant';
import { Group, MovedRow } from './panel-ui';
import { paintScrub } from './scrub-paint';
import {
  EASINGS,
  EASING_IDS,
  KIT_IDS,
  PICKED_MAX_STOPS,
  SCRUB_KITS,
  SCRUB_DEFAULTS,
  SCRUB_LIMITS,
  moveTape,
  partitionPicked,
  scrubOptions,
  scrubPlan,
  scrubScore,
  scrubSeeds,
  scrubWants,
  tapeBox,
  tapeMoved,
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

/**
 * One stop's tile in the strip: the picture that will flash there, once the
 * shell has decoded it, else the day number on a dark tile — which is also
 * exactly what the sweep draws for a stop with nothing to show.
 * Cover-cropped the way the flash is. Read-only: what flashes is decided by
 * the controls above it, never by poking a tile.
 */
function StopTile({
  dayNumber,
  picture,
  legStart,
  problem,
}: {
  dayNumber: number;
  picture: HookPicture | undefined;
  legStart: boolean;
  /** Why this stop's picture will not be drawn, when that is known. */
  problem?: string;
}) {
  // A callback ref, not an effect: it runs on every attach, so a tile whose
  // canvas is remounted (a list reordered, a mode switched) is painted again
  // rather than left blank by an effect keyed on an unchanged picture.
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

  return (
    <span
      role="listitem"
      title={problem}
      aria-label={`Day ${dayNumber}${problem ? ` — ${problem}` : ''}`}
      className={`relative flex-none w-[2.25rem] aspect-[9/16] overflow-hidden rounded-[5px] bg-frame border ${
        problem ? 'border-danger' : 'border-line-strong'
      }`}
    >
      {picture ? (
        <canvas ref={paintInto} width={54} height={96} className="block w-full h-full" aria-hidden="true" />
      ) : null}
      <span className="absolute left-1 top-1 rounded-[3px] bg-black/55 px-1 font-mono text-3xs text-white">
        {dayNumber}
      </span>
      {legStart && (
        <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
      )}
    </span>
  );
}

/** How the shell is getting on with the pictures this plan flashes. */
function pictureLine(
  keys: readonly string[],
  status: HookPictureStatus | undefined,
): { text: string; danger: boolean } | null {
  if (!status || keys.length === 0) return null;
  const failing = keys.filter((key) => status.problems.has(key));
  if (status.pending > 0) {
    return { text: `Loading ${status.pending} ${status.pending === 1 ? 'picture' : 'pictures'}…`, danger: false };
  }
  if (!failing.length) return null;
  const first = status.problems.get(failing[0]);
  return {
    text:
      failing.length === 1
        ? `One picture cannot be shown: ${first}`
        : `${failing.length} pictures cannot be shown — ${first}${failing.length > 1 ? ' (and others)' : ''}`,
    danger: true,
  };
}

function ScrubPanel({ options, onChange, ctx, host }: HookPanelProps) {
  const o = scrubOptions(options);
  const set = (patch: Partial<ScrubOptions>) => onChange({ ...o, ...patch });
  const calendar = ctx.calendar;
  const plan = calendar ? scrubPlan(calendar, ctx.date, o) : null;
  const flashing = plan ? plan.stops.filter((s) => !s.hero) : [];
  const keys = [...new Set(flashing.flatMap((s) => (s.pictureKey ? [s.pictureKey] : [])))];
  const status = host?.pictureStatus;
  const line = o.flash ? pictureLine(keys, status) : null;
  const picked = o.stopsOn === 'picked';
  const split = calendar ? partitionPicked(calendar, ctx.date, o.picked) : null;

  // The panel says what the sweep WILL do for this piece — the counter modes'
  // rule: the real line, or the reason there is none.
  const flashes = flashing.filter((s) => s.told).length;
  // A told day whose piece has no picture yet is crossed dark: say so rather
  // than count it as a flash.
  const pictured = flashing.filter((s) => s.told && s.pictureKey).length;
  const summary = !plan
    ? null
    : plan.stops.length < 2
      ? picked
        ? 'No picture picked yet — choose them below, and the sweep runs through them in the order they were shot.'
        : 'This is the first day of the trip — there is nothing to sweep from.'
      : `${plan.stops.length} stops from day ${plan.stops[0].dayNumber} · ${
          !o.flash
            ? 'no pictures flash'
            : picked
              ? `${flashes} ${flashes === 1 ? 'picture flashes' : 'pictures flash'}`
              : flashes === 0
                ? 'no other day told yet, so nothing flashes'
                : pictured < flashes
                  ? `${pictured} of ${flashes} told days flash a picture — ${flashes - pictured} ${flashes - pictured === 1 ? 'piece has' : 'pieces have'} none yet`
                  : `${flashes} told ${flashes === 1 ? 'day flashes' : 'days flash'}`
        } · ${plan.sweepSeconds.toFixed(1)}s${plan.delaySeconds > 0 ? ` after ${plan.delaySeconds.toFixed(1)}s` : ''}`;
  // The hook's screen time is a separate setting; say so when it would cut the
  // sweep short, rather than delivering a scrub that never lands.
  const cut = plan && ctx.screenSeconds !== undefined && plan.endSeconds > ctx.screenSeconds;
  // Past ~3 frames a flash, the pictures stop registering as pictures.
  const perStop = plan && plan.stops.length > 1 ? plan.sweepSeconds / (plan.stops.length - 1) : 1;

  const choose = host?.choosePictures
    ? async () => {
        const next = await host.choosePictures?.(o.picked);
        if (next) set({ stopsOn: 'picked', picked: next });
      }
    : null;

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

      <Group title="Stops">
        <FieldRow
          label="Stops on"
          align="start"
          hint={
            picked
              ? 'One stop a picture you picked, in the order they were shot. Several on one day: the head holds on that day while they change.'
              : 'One stop a day another piece tells. Each flashes the picture that piece is made from — the photo itself, not its finished hook. A day nobody told goes dark.'
          }
        >
          <Segmented
            size="sm"
            fill
            label="What the sweep stops on"
            value={o.stopsOn}
            onChange={(stopsOn) => set({ stopsOn })}
            options={[
              { id: 'pieces', label: 'Pieces’ days' },
              { id: 'picked', label: 'Picked pictures' },
            ]}
          />
        </FieldRow>

        {!picked && (
          <FieldRow
            label="Starts"
            hint={
              o.mode === 'from-start'
                ? 'The head leaves day 1 of the trip.'
                : 'The head starts a few told days before this one.'
            }
          >
            <Segmented
              size="sm"
              fill
              label="Where the sweep starts"
              value={o.mode}
              onChange={(mode) => set({ mode })}
              options={[
                { id: 'from-start', label: 'At day 1' },
                { id: 'run-up', label: 'A few days back' },
              ]}
            />
          </FieldRow>
        )}
        {!picked && o.mode === 'run-up' && (
          <FieldRow label="Days back">
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
        {!picked && (
          <FieldRow label="Most stops">
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

        {flashing.length > 0 && (
          <div
            className="flex gap-1.5 overflow-x-auto pb-1 -mx-0.5 px-0.5"
            role="list"
            aria-label="The stops before this day, with the picture each flashes"
          >
            {flashing.map((stop, i) => (
              <StopTile
                key={`${stop.pictureKey ?? stop.date}-${i}`}
                dayNumber={stop.dayNumber}
                picture={stop.pictureKey ? ctx.pictures?.get(stop.pictureKey) : undefined}
                legStart={stop.legStart}
                problem={stop.pictureKey ? status?.problems.get(stop.pictureKey) : undefined}
              />
            ))}
          </div>
        )}

        {picked && (
          <div className="flex flex-col gap-2">
            {choose ? (
              <div className="flex items-center gap-2 flex-wrap">
                <Button size="sm" variant={o.picked.length ? 'default' : 'primary'} onClick={() => void choose()}>
                  {o.picked.length ? 'Change pictures…' : 'Choose pictures…'}
                </Button>
                {o.picked.length > 0 && (
                  <span className="text-xs text-muted">
                    {o.picked.length} picked
                  </span>
                )}
              </div>
            ) : (
              <p className="m-0 text-xs text-muted">The picture chooser is not available here.</p>
            )}
            {split && (split.after > 0 || split.outside > 0) && (
              <p className="m-0 text-xs text-accent-ink">
                {[
                  split.after > 0 &&
                    `${split.after} shot after this piece’s day`,
                  split.outside > 0 && `${split.outside} shot outside the trip`,
                ]
                  .filter(Boolean)
                  .join(' and ')}{' '}
                — left out: they have no place on the tape before this day.
              </p>
            )}
            {split && split.inReach.length > PICKED_MAX_STOPS && (
              <p className="m-0 text-xs text-muted">
                {split.inReach.length} pictures in reach; the sweep shows {PICKED_MAX_STOPS} of
                them, spread evenly from the first to the last.
              </p>
            )}
          </div>
        )}

        {line && (
          <p className={`m-0 text-xs ${line.danger ? 'text-danger' : 'text-muted'}`} role={line.danger ? 'alert' : undefined}>
            {line.text}
          </p>
        )}

        <SwitchRow
          label="Flash each stop’s picture as the head lands"
          name="Flash pictures"
          checked={o.flash}
          onChange={(flash) => set({ flash })}
        />
      </Group>

      <Group title="Sweep">
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
        <FieldRow label="Width">
          <RangeField
            label="Tape width"
            min={SCRUB_LIMITS.tapeWidth.min}
            max={SCRUB_LIMITS.tapeWidth.max}
            step={0.02}
            value={o.tapeWidth}
            onChange={(tapeWidth) => set({ tapeWidth })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </FieldRow>
        <FieldRow label="From edge">
          <RangeField
            label="Distance from the frame's edge"
            min={SCRUB_LIMITS.edgeOffset.min}
            max={SCRUB_LIMITS.edgeOffset.max}
            step={0.005}
            value={o.edgeOffset}
            onChange={(edgeOffset) => set({ edgeOffset })}
            format={(v) => `${(v * 100).toFixed(1)}%`}
          />
        </FieldRow>
        {tapeMoved(o) && (
          <MovedRow offsetX={o.offsetX} offsetY={o.offsetY} onReset={() => set({ offsetX: 0, offsetY: 0 })} />
        )}
        <FieldRow label="Colours" hint="The ticks ahead, then the head and the days it has passed.">
          <input
            type="color"
            value={o.tickColor}
            onChange={(e) => set({ tickColor: e.target.value })}
            className={swatchClass}
            aria-label="Ticks colour"
          />
          <input
            type="color"
            value={o.passedColor}
            onChange={(e) => set({ passedColor: e.target.value })}
            className={swatchClass}
            aria-label="Head and passed days colour"
          />
          {(o.tickColor !== SCRUB_DEFAULTS.tickColor || o.passedColor !== SCRUB_DEFAULTS.passedColor) && (
            <button
              type="button"
              onClick={() => set({ tickColor: SCRUB_DEFAULTS.tickColor, passedColor: SCRUB_DEFAULTS.passedColor })}
              className="p-0 border-0 bg-transparent text-xs text-muted cursor-pointer underline underline-offset-[3px] hover:text-accent-ink"
            >
              Reset
            </button>
          )}
        </FieldRow>
        <FieldRow label="Opacity">
          <RangeField
            label="Ticks opacity"
            min={SCRUB_LIMITS.tickOpacity.min}
            max={SCRUB_LIMITS.tickOpacity.max}
            step={0.05}
            value={o.tickOpacity}
            onChange={(tickOpacity) => set({ tickOpacity })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </FieldRow>
        <FieldRow label="Height">
          <RangeField
            label="Ticks height"
            min={SCRUB_LIMITS.tickHeight.min}
            max={SCRUB_LIMITS.tickHeight.max}
            step={0.1}
            value={o.tickHeight}
            onChange={(tickHeight) => set({ tickHeight })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </FieldRow>
        <FieldRow
          label="Spacing"
          hint="The least room between two ticks. A long trip thins its ticks to keep it; a leg's start and the trip's ends always draw."
        >
          <RangeField
            label="Least room between ticks"
            min={SCRUB_LIMITS.tickGap.min}
            max={SCRUB_LIMITS.tickGap.max}
            step={1}
            value={o.tickGap}
            onChange={(tickGap) => set({ tickGap })}
            format={(v) => (v <= 5 ? 'fine' : v <= 12 ? 'normal' : 'coarse')}
          />
        </FieldRow>
        <FieldRow label="Head">
          <Segmented
            size="sm"
            fill
            label="The shape of the reading head"
            value={o.headStyle}
            onChange={(headStyle) => set({ headStyle })}
            options={[
              { id: 'bar', label: 'Bar' },
              { id: 'dot', label: 'Dot' },
              { id: 'needle', label: 'Needle' },
            ]}
          />
        </FieldRow>
        <FieldRow label="Glow">
          <ToggleField label="Glow behind the head" checked={o.headGlow} onChange={(headGlow) => set({ headGlow })}>
            Behind the head
          </ToggleField>
        </FieldRow>
        <FieldRow label="Track">
          <ToggleField label="Draw the track line" checked={o.showTrack} onChange={(showTrack) => set({ showTrack })}>
            The line the ticks stand on
          </ToggleField>
        </FieldRow>
        <FieldRow label="Band" hint={o.tapeBackground ? undefined : 'A dark band behind the tape, for a tape over a bright picture.'}>
          <ToggleField
            label="Dark band behind the tape"
            checked={o.tapeBackground}
            onChange={(tapeBackground) => set({ tapeBackground })}
          >
            Behind the tape
          </ToggleField>
        </FieldRow>
        {o.tapeBackground && (
          <FieldRow label="Band depth">
            <RangeField
              label="Band opacity"
              min={SCRUB_LIMITS.backgroundOpacity.min}
              max={SCRUB_LIMITS.backgroundOpacity.max}
              step={0.05}
              value={o.backgroundOpacity}
              onChange={(backgroundOpacity) => set({ backgroundOpacity })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          </FieldRow>
        )}
        <FieldRow label="Ends" hint={o.edgeFade ? 'Ticks, track and band fade out over the tape’s two ends.' : undefined}>
          <ToggleField label="Fade the tape's ends" checked={o.edgeFade} onChange={(edgeFade) => set({ edgeFade })}>
            Fade out at both ends
          </ToggleField>
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
    // The hero's own picture is already on the frame, and a stop with nothing
    // to show has nothing to fetch: only the pictures the stops name, once each.
    return scrubWants(scrubSeeds(ctx.calendar, ctx.date, o) ?? []);
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
  // The TAPE is what a click grabs and a drag moves: the flashes fill the frame
  // and the numeral is a badge piece, so neither has a place to be dragged to.
  // Nothing to grab when there is no sweep to draw: `scrubPlan` refuses only a
  // piece dated outside its calendar, checked here without building a plan on
  // every repaint of the outline.
  frameBox(options, ctx, frame) {
    if (!ctx.calendar?.some((day) => day.date === ctx.date)) return null;
    return tapeBox(frame.width, frame.height, scrubOptions(options));
  },
  moveBy(options, dx, dy) {
    return { ...moveTape(scrubOptions(options), dx, dy) };
  },
  Sketch: ScrubSketch,
  Panel: ScrubPanel,
};
