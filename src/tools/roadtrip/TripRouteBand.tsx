import { useMemo } from 'react';
import HopList from '../../shared/roadtrip/HopList';
import { vehicleModel, VEHICLE_MODELS } from '../../shared/roadtrip/hooks/vehicle-registry';
import { stageTint } from '../../shared/roadtrip/stage-ruler';
import { stagesInOrder, tripHops, withCrossBoat, withHopChoice, withStageVehicle } from '../../shared/roadtrip/trip-hops';
import { stageLabel } from '../../shared/roadtrip/trip-places';
import type { TripDoc } from '../../shared/roadtrip/trip-types';
import { mainVehicle } from '../../shared/roadtrip/vehicle-fleet';
import VehicleRefSelect from '../../shared/roadtrip/VehicleRefSelect';
import { FieldRow, SelectField, SwitchRow } from '../../shared/ui/Inspector';
import { inputClass, linkButton } from './panels/ui';
import { useLandIndex } from './use-land-index';

const BOATS = VEHICLE_MODELS.filter((m) => m.kind === 'boat').map((m) => ({ id: m.id, label: m.name }));

/**
 * The TRAJET band (2026-10-17, face A of the lab
 * https://claude.ai/artifact/RrtxniqsSSYW3sKNkCS1kY): every hop of the trip
 * from place to place, the vehicle that makes it and WHY — set here, water,
 * stage, trip, not driven — and one tap to change it, in the one place the
 * road can be read whole: the overview's Map view. It writes the very fields
 * the stage card, the place and ⚙ Trip → Vehicle write (`trip-hops.ts`), so
 * nothing here is a second model; the water is read on the straight line, so
 * it names which hops cross the sea and roughly how far.
 */
export default function TripRouteBand({
  trip,
  onChange,
  onOpenVehicle,
}: {
  trip: TripDoc;
  onChange: (next: TripDoc) => void;
  onOpenVehicle: () => void;
}) {
  const land = useLandIndex(true);
  const hops = useMemo(() => tripHops(trip, land), [trip, land]);
  const rule = trip.crossings;
  const main = mainVehicle(trip.vehicles);
  const atSea = hops.filter((h) => h.sea?.water).length;
  const wet = hops.filter((h) => h.wet).length;
  const stages = stagesInOrder(trip.stages).filter((s) => hops.some((h) => h.stageId === s.id));

  return (
    <div className="flex flex-col gap-3" data-route-band>
      <div className="flex flex-col gap-2">
        <p className="m-0 flex items-baseline gap-2 text-xs text-muted">
          <span className="text-ink font-medium">Vehicles along the trip</span>
          <span className="font-mono text-2xs">
            {hops.length} hop{hops.length === 1 ? '' : 's'}
            {land ? ` · ${atSea} at sea` : ' · reading the coast…'}
          </span>
        </p>
        <SwitchRow
          label="On water, a boat by itself"
          checked={rule.auto}
          onChange={(auto) => onChange({ ...trip, crossings: { ...rule, auto, asked: true } })}
          hintShown={wet > 0}
          hint={
            wet > 0 ? (
              <p className="text-warn">
                {wet} hop{wet === 1 ? '' : 's'} drive{wet === 1 ? 's' : ''} straight over the sea.
              </p>
            ) : (
              <p>A hop from one land to another sails; the drawn line is straight, so read the kilometres as rough.</p>
            )
          }
        />
        {rule.auto && (
          <FieldRow label="Boat">
            <SelectField
              value={rule.boat}
              options={BOATS}
              label="The boat a crossing takes"
              onChange={(boat) => onChange({ ...trip, crossings: { ...rule, boat } })}
            />
          </FieldRow>
        )}
        <div>
          <button type="button" className={linkButton} onClick={onOpenVehicle}>
            The fleet and the bridge and shore distances
          </button>
        </div>
      </div>

      {!hops.length && <p className="m-0 text-xs text-muted">No two located places yet: nothing to drive.</p>}

      {stages.map((stage) => (
        <section key={stage.id} className="flex flex-col gap-1" aria-label={stageLabel(stage) || 'Unnamed stage'}>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span
              className="flex-none w-2 h-2 rounded-full"
              style={{ background: stageTint(trip.stages.indexOf(stage)) }}
              aria-hidden="true"
            />
            <span className="min-w-0 max-w-full truncate text-xs text-ink font-medium">{stageLabel(stage) || 'Unnamed stage'}</span>
            <VehicleRefSelect
              value={stage.vehicle}
              fleet={trip.vehicles}
              inherit={`Main vehicle · ${vehicleModel(main.spec.model).short}`}
              label={`What ${stageLabel(stage) || 'this stage'} drives`}
              onChange={(ref) => onChange(withStageVehicle(trip, stage.id, ref ?? null))}
              className={`${inputClass} min-w-0 flex-1 basis-44`}
            />
          </div>
          <HopList
            lines={hops.filter((h) => h.stageId === stage.id)}
            fleet={trip.vehicles}
            ruleAuto={rule.auto}
            ruleBoat={rule.boat}
            onChoose={(placeId, choice) => onChange(withHopChoice(trip, placeId, choice))}
            onCrossBoat={(placeId, boat) => onChange(withCrossBoat(trip, placeId, boat))}
          />
        </section>
      ))}
    </div>
  );
}
