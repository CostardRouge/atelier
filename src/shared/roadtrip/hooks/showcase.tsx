/**
 * «&nbsp;Vitrine&nbsp;» — the trip's vehicle presented on its own: a place,
 * an entrance, an ending, a look.
 *
 * A vehicle (the trip's, or one this piece borrows) is staged in one of
 * eleven places — a showroom, a city, a desert, a ferry, a lake, a beach, a
 * car park, a mountain road, a service station, a bivouac, a forest — each
 * with its variants, at an hour and in a weather, in full frame or as a
 * floating diorama. It enters (on its wheels, exploded, dropped, drawn, found
 * by a light, in stop-motion) and, on a road, never stops in the middle of
 * the lane: it keeps driving while the decor goes by, pulls over, or leaves
 * the road for flat ground. The badge comes in once it has made its
 * entrance. Built from the configurator lab
 * (https://claude.ai/artifact/B7dEcPYeCHC9MLDau4WtCD).
 *
 * The places are `showcase-scenes.ts`, the arithmetic `showcase-plan.ts`, the
 * drawing `showcase-paint.ts`; this file is the variant's face.
 */

import Button from '../../ui/Button';
import Segmented from '../../ui/Segmented';
import { FieldRow, SelectField, TextField, swatchClass } from '../../ui/Inspector';
import { DEFAULT_CAR, DEFAULT_MODEL, carLine, defaultCarSpec, describeCar, vehicleFor, type CarSpec, type VehicleChoice } from '../car-spec';
import { CAR_MODELS, carModel } from './car-registry';
import type { HookPanelProps, HookRender, HookVariant } from './hook-variant';
import { Group } from './panel-ui';
import { paintShowcase, prepareShowcase } from './showcase-paint';
import {
  BADGE_AFTER,
  ENDS,
  ENTRIES,
  LOOKS,
  SHOWCASE_DEFAULTS,
  SHOWCASE_RECIPES,
  SHOWCASE_SECONDS,
  applyRecipe,
  endOf,
  endsOf,
  placeOf,
  readShowcase,
  type ShowcaseOptions,
} from './showcase-plan';
import { PLACES, TIMES, TIME_IDS, WEATHERS, WEATHER_IDS } from './showcase-scenes';

/** The cars a showcase can stage: a boat has no road to drive here. */
const CARS = CAR_MODELS.filter((m) => m.kind === 'car');

/** The vehicle this piece stages: the trip's car, or the one it borrows — never a boat. */
export function showcaseSpec(o: ShowcaseOptions, tripCar: CarSpec): CarSpec {
  const spec = vehicleFor(o.vehicle, o.vehicleColor, tripCar);
  return carModel(spec.model).kind === 'car' ? spec : defaultCarSpec(DEFAULT_MODEL);
}

/** The picker card: a car on a lit plinth. */
function ShowcaseSketch() {
  return (
    <span className="relative block w-[3.6rem] h-[1.4rem] rounded-[3px] overflow-hidden" style={{ background: 'linear-gradient(#2b2b62, #cc6a7b 60%, #f8ae66)' }} aria-hidden="true">
      <svg viewBox="0 0 58 22" width="58" height="22" className="absolute inset-0" fill="none">
        <ellipse cx="29" cy="18.5" rx="17" ry="3" fill="rgba(20,16,12,0.35)" />
        <path d="M18 15 L22 10 L36 9 L41 13 L41 16 L18 16 Z" fill="#1c1c1e" />
        <path d="M24 10 L27 6.5 L34 6.3 L36 9 Z" fill="#33465a" />
        <circle cx="23" cy="16.5" r="2" fill="#1b1b1c" />
        <circle cx="37" cy="16.5" r="2" fill="#1b1b1c" />
        <circle cx="41" cy="13" r="1.1" fill="#f7efc9" />
      </svg>
    </span>
  );
}

/** What a borrowed vehicle's paint is called. */
function paintHint(model: string, color: string): string {
  const preset = carLine(model).colours.find((c) => c.hex === color);
  if (!preset) return 'A colour of this piece’s own.';
  return preset.note ? `${preset.name} — ${preset.note}` : preset.name;
}

function ShowcasePanel({ options, onChange, ctx, host }: HookPanelProps) {
  const o = readShowcase(options);
  const set = (patch: Partial<ShowcaseOptions>) => onChange({ ...o, ...patch });
  const { place, variant } = placeOf(o);
  const ends = endsOf(place, variant);
  const end = endOf(place, variant, o.end);
  const indoor = !!place.studio || (place.indoor?.(variant) ?? false);
  const tripCar = ctx.car ?? DEFAULT_CAR;
  const car = showcaseSpec(o, tripCar);
  const borrowed = car !== tripCar;
  const tripIsBoat = carModel(tripCar.model).kind !== 'car';
  const entry = ENTRIES.find((e) => e.id === o.entry) ?? ENTRIES[0];
  const look = LOOKS.find((l) => l.id === o.look) ?? LOOKS[0];
  const endLabel = (id: (typeof ENDS)[number]['id']) => ((id === 'pullover' || id === 'offroad') && ends?.[id]?.label) || ENDS.find((e) => e.id === id)!.label;
  const endHint = !ends
    ? 'No road here: the vehicle comes to its place and stays.'
    : end === 'road'
      ? place.id === 'beach'
        ? 'It drives the hard sand at the water’s edge and goes round what the tide left on it; the beach goes by.'
        : 'It never stops in the middle of the lane: it keeps driving and the place goes by.'
      : end === 'pullover'
        ? 'It indicates, brakes, and pulls out of the lane to stop.'
        : place.id === 'bivouac'
          ? 'It leaves the track for the camp; the tent and the fire come once it has stopped.'
          : 'It leaves the road and stops on flat ground.';
  return (
    <div className="flex flex-col gap-4">
      <Group title="Start from">
        <div className="flex flex-wrap gap-1.5">
          {SHOWCASE_RECIPES.map((r) => (
            <Button key={r.id} size="sm" onClick={() => onChange({ ...applyRecipe(o, r.patch) })}>
              {r.label}
            </Button>
          ))}
        </div>
      </Group>

      <Group title="Place">
        <FieldRow label="Place">
          <SelectField
            value={place.id}
            options={PLACES.map((p) => ({ id: p.id, label: p.name }))}
            onChange={(id) => set({ place: id, end: 'auto' })}
            label="Place"
          />
        </FieldRow>
        <FieldRow label="Variant">
          <Segmented
            size="sm"
            label="Variant"
            value={variant}
            options={place.variants.map(([id, label]) => ({ id, label }))}
            onChange={(v) => set({ variants: { ...o.variants, [place.id]: v } })}
          />
        </FieldRow>
        <FieldRow label="Hour" hint={indoor ? 'Inside: the light does not change with the hour.' : undefined}>
          <Segmented
            size="sm"
            label="Hour"
            value={o.time}
            options={TIME_IDS.map((id) => ({ id, label: TIMES[id].label, disabled: indoor ? 'Inside: the light does not change with the hour' : undefined }))}
            onChange={(time) => set({ time })}
          />
        </FieldRow>
        <FieldRow label="Weather">
          <Segmented size="sm" label="Weather" value={o.weather} options={WEATHER_IDS.map((id) => ({ id, label: WEATHERS[id].label }))} onChange={(weather) => set({ weather })} />
        </FieldRow>
        <FieldRow label="Framing" hint={o.frame === 'diorama' ? 'The place cut out as a slab floating in the sky; on a road it becomes a treadmill the decor slides across.' : undefined}>
          <Segmented
            size="sm"
            label="Framing"
            value={o.frame}
            options={[
              { id: 'full', label: 'Full frame' },
              { id: 'diorama', label: 'Diorama' },
            ]}
            onChange={(frame) => set({ frame })}
          />
        </FieldRow>
      </Group>

      <Group title="Motion">
        <FieldRow label="Entrance" hint={entry.hint}>
          <SelectField value={o.entry} options={ENTRIES.map((e) => ({ id: e.id, label: e.label }))} onChange={(id) => set({ entry: id })} label="Entrance" />
        </FieldRow>
        <FieldRow label="Ending" hint={endHint} align="start">
          <Segmented
            size="sm"
            label="Ending"
            value={end}
            options={ENDS.map((e) => {
              const ok = ends ? e.id !== 'still' && !!ends[e.id] : e.id === 'still';
              return {
                id: e.id,
                label: endLabel(e.id),
                disabled: ok
                  ? undefined
                  : !ends
                    ? 'No road here'
                    : e.id === 'still'
                      ? 'On a road it never stops in the middle of the lane'
                      : 'Nowhere to do that here',
              };
            })}
            onChange={(id) => set({ end: id })}
          />
        </FieldRow>
        <FieldRow label="Look" hint={look.hint}>
          <Segmented size="sm" label="Look" value={o.look} options={LOOKS.map((l) => ({ id: l.id, label: l.label }))} onChange={(id) => set({ look: id })} />
        </FieldRow>
      </Group>

      <Group title="Vehicle">
        <FieldRow
          label="Stages"
          hint={
            tripIsBoat && !borrowed
              ? 'The trip drives a boat, which has no road here: the Prado stands in until a car is picked.'
              : borrowed
                ? 'This piece only: the trip keeps its car.'
                : 'The trip’s car, as it is dressed in the garage.'
          }
        >
          <SelectField
            value={borrowed ? car.model : 'trip'}
            options={[
              { id: 'trip', label: `The trip’s ${carModel(tripCar.model).short}` },
              ...CARS.filter((m) => m.id !== tripCar.model).map((m) => ({ id: m.id, label: m.name })),
            ]}
            onChange={(vehicle) => set({ vehicle: vehicle as VehicleChoice, vehicleColor: '' })}
            label="Vehicle"
          />
        </FieldRow>
        <p className="m-0 text-xs text-ink-soft">{describeCar(car, carModel(car.model).name)}</p>
        {borrowed ? (
          <FieldRow label="Paint" align="start" hint={paintHint(car.model, car.color)}>
            <div className="flex flex-wrap items-center gap-1.5">
              {carLine(car.model).colours.map((c) => {
                const on = c.hex === car.color;
                return (
                  <button
                    key={c.id}
                    type="button"
                    aria-label={c.name}
                    aria-pressed={on}
                    title={c.note ? `${c.name} — ${c.note}` : c.name}
                    onClick={() => set({ vehicleColor: c.hex === carLine(car.model).color ? '' : c.hex })}
                    className={`flex-none w-7 h-7 p-0 rounded-full border-2 cursor-pointer transition-[box-shadow,border-color] duration-150 ease-paper focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 ${
                      on ? 'border-accent shadow-[0_0_0_2px_var(--color-surface)_inset]' : 'border-line-strong hover:border-muted'
                    }`}
                    style={{ background: c.hex }}
                  />
                );
              })}
              <input
                type="color"
                value={car.color}
                onChange={(e) => set({ vehicleColor: e.target.value.toLowerCase() })}
                aria-label="A paint of this piece’s own"
                title="A paint of this piece’s own"
                className={swatchClass}
              />
            </div>
          </FieldRow>
        ) : host?.configureCar ? (
          <div>
            <Button size="sm" onClick={() => host.configureCar?.()}>
              Configure the car…
            </Button>
          </div>
        ) : (
          <p className="m-0 text-xs text-muted">The trip’s car is dressed in the trip settings, under Car.</p>
        )}
      </Group>

      <Group title="Words">
        <FieldRow label="Place line" hint="Said by the badge in place of the day’s place while the opener plays — a crossing, a road’s name. Empty, the badge says its own.">
          <TextField value={o.caption} onChange={(caption) => set({ caption })} placeholder="Algeciras → Tanger Med" label="Place line" />
        </FieldRow>
        <FieldRow label="Badge">
          <Segmented
            size="sm"
            label="Badge"
            value={o.badge}
            options={[
              { id: 'after', label: 'After the entrance' },
              { id: 'always', label: 'Throughout' },
              { id: 'never', label: 'Hidden' },
            ]}
            onChange={(badge) => set({ badge })}
          />
        </FieldRow>
      </Group>
    </div>
  );
}

export const showcaseVariant: HookVariant = {
  id: 'showcase',
  name: 'Vitrine',
  tagline: 'The vehicle on its own: a place, an entrance, an ending, a look',
  defaults: { ...SHOWCASE_DEFAULTS },
  // The vehicle borrowed and the words are this piece's; the rest is a look.
  contentKeys: ['vehicle', 'vehicleColor', 'caption'],
  needs: {},
  owns: 'frame',
  prepare(options, ctx) {
    const o = readShowcase(options);
    const prep = prepareShowcase(o, showcaseSpec(o, ctx.car ?? DEFAULT_CAR));
    const caption = o.caption.trim();
    const render: HookRender = {
      seconds: SHOWCASE_SECONDS,
      paint: (g, t, frame) => paintShowcase(g, prep, t, frame),
      ...(caption ? { content: () => ({ caption }) } : {}),
      ...(o.badge === 'after' ? { badgeWindow: { start: BADGE_AFTER, end: null } } : o.badge === 'never' ? { badgeWindow: { start: 0, end: 0 } } : {}),
    };
    return render;
  },
  Sketch: ShowcaseSketch,
  Panel: ShowcasePanel,
};
