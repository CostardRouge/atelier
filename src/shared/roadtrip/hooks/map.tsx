/**
 * **Itinerary** — the places you picked, joined on a map, with their pictures.
 *
 * The engine's third variant, and the first one the AUTHOR composes rather than
 * reads. Défilé reads the calendar, the Route reads the legs; this one reads
 * nothing — a stop is on the map because someone put it there, in the order
 * they chose, holding the picture they gave it. That is what lets it do the one
 * thing the Route refuses: mark a POINT, and say a picture belongs to it.
 *
 * The pen travels stop to stop, waiting at each for as long as the author asks,
 * and the pictures come with it in one of four ways — pinned beside their dot,
 * on a card under the map, filling the frame behind it, or laid out as a
 * contact strip along the edge (`map-paint.ts`). What no mode does is stand
 * anything in for a stop with no picture: an empty stop looks empty.
 *
 * Arithmetic and options: `map-plan.ts`. Drawing: `map-paint.ts`. The picking
 * surface: `map-field.tsx`. This file is the variant's face — what it needs,
 * what it cannot do, and its panel.
 */

import { useState } from 'react';
import PlaceSearchField from '../../map/PlaceSearchField';
import Button from '../../ui/Button';
import Segmented from '../../ui/Segmented';
import {
  FieldRow,
  NumberField,
  RangeField,
  SelectField,
  SwitchRow,
  ToggleField,
  swatchClass,
} from '../../ui/Inspector';
import { formatCoords } from '../trip-places';
import { newId } from '../trip-types';
import { EASINGS, EASING_IDS } from './easing';
import type { HookPanelProps, HookPictureStatus, HookVariant } from './hook-variant';
import MapField from './map-field';
import { paintMap } from './map-paint';
import {
  MAP_DEFAULTS,
  MAP_LIMITS,
  MAP_MAX_STOPS,
  addStop,
  assignPictures,
  formatDistance,
  hopKms,
  mapOptions,
  mapScore,
  mapTiming,
  mapWants,
  moveStop,
  otherPlaces,
  patchStop,
  planarHops,
  removeStop,
  stopPictureKey,
  stopsFromPlaces,
  tripPlaces,
  type MapOptions,
} from './map-plan';
import { Group } from './panel-ui';
import { KIT_IDS, TICK_KITS } from './tick-kits';

export { MAP_DEFAULTS, mapOptions, type MapOptions, type MapStop } from './map-plan';

function MapSketch() {
  return (
    <svg viewBox="0 0 58 22" width="58" height="22" aria-hidden="true" fill="none">
      <path d="M6 16 Q 15 6, 24 11" stroke="rgba(255,255,255,0.85)" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M24 11 Q 33 15, 41 7" stroke="#d9442a" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M41 7 Q 48 4, 53 9" stroke="rgba(255,255,255,0.45)" strokeWidth="1" strokeDasharray="2 2" strokeLinecap="round" />
      <rect x="18" y="2" width="9" height="7" rx="1" fill="#f4efe4" />
      <circle cx="6" cy="16" r="1.6" fill="#fff" />
      <circle cx="24" cy="11" r="1.6" fill="#fff" />
      <circle cx="41" cy="7" r="2" fill="#d9442a" />
    </svg>
  );
}

const resetLink =
  'p-0 border-0 bg-transparent text-xs text-muted cursor-pointer underline underline-offset-[3px] hover:text-accent-ink';
const searchInputClass =
  'font-sans text-sm h-[2.125rem] px-3 border border-line-strong rounded-control bg-surface text-ink focus:outline-none focus:border-accent';

/** One line about the pictures: how many are coming, and what cannot be drawn. */
function pictureLine(
  keys: readonly string[],
  status: HookPictureStatus | undefined,
): { text: string; danger: boolean } | null {
  if (!keys.length || !status) return null;
  const failing = keys.filter((key) => status.problems.has(key));
  if (failing.length === 0) {
    return status.pending > 0
      ? { text: `${status.pending} picture${status.pending === 1 ? '' : 's'} still loading…`, danger: false }
      : null;
  }
  const first = status.problems.get(failing[0]);
  return {
    text:
      failing.length === 1
        ? `One picture cannot be shown: ${first}`
        : `${failing.length} pictures cannot be shown — ${first} (and others)`,
    danger: true,
  };
}

function MapPanel({ options, onChange, ctx, host }: HookPanelProps) {
  const o = mapOptions(options);
  const set = (patch: Partial<MapOptions>) => onChange({ ...o, ...patch });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** What the last pick did, when it did more than the stop it was asked from. */
  const [spread, setSpread] = useState<string | null>(null);

  const places = tripPlaces(ctx.stages);
  const free = otherPlaces(ctx.stages, o.stops);
  const timing = mapTiming(planarHops(o.stops), o);
  const selected = o.stops.find((stop) => stop.id === selectedId) ?? null;
  const selectedIndex = selected ? o.stops.findIndex((stop) => stop.id === selected.id) : -1;
  const withPictures = o.stops.filter((stop) => stop.picture).length;
  const keys = o.stops.flatMap((stop) => {
    const key = stopPictureKey(stop);
    return key ? [key] : [];
  });
  const line = o.media === 'off' ? null : pictureLine(keys, host?.pictureStatus);
  const totalKm = hopKms(o.stops).reduce((sum, km) => sum + km, 0);
  const full = o.stops.length >= MAP_MAX_STOPS;

  const setStops = (stops: MapOptions['stops']) => set({ stops });

  // The picture chooser is the shell's — a panel may not open the Library or
  // ask an instance itself (`hook-variant.ts`).
  const choose = host?.choosePictures
    ? async (index: number) => {
        const stop = o.stops[index];
        if (!stop) return;
        // Including the piece's own day: an itinerary's stops are as often the
        // day being told as the days before it, unlike a sweep's run-up.
        const picked = await host.choosePictures?.(stop.picture ? [stop.picture] : [], {
          includeThisDay: true,
        });
        if (!picked) return;
        const next = assignPictures(o.stops, index, picked);
        setStops(next.stops);
        setSpread(
          picked.length > 1
            ? next.used < picked.length
              ? `${next.used} of ${picked.length} kept pictures landed on stops — the rest had nowhere free to go.`
              : `${next.used} pictures landed on this stop and the ${next.used - 1} after it that had none.`
            : null,
        );
      }
    : null;

  // What the itinerary will really do for this piece — the counter modes'
  // rule: the real reading, or the reason there is none.
  const summary =
    o.stops.length === 0
      ? places.length
        ? 'No stops yet. Click the map, take the trip’s own places, or search for one.'
        : 'No stops yet, and the trip has no place with coordinates to start from. Click the map, or search for a place.'
      : o.stops.length === 1
        ? 'One stop — a map with a single point and no path. Add another to draw a line.'
        : `${o.stops.length} stops · ${withPictures} with a picture · ${formatDistance(totalKm, o.distance === 'off' ? 'km' : o.distance)}${
            timing.total > 0 ? ` · ${timing.total.toFixed(1)}s` : ' · still'
          }`;
  const cut = ctx.screenSeconds !== undefined && timing.total > ctx.screenSeconds;
  const coloursChanged =
    o.pathColor !== MAP_DEFAULTS.pathColor || o.aheadColor !== MAP_DEFAULTS.aheadColor;

  return (
    <div className="flex flex-col gap-4 pl-3 border-l-2 border-line">
      <p className="m-0 text-xs text-ink-soft">{summary}</p>
      {cut && (
        <p className="m-0 text-xs text-accent-ink">
          The hook is on screen for {ctx.screenSeconds?.toFixed(1)}s, shorter than the
          journey — the export would cut it before the pen arrives. Lengthen the hook in
          Export, or shorten the drawing.
        </p>
      )}

      <Group title="Stops">
        <MapField
          stops={o.stops}
          places={free}
          selectedId={selectedId}
          curve={o.curve}
          onSelect={setSelectedId}
          onDrop={(at) => {
            if (full) return;
            const id = newId();
            setStops(addStop(o.stops, at, id));
            setSelectedId(id);
          }}
          onAdopt={(place) => {
            if (full) return;
            const id = newId();
            setStops(addStop(o.stops, place, id));
            setSelectedId(id);
          }}
          onMove={(id, at) => setStops(patchStop(o.stops, id, at))}
        />
        <p className="m-0 text-2xs text-faint">
          Click the map to drop a stop, drag one to move it, click a hollow ring to take one
          of the trip’s own places. Nothing here is fetched — no tiles, no basemap.
        </p>

        {o.stops.length === 0 && places.length > 1 && (
          <Button
            size="sm"
            variant="primary"
            onClick={() => setStops(stopsFromPlaces(places, () => newId()))}
          >
            Take the trip’s {places.length} places
          </Button>
        )}

        {free.length > 0 && !full && (
          <div className="flex flex-wrap gap-1.5">
            {free.slice(0, 12).map((place) => (
              <button
                key={`${place.lat},${place.lon},${place.name}`}
                type="button"
                onClick={() => {
                  const id = newId();
                  setStops(addStop(o.stops, place, id));
                  setSelectedId(id);
                }}
                className="px-2 py-0.5 border border-line rounded-full bg-paper text-2xs text-ink-soft cursor-pointer hover:border-accent hover:text-accent-ink"
              >
                + {place.name || 'Unnamed place'}
              </button>
            ))}
          </div>
        )}

        {o.stops.length > 0 && (
          <ul className="m-0 p-0 list-none flex flex-col border border-line rounded-paper overflow-hidden">
            {o.stops.map((stop, index) => (
              <li key={stop.id} className="border-b border-line last:border-b-0">
                <button
                  type="button"
                  onClick={() => setSelectedId(stop.id === selectedId ? null : stop.id)}
                  aria-pressed={stop.id === selectedId}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 border-0 text-left cursor-pointer ${
                    stop.id === selectedId ? 'bg-accent-wash' : 'bg-paper hover:bg-surface'
                  }`}
                >
                  <span className="flex-none w-5 h-5 grid place-items-center rounded-full bg-frame font-mono text-3xs text-paper">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-ink">
                    {stop.name.trim() || <span className="text-muted">Unnamed stop</span>}
                  </span>
                  <span className="flex-none font-mono text-3xs text-faint">
                    {stop.picture ? 'photo' : '—'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {full && (
          <p className="m-0 text-2xs text-muted">
            {MAP_MAX_STOPS} stops is as many as one opener draws — past that the dots merge
            and every picture is another decode.
          </p>
        )}

        {selected && (
          <div className="flex flex-col gap-2 p-2 border border-line rounded-paper bg-paper">
            <PlaceSearchField
              value={selected.name}
              onChange={(name) => setStops(patchStop(o.stops, selected.id, { name }))}
              onPick={(result) =>
                setStops(
                  patchStop(o.stops, selected.id, {
                    name: result.name,
                    lat: result.lat,
                    lon: result.lon,
                  }),
                )
              }
              placeholder="Kalbarri"
              label={`Name of stop ${selectedIndex + 1}`}
              inputClassName={searchInputClass}
            />
            {/*
              One coordinate a row: two number fields sharing the inspector's
              22rem control column truncated both of them at six decimals.
              These are the keyboard twin of dragging the stop on the map.
            */}
            <FieldRow label="Latitude">
              <NumberField
                label="Latitude"
                value={selected.lat}
                min={-90}
                max={90}
                step={0.0001}
                unit="°N"
                onChange={(lat) => setStops(patchStop(o.stops, selected.id, { lat }))}
              />
            </FieldRow>
            <FieldRow label="Longitude" hint={formatCoords(selected)}>
              <NumberField
                label="Longitude"
                value={selected.lon}
                min={-180}
                max={180}
                step={0.0001}
                unit="°E"
                onChange={(lon) => setStops(patchStop(o.stops, selected.id, { lon }))}
              />
            </FieldRow>
            <FieldRow
              label="Picture"
              align="start"
              hint={
                selected.picture
                  ? selected.picture.ref.name
                  : o.media === 'off'
                    ? 'The pictures are switched off below, so nothing a stop holds is drawn.'
                    : 'One picture, shown as the pen reaches this stop.'
              }
            >
              <div className="flex flex-wrap items-center gap-2">
                {choose ? (
                  <Button size="sm" onClick={() => void choose(selectedIndex)}>
                    {selected.picture ? 'Change…' : 'Pick…'}
                  </Button>
                ) : (
                  <span className="text-xs text-muted">The picture chooser is not available here.</span>
                )}
                {selected.picture && (
                  <button
                    type="button"
                    onClick={() =>
                      setStops(o.stops.map((s) => (s.id === selected.id ? { ...s, picture: undefined } : s)))
                    }
                    className={resetLink}
                  >
                    Remove picture
                  </button>
                )}
              </div>
            </FieldRow>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                disabled={selectedIndex <= 0}
                onClick={() => setStops(moveStop(o.stops, selected.id, -1))}
              >
                ↑ Earlier
              </Button>
              <Button
                size="sm"
                disabled={selectedIndex < 0 || selectedIndex >= o.stops.length - 1}
                onClick={() => setStops(moveStop(o.stops, selected.id, 1))}
              >
                ↓ Later
              </Button>
              <button
                type="button"
                onClick={() => {
                  setStops(removeStop(o.stops, selected.id));
                  setSelectedId(null);
                }}
                className={`${resetLink} ml-auto text-danger hover:text-danger`}
              >
                Remove stop
              </button>
            </div>
          </div>
        )}

        {spread && <p className="m-0 text-2xs text-muted">{spread}</p>}
        {line && (
          <p
            className={`m-0 text-xs ${line.danger ? 'text-danger' : 'text-muted'}`}
            role={line.danger ? 'alert' : undefined}
          >
            {line.text}
          </p>
        )}
      </Group>

      <Group title="Pictures">
        <FieldRow
          label="Shown as"
          align="start"
          hint={
            o.media === 'off'
              ? 'The map alone. Nothing a stop holds is fetched or drawn.'
              : o.media === 'pin'
                ? 'A small picture beside each stop’s dot, arriving as the pen lands. Several are on screen at once.'
                : o.media === 'card'
                  ? 'One picture under the map, cross-fading, with the stop’s name under it.'
                  : o.media === 'backdrop'
                    ? 'The picture fills the frame behind the map, dimmed so the line survives. A stop with no picture lets your own picture back through.'
                    : 'Every stop’s picture in a row along the edge; the ones still ahead are held back.'
          }
        >
          <SelectField
            label="How a stop’s picture is presented"
            value={o.media}
            onChange={(media) => set({ media })}
            options={[
              { id: 'off', label: 'Not at all' },
              { id: 'pin', label: 'Pinned at the stop' },
              { id: 'card', label: 'On a card under the map' },
              { id: 'backdrop', label: 'Filling the frame behind' },
              { id: 'strip', label: 'A strip along the edge' },
            ]}
          />
        </FieldRow>
        {o.media !== 'off' && withPictures === 0 && (
          <p className="m-0 text-xs text-accent-ink">
            No stop holds a picture yet — pick one on a stop above, and it appears here.
          </p>
        )}
        {/*
          One picture at a time, and the pen comes to rest on a stop that has
          none: the frame ends empty. Nothing stands in for a missing picture —
          a card captioned "Exmouth" showing Coral Bay is the one thing this
          tool must not do — so the honest fix is to say it here.
        */}
        {(o.media === 'card' || o.media === 'backdrop') &&
          withPictures > 0 &&
          o.stops.length > 0 &&
          !o.stops[o.stops.length - 1].picture && (
            <p className="m-0 text-xs text-accent-ink">
              The pen comes to rest on {o.stops[o.stops.length - 1].name.trim() || 'the last stop'},
              which has no picture — so the opener ends showing{' '}
              {o.media === 'backdrop' ? 'your own picture again' : 'nothing'}. Nothing stands in for
              a stop that holds none.
            </p>
          )}
        {o.media !== 'off' && o.media !== 'backdrop' && (
          <FieldRow label="Size">
            <RangeField
              label="Picture size"
              min={MAP_LIMITS.mediaSize.min}
              max={MAP_LIMITS.mediaSize.max}
              step={0.05}
              value={o.mediaSize}
              onChange={(mediaSize) => set({ mediaSize })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          </FieldRow>
        )}
        {o.media !== 'off' && (
          <FieldRow
            label="Arrival"
            hint={o.mediaFade === 0 ? 'A picture appears on the frame the pen lands.' : undefined}
          >
            <RangeField
              label="How long a picture takes to arrive"
              min={MAP_LIMITS.mediaFade.min}
              max={MAP_LIMITS.mediaFade.max}
              step={0.05}
              value={o.mediaFade}
              onChange={(mediaFade) => set({ mediaFade })}
              format={(v) => (v === 0 ? 'at once' : `${v.toFixed(2)}s`)}
            />
          </FieldRow>
        )}
        {(o.media === 'pin' || o.media === 'card' || o.media === 'strip') && (
          <FieldRow label="Mount" hint={o.mediaFrame === 'paper' ? 'Paper around the picture — and where a card’s name goes.' : undefined}>
            <Segmented
              size="sm"
              fill
              label="How a picture is mounted"
              value={o.mediaFrame}
              onChange={(mediaFrame) => set({ mediaFrame })}
              options={[
                { id: 'paper', label: 'On paper' },
                { id: 'bare', label: 'Bare' },
              ]}
            />
          </FieldRow>
        )}
        {o.media === 'pin' && (
          <FieldRow label="Pins">
            <ToggleField
              label="Pins stay once they have appeared"
              checked={o.pinKeep}
              onChange={(pinKeep) => set({ pinKeep })}
            >
              They stay as the pen goes on
            </ToggleField>
          </FieldRow>
        )}
        {o.media === 'pin' && (
          <FieldRow label="Stem" hint="A hairline from the picture to the dot it belongs to.">
            <ToggleField label="A stem to the dot" checked={o.pinStem} onChange={(pinStem) => set({ pinStem })}>
              A stem to the dot
            </ToggleField>
          </FieldRow>
        )}
        {o.media === 'backdrop' && (
          <FieldRow label="Dim" hint="How far the picture behind is darkened, so the line stays legible over it.">
            <RangeField
              label="Backdrop dim"
              min={MAP_LIMITS.mediaDim.min}
              max={MAP_LIMITS.mediaDim.max}
              step={0.05}
              value={o.mediaDim}
              onChange={(mediaDim) => set({ mediaDim })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          </FieldRow>
        )}
      </Group>

      <Group title="Frame">
        <FieldRow label="Where">
          <Segmented
            size="sm"
            fill
            label="Where the map sits"
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
            label="Which side the map keeps to"
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
            label="Map size"
            min={MAP_LIMITS.size.min}
            max={MAP_LIMITS.size.max}
            step={0.05}
            value={o.size}
            onChange={(size) => set({ size })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </FieldRow>
        <FieldRow label="Plate" hint={o.plate ? undefined : 'A translucent panel behind the map, for a map over a busy picture.'}>
          <ToggleField label="Plate behind the map" checked={o.plate} onChange={(plate) => set({ plate })}>
            Behind the map
          </ToggleField>
        </FieldRow>
        {o.plate && (
          <FieldRow label="Plate depth">
            <RangeField
              label="Plate opacity"
              min={MAP_LIMITS.plateOpacity.min}
              max={MAP_LIMITS.plateOpacity.max}
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
            {o.plateColor !== MAP_DEFAULTS.plateColor && (
              <button type="button" onClick={() => set({ plateColor: MAP_DEFAULTS.plateColor })} className={resetLink}>
                Reset
              </button>
            )}
          </FieldRow>
        )}
        <FieldRow label="Grid" hint={o.graticule ? 'Whole degrees of latitude and longitude, faint behind the line.' : undefined}>
          <ToggleField label="A lat/lon grid" checked={o.graticule} onChange={(graticule) => set({ graticule })}>
            A chart’s grid
          </ToggleField>
        </FieldRow>
      </Group>

      <Group title="Path">
        <FieldRow label="Width">
          <RangeField
            label="Line width"
            min={MAP_LIMITS.lineWidth.min}
            max={MAP_LIMITS.lineWidth.max}
            step={0.05}
            value={o.lineWidth}
            onChange={(lineWidth) => set({ lineWidth })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </FieldRow>
        <FieldRow label="Bow" hint={o.curve === 0 ? 'Straight lines between the stops.' : 'Each hop bows away from the straight line — a travel map’s idiom, and what keeps a there-and-back from drawing one line twice.'}>
          <RangeField
            label="How far a hop bows"
            min={MAP_LIMITS.curve.min}
            max={MAP_LIMITS.curve.max}
            step={0.02}
            value={o.curve}
            onChange={(curve) => set({ curve })}
            format={(v) => (v === 0 ? 'straight' : `${Math.round(v * 100)}%`)}
          />
        </FieldRow>
        <FieldRow label="Colours" hint="The path travelled, then the stops still ahead.">
          <input
            type="color"
            value={o.pathColor}
            onChange={(e) => set({ pathColor: e.target.value })}
            className={swatchClass}
            aria-label="Path colour"
          />
          <input
            type="color"
            value={o.aheadColor}
            onChange={(e) => set({ aheadColor: e.target.value })}
            className={swatchClass}
            aria-label="Colour of what is still ahead"
          />
          {coloursChanged && (
            <button
              type="button"
              onClick={() => set({ pathColor: MAP_DEFAULTS.pathColor, aheadColor: MAP_DEFAULTS.aheadColor })}
              className={resetLink}
            >
              Reset
            </button>
          )}
        </FieldRow>
        <FieldRow
          label="Ahead"
          hint={
            o.aheadStyle === 'hidden'
              ? 'Nothing ahead of the pen is drawn: the map grows as it travels.'
              : 'The stops still to come are already there, so the shape of the journey is readable from the first frame.'
          }
        >
          <Segmented
            size="sm"
            fill
            label="How what is still ahead is drawn"
            value={o.aheadStyle}
            onChange={(aheadStyle) => set({ aheadStyle })}
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
          <ToggleField label="A dot at every stop" checked={o.dots} onChange={(dots) => set({ dots })}>
            A dot at every stop
          </ToggleField>
        </FieldRow>
        {o.dots && (
          <FieldRow label="Dot size">
            <RangeField
              label="Dot size"
              min={MAP_LIMITS.dotSize.min}
              max={MAP_LIMITS.dotSize.max}
              step={0.1}
              value={o.dotSize}
              onChange={(dotSize) => set({ dotSize })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          </FieldRow>
        )}
        {o.dots && (
          <FieldRow label="Numbers" hint={o.numbers ? 'Each dot carries its place in the order.' : undefined}>
            <ToggleField label="Number the stops" checked={o.numbers} onChange={(numbers) => set({ numbers })}>
              1, 2, 3 on the dots
            </ToggleField>
          </FieldRow>
        )}
        <FieldRow
          label="Names"
          hint={
            o.labels === 'none'
              ? undefined
              : o.labels === 'passed'
                ? 'A name appears as the pen reaches its stop and stays — the itinerary reads as a list being written. One that would sit on another name, or on a picture, is left out.'
                : 'The names you gave the stops. One that would sit on another name, or on a picture, is left out.'
          }
        >
          <SelectField
            label="Which stops carry their name"
            value={o.labels}
            onChange={(labels) => set({ labels })}
            options={[
              { id: 'none', label: 'None' },
              { id: 'ends', label: 'The first and the last' },
              { id: 'current', label: 'Where the pen is' },
              { id: 'passed', label: 'Everywhere it has been' },
              { id: 'all', label: 'Every stop' },
            ]}
          />
        </FieldRow>
        {o.labels !== 'none' && (
          <FieldRow label="Name size">
            <RangeField
              label="Name size"
              min={MAP_LIMITS.labelSize.min}
              max={MAP_LIMITS.labelSize.max}
              step={0.1}
              value={o.labelSize}
              onChange={(labelSize) => set({ labelSize })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          </FieldRow>
        )}
        <FieldRow
          label="Trip’s places"
          hint={
            free.length === 0
              ? 'Every located place of the trip is already a stop.'
              : `The ${free.length} other located ${free.length === 1 ? 'place' : 'places'} of the trip, as faint marks behind the itinerary.`
          }
        >
          <ToggleField
            label="Show the trip’s other places"
            checked={o.context}
            onChange={(context) => set({ context })}
          >
            Faint, behind
          </ToggleField>
        </FieldRow>
      </Group>

      <Group title="Motion">
        <SwitchRow
          label="Travel the itinerary, stop by stop"
          name="Draw the journey"
          checked={o.draw}
          onChange={(draw) => set({ draw })}
          hint={o.draw ? undefined : 'The whole itinerary is there from the first frame, and the hook takes no time of its own.'}
        />
        {o.draw && (
          <FieldRow label="Travel" hint="Shared out by distance, so the pen keeps one pace — a long hop takes longer than a short one.">
            <RangeField
              label="Travelling time"
              min={MAP_LIMITS.drawSeconds.min}
              max={MAP_LIMITS.drawSeconds.max}
              step={0.1}
              value={o.drawSeconds}
              onChange={(drawSeconds) => set({ drawSeconds })}
              format={(v) => `${v.toFixed(1)}s`}
            />
          </FieldRow>
        )}
        {o.draw && (
          <FieldRow
            label="Wait"
            hint={
              o.dwellSeconds === 0
                ? 'The pen does not stop — with pictures on, each one is on screen only while the next hop runs.'
                : 'The pen waits at each stop it reaches, including the last, which is what gives a picture time to be looked at.'
            }
          >
            <RangeField
              label="Wait at each stop"
              min={MAP_LIMITS.dwellSeconds.min}
              max={MAP_LIMITS.dwellSeconds.max}
              step={0.05}
              value={o.dwellSeconds}
              onChange={(dwellSeconds) => set({ dwellSeconds })}
              format={(v) => (v === 0 ? 'none' : `${v.toFixed(2)}s`)}
            />
          </FieldRow>
        )}
        {o.draw && (
          <FieldRow label="Motion" hint={`${EASINGS[o.easing].hint} — on every hop.`}>
            <SelectField
              label="How the pen travels each hop"
              value={o.easing}
              onChange={(easing) => set({ easing })}
              options={EASING_IDS.map((id) => ({ id, label: EASINGS[id].label }))}
            />
          </FieldRow>
        )}
        {o.draw && (
          <FieldRow label="Hold first" hint={o.delaySeconds > 0 ? 'The map sits on its first stop this long before the pen leaves.' : undefined}>
            <RangeField
              label="Hold on the first stop"
              min={MAP_LIMITS.delaySeconds.min}
              max={MAP_LIMITS.delaySeconds.max}
              step={0.1}
              value={o.delaySeconds}
              onChange={(delaySeconds) => set({ delaySeconds })}
              format={(v) => (v === 0 ? 'none' : `${v.toFixed(1)}s`)}
            />
          </FieldRow>
        )}
        {o.draw && (
          <FieldRow label="Pen">
            <Segmented
              size="sm"
              fill
              label="What travels along the path"
              value={o.pen}
              onChange={(pen) => set({ pen })}
              options={[
                { id: 'dot', label: 'A dot' },
                { id: 'plane', label: 'A plane' },
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
              : 'The straight-line sum between the stops the pen has reached — never a road distance. It counts up with the pen.'
          }
        >
          <Segmented
            size="sm"
            fill
            label="The distance travelled"
            value={o.distance}
            onChange={(distance) => set({ distance })}
            options={[
              { id: 'off', label: 'Off' },
              { id: 'km', label: 'km' },
              { id: 'mi', label: 'mi' },
            ]}
          />
        </FieldRow>
        <FieldRow
          label="In the badge"
          hint={
            o.nameInBadge
              ? 'The badge’s caption says the stop the pen is at, and the last one once it rests. A stop with no name leaves the caption as it was.'
              : 'The badge keeps its own caption — the leg this day belongs to.'
          }
        >
          <ToggleField
            label="The badge names the stop the pen is at"
            checked={o.nameInBadge}
            onChange={(nameInBadge) => set({ nameInBadge })}
          >
            The caption follows the pen
          </ToggleField>
        </FieldRow>
      </Group>

      <Group title="Sound">
        <SwitchRow
          label="Tick at every stop the pen reaches"
          name="Tick at every stop"
          checked={o.sound}
          onChange={(sound) => set({ sound })}
          hint={
            !o.draw
              ? 'The ticks follow the pen: switch the travelling on for them to play.'
              : 'A deeper tick as it leaves, a low seat where it comes to rest. A photo, or a clip recorded without sound, takes the ticks as its sound.'
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
              min={MAP_LIMITS.tickPitch.min}
              max={MAP_LIMITS.tickPitch.max}
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
              min={MAP_LIMITS.tickVolume.min}
              max={MAP_LIMITS.tickVolume.max}
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

export const mapVariant: HookVariant = {
  id: 'map',
  name: 'Itinerary',
  tagline: 'Places you pick, joined on a map',
  defaults: { ...MAP_DEFAULTS },
  // `stages` for the trip's own places — as landmarks to adopt and as the
  // faint context layer. `media: 'day'` is what makes the shell resolve and
  // decode the pictures the stops name (`use-hook-pictures.ts`).
  needs: { stages: true, places: true, media: 'day' },
  // It MAY replace the picture: the backdrop mode does. `owns` declares what a
  // variant is allowed to do, not what it does on every piece — the scrub,
  // which only covers the frame while it sweeps, reads it the same way.
  owns: 'frame',
  // Never unmet: an itinerary with no stops is not a refusal, it is an empty
  // one, and the panel is where it gets filled.
  wantsPictures(options) {
    return mapWants(mapOptions(options));
  },
  prepare(options, ctx) {
    const o = mapOptions(options);
    if (o.stops.length === 0) return { seconds: 0 };
    const timing = mapTiming(planarHops(o.stops), o);
    const context = o.context ? otherPlaces(ctx.stages, o.stops) : [];
    return {
      seconds: timing.total,
      // The caption names the stop the pen is at — the last one once it
      // rests, where the pen really is. A stop's name is the author's own
      // assertion, so saying it claims nothing the document cannot support;
      // blanking it at the end would only flicker. A stop with no name leaves
      // the badge's own caption alone rather than emptying it.
      content: o.nameInBadge
        ? (t) => {
            let at = 0;
            for (let i = 1; i < timing.arrivals.length; i++) {
              if (t + 1e-9 >= timing.arrivals[i]) at = i;
            }
            const name = o.stops[at]?.name.trim();
            return name ? { caption: name } : {};
          }
        : undefined,
      paint: (g, t, frame) => paintMap(g, o, timing, context, ctx.pictures, t, frame),
      score: o.sound && o.draw
        ? () => mapScore(timing, { kit: o.kit, pitch: o.tickPitch }, o.tickVolume)
        : undefined,
      mixWithSource: o.sound && o.mixWithClip,
    };
  },
  Sketch: MapSketch,
  Panel: MapPanel,
};
