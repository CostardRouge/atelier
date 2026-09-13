/**
 * The route trace — the trip's own shape over the picture.
 *
 * The legs' located places joined in the order they were lived: the trip so
 * far solid, this day's leg in the accent, the legs still ahead faint. It can
 * draw itself, the pen travelling to the end of the current leg before the rest
 * of the trip appears — and tick at every place the pen reaches, the way the
 * Défilé ticks at every day. A LAYER over the picture; no stop list, no
 * pictures to fetch, no text to rewrite.
 *
 * It is the engine's second real variant and deliberately unlike the first:
 * it needed ONE optional field added to the context the shell fills
 * (`HookContext.stages`), and nothing else in the contract, the resolver, the
 * picker, the renderer or either export. Arithmetic and options:
 * `route-plan.ts`; drawing: `route-paint.ts`. This file is the variant's face
 * — what it needs, when it cannot run, and its panel.
 */

import Segmented from '../../ui/Segmented';
import {
  FieldRow,
  RangeField,
  SelectField,
  SwitchRow,
  ToggleField,
  swatchClass,
} from '../../ui/Inspector';
import { EASINGS, EASING_IDS } from './easing';
import type { HookPanelProps, HookVariant } from './hook-variant';
import { Group } from './panel-ui';
import { paintRoute } from './route-paint';
import {
  ROUTE_DEFAULTS,
  ROUTE_LIMITS,
  formatDistance,
  locatedSpots,
  planarLengths,
  reachTimes,
  routeOptions,
  routeScore,
  routeShape,
  routeTiming,
  segmentKms,
  type RouteOptions,
} from './route-plan';
import { KIT_IDS, TICK_KITS } from './tick-kits';

export { ROUTE_DEFAULTS, routeOptions, type RouteOptions } from './route-plan';

function RouteSketch() {
  return (
    <svg viewBox="0 0 58 22" width="58" height="22" aria-hidden="true" fill="none">
      <path d="M4 17 C 12 14, 13 7, 21 6 S 33 12, 38 9" stroke="rgba(255,255,255,0.85)" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M38 9 C 42 7, 45 4, 49 6" stroke="#d9442a" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M49 6 C 52 8, 53 13, 55 15" stroke="rgba(255,255,255,0.5)" strokeWidth="1" strokeDasharray="2 2" strokeLinecap="round" />
      <circle cx="4" cy="17" r="1.5" fill="#fff" />
      <circle cx="49" cy="6" r="1.8" fill="#d9442a" />
    </svg>
  );
}

const resetLink =
  'p-0 border-0 bg-transparent text-xs text-muted cursor-pointer underline underline-offset-[3px] hover:text-accent-ink';

function RoutePanel({ options, onChange, ctx }: HookPanelProps) {
  const o = routeOptions(options);
  const set = (patch: Partial<RouteOptions>) => onChange({ ...o, ...patch });
  const stages = ctx.stages ?? [];
  const shape = routeShape(stages, ctx.date, o.scope);
  const hasFuture = shape.segments.some((s) => s.state === 'future');
  const timing = routeTiming(o, hasFuture);
  // The distance the line will say once drawn: every segment the pen travels.
  const soFarKm = segmentKms(shape).reduce(
    (sum, km, i) => sum + (shape.segments[i].state === 'future' ? 0 : km),
    0,
  );

  // What the line will really show for THIS piece, or why it shows less.
  const summary =
    shape.points.length < 2
      ? o.scope === 'leg'
        ? 'This day’s leg has fewer than two places with coordinates, so there is no line to draw for it alone.'
        : null
      : `${shape.points.length} located places across ${
          o.scope === 'leg' ? 'this leg' : `${stages.length} ${stages.length === 1 ? 'leg' : 'legs'}`
        } · ${
          shape.currentLeg === null
            ? 'no leg covers this day, so none is marked'
            : `this day is on leg ${shape.currentLeg}${
                stages[shape.currentLeg - 1]?.label ? ` — ${stages[shape.currentLeg - 1].label}` : ''
              }`
        }${o.distance !== 'off' ? ` · ${formatDistance(soFarKm, o.distance)} so far` : ''}${
          timing.total > 0 ? ` · ${timing.total.toFixed(1)}s` : ''
        }`;
  const unlocated = stages.length > 0 && stages.some((stage) => stage.places.length === 0);
  // The hook's screen time is a separate setting; say so when it would cut the
  // pen short, rather than delivering a route that never arrives.
  const cut = ctx.screenSeconds !== undefined && timing.total > ctx.screenSeconds;
  const coloursChanged =
    o.pastColor !== ROUTE_DEFAULTS.pastColor ||
    o.currentColor !== ROUTE_DEFAULTS.currentColor ||
    o.futureColor !== ROUTE_DEFAULTS.futureColor;

  return (
    <div className="flex flex-col gap-4 pl-3 border-l-2 border-line">
      {summary && <p className="m-0 text-xs text-ink-soft">{summary}</p>}
      {unlocated && (
        <p className="m-0 text-xs text-faint">
          A leg with no located place is not on the line. Places get coordinates when you
          look them up in the trip’s legs.
        </p>
      )}
      {cut && (
        <p className="m-0 text-xs text-accent-ink">
          The hook is on screen for {ctx.screenSeconds?.toFixed(1)}s, shorter than the
          drawing — the export would cut it before the pen arrives. Lengthen the hook in
          Export, or shorten the drawing.
        </p>
      )}

      <Group title="Frame">
        <FieldRow label="Route">
          <Segmented
            size="sm"
            fill
            label="Which legs the line joins"
            value={o.scope}
            onChange={(scope) => set({ scope })}
            options={[
              { id: 'trip', label: 'Whole trip' },
              { id: 'leg', label: 'This leg' },
            ]}
          />
        </FieldRow>
        <FieldRow label="Where">
          <Segmented
            size="sm"
            fill
            label="Where the route sits"
            value={o.position}
            onChange={(position) => set({ position })}
            options={[
              { id: 'top', label: 'Top' },
              { id: 'middle', label: 'Middle' },
              { id: 'bottom', label: 'Bottom' },
            ]}
          />
        </FieldRow>
        <FieldRow label="Align">
          <Segmented
            size="sm"
            fill
            label="Which side the route keeps to"
            value={o.align}
            onChange={(align) => set({ align })}
            options={[
              { id: 'left', label: 'Left' },
              { id: 'center', label: 'Centre' },
              { id: 'right', label: 'Right' },
            ]}
          />
        </FieldRow>
        <FieldRow label="Size">
          <RangeField
            label="Route size"
            min={ROUTE_LIMITS.size.min}
            max={ROUTE_LIMITS.size.max}
            step={0.05}
            value={o.size}
            onChange={(size) => set({ size })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </FieldRow>
        <FieldRow label="Plate" hint={o.plate ? undefined : 'A translucent panel behind the route, for a route over a busy picture.'}>
          <ToggleField label="Plate behind the route" checked={o.plate} onChange={(plate) => set({ plate })}>
            Behind the route
          </ToggleField>
        </FieldRow>
        {o.plate && (
          <FieldRow label="Plate depth">
            <RangeField
              label="Plate opacity"
              min={ROUTE_LIMITS.plateOpacity.min}
              max={ROUTE_LIMITS.plateOpacity.max}
              step={0.05}
              value={o.plateOpacity}
              onChange={(plateOpacity) => set({ plateOpacity })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          </FieldRow>
        )}
        {o.plate && (
          <FieldRow label="Plate colour">
            <input
              type="color"
              value={o.plateColor}
              onChange={(e) => set({ plateColor: e.target.value })}
              className={swatchClass}
              aria-label="Plate colour"
            />
            {o.plateColor !== ROUTE_DEFAULTS.plateColor && (
              <button type="button" onClick={() => set({ plateColor: ROUTE_DEFAULTS.plateColor })} className={resetLink}>
                Reset
              </button>
            )}
          </FieldRow>
        )}
      </Group>

      <Group title="Line">
        <FieldRow label="Width">
          <RangeField
            label="Line width"
            min={ROUTE_LIMITS.lineWidth.min}
            max={ROUTE_LIMITS.lineWidth.max}
            step={0.05}
            value={o.lineWidth}
            onChange={(lineWidth) => set({ lineWidth })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </FieldRow>
        <FieldRow label="Colours" hint="The trip so far, then this day’s leg, then the legs still ahead.">
          <input
            type="color"
            value={o.pastColor}
            onChange={(e) => set({ pastColor: e.target.value })}
            className={swatchClass}
            aria-label="Trip so far colour"
          />
          <input
            type="color"
            value={o.currentColor}
            onChange={(e) => set({ currentColor: e.target.value })}
            className={swatchClass}
            aria-label="This day’s leg colour"
          />
          <input
            type="color"
            value={o.futureColor}
            onChange={(e) => set({ futureColor: e.target.value })}
            className={swatchClass}
            aria-label="Legs ahead colour"
          />
          {coloursChanged && (
            <button
              type="button"
              onClick={() =>
                set({
                  pastColor: ROUTE_DEFAULTS.pastColor,
                  currentColor: ROUTE_DEFAULTS.currentColor,
                  futureColor: ROUTE_DEFAULTS.futureColor,
                })
              }
              className={resetLink}
            >
              Reset
            </button>
          )}
        </FieldRow>
        <FieldRow
          label="Ahead"
          hint={
            o.futureStyle === 'hidden'
              ? 'The legs still ahead are not drawn: the line ends on this day’s leg.'
              : undefined
          }
        >
          <Segmented
            size="sm"
            fill
            label="How the legs still ahead are drawn"
            value={o.futureStyle}
            onChange={(futureStyle) => set({ futureStyle })}
            options={[
              { id: 'dashed', label: 'Dashed' },
              { id: 'faint', label: 'Faint' },
              { id: 'hidden', label: 'Hidden' },
            ]}
          />
        </FieldRow>
        <FieldRow label="Underlay" hint={o.underlay ? undefined : 'Without the dark underlay a light line can vanish over a pale sky.'}>
          <ToggleField label="Dark underlay under the line" checked={o.underlay} onChange={(underlay) => set({ underlay })}>
            Dark edge under everything
          </ToggleField>
        </FieldRow>
      </Group>

      <Group title="Places">
        <FieldRow label="Dots">
          <ToggleField label="A dot at every place" checked={o.dots} onChange={(dots) => set({ dots })}>
            A dot at every place
          </ToggleField>
        </FieldRow>
        {o.dots && (
          <FieldRow label="Dot size">
            <RangeField
              label="Dot size"
              min={ROUTE_LIMITS.dotSize.min}
              max={ROUTE_LIMITS.dotSize.max}
              step={0.1}
              value={o.dotSize}
              onChange={(dotSize) => set({ dotSize })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          </FieldRow>
        )}
        <FieldRow
          label="Names"
          hint={
            o.labels === 'none'
              ? undefined
              : 'The places’ own names, as written in the legs. A name that would sit on another is left out.'
          }
        >
          <SelectField
            label="Which places carry their name"
            value={o.labels}
            onChange={(labels) => set({ labels })}
            options={[
              { id: 'none', label: 'None' },
              { id: 'ends', label: 'The trip’s two ends' },
              { id: 'current', label: 'This day’s leg' },
              { id: 'all', label: 'Every place' },
            ]}
          />
        </FieldRow>
        {o.labels !== 'none' && (
          <FieldRow label="Name size">
            <RangeField
              label="Name size"
              min={ROUTE_LIMITS.labelSize.min}
              max={ROUTE_LIMITS.labelSize.max}
              step={0.1}
              value={o.labelSize}
              onChange={(labelSize) => set({ labelSize })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          </FieldRow>
        )}
        <FieldRow
          label="Ring"
          hint="Only a leg that is a single place is ringed — it IS that place. A longer leg is marked by its colour, never by a pin the dates cannot justify."
        >
          <ToggleField label="Ring a one-place leg" checked={o.ringCurrent} onChange={(ringCurrent) => set({ ringCurrent })}>
            Ring a one-place leg
          </ToggleField>
        </FieldRow>
      </Group>

      <Group title="Motion">
        <SwitchRow
          label="Draw the trip so far, then show what is still ahead"
          name="Draw the route"
          checked={o.draw}
          onChange={(draw) => set({ draw })}
        />
        {o.draw && (
          <FieldRow label="Length">
            <RangeField
              label="Drawing length"
              min={ROUTE_LIMITS.drawSeconds.min}
              max={ROUTE_LIMITS.drawSeconds.max}
              step={0.1}
              value={o.drawSeconds}
              onChange={(drawSeconds) => set({ drawSeconds })}
              format={(v) => `${v.toFixed(1)}s`}
            />
          </FieldRow>
        )}
        {o.draw && (
          <FieldRow label="Motion" hint={EASINGS[o.easing].hint}>
            <SelectField
              label="How the pen travels"
              value={o.easing}
              onChange={(easing) => set({ easing })}
              options={EASING_IDS.map((id) => ({ id, label: EASINGS[id].label }))}
            />
          </FieldRow>
        )}
        {o.draw && (
          <FieldRow
            label="Hold first"
            hint={o.delaySeconds > 0 ? 'The line sits at its first place this long before the pen moves.' : undefined}
          >
            <RangeField
              label="Hold on the first place"
              min={ROUTE_LIMITS.delaySeconds.min}
              max={ROUTE_LIMITS.delaySeconds.max}
              step={0.1}
              value={o.delaySeconds}
              onChange={(delaySeconds) => set({ delaySeconds })}
              format={(v) => (v === 0 ? 'none' : `${v.toFixed(1)}s`)}
            />
          </FieldRow>
        )}
        {o.draw && o.futureStyle !== 'hidden' && (
          <FieldRow
            label="Ahead"
            hint={
              o.futureReveal === 'after'
                ? 'The legs still ahead fade in as the pen arrives.'
                : 'The legs still ahead are there from the first frame; the pen draws over the trip so far.'
            }
          >
            <Segmented
              size="sm"
              fill
              label="When the legs ahead appear"
              value={o.futureReveal}
              onChange={(futureReveal) => set({ futureReveal })}
              options={[
                { id: 'after', label: 'After the pen' },
                { id: 'always', label: 'From the start' },
              ]}
            />
          </FieldRow>
        )}
        {o.draw && (
          <FieldRow label="Pen">
            <Segmented
              size="sm"
              fill
              label="The pen's tip while it travels"
              value={o.pen}
              onChange={(pen) => set({ pen })}
              options={[
                { id: 'dot', label: 'A dot' },
                { id: 'none', label: 'Bare line' },
              ]}
            />
          </FieldRow>
        )}
      </Group>

      <Group title="Extras">
        <FieldRow label="Compass" hint={o.compass ? 'North is up because the projection is; the arrow says so.' : undefined}>
          <ToggleField label="A north arrow" checked={o.compass} onChange={(compass) => set({ compass })}>
            A north arrow
          </ToggleField>
        </FieldRow>
        <FieldRow
          label="Distance"
          hint={
            o.distance === 'off'
              ? undefined
              : 'The straight-line sum between the located places the pen has drawn — the trip so far, never a road distance. It counts up with the pen.'
          }
        >
          <Segmented
            size="sm"
            fill
            label="The distance so far"
            value={o.distance}
            onChange={(distance) => set({ distance })}
            options={[
              { id: 'off', label: 'Off' },
              { id: 'km', label: 'km' },
              { id: 'mi', label: 'mi' },
            ]}
          />
        </FieldRow>
      </Group>

      <Group title="Sound">
        <SwitchRow
          label="Tick at every place the pen reaches"
          name="Tick at every place"
          checked={o.sound}
          onChange={(sound) => set({ sound })}
          hint={
            !o.draw
              ? 'The ticks follow the pen: switch the drawing on for them to play.'
              : 'A deeper tick where a leg begins, a low seat where the pen comes to rest. A photo, or a clip recorded without sound, takes the ticks as its sound.'
          }
        />
        {o.sound && (
          <FieldRow label="Voice" hint={TICK_KITS[o.kit].hint}>
            <SelectField
              label="The voices the ticks play on"
              value={o.kit}
              onChange={(kit) => set({ kit })}
              options={KIT_IDS.map((id) => ({ id, label: TICK_KITS[id].label }))}
            />
          </FieldRow>
        )}
        {o.sound && (
          <FieldRow label="Pitch">
            <RangeField
              label="Ticks pitch"
              min={ROUTE_LIMITS.tickPitch.min}
              max={ROUTE_LIMITS.tickPitch.max}
              step={0.05}
              value={o.tickPitch}
              onChange={(tickPitch) => set({ tickPitch })}
              format={(v) => (v === 1 ? 'as designed' : `${v < 1 ? '' : '+'}${Math.round(12 * Math.log2(v))} st`)}
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
              min={ROUTE_LIMITS.tickVolume.min}
              max={ROUTE_LIMITS.tickVolume.max}
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
    </div>
  );
}

export const routeVariant: HookVariant = {
  id: 'route',
  name: 'Route',
  tagline: 'The trip’s own shape, this day’s leg marked',
  defaults: { ...ROUTE_DEFAULTS },
  needs: { stages: true, places: true },
  owns: 'layer',
  unmet(ctx) {
    // No legs resolved means the shell has not filled them — not a refusal.
    if (!ctx.stages) return null;
    return locatedSpots(ctx.stages) < 2 ? 'Needs two places with coordinates' : null;
  },
  prepare(options, ctx) {
    const o = routeOptions(options);
    const shape = routeShape(ctx.stages ?? [], ctx.date, o.scope);
    if (shape.points.length < 2) return { seconds: 0 };
    const hasFuture = shape.segments.some((s) => s.state === 'future');
    const timing = routeTiming(o, hasFuture);
    // The ticks are timed on the same lengths the paint reveals by, in the
    // projection's own units — so a tick lands where its dot appears at any
    // frame size. A pen that does not move reaches nothing: no ticks.
    const times = () =>
      reachTimes(
        planarLengths(shape),
        shape.segments.map((s) => s.state),
        o.easing,
        timing.delay,
        timing.draw,
      );
    return {
      seconds: timing.total,
      paint: (g, t, frame) => paintRoute(g, shape, o, timing, t, frame),
      score:
        o.sound && o.draw
          ? () => routeScore(shape, times(), { kit: o.kit, pitch: o.tickPitch }, o.tickVolume)
          : undefined,
      mixWithSource: o.sound && o.mixWithClip,
    };
  },
  Sketch: RouteSketch,
  Panel: RoutePanel,
};
