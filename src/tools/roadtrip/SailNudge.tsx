import { useMemo } from 'react';
import { vehicleModel } from '../../shared/roadtrip/hooks/vehicle-registry';
import { seaHops, shouldAskToSail } from '../../shared/roadtrip/sea-hops';
import type { TripDoc } from '../../shared/roadtrip/trip-types';
import Button from '../../shared/ui/Button';
import { useLandIndex } from './use-land-index';

/**
 * One question for a trip older than the water rule (2026-10-17, face B of
 * the Trajet lab): its migration turned `crossings.auto` off without asking,
 * so the vehicle drove straight over Bass Strait and nothing said so. Shown
 * only while the rule is off, nobody has answered and the shipped coastline
 * finds a hop at sea; either verb answers for good (`crossings.asked`), and
 * the switch in ⚙ Trip → Vehicle answers too.
 */
export default function SailNudge({
  trip,
  onChange,
  onOpenVehicle,
}: {
  trip: TripDoc;
  onChange: (next: TripDoc) => void;
  onOpenVehicle: () => void;
}) {
  const ask = shouldAskToSail(trip.crossings);
  const land = useLandIndex(ask);
  const hops = useMemo(
    () => (ask && land ? seaHops(trip.stages, land, trip.crossings) : []),
    [ask, land, trip.stages, trip.crossings],
  );
  if (!hops.length) return null;

  const answer = (auto: boolean) => onChange({ ...trip, crossings: { ...trip.crossings, auto, asked: true } });
  const named = hops.slice(0, 2).map((h) => `${h.from} → ${h.to}`).join(', ');
  const more = hops.length > 2 ? ` +${hops.length - 2}` : '';
  return (
    <div
      role="status"
      data-sail-nudge
      className="flex-none flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-1 mb-2 px-3 py-2 rounded-control border border-accent/40 bg-accent-wash text-sm"
    >
      <p className="m-0 flex-1 min-w-0 basis-60">
        <strong className="font-semibold">
          {hops.length} hop{hops.length === 1 ? '' : 's'} cross{hops.length === 1 ? 'es' : ''} the sea
        </strong>{' '}
        <span className="text-ink-soft">
          · {named}
          {more}. The vehicle drives straight over {hops.length === 1 ? 'it' : 'them'}.
        </span>
      </p>
      <Button
        size="sm"
        variant="primary"
        onClick={() => answer(true)}
        title={`Turn on «On water, a boat by itself»: each crossing on the ${vehicleModel(trip.crossings.boat).name}`}
      >
        Sail them
      </Button>
      <Button size="sm" variant="ghost" onClick={onOpenVehicle} title="Trip settings → Vehicle: the boat, the bridge and shore distances">
        Choose the boat
      </Button>
      <Button size="sm" variant="ghost" onClick={() => answer(false)} title="Keep driving over the water — the switch stays in Trip settings → Vehicle">
        Not now
      </Button>
    </div>
  );
}
