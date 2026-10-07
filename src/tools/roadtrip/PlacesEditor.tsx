import { useEffect, useState } from 'react';
import PlaceSearchField from '../../shared/map/PlaceSearchField';
import { moveItem } from '../../shared/roadtrip/deck';
import { homonyms, type GazetteerCity } from '../../shared/roadtrip/gazetteer';
import { gazetteerOrEmpty } from '../../shared/roadtrip/load-gazetteer';
import { placeOddity, stageReference } from '../../shared/roadtrip/place-oddity';
import { adoptSearchResult, replacePlace, searchFacts } from '../../shared/roadtrip/place-search';
import {
  CODE_FROM_WORDS,
  PLACE_STYLE_OPTIONS,
  codeCandidates,
  countryName,
  datesOutsideStage,
  placeDates,
  placeLine,
  placeStyleFor,
  placeText,
  stateCodeFor,
  tableCode,
  tripCountry,
} from '../../shared/roadtrip/place-style';
import { formatIsoDate } from '../../shared/roadtrip/trip-days';
import { formatCoords, stageRegionLabel } from '../../shared/roadtrip/trip-places';
import {
  createTripPlace,
  isPlaceStyle,
  type PlaceCodeFrom,
  type PlaceStyle,
  type TripDoc,
  type TripPlace,
  type TripStage,
} from '../../shared/roadtrip/trip-types';
import { DateField } from '../../shared/ui/DateField';
import PlaceFixPanel, { type FixCandidate, type FixTab } from './PlaceFixPanel';
import PlacesTable, { type PlacesTableRow } from './PlacesTable';

interface PlacesEditorProps {
  trip: TripDoc;
  stage: TripStage;
  onChange: (places: TripPlace[]) => void;
  /** Keep a state's code for the whole trip (`TripDoc.stateCodes`); absent, the verb is not offered. */
  onRememberCode?: (state: string, code: string) => void;
}

const inputClass =
  'font-sans text-xs px-2 py-1 border border-line-strong rounded-paper bg-surface text-ink focus:outline-none focus:border-accent';
const fieldLabel = 'font-mono text-3xs tracking-[0.1em] uppercase text-muted';
const linkClass =
  'p-0 border-0 bg-transparent text-2xs cursor-pointer underline underline-offset-[2px]';

const SOURCE_WORDS: Record<NonNullable<TripPlace['source']>, string> = {
  typed: 'typed',
  search: 'found by the search',
  deduced: 'from your pictures',
};

/**
 * The writing of a place, with «like above» as the empty value — one control
 * for the three rungs (trip, stage, place), so a stage's select and a
 * place's read the same.
 */
export function PlaceStyleSelect({
  value,
  inherit,
  label,
  onChange,
  className = inputClass,
}: {
  value: PlaceStyle | '';
  /** What the empty value means here — «Like the trip · Sydney, NSW». */
  inherit: string;
  label: string;
  onChange: (style: PlaceStyle | '') => void;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(isPlaceStyle(e.target.value) ? e.target.value : '')}
      aria-label={label}
      className={className}
    >
      <option value="">{inherit}</option>
      {PLACE_STYLE_OPTIONS.map((o) => (
        <option key={o.id} value={o.id}>
          {o.example}
        </option>
      ))}
    </select>
  );
}

/**
 * The places one stage went through, in the order they were lived. The first
 * and the last ARE the stage's start and end — there is no separate pair of
 * fields, because a second copy of that fact is a second thing to keep in sync.
 *
 * They are a TABLE (`PlacesTable`, the maintainer's variant B of 2026-10-06):
 * a line per place with its state, its country and its distance to the rest
 * of the stage, a town in the wrong country in orange. ↑ ↓ reorder; a click
 * opens the place under the table, where Fix offers the other towns of its
 * name (the shipped index), the search (inside the trip's country first) or
 * the fields by hand.
 */
export default function PlacesEditor({ trip, stage, onChange, onRememberCode }: PlacesEditorProps) {
  const places = stage.places ?? [];
  const [openId, setOpenId] = useState<string | null>(null);
  const [tab, setTab] = useState<FixTab>('hand');
  // The place just added gets its name field focused; an existing one opened
  // by a click keeps the focus where the click put it.
  const [fresh, setFresh] = useState<string | null>(null);
  // The index of towns, fetched the first time «Same name» is asked — never at boot.
  const [cities, setCities] = useState<GazetteerCity[] | null>(null);
  const open = places.find((p) => p.id === openId) ?? null;
  const openIndex = open ? places.indexOf(open) : -1;
  const home = tripCountry(trip);

  useEffect(() => {
    if (!open || tab !== 'same' || cities) return;
    let live = true;
    void gazetteerOrEmpty().then((list) => {
      if (live) setCities(list);
    });
    return () => {
      live = false;
    };
  }, [open, tab, cities]);

  function add() {
    const place = createTripPlace('', '', null, { source: 'typed' });
    onChange([...places, place]);
    setOpenId(place.id);
    setTab('hand');
    setFresh(place.id);
  }

  function openPlace(id: string, as: FixTab) {
    if (openId === id && tab === as) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    setTab(as);
  }

  const rows: PlacesTableRow[] = places.map((place) => {
    const line = placeLine(place, stage, trip, 'lists');
    const oddity = placeOddity(place, stageReference(stage, place.id, trip, home), home);
    const dates = placeDates(place);
    const outside = datesOutsideStage(place, stage);
    return {
      key: place.id,
      name: place.name.trim(),
      state: line.stateText,
      countryCode: line.countryCode,
      countryName: line.countryName,
      km: oddity.km,
      odd: oddity.odd,
      note: dates ? (
        <span
          data-dates
          className={`ml-2 inline-block whitespace-nowrap font-mono text-3xs font-normal px-1.5 rounded-full border ${
            outside ? 'border-warn text-warn' : 'border-line-strong text-muted'
          } ${place.dateFrom === 'photos' ? 'border-dashed' : ''}`}
          title={`${place.dateFrom === 'photos' ? 'From your pictures' : 'Set by hand'}${outside ? ' · outside the stage' : ''}`}
        >
          {dates}
        </span>
      ) : undefined,
    };
  });

  const replace = (next: TripPlace) => onChange(places.map((p) => (p.id === next.id ? next : p)));
  // Nearest the REST of the stage, never the place's own position: that
  // position is the very town being corrected.
  const reference = open ? stageReference(stage, open.id, trip, home) : null;
  const found = open && cities ? homonyms(cities, open.name, reference ?? open.coords) : null;
  const candidates: FixCandidate[] | null = found
    ? found.map(({ city, km }, i) => {
        const code = city.country.toUpperCase();
        const town = createTripPlace(city.name, city.region, { lat: city.lat, lon: city.lon }, { countryCode: code });
        return {
          key: String(i),
          text: placeText(town, stage, trip, 'lists'),
          countryCode: code,
          countryName: countryName(code),
          km,
          current: !!open!.coords && open!.coords.lat === city.lat && open!.coords.lon === city.lon,
        };
      })
    : null;

  return (
    <div className="flex flex-col gap-2">
      <PlacesTable
        label="Places of this stage, in the order they were lived"
        kmLabel="From the stage"
        rows={rows}
        openKey={openId}
        editing
        onOpen={(id) => openPlace(id, 'hand')}
        onFix={(id) => openPlace(id, places.find((p) => p.id === id)?.name.trim() ? 'same' : 'hand')}
        onMove={(id, delta) => {
          const at = places.findIndex((p) => p.id === id);
          const to = at + delta;
          if (at < 0 || to < 0 || to >= places.length) return;
          onChange(moveItem(places, at, to));
        }}
      />

      {open && (
        <PlaceFixPanel
          key={open.id}
          title={open.name.trim() ? `Which ${open.name.trim()}?` : 'A new place'}
          tab={tab}
          onTab={setTab}
          candidates={open.name.trim() ? candidates : []}
          home={home}
          nearWord="nearest the stage"
          onPick={(i) => {
            const city = found?.[Number(i)]?.city;
            if (!city) return;
            const code = city.country.toUpperCase();
            replace(
              replacePlace(open, {
                name: city.name,
                state: city.region,
                countryCode: code,
                country: countryName(code),
                coords: { lat: city.lat, lon: city.lon },
                source: 'search',
              }),
            );
            setTab('hand');
          }}
          onClose={() => setOpenId(null)}
          search={
            <SearchReplace
              place={open}
              home={home}
              onPick={(next) => {
                replace(next);
                setTab('hand');
              }}
            />
          }
          hand={
            <PlaceFields
              trip={trip}
              stage={stage}
              place={open}
              index={openIndex}
              autoFocus={open.id === fresh}
              country={home}
              onChange={replace}
              onDelete={() => {
                onChange(places.filter((p) => p.id !== open.id));
                setOpenId(null);
              }}
              onRememberCode={onRememberCode}
            />
          }
        />
      )}

      <button
        type="button"
        onClick={add}
        className="self-start inline-flex items-center h-[1.9rem] px-2.5 rounded-full border border-dashed border-line-strong bg-transparent text-xs text-muted cursor-pointer hover:border-accent hover:text-accent-ink"
      >
        + Place
      </button>
    </div>
  );
}

/** «Search»: the online search for this place, its answer REPLACING the town it was. */
function SearchReplace({ place, home, onPick }: { place: TripPlace; home: string; onPick: (next: TripPlace) => void }) {
  const [query, setQuery] = useState(place.name);
  return (
    <PlaceSearchField
      value={query}
      onChange={setQuery}
      onPick={(result) => onPick(replacePlace(place, searchFacts(result)))}
      label="Search another place for this one"
      placeholder="Kalbarri"
      country={home}
      countryLabel={countryName(home)}
      autoFocus
      inputClassName={inputClass}
    />
  );
}

/** Write an optional string field: empty deletes the key rather than storing ''. */
function withText<K extends 'area' | 'country' | 'countryCode' | 'stateCode' | 'arrived' | 'left'>(
  place: TripPlace,
  key: K,
  value: string,
): TripPlace {
  const next = { ...place };
  if (value.trim()) next[key] = value.trim() as TripPlace[K];
  else delete next[key];
  return next;
}

function PlaceFields({
  trip,
  stage,
  place,
  index,
  autoFocus,
  country,
  onChange,
  onDelete,
  onRememberCode,
}: {
  trip: TripDoc;
  stage: TripStage;
  place: TripPlace;
  index: number;
  autoFocus: boolean;
  /** The trip's country — the search asks inside it first. */
  country: string;
  onChange: (place: TripPlace) => void;
  onDelete: () => void;
  onRememberCode?: (state: string, code: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [more, setMore] = useState(false);
  const [dating, setDating] = useState(false);
  const name = place.name.trim() || 'this place';
  // The stage's region stands in when the place has none — an empty field
  // means "the stage's", never blank.
  const inherited = stageRegionLabel(stage);
  const state = place.state.trim();
  const code = stateCodeFor(place, trip);
  const candidates = codeCandidates(place, trip);
  const inTable = tableCode(trip.stateCodes, state);
  // Offer to keep the code on the trip when the state has none there yet, or
  // a different one — one click, and every place of that state follows.
  const canRemember = !!onRememberCode && !!state && !!code.code && inTable !== code.code;
  const style = placeStyleFor(place, stage, trip, 'lists');
  const hasDates = !!(place.arrived || place.left);
  const outside = datesOutsideStage(place, stage);
  const codeOptions: { id: PlaceCodeFrom | ''; label: string; disabled?: boolean }[] = [
    { id: '', label: `Automatic · ${code.code || '—'}` },
    { id: 'search', label: candidates.search ? `The search · ${candidates.search}` : 'The search · none', disabled: !candidates.search },
    { id: 'table', label: candidates.table ? `The trip’s table · ${candidates.table}` : 'The trip’s table · none', disabled: !candidates.table },
    { id: 'own', label: candidates.own ? `My own · ${candidates.own}` : 'My own…' },
  ];

  return (
    <div className="flex flex-col gap-1.5 pl-1" data-place-fields>
      <div className="flex flex-wrap items-start gap-1.5">
        <PlaceSearchField
          value={place.name}
          onChange={(next) => onChange({ ...place, name: next })}
          onPick={(result) => onChange(adoptSearchResult(place, result))}
          placeholder="Kalbarri"
          label={`Place ${index + 1}`}
          autoFocus={autoFocus}
          country={country}
          countryLabel={countryName(country)}
          className="flex-1 min-w-[9rem]"
          inputClassName={inputClass}
        />
        <input
          value={place.state}
          onChange={(e) => onChange({ ...place, state: e.target.value })}
          placeholder={inherited || 'Western Australia'}
          aria-label={`State of ${name}`}
          className={`${inputClass} flex-1 min-w-[7rem]`}
        />
        {confirming ? (
          <span className="flex items-center gap-1.5 text-2xs pt-1.5">
            <button
              type="button"
              onClick={onDelete}
              className={`${linkClass} text-danger font-semibold`}
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="p-0 border-0 bg-transparent text-muted cursor-pointer"
            >
              Keep
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className={`${linkClass} pt-1.5 text-faint hover:text-danger`}
            aria-label={`Delete ${name}`}
          >
            Delete
          </button>
        )}
      </div>

      {/* The short code: what it is, where it comes from, and the one verb
          that makes it the trip's. Shown only once there is a state to code. */}
      {state && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-ink-soft" data-code>
          <span className={fieldLabel}>Code</span>
          <select
            value={place.codeFrom ?? ''}
            onChange={(e) => {
              const from = e.target.value as PlaceCodeFrom | '';
              const next = { ...place };
              if (from) next.codeFrom = from;
              else delete next.codeFrom;
              onChange(next);
            }}
            aria-label={`Where the code of ${state} comes from`}
            className={`${inputClass} py-0.5`}
          >
            {codeOptions.map((o) => (
              <option key={o.id} value={o.id} disabled={o.disabled}>
                {o.label}
              </option>
            ))}
          </select>
          {(place.codeFrom === 'own' || candidates.own) && (
            <input
              value={place.stateCode ?? ''}
              onChange={(e) => onChange(withText(place, 'stateCode', e.target.value.toUpperCase()))}
              placeholder={candidates.official || candidates.derived || 'NSW'}
              aria-label={`Your own code for ${state}`}
              maxLength={6}
              className={`${inputClass} w-[4.5rem] py-0.5 font-mono uppercase`}
            />
          )}
          <span className="font-mono text-ink">
            {code.code || '—'}
          </span>
          <span className="text-muted">{CODE_FROM_WORDS[code.from]}</span>
          {canRemember && (
            <button
              type="button"
              onClick={() => onRememberCode!(state, code.code)}
              className={`${linkClass} text-accent-ink`}
              title={`Every place of ${state} with no code of its own will read ${code.code}`}
            >
              Keep {code.code} for {state} on this trip
            </button>
          )}
        </div>
      )}

      {/* Dates are a bonus: nothing drawn until asked, one row once set. */}
      {hasDates || dating ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1" data-dates-fields>
          <span className={fieldLabel}>Dates</span>
          <DateField
            value={place.arrived ?? ''}
            onChange={(v) => onChange({ ...withText(place, 'arrived', v), dateFrom: 'hand' })}
            label="Arrived"
            format={formatIsoDate}
            className="[&>span]:h-[1.9rem] [&>span]:text-xs"
          />
          <span className="font-mono text-faint select-none" aria-hidden="true">
            →
          </span>
          <DateField
            value={place.left ?? ''}
            onChange={(v) => onChange({ ...withText(place, 'left', v), dateFrom: 'hand' })}
            label="Left"
            format={formatIsoDate}
            className="[&>span]:h-[1.9rem] [&>span]:text-xs"
          />
          {hasDates && (
            <button
              type="button"
              onClick={() => {
                const next = { ...place };
                delete next.arrived;
                delete next.left;
                delete next.dateFrom;
                onChange(next);
                setDating(false);
              }}
              className={`${linkClass} text-muted hover:text-danger`}
            >
              No date
            </button>
          )}
          {hasDates && (
            <span className={`text-2xs ${outside ? 'text-warn' : 'text-muted'}`}>
              {place.dateFrom === 'photos' ? 'from your pictures' : ''}
              {outside ? `${place.dateFrom === 'photos' ? ' · ' : ''}outside this stage (${formatIsoDate(stage.startDate)} → ${formatIsoDate(stage.endDate)}), kept as it is` : ''}
            </span>
          )}
        </div>
      ) : null}

      {/* The facts line: where the place came from, what else it knows, and
          the two verbs that open the rest. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-2xs text-faint">
        <span>
          {place.source ? SOURCE_WORDS[place.source] : 'typed'}
          {place.area ? ` · ${place.area}` : ''}
          {place.country ? ` · ${place.country}` : ''}
        </span>
        {!hasDates && !dating && (
          <button type="button" onClick={() => setDating(true)} className={`${linkClass} text-faint hover:text-accent-ink`}>
            + date
          </button>
        )}
        <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} className={`${linkClass} text-faint hover:text-accent-ink`}>
          {more ? 'Less' : 'More…'}
        </button>
      </div>

      {more && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-x-3 gap-y-1.5 p-2 border border-line rounded-paper bg-paper" data-more>
          <label className="flex flex-col gap-0.5">
            <span className={fieldLabel}>Area</span>
            <input
              value={place.area ?? ''}
              onChange={(e) => onChange(withText(place, 'area', e.target.value))}
              placeholder="Shire, county, département"
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className={fieldLabel}>Country</span>
            <input
              value={place.country ?? ''}
              onChange={(e) => onChange(withText(place, 'country', e.target.value))}
              placeholder="Australia"
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className={fieldLabel}>Country code</span>
            <input
              value={place.countryCode ?? ''}
              onChange={(e) => onChange(withText(place, 'countryCode', e.target.value.toUpperCase()))}
              placeholder="AU"
              maxLength={3}
              className={`${inputClass} font-mono uppercase`}
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className={fieldLabel}>Written</span>
            <PlaceStyleSelect
              value={place.style ?? ''}
              inherit={`${style.from === 'place' ? 'Like the stage' : style.from === 'stage' ? 'Like the stage' : 'Like the trip'} · ${placeText({ ...place, style: undefined }, stage, trip, 'lists') || PLACE_STYLE_OPTIONS.find((o) => o.id === style.style)?.example}`}
              label={`How ${name} is written`}
              onChange={(s) => {
                const next = { ...place };
                if (s) next.style = s;
                else delete next.style;
                onChange(next);
              }}
            />
          </label>
          {place.coords && (
            <p className="m-0 col-span-full font-mono text-2xs text-faint tabular-nums">
              {formatCoords(place.coords)}
              <button
                type="button"
                onClick={() => onChange({ ...place, coords: null })}
                className={`ml-2 ${linkClass} text-faint hover:text-danger`}
              >
                forget
              </button>
            </p>
          )}
        </div>
      )}
      {!more && place.coords && (
        <p className="m-0 font-mono text-2xs text-faint tabular-nums">
          {formatCoords(place.coords)}
          <button
            type="button"
            onClick={() => onChange({ ...place, coords: null })}
            className={`ml-2 ${linkClass} text-faint hover:text-danger`}
          >
            forget
          </button>
        </p>
      )}
    </div>
  );
}
