/**
 * Picking the author's own stops — ONE editor for every map opener.
 *
 * The Itinerary grew it; Virée asked for the same thing the day its car was
 * allowed to drive between places the legs do not name (2026-09-28, the
 * maintainer: «le même picker … peut-être un composant commun»). So the
 * picking map, the trip's places as chips, the list and a stop's own settings
 * are drawn here once, over the shared model in `stops.ts`, and each opener
 * only says what a stop's picture does in its own drawing.
 *
 * **The list keeps EVERY stop, in a box about ten rows tall that scrolls**
 * (2026-10-07, the maintainer, reversing «show the first five»): a stop's
 * picture is chosen HERE, so no stop may be out of reach — but a hundred
 * rows must not be the whole inspector either. A click on a row opens the
 * stop's POPOVER: where it is on a mini map, its name and a search, its
 * state written like any place of the suite («Sydney, NSW», in full, or the
 * name alone), its position, its picture, and its place in the order. The
 * ↑ / ↓ there and the grip on each row are the two ways to reorder; the big
 * map (`StopsMapSheet`) is where places are FOUND.
 *
 * Every gesture keeps its keyboard twin: the map is the quick way, never the
 * only way — chips for the trip's places, a search field, two number fields
 * for a position, buttons for the order.
 */

import { useEffect, useRef, useState } from 'react';
import PlaceSearchField from '../../map/PlaceSearchField';
import Button from '../../ui/Button';
import { Icons } from '../../ui/icons';
import { FieldRow, NumberField, SelectField, TextField } from '../../ui/Inspector';
import { AnchoredPopover } from '../../ui/OverflowMenu';
import { revealInScroller } from '../../ui/reveal';
import { useListReorder } from '../../ui/use-list-reorder';
import { loadGazetteer } from '../load-gazetteer';
import { PLACE_STYLE_OPTIONS, countryName, majorityCountry, type PlaceWritingTrip } from '../place-style';
import { formatCoords } from '../trip-places';
import { newId, type PlaceStyle } from '../trip-types';
import type { HookPanelHost, HookPlace } from './hook-variant';
import type { GroupOptions } from './stop-clusters';
import { fillFromIndex, fillSummary, lackingLine, lacksIndexFacts } from './stop-index';
import { insertAtHop, swapAt, type StopDrop } from './stop-drop';
import MapField from './map-field';
import { resetLink } from './panel-ui';
import {
  addStop,
  adoptSearch,
  assignPictures,
  moveStop,
  moveStopTo,
  numeralScale,
  patchStop,
  removeStop,
  replaceStopPlace,
  stopText,
  stopsFromPlaces,
  type MapStop,
  type StopStyle,
} from './stops';

const searchInputClass =
  'font-sans text-sm h-[2.125rem] px-3 border border-line-strong rounded-control bg-surface text-ink focus:outline-none focus:border-accent';

export interface StopsEditorProps {
  stops: readonly MapStop[];
  onChange: (stops: MapStop[]) => void;
  /** Every located place of the trip, in the order it was lived. */
  places: readonly HookPlace[];
  /** The trip's located places that are not stops yet — chips and landmarks. */
  free: readonly HookPlace[];
  /** How far a hop bows on the picking map, as the opener draws it (0 = straight). */
  curve: number;
  /** How the opener writes its stops' names (`stopText`), and the trip's writing behind it. */
  placeStyle: StopStyle;
  writing?: PlaceWritingTrip;
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
  /** How the opener groups nearby places — the big map marks the stops that merge. */
  grouping?: GroupOptions;
}

/** A stop's own writing, as the popover's select offers it: the opener's, or one of its own. */
type OwnStyle = PlaceStyle | 'opener';

export default function StopsEditor({
  stops,
  onChange,
  places,
  free,
  curve,
  placeStyle,
  writing,
  host,
  pictureHint,
  picturesOffHint = 'This opener shows no picture right now, so nothing a stop holds is drawn.',
  title,
  grouping,
}: StopsEditorProps) {
  // The open stop IS the popover: closing it selects nothing. (The selection
  // used to outlive the editor's unmount so a tab switch did not lose it; a
  // popover that reopened on its own, anchored to a row not yet measured,
  // would be the worse surprise.)
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** What the last pick did, when it did more than the stop it was asked from. */
  const [spread, setSpread] = useState<string | null>(null);
  /** The town index being read for a fill, and what the last fill did. */
  const [filling, setFilling] = useState(false);
  const [fillNote, setFillNote] = useState<{ text: string; left: number } | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());

  const selected = stops.find((stop) => stop.id === selectedId) ?? null;
  const selectedIndex = selected ? stops.findIndex((stop) => stop.id === selected.id) : -1;
  // The trip's country bounds the search, as it does on the legs.
  const country = majorityCountry([...stops, ...places].map((p) => p.countryCode));

  // One drop, one write: the list is DRAWN in the held order while the grip
  // travels, and the document changes once, on the drop.
  const reorder = useListReorder<HTMLUListElement>((id, to) => {
    onChange(moveStopTo(stops, id, to));
  });
  const rows = reorder.held ? moveStopTo(stops, reorder.held.key, reorder.held.to) : stops;

  // The row of the stop picked on the small map is brought into view in the
  // list's own box — never the inspector's (`revealInScroller`).
  useEffect(() => {
    if (!selectedId) return;
    revealInScroller(rowRefs.current.get(selectedId), { scroller: listRef.current });
  }, [selectedId]);

  const add = (at: HookPlace) => {
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
        const next = await host.editStopsOnMap?.(stops, { title, grouping });
        if (!next) return;
        onChange(next);
        if (selectedId && !next.some((stop) => stop.id === selectedId)) setSelectedId(null);
      }
    : null;

  const written = (stop: HookPlace) => stopText(stop, placeStyle, writing);

  // The stops that do not say their state learn it from the shipped town
  // index, where it answers without doubt (`stop-index.ts`) — one change, so
  // one undo. The index is read on the click, never before.
  const lacking = stops.filter(lacksIndexFacts).length;
  // The list as it stands NOW: the index's first read takes a while, and a
  // stop added or moved meanwhile must not be written back over by the fill.
  const latest = useRef({ stops, onChange });
  useEffect(() => {
    latest.current = { stops, onChange };
  });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const fillStates = async () => {
    setFilling(true);
    setFillNote(null);
    try {
      const cities = await loadGazetteer();
      if (!alive.current) return;
      const out = fillFromIndex(latest.current.stops, cities);
      if (out.filled) latest.current.onChange(out.places);
      setFillNote({ text: fillSummary(out.filled, out.left), left: out.left });
    } catch {
      if (alive.current) setFillNote({ text: 'The town index could not be read here.', left: -1 });
    } finally {
      if (alive.current) setFilling(false);
    }
  };

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
        onReorder={(id, drop) => onChange(reordered(stops, id, drop))}
      />
      <p className="m-0 text-2xs text-faint">
        {openMap
          ? 'The big map is for finding places — tap one, two, three. This small one is the drawing as it goes out: click to drop a stop; drop a stop on another to swap them, on a line to insert it, elsewhere to move it; a hollow ring is one of the trip’s own places.'
          : 'Click the map to drop a stop; drop a stop on another to swap them, on a line to insert it, elsewhere to move it; click a hollow ring to take one of the trip’s own places. Nothing here is fetched — no tiles, no basemap.'}
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
              + {written(place) || 'Unnamed place'}
            </button>
          ))}
        </div>
      )}

      {stops.length > 0 && (
        // Ten rows, then the box scrolls on its own: every stop stays a
        // click away (its picture is chosen here) without a hundred rows
        // taking the whole inspector. No `touch-action` on the box — only
        // the grip claims a gesture, a finger anywhere else scrolls it.
        <ul
          ref={(el) => {
            listRef.current = el;
            reorder.listRef.current = el;
          }}
          className="m-0 p-0 list-none flex flex-col border border-line rounded-paper overflow-y-auto overscroll-contain max-h-[21rem]"
          aria-label={`${stops.length} stops, in order`}
        >
          {rows.map((stop, index) => {
            const lifted = reorder.held?.key === stop.id;
            const on = lifted || stop.id === selectedId;
            const name = written(stop).trim();
            return (
              <li
                key={stop.id}
                ref={(el) => {
                  if (el) rowRefs.current.set(stop.id, el);
                  else rowRefs.current.delete(stop.id);
                }}
                data-reorder-row={stop.id}
                className={`flex-none flex items-stretch border-b border-line last:border-b-0 ${
                  on ? 'bg-accent-wash' : 'bg-paper hover:bg-surface'
                } ${lifted ? 'shadow-[inset_3px_0_0_var(--color-accent)]' : ''}`}
              >
                <span
                  {...reorder.grip(stop.id, index)}
                  title="Drag to reorder"
                  aria-hidden="true"
                  className={`flex-none w-5 pointer-coarse:w-9 grid place-items-center select-none [&>svg]:w-3.5 [&>svg]:h-3.5 ${
                    lifted ? 'cursor-grabbing text-accent-ink' : 'cursor-grab text-faint hover:text-ink-soft'
                  }`}
                >
                  {Icons.grip}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedId(stop.id === selectedId ? null : stop.id)}
                  aria-pressed={stop.id === selectedId}
                  aria-label={`Stop ${index + 1}${name ? `, ${name}` : ''} — its settings`}
                  className="min-w-0 flex-1 flex items-center gap-2 pl-0.5 pr-2 py-1.5 border-0 bg-transparent text-left cursor-pointer"
                >
                  <span className="flex-none w-5 h-5 grid place-items-center rounded-full bg-frame font-mono text-3xs text-on-media">
                    <span style={{ fontSize: `${numeralScale(index + 1)}em` }}>{index + 1}</span>
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-ink">
                    {name || <span className="text-muted">Unnamed stop</span>}
                  </span>
                  {/* A picture glyph where the stop holds one, nothing where it does not. */}
                  {stop.picture && (
                    <span
                      className="flex-none inline-flex text-muted [&>svg]:w-3.5 [&>svg]:h-3.5"
                      title={stop.picture.ref.name}
                      aria-label={`Picture: ${stop.picture.ref.name}`}
                    >
                      {Icons.image}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/*
        The fill's answer stands while the list is as it left it; the verb
        comes back after an edit — or at once when the index could not be read.
      */}
      {fillNote && (fillNote.left === lacking || fillNote.left < 0) && (
        <p className="m-0 text-2xs text-muted">{fillNote.text}</p>
      )}
      {stops.length > 0 && lacking > 0 && fillNote?.left !== lacking && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-muted">
          <span>{lackingLine(lacking, stops.length)}</span>
          <button type="button" disabled={filling} onClick={() => void fillStates()} className={resetLink}>
            {filling ? 'Reading the town index…' : 'Fill from the town index'}
          </button>
        </div>
      )}

      {selected && (
        <AnchoredPopover
          anchorRect={() => rowRefs.current.get(selected.id)?.getBoundingClientRect() ?? null}
          onClose={() => setSelectedId(null)}
          side="below"
          align="start"
          within={listRef}
          role="dialog"
          label={`Stop ${selectedIndex + 1}`}
          className="w-[22rem] max-w-[calc(100vw-1.5rem)] p-3"
        >
          <StopPopover
            stop={selected}
            index={selectedIndex}
            count={stops.length}
            stops={stops}
            free={free}
            curve={curve}
            placeStyle={placeStyle}
            writing={writing}
            country={country}
            pictureHint={pictureHint}
            picturesOffHint={picturesOffHint}
            onChange={onChange}
            onChoose={choose ? () => void choose(selectedIndex) : null}
            onClose={() => setSelectedId(null)}
          />
        </AnchoredPopover>
      )}

      {spread && <p className="m-0 text-2xs text-muted">{spread}</p>}
    </div>
  );
}

/**
 * One stop's settings, in the order the maintainer asked for them: where it
 * is, its name and a search, its state and how it is written, its position,
 * its picture, its place in the order.
 */
function StopPopover({
  stop,
  index,
  count,
  stops,
  free,
  curve,
  placeStyle,
  writing,
  country,
  pictureHint,
  picturesOffHint,
  onChange,
  onChoose,
  onClose,
}: {
  stop: MapStop;
  index: number;
  count: number;
  stops: readonly MapStop[];
  free: readonly HookPlace[];
  curve: number;
  placeStyle: StopStyle;
  writing?: PlaceWritingTrip;
  country: string;
  pictureHint: string | null;
  picturesOffHint: string;
  onChange: (stops: MapStop[]) => void;
  onChoose: (() => void) | null;
  onClose: () => void;
}) {
  const patch = (p: Partial<Omit<MapStop, 'id'>>) => onChange(patchStop(stops, stop.id, p));
  const own: OwnStyle = stop.style ?? 'opener';
  const openerStyle = placeStyle === 'trip' ? (writing?.placeStyle?.badge ?? 'name') : placeStyle;
  const openerWord = PLACE_STYLE_OPTIONS.find((o) => o.id === openerStyle)?.label ?? 'Name only';

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-2xs text-muted">
          Stop {index + 1} of {count}
        </span>
        <button type="button" onClick={onClose} aria-label="Close" className={resetLink}>
          Close
        </button>
      </div>
      {/*
        Where it is, among the others: a click on empty ground MOVES this
        stop there, a hollow ring gives it that landmark's place and name,
        a drag moves a marker. Nothing here adds a stop — the field above
        the list does that.
      */}
      <MapField
        stops={stops}
        places={free}
        selectedId={stop.id}
        curve={curve}
        onSelect={() => {}}
        onDrop={(at) => patch(at)}
        onAdopt={(place) => onChange(replaceStopPlace(stops, stop.id, place))}
        onMove={(id, at) => onChange(patchStop(stops, id, at))}
        onReorder={(id, drop) => onChange(reordered(stops, id, drop))}
      />
      <PlaceSearchField
        value={stop.name}
        onChange={(name) => patch({ name })}
        onPick={(result) => onChange(stops.map((s) => (s.id === stop.id ? adoptSearch(s, result) : s)))}
        placeholder="Kalbarri"
        label={`Name of stop ${index + 1}`}
        inputClassName={searchInputClass}
        country={country}
        countryLabel={country ? countryName(country) : undefined}
      />
      <FieldRow
        label="State"
        hint={
          stop.state?.trim()
            ? `Written “${stopText(stop, placeStyle, writing)}”${own === 'opener' ? ` — ${openerWord}, as the opener writes every stop.` : '.'}`
            : 'The state or region, so the name can be written “Sydney, NSW” like the trip’s own places. A search fills it, and so does “Fill from the town index” under the list.'
        }
      >
        <TextField
          label="State"
          value={stop.state ?? ''}
          placeholder="New South Wales"
          onChange={(state) => patch(state.trim() ? { state } : { state: undefined })}
        />
      </FieldRow>
      {stop.state?.trim() && (
        <FieldRow label="Written">
          <SelectField<OwnStyle>
            label="How this stop is written"
            value={own}
            onChange={(style) => patch({ style: style === 'opener' ? undefined : style })}
            options={[
              { id: 'opener', label: `As the opener (${openerWord})` },
              ...PLACE_STYLE_OPTIONS.map((o) => ({ id: o.id, label: `${o.label} — ${o.example}` })),
            ]}
          />
        </FieldRow>
      )}
      {/*
        One coordinate a row: two number fields sharing the inspector's
        control column truncated both of them at six decimals. These are the
        keyboard twin of dragging the stop on the map.
      */}
      <FieldRow label="Latitude">
        <NumberField label="Latitude" value={stop.lat} min={-90} max={90} step={0.0001} unit="°N" onChange={(lat) => patch({ lat })} />
      </FieldRow>
      <FieldRow label="Longitude" hint={formatCoords(stop)}>
        <NumberField label="Longitude" value={stop.lon} min={-180} max={180} step={0.0001} unit="°E" onChange={(lon) => patch({ lon })} />
      </FieldRow>
      <FieldRow label="Picture" align="start" hint={stop.picture ? stop.picture.ref.name : pictureHint ?? picturesOffHint}>
        <div className="flex flex-wrap items-center gap-2">
          {onChoose ? (
            <Button size="sm" onClick={onChoose}>
              {stop.picture ? 'Change…' : 'Pick…'}
            </Button>
          ) : (
            <span className="text-xs text-muted">The picture chooser is not available here.</span>
          )}
          {stop.picture && (
            <button type="button" onClick={() => patch({ picture: undefined })} className={resetLink}>
              Remove picture
            </button>
          )}
        </div>
      </FieldRow>
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={index <= 0} onClick={() => onChange(moveStop(stops, stop.id, -1))}>
          ↑ Earlier
        </Button>
        <Button size="sm" disabled={index < 0 || index >= count - 1} onClick={() => onChange(moveStop(stops, stop.id, 1))}>
          ↓ Later
        </Button>
        <button
          type="button"
          onClick={() => {
            onChange(removeStop(stops, stop.id));
            onClose();
          }}
          className={`${resetLink} ml-auto text-danger hover:text-danger`}
        >
          Remove stop
        </button>
      </div>
    </div>
  );
}

/**
 * The opener's row for how it writes its stops — like the trip's badges, or
 * one writing of its own. Shared by the Itinerary's and Virée's panels, under
 * their Names row.
 */
export function StopStyleRow({
  value,
  writing,
  onChange,
}: {
  value: StopStyle;
  writing?: PlaceWritingTrip;
  onChange: (style: StopStyle) => void;
}) {
  const tripStyle = writing?.placeStyle?.badge ?? 'name';
  const tripWord = PLACE_STYLE_OPTIONS.find((o) => o.id === tripStyle);
  return (
    <FieldRow
      label="Written as"
      hint="A stop that knows its state is written like the trip’s own places — a stop may depart from this in its own settings."
    >
      <SelectField<StopStyle>
        label="How the stops’ names are written"
        value={value}
        onChange={onChange}
        options={[
          { id: 'trip', label: `As the trip’s badges${tripWord ? ` (${tripWord.example})` : ''}` },
          ...PLACE_STYLE_OPTIONS.map((o) => ({ id: o.id, label: `${o.label} — ${o.example}` })),
        ]}
      />
    </FieldRow>
  );
}

/** A stop dropped on another (swap) or on a line (insert), as the field read it (`stop-drop.ts`). */
function reordered(stops: readonly MapStop[], id: string, drop: Exclude<StopDrop, { kind: 'move' }>): MapStop[] {
  const index = stops.findIndex((stop) => stop.id === id);
  return drop.kind === 'swap' ? swapAt(stops, index, drop.index) : insertAtHop(stops, index, drop.hop);
}
