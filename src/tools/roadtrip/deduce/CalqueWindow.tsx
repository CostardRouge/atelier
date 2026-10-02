import { GRAINS } from '../../../shared/roadtrip/deduce-grain';
import { draftOutcome, type Proposal } from '../../../shared/roadtrip/deduce-draft';
import { stageLabel } from '../../../shared/roadtrip/trip-places';
import Segmented from '../../../shared/ui/Segmented';
import DeduceFrieze, { type FriezeItem } from './DeduceFrieze';
import FineSettings from './FineSettings';
import ProposalEditor from './ProposalEditor';
import { GoButton, VerbPill, VerbSelect, legend, mono, note, plural, quoted, spanText } from './pieces';
import type { DeduceContext, DeduceIntent } from './context';

/**
 * B · Le calque — what the pictures say, laid under the stages the author
 * already has. The intent comes first: fill the gaps, enrich my stages (the
 * default, the maintainer's call), or show everything. It is a FILTER over
 * the one draft, never a second proposal set: a line ticked here is the
 * card's verb in the grain and the answer in the paquet.
 */

export const INTENTS: { id: DeduceIntent; title: string; hint: string }[] = [
  { id: 'fill', title: 'Fill the gaps', hint: 'Only the days none of your stages covers. Never touches a stage of yours.' },
  { id: 'enrich', title: 'Enrich my stages', hint: 'Add the places your pictures saw to the stages you drew. No new stage.' },
  { id: 'all', title: 'Show everything', hint: 'Every deduced stage beside yours, with the safe verb picked for each.' },
];

export function visibleUnder(intent: DeduceIntent, proposals: readonly Proposal[]): Proposal[] {
  if (intent === 'fill') return proposals.filter((p) => p.relation === 'free' || (p.relation === 'partial' && p.free.length > 0));
  if (intent === 'enrich') return proposals.filter((p) => p.target !== null && p.extra.length > 0);
  return [...proposals];
}

/** The verb a tick means under this intent. */
function tickedVerb(intent: DeduceIntent, p: Proposal) {
  if (intent === 'fill') return p.relation === 'free' ? 'stage' : 'trim';
  if (intent === 'enrich') return 'into';
  return p.safe === 'skip' ? (p.target && p.extra.length ? 'into' : 'stage') : p.safe;
}

function sentence(p: Proposal): string {
  switch (p.verb) {
    case 'into':
      return `Add ${p.extra.map((h) => h.city?.name ?? 'an unnamed halt').join(', ')} to “${stageLabel(p.target!)}”`;
    case 'trim':
      return `Add ${plural(p.free.length, 'stage')} in the free days of “${p.label}”`;
    case 'split':
      return `Add ${plural(p.halts.length, 'stage')}, one per halt of “${p.label}”`;
    case 'skip':
      return `Leave “${p.label}”`;
    default:
      return p.overlapping.length ? `Add, over ${quoted(p.overlapping)}, “${p.label}”` : `Add “${p.label}”`;
  }
}

export default function CalqueWindow({ ctx }: { ctx: DeduceContext }) {
  const { trip, deduction, draft, settings, actions, hot, editing, intent, flash } = ctx;
  const { proposals, days, sourceId } = deduction;
  const visible = visibleUnder(intent, proposals);
  const counts = Object.fromEntries(INTENTS.map((i) => [i.id, visibleUnder(i.id, proposals).length])) as Record<DeduceIntent, number>;
  const colour = (p: Proposal) => (p.verb === 'into' ? 'var(--color-ok)' : p.verb === 'stage' && p.overlapping.length ? 'var(--color-warn)' : 'var(--color-accent)');

  const lane: FriezeItem[] = visible.flatMap((p) => {
    const on = p.verb !== 'skip';
    const o = draftOutcome([p], draft, { sourceId, now: 0 });
    const spans = p.verb === 'trim' ? p.free : [{ startDate: p.startDate, endDate: p.endDate }];
    return spans.map((s) => ({
      key: p.key,
      startDate: s.startDate,
      endDate: s.endDate,
      fill: on && p.verb !== 'into' ? colour(p) : null,
      stroke: colour(p),
      dashed: !on,
      label: p.verb === 'into' ? `+${o.completes[0]?.places.length ?? 0} places` : p.label,
      ink: on && p.verb !== 'into' ? 'var(--color-surface)' : colour(p),
    }));
  });

  return (
    <>
      <div role="group" aria-label="What you want" className="grid grid-cols-3 gap-2 max-[520px]:grid-cols-1">
        {INTENTS.map((i) => (
          <button
            key={i.id}
            type="button"
            aria-pressed={intent === i.id}
            onClick={() => actions.setIntent(i.id)}
            className={`flex flex-col gap-0.5 px-3 py-2.5 rounded-paper border text-left cursor-pointer bg-paper ${
              intent === i.id ? 'border-ink shadow-[inset_0_0_0_1px_var(--color-ink)] bg-surface' : 'border-line-strong hover:border-ink-soft'
            }`}
          >
            <b className="font-serif font-normal text-lg leading-tight">{i.title}</b>
            <span className="text-2xs text-muted leading-snug">{i.hint}</span>
            <span className="font-mono text-2xs text-ink-soft">{plural(counts[i.id], 'proposal')}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className={legend}>Grain</span>
        <Segmented size="sm" label="Grain" value={settings.grain} onChange={(id) => actions.setSettings({ grain: id })} options={GRAINS.map((g) => ({ id: g.id, label: g.short }))} />
      </div>

      <DeduceFrieze
        days={days}
        hot={hot}
        barHeight={26}
        lanes={[
          { items: trip.stages.map((s) => ({ startDate: s.startDate, endDate: s.endDate, fill: 'var(--color-ink)', label: stageLabel(s) || 'unnamed' })) },
          { items: lane },
        ]}
      />
      <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-2xs text-ink-soft">
        <span><i className="inline-block w-4 h-2 rounded-sm mr-1 align-middle bg-ink" />your stages</span>
        <span><i className="inline-block w-4 h-2 rounded-sm mr-1 align-middle bg-accent" />new stage</span>
        <span><i className="inline-block w-4 h-2 rounded-sm mr-1 align-middle border border-ok" />places into a stage of yours</span>
        <span><i className="inline-block w-4 h-2 rounded-sm mr-1 align-middle bg-warn" />would sit over one of yours</span>
        <span><i className="inline-block w-4 h-2 rounded-sm mr-1 align-middle border border-dashed border-faint" />left out</span>
      </div>

      {visible.length === 0 ? (
        <p className="m-0 text-sm text-muted">
          {intent === 'fill' ? 'Your stages already cover every day with a position.' : intent === 'enrich' ? 'Your stages already name every place your pictures saw.' : 'Nothing deduced.'}
        </p>
      ) : (
        <ul className="m-0 p-0 list-none flex flex-col">
          {visible.map((p) => {
            const on = p.verb !== 'skip';
            return (
              <li key={p.key} data-key={p.key} onMouseEnter={() => actions.setHot(p.key)} onMouseLeave={() => actions.setHot(null)} className={`border-b border-line last:border-b-0 ${flash === p.key ? 'shadow-[inset_0_0_0_2px_var(--color-accent)] rounded-md' : ''}`}>
                <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] gap-2.5 items-center py-2 text-sm">
                  <input
                    type="checkbox"
                    className="w-4 h-4 accent-ink"
                    checked={on}
                    onChange={(e) => actions.answer(p.key, e.target.checked ? tickedVerb(intent, p) : 'skip')}
                    aria-label={sentence(p)}
                  />
                  <span className={`min-w-0 ${on ? '' : 'opacity-50'}`}>
                    {sentence(p)}
                    <span className={`block ${mono} normal-case`}>
                      {spanText(p.startDate, p.endDate)} · {p.halts.map((h) => h.city?.name ?? 'unnamed').join(' · ')}
                      {p.doubtful ? ' · stops on the way or guesses only' : ''}
                      {p.unnamed.length ? <span className="text-warn"> · {plural(p.unnamed.length, 'unnamed halt')}</span> : null}
                      {p.edited ? <span className="text-accent-ink"> · edited</span> : null}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5">
                      {intent === 'all' && p.verbs.length > 2 && <VerbSelect p={p} onChange={(v) => actions.answer(p.key, v)} />}
                      <GoButton tab="paquet" label="Deck" onClick={() => actions.goTo('paquet', p.key)} />
                    </span>
                  </span>
                  <VerbPill p={p} />
                  <button
                    type="button"
                    aria-expanded={editing === p.key}
                    aria-label={`Edit ${p.label}`}
                    onClick={() => actions.setEditing(editing === p.key ? null : p.key)}
                    className={`w-7 h-7 rounded-md border bg-transparent cursor-pointer text-sm ${editing === p.key ? 'border-line-strong text-ink' : 'border-transparent text-muted hover:border-line-strong hover:text-ink'}`}
                  >
                    ✎
                  </button>
                </div>
                {editing === p.key && (
                  <div className="pb-3">
                    <ProposalEditor p={p} draft={draft} actions={actions} first={trip.startDate} last={trip.endDate} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className={`m-0 ${note}`}>A tick is the same verb the grain's card shows and the paquet answers; unticked, the chapter is left — never dropped from the trip.</p>

      <FineSettings settings={settings} actions={actions} />
    </>
  );
}
