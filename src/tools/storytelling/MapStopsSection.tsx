import { useEffect, useMemo, useState } from 'react';
import type { TripDoc } from '../../shared/roadtrip/trip-types';
import { derivedStops, groupedStops, ownStops, tripPlaces, type MapChoice } from '../../shared/story/trip-map';
import { withSeriesSources } from '../../shared/story/sources';
import { MAX_MAP_STOPS, type MapStopRef, type StoryScript } from '../../shared/story/story-script';
import { dayText } from '../../shared/story/locale';
import StopsMapSheet from '../../shared/roadtrip/hooks/StopsMapSheet';
import { GroupRows } from '../../shared/roadtrip/hooks/group-rows';
import type { GroupOptions } from '../../shared/roadtrip/hooks/stop-clusters';
import type { MapStop } from '../../shared/roadtrip/hooks/stops';
import { loadTowns, townsIfLoaded } from '../../shared/roadtrip/load-gazetteer';
import Button from '../../shared/ui/Button';
import Segmented from '../../shared/ui/Segmented';
import { SelectField } from '../../shared/ui/Inspector';
import IconButton from '../../shared/ui/IconButton';
import { Icons } from '../../shared/ui/icons';

type Source = 'ends' | 'starts' | 'places' | 'own';
const SOURCES: readonly { id: Source; label: string; title: string }[] = [
  { id: 'ends', label: 'Stage ends', title: 'Where each stage starts and ends' },
  { id: 'starts', label: 'Starts', title: 'Where each stage starts' },
  { id: 'places', label: 'Every place', title: 'Every place of the trip' },
  { id: 'own', label: 'Your stops', title: 'Your own list, edited here or on the big map' },
];
const TOOK_LABEL = { ends: 'Stage ends', starts: 'Stage starts', places: 'Every place' } as const;

const key = (s: MapStopRef) => `${s.name}|${s.lat.toFixed(4)}|${s.lon.toFixed(4)}`;

/**
 * Which points the series' map names, and which road it draws (lab
 * https://claude.ai/artifact/Xkq8eD2eUTmuhEw17ZJ5sp, his picks): the trip's
 * stage ends, starts or every place as before — or the author's OWN list,
 * taken over from one of those the moment it is edited, and edited on Trips'
 * big map (`StopsMapSheet`: tap a place to add, drag to move or swap, undo,
 * written on Done). Nearby stops can be drawn as one halt (Trips'
 * `GroupRows`); the road runs from the first stop to the last, so a
 * stopover taken off the list leaves the map (`trip-map.ts`).
 */
export default function MapStopsSection({ trip, script, onScript, lang }: { trip: TripDoc; script: StoryScript; onScript: (s: StoryScript) => void; lang?: 'fr' | 'en' }) {
  const sources = script.sources ?? {};
  const map = sources.map ?? {};
  const own = map.stops ?? null;
  const source: Source = own ? 'own' : (map.points ?? 'ends');
  const choice: MapChoice = useMemo(() => ({ ...(sources.trip?.stages ? { stages: sources.trip.stages } : {}), ...map }), [sources.trip?.stages, map]);
  // The list shown: the author's own, else the one the trip gives under the chosen rule.
  const list = useMemo(() => own ?? derivedStops(trip, choice), [own, trip, choice]);
  const places = useMemo(() => tripPlaces(trip), [trip]);
  const [editing, setEditing] = useState(false);
  const [towns, setTowns] = useState(() => townsIfLoaded());
  useEffect(() => {
    if (towns || map.group?.name !== 'town') return;
    let alive = true;
    void loadTowns().then((t) => alive && setTowns(t.sorted));
    return () => {
      alive = false;
    };
  }, [towns, map.group?.name]);

  const writeMap = (patch: Partial<NonNullable<typeof sources.map>>) => {
    const next = { ...map, ...patch };
    for (const k of Object.keys(next) as (keyof typeof next)[]) if (next[k] === undefined) delete next[k];
    onScript(withSeriesSources(script, { map: next }));
  };
  /** An edit of a derived list makes it the author's own, remembering what it was taken from. */
  const writeOwn = (stops: MapStopRef[]) =>
    writeMap({ stops: stops.slice(0, MAX_MAP_STOPS), took: own ? map.took : source === 'own' ? 'ends' : (source as 'ends' | 'starts' | 'places') });

  const halts = useMemo(() => groupedStops(ownStops({ stops: list }), map.group, towns).length, [list, map.group, towns]);
  const grouping: GroupOptions = { groupKm: map.group?.km ?? 0, groupVisits: map.group?.visits ?? 'consecutive', groupName: map.group?.name ?? 'town' };
  const route = map.route ?? (own ? 'stops' : 'all');
  const listed = new Set(list.map(key));
  const free = places.filter((p) => !listed.has(key(p)));

  // StopsMapSheet speaks Trips' MapStop: ids for the rows, a place id when it is one of the trip's.
  const asMapStops = (stops: readonly MapStopRef[]): MapStop[] =>
    stops.map((s, i) => {
      const place = places.find((p) => key(p) === key(s));
      return { id: `story-${i}-${key(s)}`, name: s.name, lat: s.lat, lon: s.lon, ...(place ? { placeId: place.id } : {}) };
    });
  const fromMapStops = (stops: readonly MapStop[]): MapStopRef[] =>
    stops.map((s) => {
      const place = (s.placeId && places.find((p) => p.id === s.placeId)) || places.find((p) => key(p) === key(s));
      const before = list.find((x) => key(x) === key(s));
      const day = before?.day ?? place?.day;
      return { name: s.name, lat: s.lat, lon: s.lon, ...(day ? { day } : {}) };
    });

  const move = (i: number, j: number) => {
    const next = list.slice();
    const [x] = next.splice(i, 1);
    next.splice(j, 0, x);
    writeOwn(next);
  };
  const insertByDay = (p: MapStopRef) => {
    const next = list.slice();
    const at = p.day ? next.findIndex((s) => (s.day ?? '') > p.day!) : -1;
    if (at < 0) next.push(p);
    else next.splice(at, 0, p);
    writeOwn(next);
  };

  return (
    <div className="flex flex-col gap-2">
      <Segmented<Source>
        options={SOURCES.map((s) => ({ ...s, disabled: s.id === 'own' && !own }))}
        value={source}
        onChange={(id) => {
          if (id === 'own') return;
          // A rule chosen: the derived list again, the own one dropped (« Back to it » with the rule picked).
          writeMap({ points: id, stops: undefined, took: undefined });
        }}
        size="sm"
        fill
        label="What the map names"
      />
      {own ? (
        <p className="m-0 flex items-center justify-between gap-2 rounded-control bg-accent-wash px-2.5 py-1.5 text-xs text-ink-soft">
          <span>Your list{map.took ? `, taken from ${TOOK_LABEL[map.took]}` : ''}.</span>
          <button type="button" className="text-accent-ink underline underline-offset-[3px] cursor-pointer" onClick={() => writeMap({ points: map.took ?? 'ends', stops: undefined, took: undefined })}>
            Back to it
          </button>
        </p>
      ) : (
        <p className="m-0 text-2xs text-muted leading-snug">Take one off, move one or add one, and the list becomes yours: the trip no longer changes it.</p>
      )}
      <ol className="m-0 p-0 list-none max-h-64 overflow-y-auto overscroll-contain rounded-control border border-line bg-paper" aria-label="Stops, in the order the map visits them">
        {list.map((s, i) => (
          <li key={`${key(s)}-${i}`} className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-2 pl-2.5 pr-1 min-h-10 pointer-coarse:min-h-12 border-t border-line first:border-t-0">
            <span className="font-mono text-2xs text-muted text-right">{i + 1}</span>
            <span className="min-w-0 truncate text-sm">
              {s.name || 'Unnamed point'}
              {s.day ? <span className="ml-1.5 font-mono text-3xs text-muted">{dayText(s.day, lang ?? 'en')}</span> : null}
            </span>
            <span className="inline-flex">
              <IconButton label={`Move ${s.name} up`} size="sm" variant="ghost" disabled={i === 0} onClick={() => move(i, i - 1)}>
                {Icons.up}
              </IconButton>
              <IconButton label={`Move ${s.name} down`} size="sm" variant="ghost" disabled={i === list.length - 1} onClick={() => move(i, i + 1)}>
                {Icons.down}
              </IconButton>
              <IconButton label={`Take ${s.name} off the map`} size="sm" variant="ghost" onClick={() => writeOwn(list.filter((_, k) => k !== i))}>
                {Icons.close}
              </IconButton>
            </span>
          </li>
        ))}
        {list.length === 0 ? <li className="px-3 py-3 text-xs text-muted">No stop: the map names nothing.</li> : null}
      </ol>
      {own && list.length
        ? (() => {
            // A stage end taken off leaves the map starting (or ending) further in: say which places it skipped.
            // In the order the trip lived them (a place knows its stage's days, not its own).
            const first = list[0];
            const last = list[list.length - 1];
            const at = (s: MapStopRef) => places.findIndex((p) => key(p) === key(s));
            const [i0, i1] = [at(first), at(last)];
            const before = i0 > 0 ? places.slice(0, i0).filter((p) => !listed.has(key(p))).map((p) => p.name) : [];
            const after = i1 >= 0 ? places.slice(i1 + 1).filter((p) => !listed.has(key(p))).map((p) => p.name) : [];
            const say = (names: string[]) => (names.length > 4 ? `${names.slice(0, 4).join(', ')} and ${names.length - 4} more` : names.join(', '));
            return before.length || after.length ? (
              <p className="m-0 text-2xs text-muted leading-snug">
                Not on your list
                {before.length ? `: before ${first.name}, ${say(before)}` : ''}
                {before.length && after.length ? ';' : ''}
                {after.length ? `${before.length ? '' : ':'} after ${last.name}, ${say(after)}` : ''}. The road starts and ends with your list — add a place here or on the map.
              </p>
            ) : null;
          })()
        : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" onClick={() => setEditing(true)}>
          Edit on the map…
        </Button>
        {free.length ? (
          <span className="flex-1 min-w-[10rem]">
            <SelectField
              label="Add a place of the trip"
              value=""
              options={[{ id: '', label: 'Add a place…' }, ...free.map((p) => ({ id: p.id, label: p.day ? `${p.name} · ${dayText(p.day, lang ?? 'en')}` : p.name }))]}
              onChange={(id) => {
                const p = places.find((x) => x.id === id);
                if (p) insertByDay({ name: p.name, lat: p.lat, lon: p.lon, ...(p.day ? { day: p.day } : {}) });
              }}
            />
          </span>
        ) : null}
      </div>
      <GroupRows
        value={grouping}
        count={{ stops: list.length, halts }}
        townsReady={!!towns}
        onChange={(patch) => {
          const g = { ...grouping, ...patch };
          writeMap({ group: g.groupKm > 0 ? { km: g.groupKm, visits: g.groupVisits, name: g.groupName } : undefined });
        }}
      />
      <div className="flex items-center gap-2">
        <span className="text-sm text-ink-soft w-16">Road</span>
        <SelectField<'stops' | 'all'>
          label="Which part of the recorded road is drawn"
          value={route}
          options={[
            { id: 'stops', label: 'From the first stop to the last' },
            { id: 'all', label: 'The whole recorded trip' },
          ]}
          onChange={(r) => writeMap({ route: r === (own ? 'stops' : 'all') ? undefined : r })}
        />
      </div>
      {editing ? (
        <StopsMapSheet
          stops={asMapStops(list)}
          places={places.map((p) => ({ placeId: p.id, name: p.name, lat: p.lat, lon: p.lon }))}
          title="The series' map"
          grouping={grouping.groupKm > 0 ? grouping : undefined}
          onCancel={() => setEditing(false)}
          onDone={(stops) => {
            setEditing(false);
            writeOwn(fromMapStops(stops));
          }}
        />
      ) : null}
    </div>
  );
}
