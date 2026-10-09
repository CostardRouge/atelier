import { useState } from 'react';
import { VEHICLE_MODELS } from '../../shared/roadtrip/hooks/vehicle-registry';
import { CROSSING_LIMITS, DEFAULT_CROSSINGS, type TripCrossings } from '../../shared/roadtrip/vehicle-fleet';
import { FieldRow, FoldHints, RangeField, SelectField, SwitchRow } from '../../shared/ui/Inspector';
import { linkButton } from './panels/ui';

const BOATS = VEHICLE_MODELS.filter((m) => m.kind === 'boat').map((m) => ({ id: m.id, label: m.name }));

const km = (v: number) => `${v} km`;

/**
 * The trip's rule for WATER (2026-10-09, `terrain.ts`): whether a hop that
 * crosses the sea takes a boat by itself, which boat, and the two distances
 * the shipped coastline needs — a bridge and a shore. The distances are
 * folded under «Fine settings»: they correct the map, not the trip.
 */
export default function CrossingsPanel({
  value,
  onChange,
}: {
  value: TripCrossings | undefined;
  onChange: (crossings: TripCrossings) => void;
}) {
  const c = value ?? DEFAULT_CROSSINGS;
  const [fine, setFine] = useState(false);
  const set = (patch: Partial<TripCrossings>) => onChange({ ...c, ...patch });
  return (
    <FoldHints>
      <div className="pb-3 border-b border-line" data-crossings>
        <div className="flex flex-col gap-2.5 max-w-[36rem]">
          <SwitchRow
            label="On water, a boat by itself"
            checked={c.auto}
            onChange={(auto) => set({ auto })}
            hint={
              <>
                <p>
                  A hop sails when it goes from one land to another (Bass Strait, the
                  Whitsundays) or ends at sea; between two places of the same land the road
                  went round, so a bay the drawn line cuts stays driven.
                </p>
                <p>A river is too thin for the map: pick its boat on the place, under «Reached by».</p>
              </>
            }
          />
          {c.auto && (
            <>
              <FieldRow label="Boat">
                <SelectField value={c.boat} options={BOATS} label="The boat a crossing takes" onChange={(boat) => set({ boat })} />
              </FieldRow>
              {fine ? (
                <>
                  <FieldRow
                    label="Bridge"
                    hint="Water shorter than this between two lands is a bridge or a causeway: the vehicle stays on the road."
                  >
                    <RangeField
                      value={c.bridgeKm}
                      {...CROSSING_LIMITS.bridgeKm}
                      step={0.5}
                      format={km}
                      label="Bridge length"
                      onChange={(bridgeKm) => set({ bridgeKm })}
                    />
                  </FieldRow>
                  <FieldRow
                    label="Shore"
                    hint="A stop this close to a coast is ashore — the map’s coast is coarse, and a harbour town can fall in its sea."
                  >
                    <RangeField
                      value={c.shoreKm}
                      {...CROSSING_LIMITS.shoreKm}
                      step={1}
                      format={km}
                      label="Shore distance"
                      onChange={(shoreKm) => set({ shoreKm })}
                    />
                  </FieldRow>
                </>
              ) : (
                <div>
                  <button type="button" className={linkButton} onClick={() => setFine(true)}>
                    Fine settings
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </FoldHints>
  );
}
