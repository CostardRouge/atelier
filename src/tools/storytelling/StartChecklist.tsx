import { useEffect, useState, useSyncExternalStore } from 'react';
import { startSteps, type StartStep } from '../../shared/story/start-steps';
import { withSeriesSources } from '../../shared/story/sources';
import { newScript, type StoryScript } from '../../shared/story/story-script';
import { healthFromAnswer, healthFromError, type SourceHealth } from '../../shared/sources/source-ledger';
import { WinnowClient } from '../../shared/sources/winnow/client';
import { listWinnowConnections, subscribeWinnowConnections } from '../../shared/sources/winnow/store';
import type { TripDoc } from '../../shared/roadtrip/trip-types';
import Button from '../../shared/ui/Button';
import { SelectField } from '../../shared/ui/Inspector';

/**
 * « Getting started » (his « je n'ai pas pu connecter l'instance … ni
 * sélectionner les photos », on atelier.steeve.website): the four things a
 * series needs in THIS browser — a series, a Winnow connected and chosen, a
 * trip present and chosen, a first Count — each ticked, or with the one
 * gesture that fixes it. Shown on the map of subjects until all four are done.
 * Nothing here calls a server unasked: the Winnow is checked on « Check ».
 */
export default function StartChecklist({ script, onScript, onCount }: { script: StoryScript | null; onScript: (s: StoryScript) => void; onCount?: () => void }) {
  const connections = useSyncExternalStore(subscribeWinnowConnections, listWinnowConnections);
  const [trips, setTrips] = useState<TripDoc[] | null>(null);
  useEffect(() => {
    let alive = true;
    void import('../../shared/roadtrip/trip-store')
      .then((m) => m.listTrips())
      .then((all) => alive && setTrips(all))
      .catch(() => alive && setTrips([]));
    return () => {
      alive = false;
    };
  }, []);
  const steps = startSteps({ script, connections, trips });
  const [health, setHealth] = useState<SourceHealth | null>(null);
  if (steps.every((s) => s.done)) return null;

  const chosen = script?.sources?.winnow?.source;
  const connection = connections.find((c) => c.id === chosen) ?? null;
  const check = async () => {
    if (!connection) return;
    setHealth({ state: 'checking', reason: null, latencyMs: null, checkedAt: null });
    const at = Date.now();
    try {
      await new WinnowClient({ baseUrl: connection.baseUrl, auth: connection.auth }).capabilities();
      setHealth(healthFromAnswer(Date.now() - at));
    } catch (err) {
      setHealth(healthFromError(err, new URL(connection.baseUrl).host));
    }
  };

  const action = (step: StartStep) => {
    if (step.done) return null;
    switch (step.id) {
      case 'script':
        return (
          <Button size="sm" variant="primary" onClick={() => onScript(newScript('My series', 'fr'))}>
            New series
          </Button>
        );
      case 'winnow':
        if (!script) return null;
        return connections.length ? (
          <SelectField<string>
            label="The Winnow the series counts on"
            value={chosen && connection ? chosen : ''}
            options={[{ id: '', label: 'Choose a Winnow…' }, ...connections.map((c) => ({ id: c.id, label: c.id }))]}
            onChange={(id) => id && onScript(withSeriesSources(script, { winnow: { source: id } }))}
          />
        ) : (
          <a className="text-sm text-accent-ink font-semibold underline underline-offset-[3px]" href="#/sources">
            Connect a Winnow
          </a>
        );
      case 'trip':
        if (!script || trips === null) return null;
        return trips.length ? (
          <SelectField<string>
            label="The trip the series follows"
            value=""
            options={[{ id: '', label: 'Choose a trip…' }, ...trips.map((t) => ({ id: t.id, label: t.name || 'Untitled trip' }))]}
            onChange={(id) => {
              const t = trips.find((x) => x.id === id);
              if (t) onScript(withSeriesSources(script, { trip: { id: t.id, name: t.name } }));
            }}
          />
        ) : (
          <a className="text-sm text-accent-ink font-semibold underline underline-offset-[3px]" href="#/roadtrip">
            Open Trips
          </a>
        );
      case 'count':
        return onCount && steps[1].done && steps[2].done ? (
          <Button size="sm" onClick={onCount} title="Opens the first post: Count is under its Sources">
            Open a post to Count
          </Button>
        ) : null;
    }
  };

  return (
    <section aria-label="Getting started" className="rounded-panel border border-line bg-surface p-3 flex flex-col gap-2">
      <p className="m-0 font-mono text-2xs uppercase tracking-[0.12em] text-muted">Getting started · in this browser</p>
      <ol className="m-0 p-0 list-none flex flex-col gap-2">
        {steps.map((s, i) => (
          <li key={s.id} className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
            <span
              aria-hidden="true"
              className={`mt-0.5 shrink-0 inline-flex w-5 h-5 items-center justify-center rounded-full text-3xs font-mono ${s.done ? 'bg-ink text-paper' : 'border border-line-strong text-ink-soft'}`}
            >
              {s.done ? '✓' : i + 1}
            </span>
            <div className="flex-1 min-w-[12rem]">
              <p className={`m-0 text-sm ${s.done ? 'text-ink-soft' : 'text-ink font-semibold'}`}>
                {s.title}
                <span className="sr-only">{s.done ? ' — done' : ' — to do'}</span>
              </p>
              <p className="m-0 text-2xs text-muted leading-snug">{s.detail}</p>
              {s.id === 'winnow' && connection ? (
                <p className="m-0 mt-1 flex flex-wrap items-center gap-2 text-2xs leading-snug">
                  <Button size="sm" variant="ghost" onClick={() => void check()}>
                    Check the connection
                  </Button>
                  {health ? (
                    <span className={health.state === 'reachable' ? 'text-ink-soft' : health.state === 'checking' ? 'text-muted' : 'text-danger'}>
                      {health.state === 'reachable' ? `It answers (${health.latencyMs} ms).` : health.state === 'checking' ? 'Asking…' : health.reason}
                    </span>
                  ) : null}
                </p>
              ) : null}
            </div>
            <div className="shrink-0 min-w-0 max-w-full">{action(s)}</div>
          </li>
        ))}
      </ol>
    </section>
  );
}
