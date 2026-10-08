/**
 * «&nbsp;Virée&nbsp;» — a little car drives the map from place to place,
 * stopping to show pictures.
 *
 * A paper map of the trip so far (no tiles, nothing fetched: the projection
 * is the route trace's own), the road as a curve through the stops, and a
 * cartoon vehicle — the trip's car, wheels turning, or a boat a piece borrows
 * for its day on the water, a wake behind it — a miniature rendered by
 * `mesh3d.ts`, driving it. The stops are the legs' located places, the places the
 * author puts on the map themselves (the Itinerary's own editor, shared), or
 * the picked pictures' own positions; at a stop with pictures the car halts and they pop
 * as prints beside it, or fill the frame; when it arrives the map can fade
 * and leave the piece's own picture under the badge. It ticks at every stop
 * on the shared kits, with a shutter as each print lands.
 *
 * The arithmetic is `drive-plan.ts`, the drawing `drive-paint.ts`, the
 * vehicles `car-registry.ts`; this file is the variant's face — what it
 * needs, its sketch, and its options.
 */

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
import { DEFAULT_CAR, carLine, describeCar, vehicleFor, type VehicleChoice } from '../car-spec';
import { CAR_MODELS, carModel, vehicleLabel } from './car-registry';
import {
  DRIVE_DEFAULTS,
  DRIVE_LIMITS,
  STAY_MIN_SECONDS,
  MAX_PICTURES_PER_STOP,
  MILESTONE_DAYS,
  MILESTONE_DISTANCE,
  counterDay,
  distanceNumeral,
  driveCounterPieces,
  drivePlan,
  driveOptions,
  driveRoute,
  driveScore,
  driveShortestBeat,
  driveWants,
  type DriveOptions,
  type DrivePlan,
  type DriveRoute,
} from './drive-plan';
import { driveRibbon } from './drive-ribbon';
import { driveBasemap, driveScratch, driveTrack, paintDrive } from './drive-paint';
import { driveCountOf, type DriveCount } from '../day-badge';
import { FitRow } from './fit-row';
import { GroupRows } from './group-rows';
import { fitRender } from '../slide-timing';
import { CAMERA_PRESETS } from './map-camera';
import { CameraRows } from './camera-rows';
import { EASINGS, EASING_IDS } from './easing';
import { formatDistance } from './geo';
import type { HookPanelProps, HookPictureStatus, HookRender, HookVariant } from './hook-variant';
import { allowTiles, stripBudget } from '../../map/osm-tiles';
import { BasemapStatus } from './basemap-row';
import { readyGround } from './basemap-strip';
import { Group } from './panel-ui';
import StopsEditor, { StopStyleRow } from './stops-editor';
import { otherPlaces, tripPlaces } from './stops';
import { KIT_IDS, TICK_KITS } from './tick-kits';

export { DRIVE_DEFAULTS, driveOptions, type DriveOptions } from './drive-plan';

/** The picker card: a dotted road on paper and a car glyph travelling it (keyframes in `index.css`). */
function DriveSketch() {
  return (
    <span
      className="relative block w-[3.6rem] h-[1.4rem] rounded-[3px] overflow-hidden"
      style={{ background: '#e8e2d4' }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 58 22" width="58" height="22" className="absolute inset-0" fill="none">
        <path d="M5 16 C 14 4, 24 20, 34 10 S 48 4, 53 8" stroke="rgba(58,51,42,0.45)" strokeWidth="1.2" strokeDasharray="2 2.2" strokeLinecap="round" />
        <circle cx="5" cy="16" r="1.6" fill="#d9442a" />
        <circle cx="34" cy="10" r="1.6" fill="rgba(58,51,42,0.7)" />
        <circle cx="53" cy="8" r="1.6" fill="rgba(58,51,42,0.7)" />
      </svg>
      <span
        className="drive-sketch-car absolute left-0 top-0 block w-[9px] h-[5px] rounded-[1.5px] shadow-[0_1px_1px_rgba(20,16,12,0.5)]"
        style={{ background: '#1c1c1e' }}
      />
    </span>
  );
}

const resetLink =
  'p-0 border-0 bg-transparent text-xs text-muted cursor-pointer underline underline-offset-[3px] hover:text-accent-ink self-start';

/** How the shell is getting on with the pictures this drive shows. */
function pictureLine(keys: readonly string[], status: HookPictureStatus | undefined): { text: string; danger: boolean } | null {
  if (!status || keys.length === 0) return null;
  const failing = keys.filter((key) => status.problems.has(key));
  if (status.pending > 0) {
    return { text: `Loading ${status.pending} ${status.pending === 1 ? 'picture' : 'pictures'}…`, danger: false };
  }
  if (!failing.length) return null;
  const first = status.problems.get(failing[0]);
  return {
    text: failing.length === 1 ? `One picture cannot be shown: ${first}` : `${failing.length} pictures cannot be shown — ${first}`,
    danger: true,
  };
}

/** What the route leaves out, in one sentence, or null. */
function leftOutLine(route: DriveRoute, o: DriveOptions): string | null {
  const l = route.leftOut;
  const parts = [
    l.after > 0 && `${l.after} shot after this piece’s day`,
    l.outside > 0 && `${l.outside} shot outside the trip`,
    l.unlocated > 0 &&
      (o.stopsOn === 'custom'
        ? `${l.unlocated} picked with no position`
        : `${l.unlocated} with no position and no stop to ride with`),
    l.homeless > 0 && `${l.homeless} with no position on a day no driven leg covers`,
    l.crowded > 0 && `${l.crowded} past the ${MAX_PICTURES_PER_STOP} a stop can show`,
  ].filter(Boolean);
  if (!parts.length) return null;
  const why =
    l.unlocated === 0
      ? '.'
      : o.stopsOn === 'pictures'
        ? ' — a picture needs a position in its EXIF to be a stop.'
        : o.stopsOn === 'custom'
          ? ' — a picked picture needs a position in its EXIF to find its nearest stop; give it to a stop instead.'
          : '.';
  return `Left out: ${parts.join(', ')}${why}`;
}

/** What the recap counts, and up to what — the real numbers, or the reason there are none. */
function recapLine(count: DriveCount, route: DriveRoute, plan: DrivePlan | null): string {
  if (!plan) return 'Nothing to drive yet — the counter waits for the road.';
  const n = route.stops.length;
  if (count === 'km') return `The badge counts the distance as the car drives, up to ${formatDistance(plan.kmAtStop[n - 1], 'km')} as the crow flies.`;
  if (count === 'places') return `The badge counts the stops as the car reaches them, up to ${n}.`;
  const km = count === 'days-km' ? `, the distance beside it up to ${formatDistance(plan.kmAtStop[n - 1], 'km')} as the crow flies` : '';
  if (!plan.clock) {
    return route.stops.length
      ? 'No stop carries a date, so the day cannot count: the badge keeps the day of the trip. A stop put on one of the trip’s places, or given a picture, takes its date.'
      : 'Nothing to drive yet.';
  }
  const from = counterDay(plan.clock.arrive[0], route.tripDays);
  const to = counterDay(plan.clock.leave[n - 1], route.tripDays);
  return `The badge counts the day of the trip as the car drives, from day ${from} to day ${to} of ${route.tripDays}${km}.`;
}

/** What a borrowed vehicle's paint is called: its preset, with its word, or a colour of the piece's own. */
function paintHint(model: string, color: string): string {
  const preset = carLine(model).colours.find((c) => c.hex === color);
  if (!preset) return 'A colour of this piece’s own.';
  return preset.note ? `${preset.name} — ${preset.note}` : preset.name;
}

function DrivePanel({ options, onChange, ctx, host }: HookPanelProps) {
  const o = driveOptions(options);
  const set = (patch: Partial<DriveOptions>) => onChange({ ...o, ...patch });
  const stages = ctx.stages ?? [];
  const calendar = ctx.calendar ?? [];
  const route = driveRoute(stages, calendar, ctx.date, o, ctx.writing, ctx.towns ?? null);
  const count = driveCountOf(ctx.counterMode);
  const plan = drivePlan(route, o, count !== null);
  /** How many stops the road has BEFORE nearby ones are grouped — what the grouping row counts from. */
  const ungrouped = o.groupKm > 0 ? driveRoute(stages, calendar, ctx.date, { ...o, groupKm: 0 }, ctx.writing).stops.length : route.stops.length;
  const wants = driveWants(route, o);
  const status = host?.pictureStatus;
  const line = pictureLine(wants.map((w) => w.key), status);
  // The ground's rasters, as the shell is asked for them — the same call as
  // `wantsBasemap`, so the status row reads the keys the stage draws.
  const basemapWants =
    plan && o.ground === 'tiles'
      ? driveBasemap(plan, o, ctx.aspect, o.camera === 'follow' ? driveTrack(plan, o, ctx.aspect) : null, stripBudget())
      : null;
  const tripCar = ctx.car ?? DEFAULT_CAR;
  // `vehicleFor` hands back the trip's own spec when the piece borrows nothing.
  const car = vehicleFor(o.vehicle, o.vehicleColor, tripCar);
  const borrowed = car !== tripCar;
  const shown = route.stops.reduce((n, s) => n + s.pictures.length, 0);
  const located = stages.reduce((n, s) => n + s.places.length, 0);
  const pickedLocated = o.picked.filter((p) => p.coords).length;
  const places = tripPlaces(stages);
  // The caption can follow the car wherever a stop's name is a PLACE: the
  // legs' own, or the author's. A picture stop is named after its day.
  const namesArePlaces = o.stopsOn !== 'pictures';

  // What the drive WILL do for this piece — the counter modes' rule: the real
  // line, or the reason there is none.
  const summary = !route.stops.length
    ? o.stopsOn === 'pictures'
      ? o.picked.length
        ? 'None of the picked pictures carries a position, so there is nothing to drive between.'
        : 'No picture picked yet — choose them below; each one shot with a position becomes a stop.'
      : o.stopsOn === 'custom'
        ? 'No stop yet — click the map below, take the trip’s own places, or search for one.'
        : located === 0
        ? 'No leg of this trip has a place with coordinates, so there is no road to drive. Look the places up in the trip’s legs, or drive between picked pictures instead.'
        : 'No leg with a located place lies on or before this day.'
    : `${route.stops.length} ${route.stops.length === 1 ? 'stop' : 'stops'}${
        o.stopsOn === 'places'
          ? route.currentLeg === null
            ? ' across every leg'
            : `, arriving where leg ${route.currentLeg} ends${route.stops[route.stops.length - 1].name ? ` — ${route.stops[route.stops.length - 1].name}` : ''}`
          : o.stopsOn === 'custom'
            ? `, in your order${route.stops[route.stops.length - 1].name ? `, arriving at ${route.stops[route.stops.length - 1].name}` : ''}`
            : ', in the order the pictures were shot'
      } · ${
        o.pictures === 'none' ? 'no picture shown' : shown === 0 ? 'no picture to show' : `${shown} ${shown === 1 ? 'picture' : 'pictures'} on the way`
      }${plan ? ` · ${plan.seconds.toFixed(1)}s` : ''}${
        plan && o.distance !== 'off' ? ` · ${formatDistance(plan.kmAtStop[plan.kmAtStop.length - 1], o.distance)}` : ''
      }`;
  const leftOut = leftOutLine(route, o);
  const choose = host?.choosePictures
    ? async () => {
        const next = await host.choosePictures?.(o.picked);
        if (next) set({ picked: next });
      }
    : null;
  const coloursChanged = o.trailColor !== DRIVE_DEFAULTS.trailColor || o.aheadColor !== DRIVE_DEFAULTS.aheadColor;
  const paperChanged = o.paperColor !== DRIVE_DEFAULTS.paperColor || o.inkColor !== DRIVE_DEFAULTS.inkColor;
  // The camera as the drive will really see it: the width a stored share resolves to.
  const viewKm = o.viewKm ?? (plan ? driveTrack(plan, o, ctx.aspect).viewKm : CAMERA_PRESETS.calm.values.viewKm ?? 120);

  return (
    <div className="flex flex-col gap-4 pl-3 border-l-2 border-line">
      <p className="m-0 text-xs text-ink-soft">{summary}</p>
      {leftOut && <p className="m-0 text-xs text-accent-ink">{leftOut}</p>}
      {line && (
        <p className={`m-0 text-xs ${line.danger ? 'text-danger' : 'text-muted'}`} role={line.danger ? 'alert' : undefined}>
          {line.text}
        </p>
      )}

      <Group title="Road">
        <FieldRow
          label="Stops"
          align="start"
          hint={
            o.stopsOn === 'places'
              ? 'The legs’ places with coordinates, the trip so far, arriving where this day’s leg ends. A place gets coordinates when you look it up in the trip’s legs.'
              : o.stopsOn === 'custom'
                ? 'The places you put on the map below, in your order — any place, on the trip’s legs or not. The car halts at a stop that holds a picture.'
                : `Each picked picture shot with a position is a stop, in the order they were shot; one without rides with the stop before it.${pickedLocated ? ` ${pickedLocated} of ${o.picked.length} picked carry one.` : ''}`
          }
        >
          <Segmented
            size="sm"
            fill
            label="What the car drives between"
            value={o.stopsOn}
            onChange={(stopsOn) => set({ stopsOn })}
            options={[
              // Three in a 200px column: the words are short, the hint under
              // the control says the rest.
              { id: 'places', label: 'Legs' },
              { id: 'custom', label: 'Your map' },
              { id: 'pictures', label: 'Photos' },
            ]}
          />
        </FieldRow>
        {o.stopsOn === 'custom' && (
          <StopsEditor
            stops={o.stops}
            onChange={(stops) => set({ stops })}
            places={places}
            free={otherPlaces(stages, o.stops)}
            curve={o.path === 'curved' ? 0.12 : 0}
            placeStyle={o.placeStyle}
            writing={ctx.writing}
            host={host}
            title="Virée"
            pictureHint={
              o.pictures === 'none'
                ? null
                : 'Shown when the car halts here, before any picked picture shot nearby.'
            }
            picturesOffHint="The pictures are set to None below, so the car drives past without showing any."
            grouping={{ groupKm: o.groupKm, groupVisits: o.groupVisits, groupName: o.groupName }}
          />
        )}
        <GroupRows
          value={{ groupKm: o.groupKm, groupVisits: o.groupVisits, groupName: o.groupName }}
          onChange={(patch) => set(patch)}
          count={{ stops: ungrouped, halts: route.stops.length }}
          townsReady={Boolean(ctx.towns?.length)}
        />
        <FieldRow label="Path">
          <Segmented
            size="sm"
            fill
            label="The shape of the road"
            value={o.path}
            onChange={(path) => set({ path })}
            options={[
              { id: 'curved', label: 'Curved' },
              { id: 'straight', label: 'Straight' },
            ]}
          />
        </FieldRow>
        <FieldRow label="Ahead" hint={o.ahead === 'hidden' ? 'The road ahead is not drawn: only the trail the car leaves.' : undefined}>
          <Segmented
            size="sm"
            fill
            label="How the road ahead is drawn"
            value={o.ahead}
            onChange={(ahead) => set({ ahead })}
            options={[
              { id: 'dashed', label: 'Dashed' },
              { id: 'faint', label: 'Faint' },
              { id: 'hidden', label: 'Hidden' },
            ]}
          />
        </FieldRow>
        <FieldRow label="Trail">
          <ToggleField label="The trail behind the car" checked={o.trail} onChange={(trail) => set({ trail })}>
            A solid line behind the car
          </ToggleField>
        </FieldRow>
        <FieldRow label="Colours" hint="The trail, then the road ahead.">
          <input type="color" value={o.trailColor} onChange={(e) => set({ trailColor: e.target.value })} className={swatchClass} aria-label="Trail colour" />
          <input type="color" value={o.aheadColor} onChange={(e) => set({ aheadColor: e.target.value })} className={swatchClass} aria-label="Road ahead colour" />
          {coloursChanged && (
            <button type="button" onClick={() => set({ trailColor: DRIVE_DEFAULTS.trailColor, aheadColor: DRIVE_DEFAULTS.aheadColor })} className={resetLink}>
              Reset
            </button>
          )}
        </FieldRow>
        <FieldRow label="Width">
          <RangeField
            label="Line width"
            min={DRIVE_LIMITS.lineWidth.min}
            max={DRIVE_LIMITS.lineWidth.max}
            step={0.05}
            value={o.lineWidth}
            onChange={(lineWidth) => set({ lineWidth })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </FieldRow>
      </Group>

      <Group title="Pictures">
        <FieldRow
          label="Shown as"
          hint={
            o.pictures === 'cards'
              ? 'Prints popping beside the car at each stop, piled like a stack on the map.'
              : o.pictures === 'fill'
                ? 'Each picture fills the frame while the car halts, then the map comes back.'
                : o.pictures === 'backdrop'
                  ? 'Each picture takes the paper’s place behind the road and the car while it halts.'
                  : 'The car drives without stopping for pictures.'
          }
        >
          <Segmented
            size="sm"
            fill
            label="How the pictures are shown"
            value={o.pictures}
            onChange={(pictures) => set({ pictures })}
            options={[
              { id: 'cards', label: 'Prints' },
              { id: 'fill', label: 'Fill' },
              { id: 'backdrop', label: 'Behind' },
              { id: 'none', label: 'None' },
            ]}
          />
        </FieldRow>
        {o.pictures !== 'none' && (
          <div className="flex flex-col gap-2">
            {choose ? (
              <div className="flex items-center gap-2 flex-wrap">
                <Button size="sm" variant={o.picked.length ? 'default' : 'primary'} onClick={() => void choose()}>
                  {o.picked.length ? 'Change pictures…' : 'Choose pictures…'}
                </Button>
                {o.picked.length > 0 && <span className="text-xs text-muted">{o.picked.length} picked</span>}
              </div>
            ) : (
              <p className="m-0 text-xs text-muted">The picture chooser is not available here.</p>
            )}
          </div>
        )}
        {o.pictures !== 'none' && o.stopsOn === 'places' && (
          <SwitchRow
            label="Also the pictures of the days already told"
            name="Show the told days’ pictures"
            checked={o.includePieces}
            onChange={(includePieces) => set({ includePieces })}
            hint="The photo each piece is made from, shown where the leg of its day ends — the leg is dated, the place is not."
          />
        )}
        {o.pictures !== 'none' && (
          <FieldRow label="Per picture" hint="How long the car halts for each picture at a stop.">
            <RangeField
              label="Seconds per picture"
              min={DRIVE_LIMITS.secondsPerPicture.min}
              max={DRIVE_LIMITS.secondsPerPicture.max}
              step={0.1}
              value={o.secondsPerPicture}
              onChange={(secondsPerPicture) => set({ secondsPerPicture })}
              format={(v) => `${v.toFixed(1)}s`}
            />
          </FieldRow>
        )}
        {o.pictures === 'cards' && (
          <FieldRow label="Print size">
            <RangeField
              label="Print size"
              min={DRIVE_LIMITS.cardSize.min}
              max={DRIVE_LIMITS.cardSize.max}
              step={0.05}
              value={o.cardSize}
              onChange={(cardSize) => set({ cardSize })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          </FieldRow>
        )}
        {o.pictures === 'cards' && (
          <FieldRow label="Afterwards" hint={o.cardsStay ? 'The prints stay on the map once the car has gone: a collage by the end.' : 'The prints fade as the car leaves.'}>
            <ToggleField label="Leave the prints on the map" checked={o.cardsStay} onChange={(cardsStay) => set({ cardsStay })}>
              Leave them on the map
            </ToggleField>
          </FieldRow>
        )}
        <FieldRow label="Pauses" hint={o.pauseEverywhere ? 'The car pauses a beat at every stop, pictures or not.' : undefined}>
          <ToggleField label="Pause at every stop" checked={o.pauseEverywhere} onChange={(pauseEverywhere) => set({ pauseEverywhere })}>
            At every stop, pictures or not
          </ToggleField>
        </FieldRow>
      </Group>

      <Group title="Vehicle">
        <FieldRow
          label="Drives"
          hint={
            borrowed
              ? 'This piece only: the trip keeps its car, and its other pieces drive it.'
              : 'The trip’s car, as it is dressed in the garage.'
          }
        >
          <SelectField
            value={borrowed ? car.model : 'trip'}
            options={[
              { id: 'trip', label: `The trip’s ${carModel(tripCar.model).short}` },
              ...CAR_MODELS.filter((m) => m.id !== tripCar.model).map((m) => ({ id: m.id, label: vehicleLabel(m) })),
            ]}
            onChange={(vehicle) => set({ vehicle: vehicle as VehicleChoice, vehicleColor: '' })}
            label="Vehicle"
          />
        </FieldRow>
        <p className="m-0 text-xs text-ink-soft">{describeCar(car, carModel(car.model).name)}</p>
        {borrowed ? (
          <FieldRow
            label="Paint"
            align="start"
            hint={paintHint(car.model, car.color)}
          >
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
          <p className="m-0 text-xs text-muted">The car is set for the whole trip, in its settings.</p>
        )}
        <FieldRow label="Size">
          <RangeField
            label="Vehicle size"
            min={DRIVE_LIMITS.carSize.min}
            max={DRIVE_LIMITS.carSize.max}
            step={0.05}
            value={o.carSize}
            onChange={(carSize) => set({ carSize })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </FieldRow>
        <FieldRow label="Camera" hint="How steeply the camera looks down at the car: 90° is the map’s own view, lower shows its sides.">
          <RangeField
            label="Camera elevation"
            min={DRIVE_LIMITS.tilt.min}
            max={DRIVE_LIMITS.tilt.max}
            step={1}
            value={o.tilt}
            onChange={(tilt) => set({ tilt })}
            format={(v) => `${Math.round(v)}°`}
          />
        </FieldRow>
      </Group>

      <Group title="Map">
        <FieldRow
          label="Ground"
          hint={
            o.ground === 'paper'
              ? 'A paper map covers the picture while the car drives.'
              : o.ground === 'tiles'
                ? 'OpenStreetMap under the road and the car — roads, coasts, towns — in the preview and in the exported file. The paper stands in until the tiles arrive.'
                : 'The road and the car are drawn over the piece’s own picture.'
          }
        >
          <Segmented
            size="sm"
            fill
            label="What the car drives on"
            value={o.ground}
            onChange={(ground) => {
              // Choosing the tiles is this device's yes, given with the
              // notice in view (`basemap-row.tsx`).
              if (ground === 'tiles') allowTiles(true);
              set({ ground });
            }}
            options={[
              { id: 'paper', label: 'Paper' },
              { id: 'tiles', label: 'OSM map' },
              { id: 'picture', label: 'Picture' },
            ]}
          />
        </FieldRow>
        {(o.pictures === 'backdrop' || o.ground === 'picture') && (
          <FieldRow label="Plate" hint="The map on a translucent paper plate over the picture, the picture pushing in slowly while it shows — the recap’s «map over photo».">
            <ToggleField label="The map on a paper plate over the picture" checked={o.plate} onChange={(plate) => set({ plate })}>
              Map on a paper plate
            </ToggleField>
          </FieldRow>
        )}
        {o.ground === 'tiles' && (
          <BasemapStatus
            want={basemapWants?.wide ?? null}
            set={basemapWants}
            ctx={ctx}
            status={host?.pictureStatus}
            opacity={o.basemapOpacity}
            onOpacity={(basemapOpacity) => set({ basemapOpacity })}
            limits={DRIVE_LIMITS.basemapOpacity}
            note="Below full strength, the paper shows through and keeps the drive’s own colours."
          />
        )}
        {o.ground !== 'picture' && (
          <FieldRow label="Paper · ink">
            <input type="color" value={o.paperColor} onChange={(e) => set({ paperColor: e.target.value })} className={swatchClass} aria-label="Paper colour" />
            <input type="color" value={o.inkColor} onChange={(e) => set({ inkColor: e.target.value })} className={swatchClass} aria-label="Ink colour" />
            {paperChanged && (
              <button type="button" onClick={() => set({ paperColor: DRIVE_DEFAULTS.paperColor, inkColor: DRIVE_DEFAULTS.inkColor })} className={resetLink}>
                Reset
              </button>
            )}
          </FieldRow>
        )}
        {o.ground !== 'picture' && (
          <FieldRow label="Paper" align="start">
            <div className="flex flex-col gap-1.5">
              {o.ground === 'paper' && (
                <ToggleField label="Lines of latitude and longitude" checked={o.graticule} onChange={(graticule) => set({ graticule })}>
                  Latitude and longitude lines
                </ToggleField>
              )}
              <ToggleField label="A vignette at the edges" checked={o.vignette} onChange={(vignette) => set({ vignette })}>
                Darkened edges
              </ToggleField>
            </div>
          </FieldRow>
        )}
        <FieldRow label="Where">
          <Segmented
            size="sm"
            fill
            label="Where the route sits in the frame"
            value={o.position}
            onChange={(position) => set({ position })}
            options={[
              { id: 'top', label: 'Top' },
              { id: 'middle', label: 'Middle' },
              { id: 'bottom', label: 'Bottom' },
            ]}
          />
        </FieldRow>
        <FieldRow label="Size">
          <RangeField
            label="Route size"
            min={DRIVE_LIMITS.size.min}
            max={DRIVE_LIMITS.size.max}
            step={0.05}
            value={o.size}
            onChange={(size) => set({ size })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </FieldRow>
        <FieldRow label="Dots">
          <ToggleField label="A dot at every stop" checked={o.dots} onChange={(dots) => set({ dots })}>
            A dot at every stop
          </ToggleField>
        </FieldRow>
        <FieldRow
          label="Names"
          hint={
            o.labels === 'none'
              ? undefined
              : o.stopsOn === 'places'
                ? 'The places’ own names, as written in the legs. A name that would sit on another, or on a print, is left out.'
                : o.stopsOn === 'custom'
                  ? 'The names you gave the stops. A name that would sit on another, or on a print, is left out.'
                  : 'The day each stop was shot on. A name that would sit on another, or on a print, is left out.'
          }
        >
          <SelectField
            label="Which stops carry a name"
            value={o.labels}
            onChange={(labels) => set({ labels })}
            options={[
              { id: 'none', label: 'None' },
              { id: 'ends', label: 'The two ends' },
              { id: 'all', label: 'Every stop' },
            ]}
          />
        </FieldRow>
        {o.labels !== 'none' && o.stopsOn !== 'pictures' && (
          <StopStyleRow value={o.placeStyle} writing={ctx.writing} onChange={(placeStyle) => set({ placeStyle })} />
        )}
        {o.labels !== 'none' && (
          <FieldRow label="Name size">
            <RangeField
              label="Name size"
              min={DRIVE_LIMITS.labelSize.min}
              max={DRIVE_LIMITS.labelSize.max}
              step={0.1}
              value={o.labelSize}
              onChange={(labelSize) => set({ labelSize })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          </FieldRow>
        )}
        <FieldRow label="Furniture" align="start">
          <div className="flex flex-col gap-1.5">
            <ToggleField label="A compass rose" checked={o.compass} onChange={(compass) => set({ compass })}>
              Compass rose
            </ToggleField>
            <ToggleField label="A scale bar" checked={o.scaleBar} onChange={(scaleBar) => set({ scaleBar })}>
              Scale bar
            </ToggleField>
          </div>
        </FieldRow>
        <FieldRow
          label="Distance"
          hint={o.distance === 'off' ? undefined : 'The straight-line sum between the stops the car has passed, counting up as it drives — never a road distance.'}
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

      <Group title="Motion">
        <FieldRow
          label="Driving"
          hint={
            plan && o.driveSeconds < plan.schedule.roadFloor - 1e-9
              ? `${plan.schedule.phases.filter((p) => p.kind === 'run').length} hops in ${o.driveSeconds.toFixed(1)} s: each is shorter than a third of a second. Give the road ${Math.ceil(plan.schedule.roadFloor)} s, or group nearby places.`
              : `The time on the road${count ? ', stays at the places included' : ''}, shared between the stops by distance${count ? ' and days' : ''}; halts${count && o.summary ? ' and the summary card' : ''} come on top.`
          }
        >
          <RangeField
            label="Driving length"
            min={DRIVE_LIMITS.driveSeconds.min}
            max={DRIVE_LIMITS.driveSeconds.max}
            step={0.5}
            value={o.driveSeconds}
            onChange={(driveSeconds) => set({ driveSeconds })}
            format={(v) => `${v.toFixed(1)}s`}
          />
        </FieldRow>
        {plan && (
          <FitRow
            seconds={plan.seconds}
            screenSeconds={ctx.screenSeconds}
            shortestBeat={driveShortestBeat(plan, o)}
            fit={o.fit}
            onChange={(fit) => set({ fit })}
          />
        )}
        <FieldRow label="Motion" hint={EASINGS[o.easing].hint}>
          <SelectField
            label="How the car pulls away and stops"
            value={o.easing}
            onChange={(easing) => set({ easing })}
            options={EASING_IDS.map((id) => ({ id, label: EASINGS[id].label }))}
          />
        </FieldRow>
        <FieldRow label="Hold first" hint={o.delaySeconds > 0 ? 'The car sits at the first stop this long before it moves.' : undefined}>
          <RangeField
            label="Hold on the first stop"
            min={DRIVE_LIMITS.delaySeconds.min}
            max={DRIVE_LIMITS.delaySeconds.max}
            step={0.1}
            value={o.delaySeconds}
            onChange={(delaySeconds) => set({ delaySeconds })}
            format={(v) => (v === 0 ? 'none' : `${v.toFixed(1)}s`)}
          />
        </FieldRow>
        <FieldRow label="At the end" hint="A beat at rest once the car has arrived, after its last pictures.">
          <RangeField
            label="Rest on arrival"
            min={DRIVE_LIMITS.arriveSeconds.min}
            max={DRIVE_LIMITS.arriveSeconds.max}
            step={0.1}
            value={o.arriveSeconds}
            onChange={(arriveSeconds) => set({ arriveSeconds })}
            format={(v) => (v === 0 ? 'none' : `${v.toFixed(1)}s`)}
          />
        </FieldRow>
        <FieldRow
          label="Then"
          hint={o.end === 'reveal' ? 'The map fades away and the piece’s own picture is left under the badge.' : 'The map stays; the piece’s picture is never shown on this slide.'}
        >
          <Segmented
            size="sm"
            fill
            label="What happens once the car has arrived"
            value={o.end}
            onChange={(end) => set({ end })}
            options={[
              { id: 'reveal', label: 'Reveal the picture' },
              { id: 'stay', label: 'Stay on the map' },
            ]}
          />
        </FieldRow>
        {namesArePlaces && (
          <SwitchRow
            label="The badge’s place follows the car"
            name="Caption follows the car"
            checked={o.captionFollows}
            onChange={(captionFollows) => set({ captionFollows })}
            hint="While the car drives, the badge’s place reads the last stop it passed; once it arrives the badge says its own."
          />
        )}
      </Group>

      <Group title="Camera">
        <CameraRows
          o={o}
          set={set}
          viewKm={viewKm}
          fresh={o.viewKm === null && o.followZoom === DRIVE_DEFAULTS.followZoom}
          words={{ whole: 'Whole route', follow: 'Follow the car', subject: 'the car' }}
          heading
        />
      </Group>

      {ctx.counterMode !== undefined && (
        <Group title="Recap">
          {!count ? (
            <p className="m-0 text-xs text-muted">
              To make the badge’s number count with the car — the day of the trip, the distance, the stops, or the
              day with the distance beside it —
              pick a counter that follows the drive under Content → Counter.
            </p>
          ) : (
            <>
              <p className="m-0 text-xs text-ink-soft">{recapLine(count, route, plan)}</p>
              {(count === 'days' || count === 'days-km') && route.undated > 0 && route.undated < route.stops.length && (
                <p className="m-0 text-xs text-accent-ink">
                  {route.undated} {route.undated === 1 ? 'stop carries' : 'stops carry'} no date — the day holds across{' '}
                  {route.undated === 1 ? 'it' : 'them'}.{o.stopsOn === 'custom' ? ' A stop put on one of the trip’s places, or given a picture, takes its date.' : ''}
                </p>
              )}
              <FieldRow
                label="Pace"
                hint={
                  o.pace === 0
                    ? 'The road time is shared by distance alone; the car never waits, a place’s days running while it drives on.'
                    : 'This much of the road time goes to the days and the rest to the kilometres: the car slows past a place that took days.'
                }
              >
                <RangeField
                  label="Calendar against road"
                  min={DRIVE_LIMITS.pace.min}
                  max={DRIVE_LIMITS.pace.max}
                  step={0.05}
                  value={o.pace}
                  onChange={(pace) => set({ pace })}
                  format={(v) => (v === 0 ? 'road' : v === 1 ? 'calendar' : `${Math.round(v * 100)}% calendar`)}
                />
              </FieldRow>
              {o.pace > 0 && (
                <FieldRow
                  label="Long stays"
                  hint={`The car stops at a place whose days make a stay of ${STAY_MIN_SECONDS} s or more, the counter running while it waits. Off, it never stops for days.`}
                >
                  <ToggleField label="Wait out the long stays" checked={o.waitStays} onChange={(waitStays) => set({ waitStays })}>
                    Wait at the place
                  </ToggleField>
                </FieldRow>
              )}
              <FieldRow
                label="On the way"
                align="start"
                hint={`A card — days · distance · stops — once the car has rested, and a mark on the road every ${MILESTONE_DAYS} days and ${distanceNumeral(MILESTONE_DISTANCE, 'km')} ${o.distance === 'mi' ? 'mi' : 'km'}. The ribbon is Défilé’s tape of the trip’s days under the map, its head on the counter’s day.${o.pictures !== 'none' ? ' While the car stays, a picture shot on a later day comes up on its day.' : ''}`}
              >
                <div className="flex flex-col gap-1.5">
                  <ToggleField label="A summary card at the end" checked={o.summary} onChange={(summary) => set({ summary })}>
                    Summary card
                  </ToggleField>
                  <ToggleField label="Milestones on the road" checked={o.milestones} onChange={(milestones) => set({ milestones })}>
                    Milestones
                  </ToggleField>
                  <ToggleField
                    label="Défilé’s ribbon of the trip’s days under the map, its head following the car"
                    checked={o.ribbon}
                    onChange={(ribbon) => set({ ribbon })}
                  >
                    Ribbon of days
                  </ToggleField>
                  {o.pictures !== 'none' && (
                    <ToggleField
                      label="While the car stays, each picture on the day it was shot"
                      checked={o.dayPictures}
                      onChange={(dayPictures) => set({ dayPictures })}
                    >
                      Pictures on their day
                    </ToggleField>
                  )}
                </div>
              </FieldRow>
            </>
          )}
        </Group>
      )}

      <Group title="Sound">
        <SwitchRow
          label="Tick at every stop the car reaches"
          name="Tick at every stop"
          checked={o.sound}
          onChange={(sound) => set({ sound })}
          hint="A deeper tick where a leg begins (or a new day), a low seat when the car arrives. A photo, or a clip recorded without sound, takes the ticks as its sound."
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
        {o.sound && o.pictures !== 'none' && (
          <FieldRow label="Shutter">
            <ToggleField label="A shutter click as each picture pops" checked={o.shutter} onChange={(shutter) => set({ shutter })}>
              A click as each picture lands
            </ToggleField>
          </FieldRow>
        )}
        {o.sound && plan?.clock && (
          <FieldRow label="Days">
            <ToggleField label="A light tick as each day of the trip passes" checked={o.dayTicks} onChange={(dayTicks) => set({ dayTicks })}>
              A tick as each day passes
            </ToggleField>
          </FieldRow>
        )}
        {o.sound && (
          <FieldRow label="Pitch">
            <RangeField
              label="Ticks pitch"
              min={DRIVE_LIMITS.tickPitch.min}
              max={DRIVE_LIMITS.tickPitch.max}
              step={0.05}
              value={o.tickPitch}
              onChange={(tickPitch) => set({ tickPitch })}
              format={(v) => (v === 1 ? 'as designed' : `${v < 1 ? '' : '+'}${Math.round(12 * Math.log2(v))} st`)}
            />
          </FieldRow>
        )}
        {o.sound && (
          <FieldRow label="Volume" hint={o.tickVolume === 0 ? 'At 0% no sound track is written for the ticks at all.' : undefined}>
            <RangeField
              label="Ticks volume"
              min={DRIVE_LIMITS.tickVolume.min}
              max={DRIVE_LIMITS.tickVolume.max}
              step={0.05}
              value={o.tickVolume}
              onChange={(tickVolume) => set({ tickVolume })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          </FieldRow>
        )}
        {o.sound && (
          <FieldRow label="Mix in" hint="Off, a clip that has sound keeps it bit-for-bit and goes out without the ticks. On, its sound is decoded, the ticks are added, and it is re-encoded.">
            <ToggleField label="Mix the ticks into a clip’s own sound" checked={o.mixWithClip} onChange={(mixWithClip) => set({ mixWithClip })}>
              Into a clip’s own sound
            </ToggleField>
          </FieldRow>
        )}
      </Group>
    </div>
  );
}

export const driveVariant: HookVariant = {
  id: 'drive',
  name: 'Virée',
  tagline: 'A little car drives the map from stop to stop, showing pictures',
  defaults: { ...DRIVE_DEFAULTS },
  // The vehicle too: the boat a piece borrowed is that day's, not a look.
  contentKeys: ['picked', 'stops', 'vehicle', 'vehicleColor'],
  // An Itinerary's stops, handed over on a switch, are driven at once the
  // first time — the author came for their places, not the legs'.
  sharedStops: { key: 'stops', fresh: { stopsOn: 'custom' } },
  needs: { coverage: true, stages: true, places: true, media: 'day' },
  owns: 'frame',
  wantsPictures(options, ctx) {
    const o = driveOptions(options);
    return driveWants(driveRoute(ctx.stages ?? [], ctx.calendar ?? [], ctx.date, o, ctx.writing, ctx.towns ?? null), o);
  },
  wantsBasemap(options, ctx) {
    const o = driveOptions(options);
    if (o.ground !== 'tiles') return [];
    const plan = drivePlan(driveRoute(ctx.stages ?? [], ctx.calendar ?? [], ctx.date, o, ctx.writing, ctx.towns ?? null), o, driveCountOf(ctx.counterMode) !== null);
    return plan ? driveBasemap(plan, o, ctx.aspect, o.camera === 'follow' ? driveTrack(plan, o, ctx.aspect) : null, stripBudget())?.wants ?? [] : [];
  },
  prepare(options, ctx) {
    const o = driveOptions(options);
    const route = driveRoute(ctx.stages ?? [], ctx.calendar ?? [], ctx.date, o, ctx.writing, ctx.towns ?? null);
    // The RECAP: the badge's counter follows the drive (declared in its own
    // Counter section, `day-badge.ts`), so the plan runs the stops' clock.
    const count = driveCountOf(ctx.counterMode);
    const plan = drivePlan(route, o, count !== null);
    if (!plan) return { seconds: 0 };
    const words = ctx.badgeWords;
    const scratch = driveScratch(vehicleFor(o.vehicle, o.vehicleColor, ctx.car ?? DEFAULT_CAR), {
      day: words?.day,
      days: words?.days,
      stop: words?.stop,
    });
    // The camera, baked once with the plan (`map-camera.ts`); the plain
    // follow of before needs none.
    const track = o.camera === 'follow' ? driveTrack(plan, o, ctx.aspect) : null;
    const basemap = driveBasemap(plan, o, ctx.aspect, track, stripBudget());
    // Défilé's ribbon under the map, on the recap's clock alone.
    const ribbon = o.ribbon ? driveRibbon(plan, ctx.calendar ?? []) : null;
    // A stop's name is a place on the legs and on the author's own list — the
    // author's assertion there, the Itinerary's rule — and a day on pictures.
    const follows = o.captionFollows && o.stopsOn !== 'pictures' && route.stops.some((s) => s.name);
    const counterWords = { day: words?.day ?? 'Day', of: words?.of ?? 'of', stop: words?.stop };
    // A set slide shorter than the drive: fitted into it when asked, the whole
    // closure on one scaled clock (`slide-timing.ts`); an Auto slide follows.
    const render: HookRender = {
      seconds: plan.seconds,
      // The badge's place reads the last stop the car passed, while it drives;
      // once it arrives the badge says its own — the leg's label. The counter,
      // when it follows the drive, reads the car at every moment, and past the
      // end the trip told whole.
      content:
        follows || count
          ? (t) => {
              const m = plan.at(t);
              const out: Partial<Record<'caption' | 'label' | 'headline' | 'counter', string>> = {};
              if (follows && !m.over && t < plan.schedule.arrivedAt) {
                const name = route.stops[m.reached]?.name;
                if (name) out.caption = name;
              }
              if (count) Object.assign(out, driveCounterPieces(plan, o, count, t, counterWords));
              return out;
            }
          : undefined,
      paint: (g, t, frame) => paintDrive(g, plan, o, ctx.pictures, scratch, t, frame, basemap, track, ribbon),
      // A streamed ground's tiles, decoded before an export draws (`basemap-strip.ts`).
      ready: basemap?.pyramid ? (t0, t1, signal) => readyGround(basemap, t0, t1, signal) : undefined,
      score: o.sound ? () => driveScore(plan, o) : undefined,
      mixWithSource: o.sound && o.mixWithClip,
    };
    return o.fit ? fitRender(render, ctx.screenSeconds, driveShortestBeat(plan, o)).render : render;
  },
  Sketch: DriveSketch,
  Panel: DrivePanel,
};
