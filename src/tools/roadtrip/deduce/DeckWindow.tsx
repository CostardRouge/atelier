import { GRAINS } from '../../../shared/roadtrip/deduce-grain';
import { haltText, type DeduceDraft, type DeduceVerb, type Proposal } from '../../../shared/roadtrip/deduce-draft';
import type { TripDoc } from '../../../shared/roadtrip/trip-types';
import Button from '../../../shared/ui/Button';
import IconButton from '../../../shared/ui/IconButton';
import { Icons } from '../../../shared/ui/icons';
import Segmented from '../../../shared/ui/Segmented';
import DeduceMap from './DeduceMap';
import FineSettings from './FineSettings';
import ProposalEditor from './ProposalEditor';
import { Flags, GoButton, HaltChips, legend, mono, num, plural, quoted, spanText, stageName } from './pieces';
import type { DeduceContext } from './context';

/**
 * C · Le paquet — one chapter at a time: its map, its halts, its dates, and
 * one gesture to answer it. The answer moves to the next chapter; the safe
 * verb is marked; ← comes back; the dots say what each chapter got.
 */

const kbd = 'font-mono text-2xs font-semibold px-1.5 py-px rounded border border-line-strong text-muted flex-none';

interface Answer {
  verb: DeduceVerb;
  key: string;
  title: string;
  hint: string;
  disabled?: boolean;
}

function answersFor(p: Proposal, draft: DeduceDraft, trip: TripDoc): Answer[] {
  const out: Answer[] = [
    {
      verb: 'stage',
      key: '1',
      title: p.overlapping.length ? `Add, over ${quoted(p.overlapping, trip)}` : 'One stage',
      hint: `“${p.label}”, its ${plural(p.halts.length, 'place')} in order${p.overlapping.length ? ' · a stage of yours would be under it' : ''}`,
    },
  ];
  if (p.halts.length >= 2) out.push({ verb: 'split', key: '2', title: `Split into ${plural(p.halts.length, 'stage')}`, hint: 'One per halt' });
  if (p.verbs.includes('trim')) {
    out.push({ verb: 'trim', key: '3', title: 'Only the free days', hint: `${plural(p.free.length, 'stage')} in the days ${quoted(p.overlapping, trip)} leaves free` });
  }
  out.push({
    verb: 'into',
    key: '4',
    title: p.target ? `Its places into “${stageName(p.target, trip)}”` : 'Its places into a stage',
    hint: p.target ? (p.extra.length ? `${p.extra.map((h) => haltText(h, draft, trip) ?? 'an unnamed halt').join(', ')} · no new stage` : 'It already names them') : 'None of your stages covers these days',
    disabled: !p.verbs.includes('into'),
  });
  out.push({ verb: 'skip', key: '→', title: p.already ? 'Already in the trip' : 'Skip', hint: p.already ? 'Nothing to write for these days' : 'Write nothing for these days' });
  return out;
}

export default function DeckWindow({ ctx }: { ctx: DeduceContext }) {
  const { trip, deduction, draft, settings, actions, editing, index } = ctx;
  const { proposals, points, land } = deduction;
  const k = Math.min(index, proposals.length);
  const answered = proposals.filter((p) => draft.answers[p.key] !== undefined).length;

  const top = (
    <div className="flex flex-wrap items-center justify-between gap-2.5">
      <span className="inline-flex items-center gap-1">
        <IconButton size="sm" variant="ghost" label="The chapter before (←)" disabled={k === 0} onClick={() => { actions.setIndex(k - 1); actions.setEditing(null); }}>
          {Icons.back}
        </IconButton>
        <span className={`${legend} tabular-nums`}>
          {k < proposals.length ? `${k + 1} / ${proposals.length}` : 'Done'}
          {answered ? ` · ${answered} answered` : ''}
        </span>
      </span>
      <div className="flex flex-wrap gap-1" role="group" aria-label="The chapters">
        {proposals.map((p, j) => (
          <button
            key={p.key}
            type="button"
            aria-label={p.label}
            title={p.label}
            onClick={() => actions.setIndex(j)}
            className={`w-5 h-1.5 p-0 border-0 rounded-sm cursor-pointer ${
              j === k ? 'bg-ink' : draft.answers[p.key] ? (p.verb === 'skip' ? 'bg-faint' : p.verb === 'into' ? 'bg-ok' : 'bg-accent') : 'bg-line-strong'
            }`}
          />
        ))}
      </div>
      <Segmented size="sm" label="Grain" value={settings.grain} onChange={(id) => { actions.setSettings({ grain: id }); actions.setIndex(0); }} options={GRAINS.map((g) => ({ id: g.id, label: g.short }))} />
    </div>
  );

  if (!proposals.length) {
    return (
      <>
        {top}
        <p className="m-0 text-sm text-muted">{points.length === 0 ? 'No day of this trip carries a position, so there is no itinerary to work out.' : 'These settings produce no stage — try a wider radius.'}</p>
        <FineSettings settings={settings} actions={actions} />
      </>
    );
  }

  if (k >= proposals.length) {
    return (
      <>
        {top}
        <div className="px-3 py-2 rounded-control border border-line border-l-[3px] border-l-ok bg-paper text-xs text-ink-soft">
          All {proposals.length} chapters answered. Review what will be written, or go back to a chapter from the dots.
        </div>
        <div>
          <Button size="sm" onClick={() => actions.setIndex(Math.max(0, proposals.length - 1))}>
            Back
          </Button>
        </div>
        <FineSettings settings={settings} actions={actions} />
      </>
    );
  }

  const p = proposals[k];
  const answers = answersFor(p, draft, trip);
  return (
    <>
      {top}
      <div className="grid grid-cols-2 rounded-paper-lg border border-line-strong bg-paper overflow-hidden max-[560px]:grid-cols-1" data-key={p.key}>
        <div className="flex flex-col gap-2 px-4 py-3.5 min-w-0">
          <span className={mono}>
            {spanText(p.startDate, p.endDate)} · {p.dayCount} days{p.region ? ` · ${p.region}` : ''}
          </span>
          <h3 className="m-0 font-serif font-normal text-3xl leading-none break-words">{p.label}</h3>
          <HaltChips p={p} draft={draft} trip={trip} />
          <span className={mono}>{num(p.count)} pictures and clips</span>
          <Flags p={p} trip={trip} />
          <span className="flex flex-wrap items-center gap-1">
            <Button size="sm" variant="ghost" aria-expanded={editing === p.key} onClick={() => actions.setEditing(editing === p.key ? null : p.key)}>
              <kbd className={kbd}>E</kbd> {editing === p.key ? 'Close' : 'Edit this chapter'}
            </Button>
            <GoButton tab="grain" label="All stages" onClick={() => actions.goTo('grain', p.key)} />
            {p.overlapping.length > 0 && <GoButton tab="calque" label="Against mine" onClick={() => actions.goTo('calque', p.key)} />}
          </span>
        </div>
        {/* As tall as a third of the body's view (`cqh`), its half filled at that shape:
            a 4:3 picture in a wide window pushed the answers off the screen. */}
        <DeduceMap
          proposals={proposals}
          trip={trip}
          draft={draft}
          points={points}
          land={land}
          focus={p}
          fill
          className="rounded-none border-0 h-[clamp(15rem,40cqh,28rem)] max-[560px]:h-[11rem]"
        />
        {editing === p.key && (
          <div className="col-span-full px-4 pb-3.5 border-t border-line">
            <ProposalEditor p={p} trip={trip} cities={deduction.cities} draft={draft} actions={actions} first={trip.startDate} last={trip.endDate} />
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 max-[520px]:grid-cols-1" role="group" aria-label="Your answer">
        {answers.map((a) => {
          const chosen = p.verb === a.verb && (draft.answers[p.key] !== undefined || p.safe === a.verb);
          return (
            <button
              key={a.verb}
              type="button"
              data-answer={a.verb}
              disabled={a.disabled}
              aria-pressed={chosen}
              onClick={() => {
                actions.answer(p.key, a.verb);
                actions.setIndex(k + 1);
                actions.setEditing(null);
              }}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-control border bg-surface text-left cursor-pointer min-w-0 disabled:opacity-45 disabled:cursor-default hover:border-ink ${
                chosen ? 'border-ink shadow-[inset_0_0_0_1px_var(--color-ink)]' : 'border-line-strong'
              }`}
            >
              <kbd className={kbd}>{a.key}</kbd>
              <span className="min-w-0">
                <b className="block font-medium text-sm">
                  {a.title}
                  {p.safe === a.verb && !a.disabled && (
                    <span className="ml-1.5 font-mono text-3xs tracking-[0.1em] uppercase px-1.5 py-0.5 rounded bg-ok-wash text-ok">safe</span>
                  )}
                </b>
                <small className="block text-2xs text-muted leading-snug">{a.hint}</small>
              </span>
            </button>
          );
        })}
      </div>
      {p.unnamed.length > 0 && (
        <p className="m-0 text-2xs text-warn">An unnamed halt gives no place unless you name it (E).</p>
      )}

      <FineSettings settings={settings} actions={actions} />
    </>
  );
}
