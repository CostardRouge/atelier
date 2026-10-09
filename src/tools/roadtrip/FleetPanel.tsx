import { useState, type ReactNode } from 'react';
import { colourName, type VehicleModelId } from '../../shared/roadtrip/vehicle-spec';
import { VEHICLE_MODELS, vehicleLabel, vehicleModel } from '../../shared/roadtrip/hooks/vehicle-registry';
import {
  addChange,
  addVehicle,
  makeMain,
  removeChange,
  removeVehicle,
  replaceVehicle,
  updateChange,
  vehicleOnDay,
  withLookOn,
  type TripVehicle,
} from '../../shared/roadtrip/vehicle-fleet';
import { addDays, daysBetween, formatIsoDate, type IsoDate } from '../../shared/roadtrip/trip-days';
import type { TripDoc } from '../../shared/roadtrip/trip-types';
import { DateField } from '../../shared/ui/DateField';
import { TextField } from '../../shared/ui/Inspector';
import GaragePanel from './GaragePanel';
import { dangerLink, linkButton } from './panels/ui';

interface FleetPanelProps {
  trip: TripDoc;
  /** The fleet as it stands; every edit writes at once, like the rest of the trip settings. */
  value: TripVehicle[];
  onChange: (fleet: TripVehicle[]) => void;
}

/** Which state of the open vehicle is being dressed: as it set off, or one change. */
type State = 'start' | string;

/**
 * The trip's FLEET in the trip settings (2026-10-09, `vehicle-fleet.ts`):
 * the vehicles it drives as chips — the first is the main one — and, for the
 * open one, its story: as it set off, then each dated change (the Prado
 * repainted at Melbourne). Picking a row dresses THAT state in the garage
 * beside it, the same `GaragePanel` as before; a change keeps the vehicle's
 * model, so its model is said rather than chosen.
 *
 * A change is dated by a day; naming the place it happened, when the trip
 * holds a place of that name with a known day, writes that day — the lab's
 * «on choisit un lieu, c'est son jour d'arrivée qui est écrit».
 */
export default function FleetPanel({ trip, value, onChange }: FleetPanelProps) {
  const [openId, setOpenId] = useState(value[0]?.id ?? '');
  const [state, setState] = useState<State>('start');
  const open = value.find((v) => v.id === openId) ?? value[0];
  const isMain = open.id === value[0].id;
  const change = state === 'start' ? null : open.changes.find((c) => c.id === state) ?? null;
  const dressed = change ? vehicleOnDay(open, change.from) : open.spec;
  const write = (next: TripVehicle) => onChange(replaceVehicle(value, next));

  const pick = (id: string) => {
    setOpenId(id);
    setState('start');
  };

  const addAChange = () => {
    const next = addChange(open, middleDay(trip, open));
    write(next);
    const made = next.changes.find((c) => !open.changes.some((o) => o.id === c.id));
    if (made) setState(made.id);
  };

  const header = (
    <div className="flex flex-col gap-3 pb-3 border-b border-line">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="The trip’s vehicles">
        {value.map((v, i) => {
          const on = v.id === open.id;
          return (
            <button
              key={v.id}
              type="button"
              aria-pressed={on}
              onClick={() => pick(v.id)}
              className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-sm cursor-pointer ${
                on ? 'border-accent bg-accent-wash text-ink' : 'border-line-strong bg-paper text-ink-soft hover:border-muted'
              }`}
            >
              <span className="w-3 h-3 rounded-full border border-line-strong" style={{ background: v.spec.color }} />
              {vehicleModel(v.spec.model).short}
              {i === 0 && <span className="font-mono text-2xs text-muted">main</span>}
            </button>
          );
        })}
        <select
          value=""
          aria-label="Add a vehicle"
          onChange={(e) => {
            const model = e.target.value as VehicleModelId;
            if (!model) return;
            const next = addVehicle(value, model);
            onChange(next);
            pick(next[next.length - 1].id);
          }}
          className="h-8 px-2 rounded-full border border-dashed border-line-strong bg-paper text-sm text-muted cursor-pointer max-[820px]:text-base"
        >
          <option value="">+ Vehicle</option>
          {VEHICLE_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {vehicleLabel(m)}
            </option>
          ))}
        </select>
      </div>
      {value.length > 1 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {!isMain && (
            <button type="button" className={linkButton} onClick={() => onChange(makeMain(value, open.id))}>
              Make it the main vehicle
            </button>
          )}
          <button
            type="button"
            className={dangerLink}
            onClick={() => {
              const next = removeVehicle(value, open.id);
              onChange(next);
              pick(next[0].id);
            }}
          >
            Remove {vehicleModel(open.spec.model).short}
          </button>
        </div>
      )}
      <p className="m-0 text-xs text-muted">
        {isMain
          ? 'The main vehicle drives every stage that names no other.'
          : 'Drives the stages and the places that name it.'}
      </p>

      <div className="flex flex-col gap-1" role="group" aria-label="Its story">
        <StoryRow on={state === 'start'} color={open.spec.color} onClick={() => setState('start')}>
          <span className="text-ink">As it set off</span>
          <span className="text-muted"> · {look(open.spec.color, open.spec.finish, open.spec.model)}</span>
        </StoryRow>
        {open.changes.map((c) => (
          <div key={c.id} className="flex flex-col gap-1.5">
            <StoryRow on={state === c.id} color={c.look.color} onClick={() => setState(c.id)}>
              <span className="text-ink">
                From {formatIsoDate(c.from)}
                {c.place ? ` · ${c.place}` : ''}
              </span>
              <span className="text-muted"> · {look(c.look.color, c.look.finish, open.spec.model)}</span>
            </StoryRow>
            {state === c.id && (
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2 pl-6">
                <DateField
                  value={c.from}
                  min={trip.startDate}
                  max={trip.endDate}
                  label="From the day"
                  onChange={(from) => write(updateChange(open, c.id, { from }))}
                />
                <span className="min-w-0">
                  <TextField
                    value={c.place ?? ''}
                    placeholder="Where (optional)"
                    label="Where it happened"
                    onChange={(place) => {
                      const day = placeDay(trip, place);
                      write(updateChange(open, c.id, day ? { place, from: day } : { place }));
                    }}
                  />
                </span>
                <button
                  type="button"
                  className={dangerLink}
                  onClick={() => {
                    write(removeChange(open, c.id));
                    setState('start');
                  }}
                >
                  Remove
                </button>
              </div>
            )}
          </div>
        ))}
        <div>
          <button type="button" className={linkButton} onClick={addAChange}>
            + A change on the way
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <GaragePanel
      value={dressed}
      header={header}
      lockModel={change !== null}
      onChange={(spec) => write(withLookOn(open, change ? change.from : null, spec))}
    />
  );
}

function StoryRow({ on, color, onClick, children }: { on: boolean; color: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`flex items-center gap-2 min-w-0 px-2 py-1.5 rounded-paper border text-left text-sm cursor-pointer ${
        on ? 'border-accent bg-accent-wash' : 'border-transparent hover:border-line'
      }`}
    >
      <span className="flex-none w-3.5 h-3.5 rounded-full border border-line-strong" style={{ background: color }} />
      <span className="min-w-0 truncate">{children}</span>
    </button>
  );
}

function look(color: string, finish: string, model: string): string {
  return `${colourName(color, model)}, ${finish}`;
}

/** The day a place of the trip was reached: its own date, else its stage's first day; null for a name the trip does not hold. */
function placeDay(trip: TripDoc, name: string): IsoDate | null {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return null;
  for (const stage of trip.stages) {
    const place = stage.places.find((p) => p.name.trim().toLowerCase() === wanted);
    if (place) return place.arrived ?? stage.startDate;
  }
  return null;
}

/** A first guess for a new change: halfway between the last state's day and the trip's end. */
function middleDay(trip: TripDoc, vehicle: TripVehicle): IsoDate {
  const from = vehicle.changes.length ? vehicle.changes[vehicle.changes.length - 1].from : trip.startDate;
  const span = daysBetween(from, trip.endDate) ?? 0;
  return addDays(from, Math.max(0, Math.floor(span / 2))) ?? from;
}
