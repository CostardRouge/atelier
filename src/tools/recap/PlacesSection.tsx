import { withRecap, type RecapDoc } from '../../shared/recap/recap-doc';
import { placeName, type PinCorner, type PlaceMarks } from '../../shared/recap/recap-places';
import { InspectorSection, ToggleField } from '../../shared/ui/Inspector';
import Segmented from '../../shared/ui/Segmented';
import type { Change } from './RecapPanels';

const MARKS_LABEL: Record<Exclude<PlaceMarks, 'off'>, string> = { changes: 'Where it changes', every: 'Every cell', first: 'First of each' };
const MARKS_HINT: Record<Exclude<PlaceMarks, 'off'>, string> = {
  changes: 'On the first picture of a new town — a route read at a glance',
  every: 'On every picture that knows its town',
  first: 'Once per town, on its first picture',
};
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
  return (
    <InspectorSection
      id="recap-places"
      title="Places"
      info="The town each picture was taken in, as Winnow named it, with one mark — the pin."
      marked={on}
      mark={<ToggleField checked={on} onChange={(v) => set({ cells: v ? 'changes' : 'off' })} label="The place on the cells" />}
    >
      <div className={`flex flex-col gap-2 ${on ? '' : 'opacity-45'}`}>
        <Segmented<Exclude<PlaceMarks, 'off'>>
          size="sm"
          fill
          label="Which cells say their place"
          value={on ? (p.cells as Exclude<PlaceMarks, 'off'>) : 'changes'}
          onChange={(cells) => set({ cells })}
          options={(['changes', 'every', 'first'] as const).map((id) => ({ id, label: MARKS_LABEL[id], title: MARKS_HINT[id] }))}
        />
        <Segmented<PinCorner>
          size="sm"
          columns={2}
          label="The corner it sits in"
          value={p.corner}
          onChange={(corner) => set({ corner, ...(on ? {} : { cells: 'changes' as const }) })}
          options={(['bottomLeft', 'topLeft', 'topRight', 'bottomRight'] as const).map((id) => ({ id, label: CORNER_LABEL[id] }))}
        />
        {!known && doc.pictures.length > 0 && <p className="m-0 text-2xs text-muted">No picture here knows its town yet — Winnow names them from their GPS when it fills the recap.</p>}
      </div>
    </InspectorSection>
  );
}
