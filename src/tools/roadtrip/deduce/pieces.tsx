import type { ReactNode } from 'react';
import { haltText, VERB_WORDS, type DeduceDraft, type DeduceVerb, type Proposal } from '../../../shared/roadtrip/deduce-draft';
import { stageRoute, type PlaceWritingTrip } from '../../../shared/roadtrip/place-style';
import { stageTint } from '../../../shared/roadtrip/stage-ruler';
import { formatIsoDate, parseIsoDate, type IsoDate } from '../../../shared/roadtrip/trip-days';
import type { TripStage } from '../../../shared/roadtrip/trip-types';
import type { DeduceTab } from './settings';

/**
 * The small pieces the three windows share: how a proposal's verb, places,
 * flags and dates are said, and the one button that carries a chapter from
 * one window to another. Kept together so the grain's card, the calque's row
 * and the paquet's card cannot drift apart in their words.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `5 Nov` — the year is the trip's, said once in its title. */
export function dayText(iso: IsoDate): string {
  const ms = parseIsoDate(iso);
  if (ms === null) return iso;
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function spanText(start: IsoDate, end: IsoDate): string {
  return start === end ? dayText(start) : `${dayText(start)} → ${dayText(end)}`;
}

export const plural = (n: number, word: string, words = `${word}s`): string =>
  `${n} ${n === 1 ? word : words}`;

export const num = (n: number): string => n.toLocaleString('en-GB');

/** The colour a proposal wears: its tint, green when it completes a stage, faint when left out. */
export function proposalColour(p: Proposal): string {
  if (p.verb === 'skip') return 'var(--color-line-strong)';
  if (p.verb === 'into') return 'var(--color-ok)';
  return stageTint(p.index);
}

/** A stage of the trip as every list names it — its own name, else its places WRITTEN («Kalbarri → Exmouth, WA»). */
export const stageName = (stage: TripStage, trip: PlaceWritingTrip, fallback = 'an unnamed stage'): string =>
  stageRoute(stage, trip, 'lists') || fallback;

/** The stages' own names, quoted and joined. */
export const quoted = (stages: readonly TripStage[], trip: PlaceWritingTrip): string =>
  stages.map((s) => `“${stageName(s, trip)}”`).join(', ');

export const legend = 'font-mono text-3xs tracking-[0.14em] uppercase text-muted';
export const note = 'text-2xs text-muted leading-snug';
export const mono = 'font-mono text-2xs text-muted tabular-nums';

/** What a verb says on a proposal, in its context. */
export function verbWord(p: Proposal, verb: DeduceVerb, trip: PlaceWritingTrip): string {
  if (verb === 'into' && p.target) return `Into “${stageName(p.target, trip, 'that stage')}”`;
  if (verb === 'stage' && p.overlapping.length) return 'Add over';
  if (verb === 'split') return `Split into ${p.halts.length}`;
  return VERB_WORDS[verb];
}

/** The small uppercase pill naming what will happen to a proposal. */
export function VerbPill({ p }: { p: Proposal }) {
  const [word, tone] =
    p.already && p.verb === 'skip'
      ? ['already', 'bg-paper-2 text-muted']
      : p.verb === 'stage'
        ? p.overlapping.length
          ? ['over', 'bg-warn-wash text-warn']
          : ['new', 'bg-accent-wash text-accent-ink']
        : p.verb === 'split'
          ? ['split', 'bg-accent-wash text-accent-ink']
          : p.verb === 'trim'
            ? ['free days', 'bg-accent-wash text-accent-ink']
            : p.verb === 'into'
              ? ['places', 'bg-ok-wash text-ok']
              : ['skip', 'bg-paper-2 text-muted'];
  return (
    <span className={`font-mono text-3xs tracking-[0.1em] uppercase px-1.5 py-0.5 rounded whitespace-nowrap ${tone}`}>
      {word}
    </span>
  );
}

/** A native select of the verbs a proposal can take — compact, keyboard-reachable, one per card. */
export function VerbSelect({ p, trip, onChange }: { p: Proposal; trip: PlaceWritingTrip; onChange: (verb: DeduceVerb) => void }) {
  // The select IS the card's verb now (the pill beside it said the same thing
  // twice), so it wears the pill's tone: the one that needs a look — over a
  // stage of yours — is the one that stands out.
  const tone =
    p.verb === 'skip'
      ? 'border-line-strong text-muted bg-surface'
      : p.verb === 'into'
        ? 'border-ok text-ok bg-surface'
        : p.verb === 'stage' && p.overlapping.length
          ? 'border-warn text-warn bg-warn-wash'
          : 'border-accent/50 text-accent-ink bg-surface';
  return (
    <select
      value={p.verb}
      onChange={(e) => onChange(e.target.value as DeduceVerb)}
      aria-label={`What to do with ${p.label}`}
      className={`h-7 max-[820px]:h-9 max-w-full pl-2.5 pr-7 rounded-full border text-xs max-[820px]:text-base font-medium cursor-pointer ${tone} appearance-none bg-no-repeat bg-[length:0.5rem_0.5rem] bg-[position:right_0.6rem_center] bg-[image:linear-gradient(45deg,transparent_50%,var(--color-muted)_50%),linear-gradient(135deg,var(--color-muted)_50%,transparent_50%)] [background-size:0.3rem_0.3rem,0.3rem_0.3rem] [background-position:calc(100%_-_0.95rem)_center,calc(100%_-_0.65rem)_center]`}
    >
      {p.verbs.map((v) => (
        <option key={v} value={v}>
          {verbWord(p, v, trip)}
        </option>
      ))}
    </select>
  );
}

/** The proposal's halts as chips, each with its days; a halt the index could not name is dashed. */
export function HaltChips({ p, draft, trip }: { p: Proposal; draft: DeduceDraft; trip: PlaceWritingTrip }) {
  return (
    <div className="flex flex-wrap gap-1">
      {p.halts.map((h) => {
        const name = haltText(h, draft, trip);
        const extra = p.verb === 'into' && p.extra.includes(h);
        return (
          <span
            key={h.leg.startDate}
            title={h.city?.region || undefined}
            className={`inline-flex items-baseline gap-1 max-w-full px-2 py-0.5 rounded-full border text-2xs whitespace-nowrap ${
              name
                ? extra
                  ? 'border-ok text-ok bg-surface'
                  : 'border-line-strong text-ink-soft bg-surface'
                : 'border-dashed border-warn text-warn bg-surface'
            }`}
          >
            <span className="truncate">{name ?? 'Unnamed halt'}</span>
            <span className="font-mono text-3xs opacity-70">{h.leg.dayCount}d</span>
          </span>
        );
      })}
    </div>
  );
}

/** What a proposal would like the author to know — nothing drawn when there is nothing. */
export function Flags({ p, trip }: { p: Proposal; trip: PlaceWritingTrip }) {
  const flags: ReactNode[] = [];
  if (p.already) {
    flags.push(
      <span key="already" className="text-muted">
        already in the trip{p.relation === 'inside' && p.target ? ` (inside “${stageName(p.target, trip)}”)` : ''}
        {p.written ? ' · written by Deduce' : ''}
      </span>,
    );
  }
  if (p.verb === 'stage' && p.overlapping.length) {
    flags.push(
      <span key="over" className="text-danger">
        would sit over {quoted(p.overlapping, trip)}
      </span>,
    );
  }
  if (p.verb === 'trim') {
    flags.push(
      <span key="trim" className="text-ok">
        {plural(p.free.length, 'stage')} in the days {quoted(p.overlapping, trip)} leaves free
      </span>,
    );
  }
  if (p.verb === 'into' && p.target) {
    flags.push(
      <span key="into" className="text-ok">
        {plural(p.extra.length, 'place')} into “{stageName(p.target, trip)}”
      </span>,
    );
  }
  if (p.doubtful) flags.push(<span key="doubt">stops on the way or guesses only</span>);
  if (p.unnamed.length) flags.push(<span key="unnamed">{plural(p.unnamed.length, 'unnamed halt')}</span>);
  if (p.blind) flags.push(<span key="blind" className="text-muted">{plural(p.blind, 'blind day')}</span>);
  if (p.edited) {
    flags.push(
      <span key="edited" className="font-mono text-3xs tracking-[0.1em] uppercase text-accent-ink">
        edited
      </span>,
    );
  }
  if (!flags.length) return null;
  return <div className="flex flex-wrap gap-x-2.5 gap-y-1 text-2xs text-warn leading-snug">{flags}</div>;
}

const TAB_KEYS: Record<DeduceTab, string> = { grain: 'A', calque: 'B', paquet: 'C' };

/** The hand-off: opens another window ON this chapter. */
export function GoButton({
  tab,
  label,
  onClick,
  className = '',
}: {
  tab: DeduceTab;
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Open the ${tab} on this chapter`}
      className={`inline-flex items-center gap-1 h-6 px-2 rounded-full border border-transparent bg-transparent text-2xs font-medium text-muted cursor-pointer whitespace-nowrap hover:border-line-strong hover:text-ink ${className}`}
    >
      <span className="font-mono text-3xs font-semibold text-accent-ink">{TAB_KEYS[tab]}</span>
      {label} ›
    </button>
  );
}

export { formatIsoDate };
