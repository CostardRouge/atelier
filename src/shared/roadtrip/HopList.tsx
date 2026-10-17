import { useState, type ReactNode } from 'react';
import { FieldRow, ToggleField, fieldClass } from '../ui/Inspector';
import { vehicleModel, VEHICLE_MODELS } from './hooks/vehicle-registry';
import type { HopChoice, HopLine, HopWhy } from './trip-hops';
import { mainVehicle, type TripVehicle, type VehicleRef } from './vehicle-fleet';
import VehicleRefSelect from './VehicleRefSelect';
import { vehicleKind, type VehicleModelId } from './vehicle-spec';

const BOATS = VEHICLE_MODELS.filter((m) => m.kind === 'boat').map((m) => ({ id: m.id, label: m.name }));

function refModel(ref: VehicleRef, fleet: readonly TripVehicle[]): string {
  if ('borrow' in ref) return ref.borrow;
  return (fleet.find((v) => v.id === ref.fleet) ?? mainVehicle(fleet)).spec.model;
}

/** A vehicle's short name, from the fleet or the registry. */
export const refShort = (ref: VehicleRef, fleet: readonly TripVehicle[]) => vehicleModel(refModel(ref, fleet)).short;

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

export interface HopListProps {
  lines: readonly HopLine[];
  fleet: readonly TripVehicle[];
  /** The trip's water rule: whether a hop at sea sails, and on which boat. */
  ruleAuto: boolean;
  ruleBoat: VehicleModelId;
  /** Write how the hop leading to a place is made; absent: the rows are read only. */
  onChoose?: (placeId: string, choice: HopChoice) => void;
  /** Write the boat for that hop's water; null gives it back to the rule. */
  onCrossBoat?: (placeId: string, boat: VehicleRef | null) => void;
}

/**
 * Hops as rows (2026-10-17, the Trajet band): from → to, the kilometres, a bar
 * of road and sea, the vehicle and WHY, and a tap that opens the hop's three
 * choices — not driven, one vehicle for the whole hop, a boat for this
 * crossing. One list for the overview's band and the Virée panel, so the two
 * say the same thing in the same words; what a choice WRITES is the host's.
 */
export default function HopList({ lines, fleet, ruleAuto, ruleBoat, onChoose, onCrossBoat }: HopListProps) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ul className="m-0 p-0 list-none flex flex-col">
      {lines.map((line) => (
        <HopRow
          key={line.key}
          line={line}
          fleet={fleet}
          open={open === line.key}
          onToggle={onChoose && line.place ? () => setOpen(open === line.key ? null : line.key) : undefined}
        >
          {open === line.key && onChoose && line.place && (
            <HopEditor
              line={line}
              place={line.place}
              fleet={fleet}
              ruleAuto={ruleAuto}
              ruleBoat={ruleBoat}
              onChoose={onChoose}
              onCrossBoat={onCrossBoat}
            />
          )}
        </HopRow>
      ))}
    </ul>
  );
}

function HopRow({
  line,
  fleet,
  open,
  onToggle,
  children,
}: {
  line: HopLine;
  fleet: readonly TripVehicle[];
  open: boolean;
  /** Absent: a row that says and offers nothing (a stop that is no trip place). */
  onToggle?: () => void;
  children?: ReactNode;
}) {
  const name = refShort(line.ref, fleet);
  const boat = line.boat ? refShort(line.boat.ref, fleet) : null;
  const says =
    line.why === 'flown'
      ? 'Not driven'
      : line.wet && line.sea
        ? `${name} drives over ${km(line.sea.water)} of sea`
        : boat && line.sea
          ? `${name} → ${boat} ${km(line.sea.water)}${line.sea.after > 1 ? ` → ${name}` : ''}`
          : name;
  const body = (
    <>
      <span className="w-full flex items-baseline gap-2 text-xs">
        <span className="flex-1 min-w-0 truncate text-ink-soft">
          {line.from} → <span className="text-ink">{line.to}</span>
        </span>
        <span className="flex-none font-mono text-2xs text-faint tabular-nums">{km(line.km)}</span>
      </span>
      <HopBar line={line} />
      <span className="w-full flex items-center gap-2 text-2xs">
        <span className={`flex-1 min-w-0 truncate ${line.wet ? 'text-warn' : 'text-muted'}`}>{says}</span>
        <span
          title={WHY_TITLE[line.why]}
          className={`flex-none font-mono uppercase tracking-[0.08em] text-3xs px-1.5 py-px rounded-full border ${
            line.why === 'place' || line.boat?.own
              ? 'border-accent/40 text-accent-ink'
              : line.why === 'water'
                ? 'border-info-line text-info'
                : 'border-line text-faint'
          }`}
        >
          {line.boat?.own ? 'boat set here' : WHY[line.why]}
        </span>
      </span>
    </>
  );
  return (
    <li className="border-t border-line first:border-t-0" data-hop={line.key}>
      {onToggle ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="w-full flex flex-col gap-1 py-2 px-1 bg-transparent border-0 text-left cursor-pointer rounded-control hover:bg-paper focus:outline-none focus-visible:ring-2 focus-visible:ring-accent pointer-coarse:min-h-11"
        >
          {body}
        </button>
      ) : (
        <div className="w-full flex flex-col gap-1 py-2 px-1">{body}</div>
      )}
      {children}
    </li>
  );
}

/** The hop's make-up: road, sea sailed (blue) or driven over (amber), or dashed when not driven. */
function HopBar({ line }: { line: HopLine }) {
  if (line.why === 'flown') {
    return <span className="block w-full h-1 border-t-2 border-dashed border-faint" aria-hidden="true" />;
  }
  const sea = line.sea;
  const total = line.km || 1;
  const water = sea?.water ?? 0;
  const before = sea ? sea.before : total;
  const after = sea ? sea.after : 0;
  return (
    <span className="flex w-full h-1 rounded-full overflow-hidden bg-line" aria-hidden="true">
      {before > 0 && <span className="h-full bg-ink-soft" style={{ width: `${(before / total) * 100}%` }} />}
      {water > 0 && (
        <span className={`h-full ${line.wet ? 'bg-warn-bright' : 'bg-info'}`} style={{ width: `${(water / total) * 100}%` }} />
      )}
      {after > 0 && <span className="h-full bg-ink-soft" style={{ width: `${(after / total) * 100}%` }} />}
    </span>
  );
}

function HopEditor({
  line,
  place,
  fleet,
  ruleAuto,
  ruleBoat,
  onChoose,
  onCrossBoat,
}: {
  line: HopLine;
  place: NonNullable<HopLine['place']>;
  fleet: readonly TripVehicle[];
  ruleAuto: boolean;
  ruleBoat: VehicleModelId;
  onChoose: (placeId: string, choice: HopChoice) => void;
  onCrossBoat?: (placeId: string, boat: VehicleRef | null) => void;
}) {
  const decided = line.why === 'place' || line.why === 'flown' ? null : line;
  const roadSays = decided
    ? decided.boat
      ? `${refShort(decided.ref, fleet)} + ${refShort(decided.boat.ref, fleet)}`
      : refShort(decided.ref, fleet)
    : ruleAuto
      ? 'a boat on water'
      : 'the stage’s vehicle';
  // What sails it when the place names no boat: the stage's own boat, else the rule's.
  const fallbackBoat = vehicleKind(refModel(line.ref, fleet)) === 'boat' ? refShort(line.ref, fleet) : vehicleModel(ruleBoat).short;
  return (
    <div className="flex flex-col gap-2 px-1 pb-3" data-hop-editor>
      <div className="flex items-center gap-3 text-xs text-ink-soft">
        <span className="flex-1 min-w-0">Not driven — a flight, a train</span>
        <ToggleField
          label={`${line.from} → ${line.to} was not driven`}
          checked={!!place.flown}
          onChange={(flown) => onChoose(place.id, flown ? { kind: 'flown' } : { kind: 'auto' })}
        />
      </div>
      {!place.flown && (
        <FieldRow label="Whole hop">
          <span className="inline-flex flex-wrap items-center gap-1.5 min-w-0">
            <VehicleRefSelect
              value={place.arriveBy}
              fleet={fleet}
              inherit={`The road decides · ${roadSays}`}
              label={`What makes ${line.from} → ${line.to}`}
              onChange={(ref) => onChoose(place.id, ref ? { kind: 'vehicle', ref } : { kind: 'auto' })}
              className={fieldClass}
            />
          </span>
        </FieldRow>
      )}
      {line.why === 'water' && onCrossBoat && (
        <FieldRow label="Boat here">
          <select
            value={place.crossBy && 'borrow' in place.crossBy ? place.crossBy.borrow : ''}
            aria-label={`The boat for the crossing to ${line.to}`}
            title={`The boat for the crossing to ${line.to}`}
            onChange={(e) => onCrossBoat(place.id, e.target.value ? { borrow: e.target.value as VehicleModelId } : null)}
            className={fieldClass}
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
