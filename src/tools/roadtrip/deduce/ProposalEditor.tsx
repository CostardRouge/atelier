import { useState } from 'react';
import PlaceSearchField from '../../../shared/map/PlaceSearchField';
import { haltKey, haltName, haltPick, haltPlace, type DeduceDraft, type Proposal } from '../../../shared/roadtrip/deduce-draft';
import { homonyms, type GazetteerCity } from '../../../shared/roadtrip/gazetteer';
import type { NamedLeg } from '../../../shared/roadtrip/group-legs';
import { placeOddity } from '../../../shared/roadtrip/place-oddity';
import { searchFacts } from '../../../shared/roadtrip/place-search';
import { countryName, majorityCountry, placeLine, placeText } from '../../../shared/roadtrip/place-style';
import { addDays } from '../../../shared/roadtrip/trip-days';
import { createTripPlace, type TripDoc } from '../../../shared/roadtrip/trip-types';
import Button from '../../../shared/ui/Button';
import PlaceFixPanel, { type FixCandidate, type FixTab } from '../PlaceFixPanel';
import PlacesTable, { type PlacesTableRow } from '../PlacesTable';
import { dayText, legend, note, spanText } from './pieces';
import type { DeduceActions } from './context';

/**
 * One proposal corrected before it is written: its name, its two dates a
 * day at a time, its halts reordered or left out, and a name for a halt the
 * index could not name. The SAME editor in the three windows, over the same
 * draft — a correction made in the grain is what the paquet then shows.
 */

interface ProposalEditorProps {
  p: Proposal;
  trip: TripDoc;
  /** The index of towns — what «Same name» lists; null while it loads. */
  cities: readonly GazetteerCity[] | null;
  draft: DeduceDraft;
  actions: DeduceActions;
  /** The trip's first and last day: a date never steps outside them. */
  first: string;
  last: string;
}

const field =
  'w-full h-[2.125rem] px-3 rounded-control border border-line-strong bg-surface text-sm max-[820px]:text-base text-ink focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20';

function Stepper({
  label,
  value,
  canLess,
  canMore,
  onStep,
}: {
  label: string;
  value: string;
  canLess: boolean;
  canMore: boolean;
  onStep: (delta: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <span className={legend}>{label}</span>
      <span className="inline-flex items-center h-7 w-fit rounded-full border border-line-strong bg-surface overflow-hidden">
        <button type="button" className="w-7 h-full border-0 bg-transparent text-ink cursor-pointer disabled:opacity-30 disabled:cursor-default" disabled={!canLess} onClick={() => onStep(-1)} aria-label={`${label}: a day earlier`}>
          −
        </button>
        <span className="min-w-[4.2rem] text-center font-mono text-2xs tabular-nums">{dayText(value)}</span>
        <button type="button" className="w-7 h-full border-0 bg-transparent text-ink cursor-pointer disabled:opacity-30 disabled:cursor-default" disabled={!canMore} onClick={() => onStep(1)} aria-label={`${label}: a day later`}>
          +
        </button>
      </span>
    </div>
  );
}

export default function ProposalEditor({ p, trip, cities, draft, actions, first, last }: ProposalEditorProps) {
  const all = p.chapter.halts;
  const kept = p.halts.map(haltKey);
  const setHalts = (keys: string[]) => actions.edit(p, { halts: keys });
  const [fixing, setFixing] = useState<string | null>(null);
  const [tab, setTab] = useState<FixTab>('same');
  // The trip's country: what its places say, and what the deduction's towns say.
  const home = majorityCountry([
    ...trip.stages.flatMap((s) => s.places.map((pl) => pl.countryCode)),
    ...all.map((h) => haltPlace(h, draft)?.countryCode),
  ]);
  const rows: PlacesTableRow[] = all.map((h) => {
    const key = haltKey(h);
    const place = haltPlace(h, draft);
    const line = place ? placeLine(place, null, trip, 'lists') : null;
    const oddity = place ? placeOddity(place, h.leg.centroid, home) : { odd: false, km: null };
    return {
      key,
      name: place?.name ?? '',
      state: line?.stateText ?? '',
      countryCode: line?.countryCode ?? '',
      countryName: line?.countryName ?? '',
      km: oddity.km,
      odd: oddity.odd,
      out: !kept.includes(key),
      note: <span className="ml-2 inline-block whitespace-nowrap font-mono text-3xs text-muted font-normal">{spanText(h.leg.startDate, h.leg.endDate)}</span>,
    };
  });
  const fixHalt = fixing ? (all.find((h) => haltKey(h) === fixing) ?? null) : null;
  const openFix = (key: string) => {
    if (fixing === key) {
      setFixing(null);
      return;
    }
    const halt = all.find((h) => haltKey(h) === key);
    // A halt nobody named has no name to look up: it opens on the typing.
    setTab(halt && haltName(halt, draft) ? 'same' : 'hand');
    setFixing(key);
  };

  return (
    <div className="flex flex-col gap-2.5 pt-2.5 border-t border-dashed border-line-strong" data-editor={p.key}>
      <label className="flex flex-col gap-1">
        <span className={legend}>Name</span>
        <input
          type="text"
          className={field}
          value={p.ownName}
          placeholder={p.ownName ? undefined : `${p.label} (derived from its places)`}
          onChange={(e) => actions.edit(p, { name: e.target.value })}
          aria-label="The stage's name; empty derives it from its places"
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <Stepper
          label="Starts"
          value={p.startDate}
          canLess={p.startDate > first}
          canMore={p.startDate < p.endDate}
          onStep={(d) => {
            const next = addDays(p.startDate, d);
            if (next) actions.edit(p, { startDate: next });
          }}
        />
        <Stepper
          label="Ends"
          value={p.endDate}
          canLess={p.endDate > p.startDate}
          canMore={p.endDate < last}
          onStep={(d) => {
            const next = addDays(p.endDate, d);
            if (next) actions.edit(p, { endDate: next });
          }}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className={legend}>Places, in order</span>
        <PlacesTable
          label={`The places of ${p.label}, in order`}
          kmLabel="From pictures"
          rows={rows}
          openKey={fixing}
          editing
          onOpen={openFix}
          onFix={openFix}
          onMove={(key, delta) => {
            const at = kept.indexOf(key);
            const to = at + delta;
            if (at < 0 || to < 0 || to >= kept.length) return;
            const next = [...kept];
            [next[at], next[to]] = [next[to], next[at]];
            setHalts(next);
          }}
          onOut={(key) => setHalts(kept.filter((k) => k !== key))}
          onBack={(key) => setHalts(all.map(haltKey).filter((k) => kept.includes(k) || k === key))}
        />
        {fixHalt && (
          <HaltFix
            key={fixing!}
            halt={fixHalt}
            trip={trip}
            cities={cities}
            draft={draft}
            home={home}
            actions={actions}
            tab={tab}
            onTab={setTab}
            onClose={() => setFixing(null)}
          />
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`${note} basis-[14rem] grow`}>
          Edits live in the draft every window reads and are written only on Write. A halt named here is named for this trip only.
        </span>
        <span className="flex gap-1.5 ml-auto">
          <Button size="sm" variant="ghost" disabled={!p.edited} onClick={() => actions.resetEdit(p.key)}>
            Reset
          </Button>
          <Button size="sm" variant="primary" onClick={() => actions.setEditing(null)}>
            Done
          </Button>
        </span>
      </div>
    </div>
  );
}

/**
 * The Fix panel of one halt: the towns of its name nearest its pictures,
 * the search inside the trip's country, or a name typed — each written
 * into the DRAFT as the place chosen for the halt, never to the instance.
 */
function HaltFix({
  halt,
  trip,
  cities,
  draft,
  home,
  actions,
  tab,
  onTab,
  onClose,
}: {
  halt: NamedLeg;
  trip: TripDoc;
  cities: readonly GazetteerCity[] | null;
  draft: DeduceDraft;
  home: string;
  actions: DeduceActions;
  tab: FixTab;
  onTab: (tab: FixTab) => void;
  onClose: () => void;
}) {
  const key = haltKey(halt);
  const name = haltName(halt, draft) ?? '';
  const current = haltPlace(halt, draft);
  const [query, setQuery] = useState(name);
  const [typed, setTyped] = useState(haltPick(halt, draft)?.source === 'typed' ? name : '');
  const found = cities ? homonyms(cities, name, halt.leg.centroid) : null;
  const candidates: FixCandidate[] | null = found
    ? found.map(({ city, km }, i) => {
        const place = createTripPlace(city.name, city.region, { lat: city.lat, lon: city.lon }, { countryCode: city.country.toUpperCase() });
        const code = city.country.toUpperCase();
        return {
          key: String(i),
          text: placeText(place, null, trip, 'lists'),
          countryCode: code,
          countryName: countryName(code),
          km,
          current: !!current?.coords && current.coords.lat === city.lat && current.coords.lon === city.lon,
        };
      })
    : null;
  const field = 'h-[2.125rem] px-3 rounded-control border border-line-strong bg-surface text-sm max-[820px]:text-base text-ink focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20';

  return (
    <PlaceFixPanel
      title={name ? `Which ${name}?` : 'Name this halt'}
      tab={tab}
      onTab={onTab}
      candidates={name ? candidates : []}
      home={home}
      nearWord="nearest your pictures"
      onPick={(i) => {
        const city = found?.[Number(i)]?.city;
        if (!city) return;
        actions.choose(key, {
          name: city.name,
          state: city.region,
          countryCode: city.country.toUpperCase(),
          coords: { lat: city.lat, lon: city.lon },
          source: 'deduced',
        });
        onClose();
      }}
      onClose={onClose}
      search={
        <PlaceSearchField
          value={query}
          onChange={setQuery}
          onPick={(result) => {
            const facts = searchFacts(result);
            actions.choose(key, { ...facts, source: 'search' });
            onClose();
          }}
          label="Search a place for this halt"
          placeholder="Exmouth"
          country={home}
          countryLabel={countryName(home)}
          autoFocus
          inputClassName={field}
        />
      }
      hand={
        <form
          className="flex flex-wrap items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!typed.trim()) return;
            actions.choose(key, { name: typed.trim(), state: '', coords: { ...halt.leg.centroid }, source: 'typed' });
            onClose();
          }}
        >
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Name it for this trip"
            aria-label="A name for this halt, on the trip only"
            className={`${field} flex-1 min-w-[10rem]`}
          />
          <Button size="sm" variant="primary" type="submit" disabled={!typed.trim()}>
            Use it
          </Button>
          {haltPick(halt, draft) && (
            <Button size="sm" variant="ghost" onClick={() => { actions.choose(key, null); onClose(); }}>
              Back to the index’s
            </Button>
          )}
          <span className={`${note} basis-full`}>Placed where the pictures were. Named for this trip only, never on the instance.</span>
        </form>
      }
    />
  );
}
