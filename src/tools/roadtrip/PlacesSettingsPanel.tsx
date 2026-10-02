import {
  CODE_FROM_WORDS,
  PLACE_STYLE_OPTIONS,
  deriveStateCode,
  rememberStateCode,
  stateCodeFor,
  statesOf,
  writePlace,
} from '../../shared/roadtrip/place-style';
import type { PlaceStyle, TripDoc, TripPlace } from '../../shared/roadtrip/trip-types';
import SectionLegend from '../../shared/ui/SectionLegend';
import { inputClass } from './panels/ui';

/**
 * The Places section of the trip settings: how a place is WRITTEN on the two
 * kinds of surface, and the trip's own table of state codes.
 *
 * The table lists every state the trip's places name, with the code each one
 * resolves to today and where that code comes from; typing in a row writes
 * the trip's table, and emptying it takes the line out. No table of codes is
 * shipped with the app — the maintainer's call (2026-10-02): a traveller
 * meets a dozen states, and a table for every country is weight. A line can
 * also be written from a place's own editor («Keep NSW for New South Wales
 * on this trip»), which lands here.
 */
export default function PlacesSettingsPanel({ trip, onChange }: { trip: TripDoc; onChange: (trip: TripDoc) => void }) {
  const states = statesOf(trip);
  // Lines of the table whose state no place names any more — kept, said.
  const orphans = Object.keys(trip.stateCodes).filter((s) => !states.some((n) => n.toLowerCase() === s.toLowerCase()));
  const sample: TripPlace =
    trip.stages.flatMap((s) => s.places).find((p) => p.name.trim() && p.state.trim()) ??
    { id: '', name: 'Sydney', state: 'New South Wales', searchCode: 'NSW', coords: null };
  const example = (style: PlaceStyle) => writePlace(sample, style, trip);
  const placesIn = (state: string) =>
    trip.stages.flatMap((s) => s.places).filter((p) => p.state.trim().toLowerCase() === state.toLowerCase());

  const setStyle = (surface: 'badge' | 'lists', style: PlaceStyle) =>
    onChange({ ...trip, placeStyle: { ...trip.placeStyle, [surface]: style } });

  return (
    <>
      <SectionLegend label="Places">
        <p>
          A place keeps its name, its state and that state’s short code, its country and,
          when you want them, the days you reached and left it. How it is WRITTEN is a
          setting: one for the badges and the openers, where room is short, one for the
          lists, the legs, the calendar and the map. A stage or a single place can depart
          from them — the nearest choice wins, like the look.
        </p>
        <p>
          A state’s code comes from the place’s own, else this table, else what the
          search gave, else the state’s initials — said as such, because initials are
          right for New South Wales and wrong for Queensland. Nothing is shipped: this
          table is this trip’s, filled one state at a time, and it travels in the backup.
        </p>
      </SectionLegend>

      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2.5 items-center max-w-[36rem] max-[820px]:grid-cols-1">
        {(
          [
            ['badge', 'On the badges and the openers'],
            ['lists', 'In the lists, the legs, the calendar and the map'],
          ] as const
        ).map(([surface, label]) => (
          <label key={surface} className="contents">
            <span className="text-xs text-muted">{label}</span>
            <select
              value={trip.placeStyle[surface]}
              onChange={(e) => setStyle(surface, e.target.value as PlaceStyle)}
              aria-label={`Places written ${label.toLowerCase()}`}
              className={`${inputClass} w-full`}
            >
              {PLACE_STYLE_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {example(o.id)} · {o.label.toLowerCase()}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      <span className="font-mono text-2xs tracking-[0.14em] uppercase text-muted">State codes</span>
      {states.length === 0 && orphans.length === 0 ? (
        <span className="text-2xs text-faint">
          No place of this trip names a state yet — the table fills from the places, or from a search.
        </span>
      ) : (
        <div className="border border-line rounded-paper overflow-x-auto max-w-[44rem]" data-state-codes>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="text-left font-mono text-3xs tracking-[0.1em] uppercase text-muted">
                <th className="px-3 py-1.5 font-normal">State</th>
                <th className="px-3 py-1.5 font-normal">Code on this trip</th>
                <th className="px-3 py-1.5 font-normal">Read today</th>
                <th className="px-3 py-1.5 font-normal text-right">Places</th>
              </tr>
            </thead>
            <tbody>
              {[...states, ...orphans].map((state) => {
                const places = placesIn(state);
                // What a place of this state with no code of its own reads now —
                // the first such place says it, else a bare place of the state.
                const probe = places.find((p) => !p.stateCode) ?? { state };
                const resolved = stateCodeFor(probe, trip);
                const own = places.filter((p) => p.stateCode).length;
                return (
                  <tr key={state} className="border-t border-line" data-state={state}>
                    <td className="px-3 py-1.5 text-ink">
                      {state}
                      {places.length === 0 && <span className="ml-1.5 text-faint">· no place names it</span>}
                    </td>
                    <td className="px-3 py-1.5">
                      <input
                        value={trip.stateCodes[state] ?? ''}
                        onChange={(e) => onChange(rememberStateCode(trip, state, e.target.value.toUpperCase()))}
                        placeholder={deriveStateCode(state) || '—'}
                        aria-label={`Code for ${state}`}
                        maxLength={6}
                        className={`${inputClass} h-[1.9rem] w-[5.5rem] font-mono uppercase`}
                      />
                    </td>
                    <td className="px-3 py-1.5 font-mono text-ink-soft whitespace-nowrap">
                      {resolved.code || '—'}
                      <span className="ml-1.5 font-sans text-muted">{CODE_FROM_WORDS[resolved.from]}</span>
                      {own > 0 && (
                        <span className="ml-1.5 font-sans text-faint">
                          · {own} with {own === 1 ? 'its' : 'their'} own
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-muted tabular-nums">{places.length}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <span className="text-2xs text-faint">
        A code typed here is read by every place of that state that has no code of its own; a place may
        still prefer the search’s or its own, from its editor on the stage. Empty a cell to take the line out.
      </span>
    </>
  );
}
