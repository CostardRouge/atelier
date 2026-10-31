import { useEffect, useState, useSyncExternalStore } from 'react';
import type { TripDoc } from '../../shared/roadtrip/trip-types';
import { listWinnowConnections, subscribeWinnowConnections } from '../../shared/sources/winnow/store';
import { WinnowClient } from '../../shared/sources/winnow/client';
import { factsOf, sourcesOf, tripLine, withSeriesFacts, withSeriesSources } from '../../shared/story/sources';
import { factChanges, factsFromCalendars, factText } from '../../shared/story/story-facts';
import type { StoryScript } from '../../shared/story/story-script';
import Button from '../../shared/ui/Button';
import { Readout, SelectField } from '../../shared/ui/Inspector';

type Counting = { state: 'idle' } | { state: 'busy' } | { state: 'done'; changes: [string, number | null, number][] } | { state: 'failed'; message: string };

const whenCounted = (at: string) =>
  new Date(at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

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
  const [counting, setCounting] = useState<Counting>({ state: 'idle' });
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

  const connection = sources.winnow ? (connections.find((c) => c.id === sources.winnow?.source) ?? null) : null;
  // Why Count cannot run yet, in one line; null when it can.
  const blocked = !sources.trip
    ? 'Choose a trip: its days are what is counted.'
    : !trip
      ? null
      : !sources.winnow
        ? 'Choose a Winnow to count on.'
        : !connection
          ? `${sources.winnow.source} is not connected here.`
          : null;

  async function count() {
    if (!script || !trip || !connection) return;
    setCounting({ state: 'busy' });
    try {
      const client = new WinnowClient({ baseUrl: connection.baseUrl, auth: connection.auth });
      const [all, photos] = await Promise.all([
        client.calendar(trip.startDate, trip.endDate),
        client.calendar(trip.startDate, trip.endDate, { mediaType: 'photo' }),
      ]);
      const values = factsFromCalendars(all, photos, { from: trip.startDate, to: trip.endDate });
      const before = script.facts?.values ?? null;
      onScript(withSeriesFacts(script, { at: new Date().toISOString(), from: `${trip.name} · ${connection.id}`, values }));
      setCounting({ state: 'done', changes: before ? factChanges(before, values) : [] });
    } catch (err) {
      setCounting({ state: 'failed', message: err instanceof Error ? err.message : String(err) });
    }
  }

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
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" onClick={() => void count()} disabled={blocked !== null || !trip || counting.state === 'busy'}>
          {counting.state === 'busy' ? 'Counting…' : facts ? 'Count again' : 'Count'}
        </Button>
        {facts ? (
          <span className="min-w-0 truncate font-mono text-2xs text-muted" title={facts.from}>
            counted {whenCounted(facts.at)}
          </span>
        ) : null}
      </div>
      {blocked ? <p className="m-0 text-2xs text-muted leading-relaxed">{blocked}</p> : null}
      {counting.state === 'failed' ? <p className="m-0 text-2xs text-danger leading-relaxed">{counting.message}</p> : null}
      {counting.state === 'done' && facts ? (
        <p className="m-0 text-2xs text-muted leading-relaxed" role="status">
          {counting.changes.length === 0
            ? 'Counted: nothing changed since the last time.'
            : counting.changes.map(([k, a, b]) => `${k} ${a === null ? '' : `${factText(a)} → `}${factText(b)}`).join(' · ')}
        </p>
      ) : null}
      {facts && Object.keys(facts.values).length > 0 ? (
        <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 font-mono text-2xs">
          {Object.entries(facts.values).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{`{${k}}`}</dt>
              <dd className="m-0 text-ink tabular-nums text-right">{factText(v)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {facts ? (
        <p className="m-0 text-2xs text-faint leading-relaxed">Write a fact in braces in your script — a caption, a title, a block&apos;s setting — and the post reads its number.</p>
      ) : null}
      <p className="m-0 text-2xs text-faint leading-relaxed">Shared by every post of the series, and saved in your script.</p>
    </div>
  );
}
