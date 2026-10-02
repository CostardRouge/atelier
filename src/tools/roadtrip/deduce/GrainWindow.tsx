import { GRAINS, grainAt, grainIndex } from '../../../shared/roadtrip/deduce-grain';
import { draftOutcome, type Proposal } from '../../../shared/roadtrip/deduce-draft';
import Button from '../../../shared/ui/Button';
import DeduceFrieze from './DeduceFrieze';
import DeduceMap from './DeduceMap';
import FineSettings from './FineSettings';
import ProposalEditor from './ProposalEditor';
import { Flags, GoButton, HaltChips, VerbPill, VerbSelect, mono, note, num, plural, proposalColour, spanText } from './pieces';
import type { DeduceContext } from './context';

/**
 * A · Le grain — one slider for the whole trip, the stages as cards, the map
 * collée beside them while the list scrolls. Each card has its own verb and
 * its own pencil, and two hand-offs: *Deck ›* opens the paquet on it,
 * *Against yours ›* the calque, where it overlaps a stage of the author's.
 */

const kbd = 'font-mono text-3xs font-semibold px-1 rounded border border-line-strong text-muted';

function Card({ p, ctx }: { p: Proposal; ctx: DeduceContext }) {
  const { actions, draft, editing, trip, flash } = ctx;
  const skipped = p.verb === 'skip';
  return (
    <article
      data-key={p.key}
      tabIndex={0}
      aria-label={p.label}
      onMouseEnter={() => actions.setHot(p.key)}
      onMouseLeave={() => actions.setHot(null)}
      onFocus={() => actions.setHot(p.key)}
      className={`flex flex-col gap-1.5 px-3 py-2.5 rounded-paper border bg-paper focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent hover:border-ink-soft focus-within:border-ink-soft ${
        skipped ? 'border-dashed border-line-strong' : 'border-line-strong'
      } ${p.already && skipped ? 'opacity-60' : ''} ${flash === p.key ? 'shadow-[inset_0_0_0_2px_var(--color-accent)]' : ''}`}
    >
      <div className="grid grid-cols-[10px_minmax(0,1fr)_auto] gap-2.5 items-start">
        <span className="w-2.5 min-h-7 h-full rounded-sm" style={{ background: proposalColour(p) }} aria-hidden="true" />
        <div className="min-w-0">
          <span className={`block text-base leading-tight font-medium ${skipped ? 'opacity-50' : ''}`}>{p.label}</span>
          <span className={`block mt-0.5 ${mono}`}>
            {spanText(p.startDate, p.endDate)} · {p.dayCount} d · {plural(p.halts.length, 'place')} · {num(p.count)} pictures
          </span>
        </div>
        <VerbPill p={p} />
      </div>
      <div className={skipped ? 'opacity-50' : ''}>
        <HaltChips p={p} draft={draft} />
      </div>
      <Flags p={p} />
      <div className="flex flex-wrap items-center gap-1.5">
        {!(p.already && skipped && p.verbs.length <= 2) && <VerbSelect p={p} onChange={(v) => actions.answer(p.key, v)} />}
        <Button size="sm" variant="ghost" aria-expanded={editing === p.key} onClick={() => actions.setEditing(editing === p.key ? null : p.key)}>
          {editing === p.key ? 'Close' : 'Edit'}
        </Button>
        <span className="ml-auto inline-flex gap-0.5">
          <GoButton tab="paquet" label="Deck" onClick={() => actions.goTo('paquet', p.key)} />
          {p.overlapping.length > 0 && <GoButton tab="calque" label="Against yours" onClick={() => actions.goTo('calque', p.key)} />}
        </span>
      </div>
      {editing === p.key && <ProposalEditor p={p} draft={draft} actions={actions} first={trip.startDate} last={trip.endDate} />}
    </article>
  );
}

export default function GrainWindow({ ctx }: { ctx: DeduceContext }) {
  const { deduction, draft, settings, actions, hot } = ctx;
  const { proposals, days, points, track, halts, land, sourceId } = deduction;
  const grain = GRAINS[grainIndex(settings.grain)];
  const kept = proposals.filter((p) => p.verb !== 'skip');
  const outcome = draftOutcome(proposals, draft, { sourceId, now: 0 });
  const oneDay = proposals.filter((p) => p.doubtful && p.verb !== 'skip');
  const over = proposals.filter((p) => p.verb === 'stage' && p.overlapping.length > 0);
  const ignored = track ? track.points.filter((p) => !points.includes(p)) : [];
  const hotProposal = hot ? (proposals.find((p) => p.key === hot) ?? null) : null;

  return (
    <>
      {/* the dial */}
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <b className="font-serif font-normal text-4xl leading-none">{plural(kept.length, 'stage')}</b>
          <span className="text-sm text-ink-soft">
            {grain.label.replace('%d', String(settings.bigDays))} · {days.length} days, {plural(halts.length, 'halt')} · {outcome.adds.length} new, {outcome.completes.length} completed
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={GRAINS.length - 1}
          step={1}
          value={grainIndex(settings.grain)}
          onChange={(e) => actions.setSettings({ grain: grainAt(Number(e.target.value)) })}
          aria-label="The grain of the stages"
          className="w-full accent-accent"
        />
        <div className="grid grid-cols-4 text-2xs text-muted">
          {GRAINS.map((g, i) => (
            <button
              key={g.id}
              type="button"
              aria-pressed={g.id === settings.grain}
              onClick={() => actions.setSettings({ grain: g.id })}
              className={`p-0 border-0 bg-transparent cursor-pointer leading-tight ${i === 0 ? 'text-left' : i === GRAINS.length - 1 ? 'text-right' : 'text-center'} ${
                g.id === settings.grain ? 'text-ink font-semibold' : 'hover:text-ink'
              }`}
            >
              {g.short}
            </button>
          ))}
        </div>
      </div>

      <DeduceFrieze
        days={days}
        hot={hot}
        lanes={[
          {
            items: proposals.map((p) => ({
              key: p.key,
              startDate: p.startDate,
              endDate: p.endDate,
              fill: p.verb === 'skip' ? null : proposalColour(p),
              stroke: p.verb === 'skip' ? 'var(--color-line-strong)' : null,
              dashed: p.verb === 'skip',
              label: p.label,
              ink: p.verb === 'skip' ? 'var(--color-muted)' : 'var(--color-surface)',
            })),
          },
        ]}
      />

      {/* the verbs of mass, and the hand-offs */}
      <div className="flex flex-wrap items-center gap-1.5 text-2xs text-muted">
        <span>All:</span>
        <Button size="sm" onClick={() => actions.setDraft({ ...draft, answers: Object.fromEntries(Object.entries(draft.answers).filter(([, v]) => v !== 'skip')) })}>
          Keep all
        </Button>
        <Button size="sm" onClick={() => actions.setDraft({ ...draft, answers: {} })}>
          Back to the safe verbs
        </Button>
        {oneDay.length > 0 && (
          <Button size="sm" onClick={() => actions.setDraft({ ...draft, answers: { ...draft.answers, ...Object.fromEntries(oneDay.map((p) => [p.key, 'skip' as const])) } })}>
            Skip stops on the way ({oneDay.length})
          </Button>
        )}
        {over.length > 0 && (
          <Button size="sm" onClick={() => actions.setDraft({ ...draft, answers: { ...draft.answers, ...Object.fromEntries(over.map((p) => [p.key, p.safe === 'stage' ? 'skip' : p.safe])) } })}>
            The safe verb instead of over ({over.length})
          </Button>
        )}
        <span className="ml-auto inline-flex gap-0.5">
          <GoButton tab="paquet" label="One by one" onClick={() => actions.goTo('paquet', proposals[0]?.key)} />
          <GoButton tab="calque" label="Against my stages" onClick={() => actions.goTo('calque', (over[0] ?? proposals.find((p) => p.overlapping.length) ?? proposals[0])?.key)} />
        </span>
      </div>
      <p className={`m-0 ${note}`}>
        <kbd className={kbd}>↑↓</kbd> move · <kbd className={kbd}>Space</kbd> keep / skip · <kbd className={kbd}>E</kbd> edit · <kbd className={kbd}>A</kbd> <kbd className={kbd}>B</kbd> <kbd className={kbd}>C</kbd> switch the window
      </p>

      {/* the cards, the map collée beside them */}
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,17rem)] gap-3.5 items-start max-[700px]:grid-cols-1">
        <div className="flex flex-col gap-2 min-w-0" data-cards>
          {proposals.length === 0 ? (
            <p className="m-0 text-sm text-muted">
              {points.length === 0 ? 'No day of this trip carries a position, so there is no itinerary to work out.' : 'These settings produce no stage — try a wider radius.'}
            </p>
          ) : (
            proposals.map((p) => <Card key={p.key} p={p} ctx={ctx} />)
          )}
        </div>
        <div className="sticky top-0 flex flex-col gap-1.5 max-[700px]:order-first max-[700px]:z-10 max-[700px]:bg-surface max-[700px]:pb-1.5">
          <DeduceMap
            proposals={proposals}
            draft={draft}
            points={points}
            ignored={ignored}
            land={land}
            hot={hot}
            caption={hotProposal ? `${hotProposal.label} · ${spanText(hotProposal.startDate, hotProposal.endDate)}` : 'Hover or focus a stage'}
            className="max-[700px]:[&_svg]:max-h-[9.5rem]"
          />
          <span className={`${note} max-[700px]:hidden`}>Colour: a new stage; green: places into one of yours; faint: left out; ✕ an ignored position.</span>
        </div>
      </div>

      <FineSettings settings={settings} actions={actions} />
    </>
  );
}
