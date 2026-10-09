import { vehicleLine } from '../../shared/roadtrip/vehicle-spec';
import { VEHICLE_MODELS, vehicleModel } from '../../shared/roadtrip/hooks/vehicle-registry';
import { swatchClass } from '../../shared/ui/Inspector';
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
 *
 * A BORROWED model comes with its paint (`VehicleRef.color`, 2026-10-09): the
 * model's named colours and a colour of one's own, drawn beside the select —
 * for this stage or this hop only, as the Virée panel's Paint row does for a
 * whole piece. Empty is the model as it comes; another model drops the paint.
 * A fleet vehicle is dressed in the garage, so it shows none.
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
  const borrowed = value && 'borrow' in value ? value : null;
  const line = borrowed ? vehicleLine(borrowed.borrow) : null;
  const paint = borrowed ? (borrowed.color ?? line!.color) : '';
  const setPaint = (hex: string) =>
    onChange(borrowed ? (hex.toLowerCase() === line!.color ? { borrow: borrowed.borrow } : { borrow: borrowed.borrow, color: hex.toLowerCase() }) : value);
  return (
    <>
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
    {borrowed && line && (
      <span className="inline-flex flex-wrap items-center gap-1" role="group" aria-label="Paint">
        {line.colours.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-label={c.name}
            aria-pressed={c.hex === paint}
            title={c.note ? `${c.name} — ${c.note}` : c.name}
            onClick={() => setPaint(c.hex)}
            className={`flex-none w-5 h-5 p-0 rounded-full border-2 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              c.hex === paint ? 'border-accent' : 'border-line-strong hover:border-muted'
            }`}
            style={{ background: c.hex }}
          />
        ))}
        <input
          type="color"
          value={paint}
          onChange={(e) => setPaint(e.target.value)}
          aria-label="A paint of its own"
          title="A paint of its own"
          className={swatchClass}
        />
      </span>
    )}
    </>
  );
}
