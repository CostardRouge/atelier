import { withRecap, type RecapDoc } from '../../shared/recap/recap-doc';
import { knownPlaces, placeName, writtenPlace, type PinCorner, type PlaceCountry, type PlaceMarks } from '../../shared/recap/recap-places';
import { PLACE_STYLE_OPTIONS } from '../../shared/roadtrip/place-style';
import { InspectorSection, ToggleField } from '../../shared/ui/Inspector';
import Segmented from '../../shared/ui/Segmented';
import type { Change } from './RecapPanels';

const MARKS_LABEL: Record<Exclude<PlaceMarks, 'off'>, string> = { changes: 'Where it changes', every: 'Every cell', first: 'First of each' };
const MARKS_HINT: Record<Exclude<PlaceMarks, 'off'>, string> = {
  changes: 'On the first picture of a new town — a route read at a glance',
  every: 'On every picture that knows its town',
  first: 'Once per town, on its first picture',
};
const COUNTRY_LABEL: Record<PlaceCountry, string> = { never: 'Never', changes: 'When it changes', always: 'Always' };
const COUNTRY_HINT: Record<PlaceCountry, string> = {
  never: 'The place alone',
  changes: 'On the first pill, then again only after a border',
  always: 'On every pill',
};
/** What the writings are drawn on when the recap knows no town with its region yet. */
const SAMPLE = { place: 'Albany', region: 'Western Australia', country: 'Australia' };
const legend = 'font-mono text-2xs tracking-[0.14em] uppercase text-muted';

const CORNER_LABEL: Record<PinCorner, string> = { bottomLeft: 'Bottom left', topLeft: 'Top left', topRight: 'Top right', bottomRight: 'Bottom right' };

/**
 * Layout › *Places* (lab 11, his yes of 2026-11-07): the town in a pill — the
 * Maps pin in the accent on glass — in a cell's corner, off until he turns it
 * on, then only where the place changes unless he asks otherwise.
 */
export default function PlacesSection({ doc, change }: { doc: RecapDoc; change: Change }) {
  const p = doc.places;
  const set = (patch: Partial<RecapDoc['places']>) => change((d) => withRecap(d, { places: { ...d.places, ...patch } }));
  const on = p.cells !== 'off';
  const known = doc.pictures.some((x) => placeName(x));
  const sample = knownPlaces(doc.pictures, 40).find((x) => x.place && x.region) ?? SAMPLE;
  return (
    <InspectorSection
      id="recap-places"
      title="Places"
      info="The town each picture was taken in, as Winnow named it or as you gave it (in its card, Pictures), with one mark — the pin. Written as Trips writes a place."
      marked={on}
      mark={<ToggleField checked={on} onChange={(v) => set({ cells: v ? 'changes' : 'off' })} label="The place on the cells" />}
    >
      <div className="flex flex-col gap-2">
        <div className={`flex flex-col gap-2 ${on ? '' : 'opacity-45'}`}>
          <span className="font-mono text-2xs tracking-[0.14em] uppercase text-muted">On the cells</span>
          <Segmented<Exclude<PlaceMarks, 'off'>>
            size="sm"
            fill
            label="Which cells say their place"
            value={on ? (p.cells as Exclude<PlaceMarks, 'off'>) : 'changes'}
            onChange={(cells) => set({ cells })}
            options={(['changes', 'every', 'first'] as const).map((id) => ({ id, label: MARKS_LABEL[id], title: MARKS_HINT[id] }))}
          />
          {/* How the place is written (lab 17 part III): Trips' writings, drawn on a place of the recap. */}
          <span className={legend}>Written</span>
          <div role="group" aria-label="How a place is written" className="grid grid-cols-2 gap-1">
            {PLACE_STYLE_OPTIONS.map((o) => (
              <button
                key={o.id}
                type="button"
                aria-pressed={p.writing === o.id}
                title={o.label}
                onClick={() => set({ writing: o.id })}
                className={`min-w-0 text-left px-2.5 py-1.5 pointer-coarse:min-h-11 rounded-[9px] border cursor-pointer ${p.writing === o.id ? 'border-ink bg-surface shadow-[inset_0_0_0_1px_var(--color-ink)]' : 'border-line bg-paper hover:border-line-strong'}`}
              >
                <b className="block truncate text-xs font-semibold text-ink">{writtenPlace(sample, o.id)}</b>
                <small className="block font-mono text-3xs text-muted">{o.label}</small>
              </button>
            ))}
          </div>
          <span className={legend}>The country</span>
          <Segmented<PlaceCountry>
            size="sm"
            fill
            label="The country after the place"
            value={p.country}
            onChange={(country) => set({ country })}
            options={(['never', 'changes', 'always'] as const).map((id) => ({ id, label: COUNTRY_LABEL[id], title: COUNTRY_HINT[id] }))}
          />
          <Segmented<PinCorner>
            size="sm"
            columns={2}
            label="The corner it sits in"
            value={p.corner}
            onChange={(corner) => set({ corner, ...(on ? {} : { cells: 'changes' as const }) })}
            options={(['bottomLeft', 'topLeft', 'topRight', 'bottomRight'] as const).map((id) => ({ id, label: CORNER_LABEL[id] }))}
          />
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          {(doc.template === 'month' || doc.template === 'week') && (
            <span title="A line in the accent under the days spent in one place, the pin and its words on it — «Albany · 8–14»">
              <ToggleField checked={p.runs} onChange={(runs) => set({ runs })} label="Runs of days">
                Runs of days
              </ToggleField>
            </span>
          )}
          <span title="{place} in a text is the place you came back to most, the pin before it; {places} is the route">
            <ToggleField checked={p.titlePin} onChange={(titlePin) => set({ titlePin })} label="The pin before {place}">
              Pin before {'{place}'}
            </ToggleField>
          </span>
        </div>
        {!known && doc.pictures.length > 0 && <p className="m-0 text-2xs text-muted">No picture here knows its town yet — Winnow names them from their GPS when it fills the recap.</p>}
      </div>
    </InspectorSection>
  );
}
