import { VEHICLE_MODELS, vehicleModel } from '../../shared/roadtrip/hooks/vehicle-registry';
import { readVehicleRef, type TripVehicle, type VehicleRef } from '../../shared/roadtrip/vehicle-fleet';

/** A reference as an option's value, and back. */
function refValue(ref: VehicleRef | undefined): string {
  if (!ref) return '';
  return 'fleet' in ref ? `fleet:${ref.fleet}` : `borrow:${ref.borrow}`;
}

function refFrom(value: string): VehicleRef | undefined {
  if (value.startsWith('fleet:')) return readVehicleRef({ fleet: value.slice(6) });
  if (value.startsWith('borrow:')) return readVehicleRef({ borrow: value.slice(7) });
  return undefined;
}

/**
 * Which vehicle a stage drives or a place was reached by (`VehicleRef`): one
 * of the trip's fleet, or a model borrowed for the day — or nothing, which
 * leaves it to what decides by default, said in the first option. A fleet
 * vehicle the trip no longer holds stays listed as gone, so the select never
 * silently shows another one.
 */
export default function VehicleRefSelect({
  value,
  fleet,
  inherit,
  label,
  onChange,
  className = '',
}: {
  value: VehicleRef | undefined;
  fleet: readonly TripVehicle[];
  /** The first option: what an empty choice means here. */
  inherit: string;
  label: string;
  onChange: (ref: VehicleRef | undefined) => void;
  className?: string;
}) {
  const current = refValue(value);
  const missing = value && 'fleet' in value && !fleet.some((v) => v.id === value.fleet);
  return (
    <select
      value={current}
      aria-label={label}
      title={label}
      onChange={(e) => onChange(refFrom(e.target.value))}
      className={`max-[820px]:text-base ${className}`}
    >
      <option value="">{inherit}</option>
      <optgroup label="The trip’s vehicles">
        {fleet.map((v, i) => (
          <option key={v.id} value={`fleet:${v.id}`}>
            {vehicleModel(v.spec.model).short}
            {i === 0 ? ' · main' : ''}
          </option>
        ))}
        {missing && <option value={current}>A vehicle no longer in the trip</option>}
      </optgroup>
      <optgroup label="Borrowed for the day">
        {VEHICLE_MODELS.map((m) => (
          <option key={m.id} value={`borrow:${m.id}`}>
            {m.kind === 'boat' ? `${m.name} (boat)` : m.name}
          </option>
        ))}
      </optgroup>
    </select>
  );
}
