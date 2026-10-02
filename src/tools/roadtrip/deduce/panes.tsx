import type { ReactNode } from 'react';
import type { DraftOutcome } from '../../../shared/roadtrip/deduce-draft';
import { stageLabel } from '../../../shared/roadtrip/trip-places';
import type { TripStage } from '../../../shared/roadtrip/trip-types';
import { stageTint } from '../../../shared/roadtrip/stage-ruler';
import Button from '../../../shared/ui/Button';
import Segmented from '../../../shared/ui/Segmented';
import { formatIsoDate, mono, note, num, plural, spanText } from './pieces';
import type { DeduceContext } from './context';

/**
 * The three panes the windows share: Review (exactly what Write will do),
 * Written (what it did, and the way back), and Data (what was read from the
 * instance, and what is wrong with it).
 */

const list = 'm-0 p-0 list-none rounded-paper border border-line';
const row = 'grid grid-cols-[10px_minmax(0,1fr)_auto] gap-2.5 items-start px-3 py-2 border-b border-line last:border-b-0 text-sm';
const pill = 'font-mono text-3xs tracking-[0.1em] uppercase px-1.5 py-0.5 rounded whitespace-nowrap';

function Callout({ tone = 'accent', children }: { tone?: 'accent' | 'ok' | 'warn'; children: ReactNode }) {
  const edge = tone === 'ok' ? 'border-l-ok' : tone === 'warn' ? 'border-l-warn' : 'border-l-accent';
  return <div className={`px-3 py-2 rounded-control border border-line border-l-[3px] ${edge} bg-paper text-xs text-ink-soft`}>{children}</div>;
}

function Heading({ children, count }: { children: ReactNode; count: number }) {
  return (
    <h3 className="m-0 font-serif font-normal text-xl leading-tight flex items-baseline gap-2">
      {children} <span className="font-mono text-xs text-muted tabular-nums">{count}</span>
    </h3>
  );
}

function placesText(stage: TripStage): string {
  return stage.places.map((p) => p.name).join(' · ');
}

export function ReviewPane({ ctx, outcome }: { ctx: DeduceContext; outcome: DraftOutcome }) {
  const { deduction } = ctx;
  return (
    <div className="flex flex-col gap-3">
      {outcome.over.length > 0 && (
        <Callout tone="warn">
          {plural(outcome.over.length, 'stage')} will sit over a stage you drew. The stage you drew is kept as it is; a badge on those days names the later one.
        </Callout>
      )}
      {outcome.adds.length > 0 && (
        <>
          <Heading count={outcome.adds.length}>New stages</Heading>
          <ul className={list}>
            {outcome.adds.map((a, i) => (
              <li key={`${a.stage.startDate}-${i}`} className={row}>
                <span className="w-2.5 h-full min-h-5 rounded-sm" style={{ background: stageTint(a.from.index) }} aria-hidden="true" />
                <span className="min-w-0">
                  <b className="font-medium">{stageLabel(a.stage) || 'Unnamed stage'}</b>
                  <span className={`block ${mono}`}>
                    {spanText(a.stage.startDate, a.stage.endDate)}
                    {a.stage.places.length ? ` · ${placesText(a.stage)}` : ' · no place: its halts are unnamed'}
                  </span>
                </span>
                <span className={`${pill} ${a.from.verb === 'stage' && a.from.overlapping.length ? 'bg-warn-wash text-warn' : 'bg-accent-wash text-accent-ink'}`}>
                  {a.from.verb === 'stage' && a.from.overlapping.length ? 'over' : 'new'}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {outcome.completes.length > 0 && (
        <>
          <Heading count={outcome.completes.length}>Stages of yours, completed</Heading>
          <ul className={list}>
            {outcome.completes.map((c) => (
              <li key={c.stage.id + c.from.key} className={row}>
                <span className="w-2.5 h-full min-h-5 rounded-sm bg-ok" aria-hidden="true" />
                <span className="min-w-0">
                  <b className="font-medium">{stageLabel(c.stage) || 'Unnamed stage'}</b>
                  <span className={`block ${mono}`}>
                    {spanText(c.stage.startDate, c.stage.endDate)} · {placesText(c.stage)} <span className="text-ok">+ {c.places.map((p) => p.name).join(', ')}</span> · after yours
                  </span>
                </span>
                <span className={`${pill} bg-ok-wash text-ok`}>places</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {outcome.left.length > 0 && (
        <details className="group rounded-paper border border-line bg-paper px-3 py-2">
          <summary className="cursor-pointer list-none text-sm text-ink-soft [&::-webkit-details-marker]:hidden">
            Left out <span className="font-mono text-xs text-muted">{outcome.left.length}</span>
          </summary>
          <ul className="m-0 mt-2 p-0 list-none flex flex-col gap-0.5 text-xs text-muted">
            {outcome.left.map((p) => (
              <li key={p.key}>
                {p.label} · {spanText(p.startDate, p.endDate)}
                {p.already ? ' · already in the trip' : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className={`m-0 ${note}`}>
        Each stage written is marked as deduced from {deduction.sourceId}: one undo step, and ⋯ can take them all out again.
      </p>
    </div>
  );
}

export function DonePane({ ctx, outcome }: { ctx: DeduceContext; outcome: DraftOutcome }) {
  const { deduction } = ctx;
  return (
    <div className="flex flex-col gap-3">
      {/* The end of the run is what is remembered of it: one clear line first. */}
      <p className="m-0 flex items-baseline gap-2.5 font-serif text-3xl leading-tight">
        <span className="text-ok" aria-hidden="true">✓</span>
        {[outcome.adds.length ? plural(outcome.adds.length, 'stage') + ' added' : '', outcome.completes.length ? `${outcome.completes.length} completed` : '']
          .filter(Boolean)
          .join(' · ') || 'Nothing written'}
      </p>
      {outcome.adds.length > 0 && (
        <>
          <ul className={list}>
            {outcome.adds.map((a, i) => (
              <li key={`${a.stage.startDate}-${i}`} className={row}>
                <span className="w-2.5 h-full min-h-5 rounded-sm bg-accent" aria-hidden="true" />
                <span className="min-w-0">
                  <b className="font-medium">{stageLabel(a.stage) || 'Unnamed stage'}</b>
                  <span className={`block ${mono}`}>{spanText(a.stage.startDate, a.stage.endDate)}{a.stage.places.length ? ` · ${placesText(a.stage)}` : ''}</span>
                </span>
                <span className={`${pill} bg-accent-wash text-accent-ink`}>deduced</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {outcome.completes.length > 0 && (
        <>
          <Heading count={outcome.completes.length}>Yours, completed</Heading>
          <ul className={list}>
            {outcome.completes.map((c) => (
              <li key={c.stage.id + c.from.key} className={row}>
                <span className="w-2.5 h-full min-h-5 rounded-sm bg-ok" aria-hidden="true" />
                <span className="min-w-0">
                  <b className="font-medium">{stageLabel(c.stage) || 'Unnamed stage'}</b>
                  <span className={`block ${mono}`}>+ {c.places.map((p) => p.name).join(', ')}</span>
                </span>
                <span className={`${pill} bg-ok-wash text-ok`}>places</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className={`m-0 ${note}`}>Run it again after cleaning {deduction.sourceId}: what is already in the trip is recognised by its days.</p>
    </div>
  );
}

export function DataPane({ ctx }: { ctx: DeduceContext }) {
  const { deduction, settings, actions, draft } = ctx;
  const { track, outliers, halts, days, readAt, sourceId } = deduction;
  const blind = days.filter((d) => !d.placed && d.count > 0);
  const unnamed = deduction.chapters.flatMap((c) => c.halts).filter((h) => !h.city);
  const ago = readAt ? Math.max(0, Math.round((Date.now() - readAt) / 60_000)) : null;
  const dates = (list: string[], n = 10) => (
    <div className="flex flex-wrap gap-1">
      {list.slice(0, n).map((d) => (
        <span key={d} className="font-mono text-2xs px-1.5 rounded border border-line-strong text-ink-soft">
          {formatIsoDate(d)}
        </span>
      ))}
      {list.length > n && <span className="font-mono text-2xs px-1.5 text-muted">+ {list.length - n} more</span>}
    </div>
  );
  const Row = ({ title, count, children }: { title: string; count: number; children: ReactNode }) => (
    <div className="flex flex-col gap-1.5 px-3 py-2.5 rounded-paper border border-line bg-paper text-sm">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <b className="font-serif font-normal text-lg leading-tight">{title}</b>
        <span className="font-mono text-xs text-muted tabular-nums">{count}</span>
      </div>
      {children}
    </div>
  );

  return (
    <div className="flex flex-col gap-2.5">
      <p className={`m-0 ${mono}`}>
        {sourceId} · one position per day, no picture fetched · {track ? `${track.points.length} placed, ${track.blind.length} without position` : 'not read yet'}
        {ago !== null ? ` · read ${ago === 0 ? 'just now' : `${ago} min ago`}` : ''}
      </p>
      <Row title="Days without a position" count={blind.length}>
        <span className={note}>
          Pictures that day, none with a position. {settings.bridgeBlind ? 'Inside a halt they stay in it (Fine settings).' : 'They are left out (Fine settings).'} Geotag them in {sourceId} and refresh.
        </span>
        {dates(blind.map((d) => d.date))}
      </Row>
      <Row title="A position far from its neighbours" count={outliers.length}>
        {outliers.length === 0 ? (
          <span className={note}>None: no day sits more than 1 500 km from both the days around it while those are within 150 km of each other.</span>
        ) : (
          <>
            {outliers.map((o) => (
              <span key={o.point.date} className="text-xs">
                {formatIsoDate(o.point.date)} · {num(o.point.count)} pictures {num(Math.round(o.fromPrevious))} km from the day before and {num(Math.round(o.fromNext))} km from the day after, which are {Math.round(o.neighbours)} km apart. A device that kept an old position, most likely.
              </span>
            ))}
            <div className="flex flex-wrap items-center gap-2">
              <Segmented
                size="sm"
                label="What to do with them"
                value={settings.ignoreOutliers ? 'ignore' : 'keep'}
                onChange={(id) => actions.setSettings({ ignoreOutliers: id === 'ignore' })}
                options={[
                  { id: 'ignore', label: 'Ignore them' },
                  { id: 'keep', label: 'Keep them' },
                ]}
              />
              <span className={note}>Kept, each becomes a halt of its own and cuts the stage around it in three.</span>
            </div>
          </>
        )}
      </Row>
      <Row title="Halts without a name" count={unnamed.length}>
        {unnamed.length === 0 ? (
          <span className={note}>Every halt is within reach of a town in the index.</span>
        ) : (
          unnamed.map((h) => (
            <div key={h.leg.startDate} className="flex flex-col gap-1">
              <span className="text-xs">
                {spanText(h.leg.startDate, h.leg.endDate)} · {Math.abs(h.leg.centroid.lat).toFixed(2)}°{h.leg.centroid.lat < 0 ? 'S' : 'N'} {Math.abs(h.leg.centroid.lon).toFixed(2)}°{h.leg.centroid.lon < 0 ? 'W' : 'E'} · {plural(h.leg.dayCount, 'day')}, {num(h.leg.count)} pictures · no town within the index's reach
              </span>
              <span className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={draft.renames[h.leg.startDate] ?? ''}
                  placeholder="Name it for this trip"
                  onChange={(e) => actions.rename(h.leg.startDate, e.target.value)}
                  aria-label={`A name for the halt of ${spanText(h.leg.startDate, h.leg.endDate)}`}
                  className="w-56 max-w-full h-8 px-2.5 rounded-control border border-line-strong bg-surface text-sm max-[820px]:text-base text-ink"
                />
                <span className={note}>Written on the trip only. To name it for every tool, tag the pictures in {sourceId} and refresh.</span>
              </span>
            </div>
          ))
        )}
      </Row>
      <Row title="Halts" count={halts.length}>
        <span className={note}>
          {plural(halts.filter((h) => h.short).length, 'stop on the way', 'stops on the way')} · {plural(halts.filter((h) => h.inferred).length, 'halt')} resting on guessed positions only · {plural(halts.reduce((n, h) => n + h.bridged, 0), 'blind day')} covered
        </span>
      </Row>
      <div className="flex flex-wrap items-center gap-2.5">
        <Button size="sm" onClick={deduction.refresh} disabled={deduction.loading}>
          {deduction.loading ? 'Reading…' : `Refresh from ${sourceId}`}
        </Button>
        <span className={note}>Your answers stay on every chapter whose days did not move.</span>
      </div>
    </div>
  );
}
