import { useEffect, useState, useSyncExternalStore } from 'react';
import type { TripDoc } from '../../shared/roadtrip/trip-types';
import { listWinnowConnections, subscribeWinnowConnections } from '../../shared/sources/winnow/store';
import { factsOf, sourcesOf, tripLine, withSeriesSources } from '../../shared/story/sources';
import type { StoryScript } from '../../shared/story/story-script';
import { Readout, SelectField } from '../../shared/ui/Inspector';

const NONE = '';

/**
 * Where the series' data comes from: a trip of Trips on this device and a
 * connected Winnow, named in the script (`sources.ts`). Choosing them is the
 * first step; the map, the counts and the wall read them in the next ones.
 * The trips are read from this browser's own store, loaded when the panel
 * opens so the tool's chunk does not carry the trip model.
 */
export default function SourcesPanel({
  postId,
  script,
  onScript,
}: {
  postId: string;
  script: StoryScript | null;
  onScript: (script: StoryScript) => void;
}) {
  const [trips, setTrips] = useState<TripDoc[] | null>(null);
  const connections = useSyncExternalStore(subscribeWinnowConnections, listWinnowConnections);
  useEffect(() => {
    let alive = true;
    void import('../../shared/roadtrip/trip-store')
      .then((m) => m.listTrips())
      .then((all) => {
        if (alive) setTrips(all);
      })
      .catch(() => {
        if (alive) setTrips([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!script) return <Readout muted>Load your script first: the sources are kept in it.</Readout>;

  const sources = sourcesOf(script, postId);
  const trip = sources.trip ? (trips?.find((t) => t.id === sources.trip?.id) ?? null) : null;
  const facts = factsOf(script, postId);
  const tripOptions = [
    { id: NONE, label: trips === null ? 'Reading trips…' : trips.length ? 'No trip' : 'No trip on this device' },
    ...(trips ?? []).map((t) => ({ id: t.id, label: t.name || 'Untitled trip' })),
    // A trip named in the script but gone from this device stays selectable by its name.
    ...(sources.trip && trips && !trip ? [{ id: sources.trip.id, label: `${sources.trip.name || 'A trip'} (not here)` }] : []),
  ];
  const winnowOptions = [
    { id: NONE, label: connections.length ? 'No Winnow' : 'No Winnow connected' },
    ...connections.map((c) => ({ id: c.id, label: c.id })),
    ...(sources.winnow && !connections.some((c) => c.id === sources.winnow?.source)
      ? [{ id: sources.winnow.source, label: `${sources.winnow.source} (not connected)` }]
      : []),
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="text-sm text-ink-soft w-16">Trip</span>
          <SelectField
            label="Trip the map is drawn from"
            value={sources.trip?.id ?? NONE}
            options={tripOptions}
            onChange={(id) => {
              const picked = trips?.find((t) => t.id === id);
              onScript(withSeriesSources(script, { trip: picked ? { id: picked.id, name: picked.name } : null }));
            }}
          />
        </div>
        {trip ? (
          <p className="m-0 text-2xs text-muted leading-relaxed">{tripLine(trip)}</p>
        ) : sources.trip && trips ? (
          <p className="m-0 text-2xs text-danger leading-relaxed">
            « {sources.trip.name} » is not in this browser. Open Trips here and import it, or choose another.
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="text-sm text-ink-soft w-16">Winnow</span>
          <SelectField
            label="Winnow the numbers are counted on"
            value={sources.winnow?.source ?? NONE}
            options={winnowOptions}
            onChange={(id) => onScript(withSeriesSources(script, { winnow: id ? { source: id } : null }))}
          />
        </div>
        {connections.length === 0 ? (
          <p className="m-0 text-2xs text-muted leading-relaxed">
            <a className="text-accent-ink font-semibold underline underline-offset-[3px]" href="#/sources">
              Connect a Winnow
            </a>{' '}
            — your server&apos;s, with an app token.
          </p>
        ) : null}
      </div>
      {facts && Object.keys(facts.values).length > 0 ? (
        <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 font-mono text-2xs">
          {Object.entries(facts.values).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd className="m-0 text-ink tabular-nums text-right">{v.toLocaleString('fr-FR')}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <p className="m-0 text-2xs text-faint leading-relaxed">Shared by every post of the series, and saved in your script.</p>
    </div>
  );
}
