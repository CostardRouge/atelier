import { useMemo, useState } from 'react';
import HopList, { km, refShort } from '../../shared/roadtrip/HopList';
import { vehicleModel, VEHICLE_MODELS } from '../../shared/roadtrip/hooks/vehicle-registry';
import { shouldAskToSail } from '../../shared/roadtrip/sea-hops';
import { stageTint } from '../../shared/roadtrip/stage-ruler';
import {
  stageHopSummary,
  stageOpensByDefault,
  stagesInOrder,
  tripHops,
  withCrossBoat,
  withHopChoice,
  withStageVehicle,
  type TripHop,
} from '../../shared/roadtrip/trip-hops';
import { stageLabel } from '../../shared/roadtrip/trip-places';
import type { TripDoc, TripStage } from '../../shared/roadtrip/trip-types';
import { mainVehicle } from '../../shared/roadtrip/vehicle-fleet';
import VehicleRefSelect from '../../shared/roadtrip/VehicleRefSelect';
import Button from '../../shared/ui/Button';
import IconButton from '../../shared/ui/IconButton';
import { Icons } from '../../shared/ui/icons';
import { SelectField, ToggleField } from '../../shared/ui/Inspector';
import { inputClass } from './panels/ui';
import { useLandIndex } from './use-land-index';

const BOATS = VEHICLE_MODELS.filter((m) => m.kind === 'boat').map((m) => ({ id: m.id, label: m.name }));

/** The weight a hop not driven takes in a stage's strip: a mark, never its thousand kilometres. */
const FLOWN_WEIGHT_KM = 40;

/**
 * The TRAJET band (2026-10-17, face A of the lab
 * https://claude.ai/artifact/RrtxniqsSSYW3sKNkCS1kY): every hop of the trip
 * from place to place, the vehicle that makes it and WHY — set here, water,
 * stage, trip, not driven — and one tap to change it, in the one place the
 * road can be read whole: the overview's Map view. It writes the very fields
 * the stage card, the place and ⚙ Trip → Vehicle write (`trip-hops.ts`), so
 * nothing here is a second model; the water is read on the straight line, so
 * it names which hops cross the sea and roughly how far.
 *
 * Folded (2026-11-07, list B + band 1 of the vehicles lab
 * https://claude.ai/artifact/EYpL6XvriERXnN9AMbe459, his «la liste est très
 * longue»): one row per stage that reads it closed — its vehicle, hops,
 * kilometres and a strip of its hops — opening by itself on the stage of the
 * day shown and on any stage driving over the sea; inside, only the hops that
 * differ (`HopList`). On a wide screen the whole card folds to its one line
 * (`foldable`). The water rule is one line, and the question an old trip is
 * asked about the sea waits here, not as a band over the overview.
 */
export default function TripRouteBand({
  trip,
  onChange,
  onOpenVehicle,
  currentStageId = null,
  foldable = false,
}: {
  trip: TripDoc;
  onChange: (next: TripDoc) => void;
  onOpenVehicle: () => void;
  /** The stage of the day the overview shows: its fold opens by itself. */
  currentStageId?: string | null;
  /** The card folds whole to its one line (the side column of a wide screen); closed at first. */
  foldable?: boolean;
}) {
  const land = useLandIndex(true);
  const hops = useMemo(() => tripHops(trip, land), [trip, land]);
  const rule = trip.crossings;
  const main = mainVehicle(trip.vehicles);
  const atSea = hops.filter((h) => h.sea?.water).length;
  const wet = hops.filter((h) => h.wet).length;
  const ask = shouldAskToSail(rule) && wet > 0;
  const stages = stagesInOrder(trip.stages).filter((s) => hops.some((h) => h.stageId === s.id));
  const [cardOpen, setCardOpen] = useState(false);
  const [chosen, setChosen] = useState<Record<string, boolean>>({});

  const linesOf = (id: string) => hops.filter((h) => h.stageId === id);
  const isOpen = (stage: TripStage) => chosen[stage.id] ?? stageOpensByDefault(stage.id, linesOf(stage.id), currentStageId);
  const allOpen = stages.length > 0 && stages.every(isOpen);
  const setAll = (open: boolean) => setChosen(Object.fromEntries(stages.map((s) => [s.id, open])));
  const answer = (auto: boolean) => onChange({ ...trip, crossings: { ...rule, auto, asked: true } });

  const summary = (
    <span className="min-w-0 truncate font-mono text-2xs text-muted">
      {hops.length} hop{hops.length === 1 ? '' : 's'}
      {!land ? ' · reading the coast…' : wet > 0 ? <span className="text-warn"> · {wet} over sea</span> : ` · ${atSea} at sea`}
    </span>
  );

  const head = foldable ? (
    <button
      type="button"
      aria-expanded={cardOpen}
      onClick={() => setCardOpen(!cardOpen)}
      className="w-full flex items-center gap-2 min-h-9 p-0 bg-transparent border-0 text-left cursor-pointer rounded-control focus:outline-none focus-visible:ring-2 focus-visible:ring-accent pointer-coarse:min-h-11"
    >
      <span className="flex-none text-sm text-ink font-semibold">Vehicles</span>
      {summary}
      {ask && <span className="flex-none w-2 h-2 rounded-full bg-warn-bright" aria-label="A question waits" />}
      <span
        className={`ml-auto flex-none inline-flex text-muted transition-transform [&>svg]:w-4 [&>svg]:h-4 ${cardOpen ? 'rotate-90' : ''}`}
        aria-hidden="true"
      >
        {Icons.chevronRight}
      </span>
    </button>
  ) : (
    <p className="m-0 flex items-baseline gap-2">{summary}</p>
  );

  if (foldable && !cardOpen) return <div data-route-band>{head}</div>;

  return (
    <div className="flex flex-col gap-2" data-route-band>
      {head}

      {ask && (
        <div role="status" data-sail-question className="flex flex-col gap-2 px-3 py-2 rounded-control border border-warn-bright bg-warn-wash text-xs">
          <p className="m-0 text-ink">
            <strong className="font-semibold">
              {wet} hop{wet === 1 ? '' : 's'} cross{wet === 1 ? 'es' : ''} the sea
            </strong>{' '}
            and the vehicle drives straight over {wet === 1 ? 'it' : 'them'}.
          </p>
          <span className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant="primary"
              onClick={() => answer(true)}
              title={`Turn on «On water, sail»: each crossing on the ${vehicleModel(rule.boat).name}`}
            >
              Sail them
            </Button>
            <Button size="sm" variant="ghost" onClick={() => answer(false)} title="Keep driving over the water — the switch stays below">
              Not now
            </Button>
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pb-2 border-b border-line">
        <ToggleField
          label="On water, a boat by itself"
          checked={rule.auto}
          onChange={(auto) => onChange({ ...trip, crossings: { ...rule, auto, asked: true } })}
        >
          On water, sail
        </ToggleField>
        {rule.auto && (
          <span className="flex-1 min-w-0 basis-32 inline-flex">
            <SelectField
              value={rule.boat}
              options={BOATS}
              label="The boat a crossing takes"
              onChange={(boat) => onChange({ ...trip, crossings: { ...rule, boat } })}
            />
          </span>
        )}
        <IconButton size="sm" variant="ghost" label="The fleet, and the bridge and shore distances" onClick={onOpenVehicle} className="ml-auto">
          {Icons.settings}
        </IconButton>
      </div>

      {!hops.length && <p className="m-0 text-xs text-muted">No two located places yet: nothing to drive.</p>}

      {stages.length > 1 && (
        <div className="flex items-center justify-between gap-2 text-2xs text-muted">
          <span className="font-mono tabular-nums">
            {stages.length} stages · {km(stageHopSummary(hops).km)}
          </span>
          <button
            type="button"
            onClick={() => setAll(!allOpen)}
            className="bg-transparent border-0 p-0 text-2xs font-medium text-accent-ink cursor-pointer hover:underline pointer-coarse:min-h-11"
          >
            {allOpen ? 'Close all' : 'Open all'}
          </button>
        </div>
      )}

      <div className="flex flex-col">
        {stages.map((stage) => {
          const lines = linesOf(stage.id);
          const open = isOpen(stage);
          const name = stageLabel(stage) || 'Unnamed stage';
          return (
            <section key={stage.id} className="border-t border-line first:border-t-0" aria-label={name} data-route-stage={stage.id}>
              <StageRow
                stage={stage}
                name={name}
                tint={stageTint(trip.stages.indexOf(stage))}
                lines={lines}
                vehicle={stage.vehicle ? refShort(stage.vehicle, trip.vehicles) : vehicleModel(main.spec.model).short}
                current={stage.id === currentStageId}
                open={open}
                onToggle={() => setChosen({ ...chosen, [stage.id]: !open })}
              />
              {open && (
                <div className="flex flex-col gap-1 pl-4 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="flex-none text-xs text-muted">Drives</span>
                    <VehicleRefSelect
                      value={stage.vehicle}
                      fleet={trip.vehicles}
                      inherit={`Main vehicle · ${vehicleModel(main.spec.model).short}`}
                      label={`What ${name} drives`}
                      onChange={(ref) => onChange(withStageVehicle(trip, stage.id, ref ?? null))}
                      className={`${inputClass} min-w-0 flex-1`}
                    />
                  </div>
                  <HopList
                    lines={lines}
                    fleet={trip.vehicles}
                    ruleAuto={rule.auto}
                    ruleBoat={rule.boat}
                    onChoose={(placeId, choice) => onChange(withHopChoice(trip, placeId, choice))}
                    onCrossBoat={(placeId, boat) => onChange(withCrossBoat(trip, placeId, boat))}
                  />
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** A stage folded into one row: its colour, name, vehicle, count, kilometres and a strip of its hops. */
function StageRow({
  stage,
  name,
  tint,
  lines,
  vehicle,
  current,
  open,
  onToggle,
}: {
  stage: TripStage;
  name: string;
  tint: string;
  lines: readonly TripHop[];
  vehicle: string;
  current: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const sum = stageHopSummary(lines);
  const weights = lines.map((l) => (l.why === 'flown' ? FLOWN_WEIGHT_KM : Math.max(l.km, 1)));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      data-stage-row={stage.id}
      className="w-full grid grid-cols-[0.5rem_minmax(0,1fr)_auto_1rem] items-center gap-x-2 gap-y-1 py-2 px-0.5 bg-transparent border-0 text-left cursor-pointer rounded-control hover:bg-paper focus:outline-none focus-visible:ring-2 focus-visible:ring-accent min-h-11"
    >
      <span className="w-2 h-2 rounded-full" style={{ background: tint }} aria-hidden="true" />
      <span className="min-w-0 truncate text-sm text-ink font-medium">{name}</span>
      {sum.wet > 0 ? (
        <span className="font-mono text-3xs px-1.5 rounded-full border border-warn-bright bg-warn-wash text-warn">{sum.wet} over sea</span>
      ) : sum.set > 0 ? (
        <span className="font-mono text-3xs px-1.5 rounded-full border border-accent/40 text-accent-ink">{sum.set} set</span>
      ) : current ? (
        <span className="font-mono text-3xs uppercase tracking-[0.08em] text-accent-ink">this day</span>
      ) : (
        <span />
      )}
      <span className={`inline-flex text-muted transition-transform [&>svg]:w-4 [&>svg]:h-4 ${open ? 'rotate-90' : ''}`} aria-hidden="true">
        {Icons.chevronRight}
      </span>
      <span className="col-start-2 col-span-2 min-w-0 truncate font-mono text-2xs text-muted tabular-nums">
        {sum.hops} hop{sum.hops === 1 ? '' : 's'} · {km(sum.km)} · {vehicle}
      </span>
      <span className="col-start-2 col-span-2 flex gap-0.5 h-1.5" aria-hidden="true">
        {lines.map((l, i) => (
          <span
            key={l.key}
            style={{ flexGrow: weights[i] / total }}
            className={`basis-0 min-w-[3px] rounded-sm ${
              l.why === 'flown'
                ? 'h-0.5 mt-0.5 border-t-2 border-dashed border-faint'
                : l.wet
                  ? 'h-full bg-warn-bright'
                  : l.sea?.water
                    ? 'h-full bg-info'
                    : 'h-full bg-ink-soft/50'
            }`}
          />
        ))}
      </span>
    </button>
  );
}
