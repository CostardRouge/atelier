import { useMemo, useState } from 'react';
import { vehicleModel, VEHICLE_MODELS } from '../../shared/roadtrip/hooks/vehicle-registry';
import { stageTint } from '../../shared/roadtrip/stage-ruler';
import {
  stagesInOrder,
  tripHops,
  withCrossBoat,
  withHopChoice,
  withStageVehicle,
  type HopWhy,
  type TripHop,
} from '../../shared/roadtrip/trip-hops';
import { stageLabel } from '../../shared/roadtrip/trip-places';
import type { TripDoc } from '../../shared/roadtrip/trip-types';
import { mainVehicle, type TripVehicle, type VehicleRef } from '../../shared/roadtrip/vehicle-fleet';
import { vehicleKind, type VehicleModelId } from '../../shared/roadtrip/vehicle-spec';
import { FieldRow, SelectField, SwitchRow, ToggleField } from '../../shared/ui/Inspector';
import { inputClass, linkButton } from './panels/ui';
import { useLandIndex } from './use-land-index';
import VehicleRefSelect from './VehicleRefSelect';

const BOATS = VEHICLE_MODELS.filter((m) => m.kind === 'boat').map((m) => ({ id: m.id, label: m.name }));

/** A vehicle's short name, from the fleet or the registry. */
function refModel(ref: VehicleRef, fleet: readonly TripVehicle[]): string {
  if ('borrow' in ref) return ref.borrow;
  return (fleet.find((v) => v.id === ref.fleet) ?? mainVehicle(fleet)).spec.model;
}

const refShort = (ref: VehicleRef, fleet: readonly TripVehicle[]) => vehicleModel(refModel(ref, fleet)).short;

const WHY: Record<HopWhy, string> = {
  flown: 'not driven',
  place: 'set here',
  water: 'water',
  stage: 'stage',
  trip: 'trip',
};

const WHY_TITLE: Record<HopWhy, string> = {
  flown: 'Marked not driven — a flight, a train: Virée fades the vehicle out and dashes the trail',
  place: 'Chosen for this hop, over the stage and the water',
  water: 'Crosses the sea, so the water rule sails it',
  stage: 'The stage’s vehicle',
  trip: 'The trip’s main vehicle',
};

const km = (v: number) => `${Math.round(v).toLocaleString('en')} km`;

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
  const [open, setOpen] = useState<string | null>(null);
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
            <span className="flex-1 min-w-0 truncate text-xs text-ink font-medium">{stageLabel(stage) || 'Unnamed stage'}</span>
            <VehicleRefSelect
              value={stage.vehicle}
              fleet={trip.vehicles}
              inherit={`Main vehicle · ${vehicleModel(main.spec.model).short}`}
              label={`What ${stageLabel(stage) || 'this stage'} drives`}
              onChange={(ref) => onChange(withStageVehicle(trip, stage.id, ref ?? null))}
              className={`${inputClass} !h-8 !text-xs max-w-[11rem]`}
            />
          </div>
          <ul className="m-0 p-0 list-none flex flex-col">
            {hops
              .filter((h) => h.stageId === stage.id)
              .map((hop) => (
                <HopRow
                  key={hop.to.id}
                  hop={hop}
                  trip={trip}
                  open={open === hop.to.id}
                  onToggle={() => setOpen(open === hop.to.id ? null : hop.to.id)}
                  onChange={onChange}
                />
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function HopRow({
  hop,
  trip,
  open,
  onToggle,
  onChange,
}: {
  hop: TripHop;
  trip: TripDoc;
  open: boolean;
  onToggle: () => void;
  onChange: (next: TripDoc) => void;
}) {
  const fleet = trip.vehicles;
  const name = refShort(hop.ref, fleet);
  const boat = hop.boat ? refShort(hop.boat.ref, fleet) : null;
  const line =
    hop.why === 'flown'
      ? 'Not driven'
      : boat && hop.sea
        ? `${name} → ${boat} ${km(hop.sea.water)}${hop.sea.after > 1 ? ` → ${name}` : ''}`
        : name;
  return (
    <li className="border-t border-line first:border-t-0" data-hop={hop.to.id}>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="w-full flex flex-col gap-1 py-2 px-1 bg-transparent border-0 text-left cursor-pointer rounded-control hover:bg-paper focus:outline-none focus-visible:ring-2 focus-visible:ring-accent pointer-coarse:min-h-11"
      >
        <span className="w-full flex items-baseline gap-2 text-xs">
          <span className="flex-1 min-w-0 truncate text-ink-soft">
            {hop.from.name} → <span className="text-ink">{hop.to.name}</span>
          </span>
          <span className="flex-none font-mono text-2xs text-faint tabular-nums">{km(hop.km)}</span>
        </span>
        <HopBar hop={hop} />
        <span className="w-full flex items-center gap-2 text-2xs">
          <span className={`flex-1 min-w-0 truncate ${hop.wet ? 'text-warn' : 'text-muted'}`}>
            {hop.wet && hop.sea ? `${name} drives over ${km(hop.sea.water)} of sea` : line}
          </span>
          <span
            title={WHY_TITLE[hop.why]}
            className={`flex-none font-mono uppercase tracking-[0.08em] text-3xs px-1.5 py-px rounded-full border ${
              hop.why === 'place' || hop.boat?.own
                ? 'border-accent/40 text-accent-ink'
                : hop.why === 'water'
                  ? 'border-info-line text-info'
                  : 'border-line text-faint'
            }`}
          >
            {hop.boat?.own ? 'boat set here' : WHY[hop.why]}
          </span>
        </span>
      </button>
      {open && <HopEditor hop={hop} trip={trip} onChange={onChange} />}
    </li>
  );
}

/** The hop's make-up along its straight line: road, sea sailed (blue) or driven over (amber), or dashed when not driven. */
function HopBar({ hop }: { hop: TripHop }) {
  if (hop.why === 'flown') {
    return <span className="block w-full h-1 border-t-2 border-dashed border-faint" aria-hidden="true" />;
  }
  const sea = hop.sea;
  const total = hop.km || 1;
  const water = sea?.water ?? 0;
  const before = sea ? sea.before : total;
  const after = sea ? sea.after : 0;
  return (
    <span className="flex w-full h-1 rounded-full overflow-hidden bg-line" aria-hidden="true">
      {before > 0 && <span className="h-full bg-ink-soft" style={{ width: `${(before / total) * 100}%` }} />}
      {water > 0 && (
        <span className={`h-full ${hop.wet ? 'bg-warn-bright' : 'bg-info'}`} style={{ width: `${(water / total) * 100}%` }} />
      )}
      {after > 0 && <span className="h-full bg-ink-soft" style={{ width: `${(after / total) * 100}%` }} />}
    </span>
  );
}

function HopEditor({ hop, trip, onChange }: { hop: TripHop; trip: TripDoc; onChange: (next: TripDoc) => void }) {
  const fleet = trip.vehicles;
  const place = hop.to;
  const rule = trip.crossings;
  const decided = hop.why === 'place' || hop.why === 'flown' ? null : hop;
  const roadSays = decided
    ? decided.boat
      ? `${refShort(decided.ref, fleet)} + ${refShort(decided.boat.ref, fleet)}`
      : refShort(decided.ref, fleet)
    : rule.auto
      ? 'a boat on water'
      : 'the stage’s vehicle';
  const sails = !place.flown && !place.arriveBy && rule.auto && !!hop.sea?.water;
  // What sails it when the place names no boat: the stage's own boat, else the rule's.
  const fallbackBoat = vehicleKind(refModel(hop.ref, fleet)) === 'boat' ? refShort(hop.ref, fleet) : vehicleModel(rule.boat).short;
  return (
    <div className="flex flex-col gap-2 px-1 pb-3" data-hop-editor>
      <div className="flex items-center gap-3 text-xs text-ink-soft">
        <span className="flex-1 min-w-0">Not driven — a flight, a train</span>
        <ToggleField
          label={`${hop.from.name} → ${hop.to.name} was not driven`}
          checked={!!place.flown}
          onChange={(flown) => onChange(withHopChoice(trip, place.id, flown ? { kind: 'flown' } : { kind: 'auto' }))}
        />
      </div>
      {!place.flown && (
        <FieldRow label="Whole hop">
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <VehicleRefSelect
              value={place.arriveBy}
              fleet={fleet}
              inherit={`The road decides · ${roadSays}`}
              label={`What makes ${hop.from.name} → ${hop.to.name}`}
              onChange={(ref) => onChange(withHopChoice(trip, place.id, ref ? { kind: 'vehicle', ref } : { kind: 'auto' }))}
              className={`${inputClass} !h-8 !text-xs max-w-[13rem]`}
            />
          </span>
        </FieldRow>
      )}
      {sails && (
        <FieldRow label="Boat here">
          <select
            value={place.crossBy && 'borrow' in place.crossBy ? place.crossBy.borrow : ''}
            aria-label={`The boat for the crossing to ${hop.to.name}`}
            title={`The boat for the crossing to ${hop.to.name}`}
            onChange={(e) => onChange(withCrossBoat(trip, place.id, e.target.value ? { borrow: e.target.value as VehicleModelId } : null))}
            className={`${inputClass} !h-8 !text-xs max-w-[13rem]`}
          >
            <option value="">Not set here · {fallbackBoat}</option>
            {BOATS.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </FieldRow>
      )}
    </div>
  );
}
