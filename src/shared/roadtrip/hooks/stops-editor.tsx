/**
 * Picking the author's own stops — ONE editor for every map opener.
 *
 * The Itinerary grew it; Virée asked for the same thing the day its car was
 * allowed to drive between places the legs do not name (2026-09-28, the
 * maintainer: «le même picker … peut-être un composant commun»). So the
 * picking map, the trip's places as chips, the list, the selected stop's name
 * (typed, or found through the opt-in lookup), its coordinates, its order and
 * its picture are drawn here once, over the shared model in `stops.ts`, and
 * each opener only says what a stop's picture does in its own drawing.
 *
 * Every gesture keeps its keyboard twin: the map is the quick way, never the
 * only way — chips for the trip's places, a search field, two number fields
 * for a position, buttons for the order.
 */

import { useState } from 'react';
import PlaceSearchField from '../../map/PlaceSearchField';
import Button from '../../ui/Button';
import { Icons } from '../../ui/icons';
import { FieldRow, NumberField } from '../../ui/Inspector';
import { formatCoords } from '../trip-places';
import { newId } from '../trip-types';
import type { HookPanelHost } from './hook-variant';
import MapField from './map-field';
import { resetLink } from './panel-ui';
import {
  addStop,
  assignPictures,
  moveStop,
  numeralScale,
  patchStop,
  removeStop,
  stopsFromPlaces,
  type MapStop,
} from './stops';

const searchInputClass =
  'font-sans text-sm h-[2.125rem] px-3 border border-line-strong rounded-control bg-surface text-ink focus:outline-none focus:border-accent';

/**
 * The stop last selected, kept past the editor's unmount: the inspector
 * unmounts it whenever another tab opens, and coming back to find the stop
 * being edited deselected read as work lost. A stop's id is a UUID, so the
 * one remembered id can never select a stop of another piece — and it is the
 * same stop whichever map opener shows the list, since the list follows the
 * author from one to the other.
 */
let lastSelectedStop: string | null = null;

type Place = { name: string; lat: number; lon: number };

export interface StopsEditorProps {
  stops: readonly MapStop[];
  onChange: (stops: MapStop[]) => void;
  /** Every located place of the trip, in the order it was lived. */
  places: readonly Place[];
  /** The trip's located places that are not stops yet — chips and landmarks. */
  free: readonly Place[];
  /** How far a hop bows on the picking map, as the opener draws it (0 = straight). */
  curve: number;
  host?: HookPanelHost;
  /**
   * What a stop's picture does in this opener, one line — or null when the
   * opener shows no picture right now, and the row then says so instead.
   */
  pictureHint: string | null;
  /** Said under the row when `pictureHint` is null. */
  picturesOffHint?: string;
  /** The opener's name, for the big map's title. */
  title?: string;
}

export default function StopsEditor({
  stops,
  onChange,
  places,
  free,
  curve,
  host,
  pictureHint,
  picturesOffHint = 'This opener shows no picture right now, so nothing a stop holds is drawn.',
  title,
}: StopsEditorProps) {
  const [selectedId, selectStop] = useState<string | null>(() => lastSelectedStop);
  const setSelectedId = (id: string | null) => {
    lastSelectedStop = id;
    selectStop(id);
  };
  /** What the last pick did, when it did more than the stop it was asked from. */
  const [spread, setSpread] = useState<string | null>(null);

  const selected = stops.find((stop) => stop.id === selectedId) ?? null;
  const selectedIndex = selected ? stops.findIndex((stop) => stop.id === selected.id) : -1;

  const add = (at: Place) => {
    const id = newId();
    onChange(addStop(stops, at, id));
    setSelectedId(id);
  };

  // The picture chooser is the shell's — a panel may not open the Library or
  // ask an instance itself (`hook-variant.ts`).
  const choose = host?.choosePictures
    ? async (index: number) => {
        const stop = stops[index];
        if (!stop) return;
        // Including the piece's own day: a stop is as often the day being
        // told as the days before it. And a stop is the author's, so a picture
        // from later in the trip is kept.
        const picked = await host.choosePictures?.(stop.picture ? [stop.picture] : [], {
          includeThisDay: true,
          keepsLater: true,
        });
        if (!picked) return;
        const next = assignPictures(stops, index, picked);
        onChange(next.stops);
        setSpread(
          picked.length > 1
            ? next.used < picked.length
              ? `${next.used} of ${picked.length} kept pictures landed on stops — the rest had nowhere free to go.`
              : `${next.used} pictures landed on this stop and the ${next.used - 1} after it that had none.`
            : null,
        );
      }
    : null;

  // The big map is the shell's (it reads the town index, and may fetch tiles
  // when asked); the result replaces the list the way any edit here does.
  const openMap = host?.editStopsOnMap
    ? async () => {
        const next = await host.editStopsOnMap?.(stops, { title });
        if (!next) return;
        onChange(next);
        if (lastSelectedStop && !next.some((stop) => stop.id === lastSelectedStop)) setSelectedId(null);
      }
    : null;

  return (
    <div className="flex flex-col gap-2">
      {openMap && (
        <Button
          size="sm"
          variant={stops.length === 0 ? 'primary' : 'default'}
          icon={Icons.map}
          onClick={() => void openMap()}
        >
          {stops.length === 0 ? 'Pick them on a map…' : 'Open the map…'}
        </Button>
      )}
      <MapField
        stops={stops}
        places={free}
        selectedId={selectedId}
        curve={curve}
        onSelect={setSelectedId}
        onDrop={(at) => add({ name: '', ...at })}
        onAdopt={add}
        onMove={(id, at) => onChange(patchStop(stops, id, at))}
      />
      <p className="m-0 text-2xs text-faint">
        {openMap
          ? 'The big map is for finding places — tap one, two, three. This small one is the drawing as it goes out: click to drop a stop, drag one to move it, a hollow ring is one of the trip’s own places.'
          : 'Click the map to drop a stop, drag one to move it, click a hollow ring to take one of the trip’s own places. Nothing here is fetched — no tiles, no basemap.'}
      </p>

      {stops.length === 0 && places.length > 1 && (
        <Button size="sm" variant="primary" onClick={() => onChange(stopsFromPlaces(places, () => newId()))}>
          Take the trip’s {places.length} places
        </Button>
      )}

      {free.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {free.slice(0, 12).map((place) => (
            <button
              key={`${place.lat},${place.lon},${place.name}`}
              type="button"
              onClick={() => add(place)}
              className="px-2 py-0.5 border border-line rounded-full bg-paper text-2xs text-ink-soft cursor-pointer hover:border-accent hover:text-accent-ink"
            >
              + {place.name || 'Unnamed place'}
            </button>
          ))}
        </div>
      )}

      {stops.length > 0 && (
        <ul className="m-0 p-0 list-none flex flex-col border border-line rounded-paper overflow-hidden">
          {stops.map((stop, index) => (
            <li key={stop.id} className="border-b border-line last:border-b-0">
              <button
                type="button"
                onClick={() => setSelectedId(stop.id === selectedId ? null : stop.id)}
                aria-pressed={stop.id === selectedId}
                className={`w-full flex items-center gap-2 px-2 py-1.5 border-0 text-left cursor-pointer ${
                  stop.id === selectedId ? 'bg-accent-wash' : 'bg-paper hover:bg-surface'
                }`}
              >
                <span className="flex-none w-5 h-5 grid place-items-center rounded-full bg-frame font-mono text-3xs text-on-media">
                  <span style={{ fontSize: `${numeralScale(index + 1)}em` }}>{index + 1}</span>
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

      {selected && (
        <div className="flex flex-col gap-2 p-2 border border-line rounded-paper bg-paper">
          <PlaceSearchField
            value={selected.name}
            onChange={(name) => onChange(patchStop(stops, selected.id, { name }))}
            onPick={(result) =>
              onChange(
                patchStop(stops, selected.id, {
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
              onChange={(lat) => onChange(patchStop(stops, selected.id, { lat }))}
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
              onChange={(lon) => onChange(patchStop(stops, selected.id, { lon }))}
            />
          </FieldRow>
          <FieldRow
            label="Picture"
            align="start"
            hint={selected.picture ? selected.picture.ref.name : pictureHint ?? picturesOffHint}
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
                    onChange(stops.map((s) => (s.id === selected.id ? { ...s, picture: undefined } : s)))
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
              onClick={() => onChange(moveStop(stops, selected.id, -1))}
            >
              ↑ Earlier
            </Button>
            <Button
              size="sm"
              disabled={selectedIndex < 0 || selectedIndex >= stops.length - 1}
              onClick={() => onChange(moveStop(stops, selected.id, 1))}
            >
              ↓ Later
            </Button>
            <button
              type="button"
              onClick={() => {
                onChange(removeStop(stops, selected.id));
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
    </div>
  );
}
