import { useState } from 'react';
import { ROAD_DETAILS, ROAD_LOOKS, ROAD_MODES, ROAD_RADII, ROAD_SMOOTHS, ROAD_WITHINS, roadDriveOf, ROAD_DRIVE_STYLES, type RoadDrive, type RoadDriveStyle, type RoadMode } from '../../shared/roadtrip/road-track';
import { ROAD_DRIVE_LABEL, ROAD_MODE_LABEL, roadMetres } from '../../shared/roadtrip/road-words';
import type { TripDoc } from '../../shared/roadtrip/trip-types';
import { Readout, SelectField } from '../../shared/ui/Inspector';
import Segmented from '../../shared/ui/Segmented';
import { writeTrip } from './trip-changes';

const steps = (list: readonly number[]) => list.map((m) => ({ id: String(m), label: roadMetres(m) }));

/**
 * The trip's ROAD, tuned from the map (road lab C2, his « si je change l'un
 * ou l'autre, tout se met à jour »): the same settings as Trips' Road pane —
 * which fixes are kept, the detail, how the line is driven (point to point,
 * the driver, the ribbon) and that style's own steps — written to the TRIP,
 * so Virée, the Itinerary and this map change together. The map with its dots
 * and the GPX stay in Trips' pane; this is the reading of the line.
 */
export default function MapRoadSection({ trip }: { trip: TripDoc }) {
  const road = trip.road;
  const [failed, setFailed] = useState(false);
  if (!road) return <Readout muted>No road on this trip yet: Trips’ Deduce writes it from a Polarsteps export.</Readout>;
  const drive = roadDriveOf(road);
  const write = (patch: { mode?: RoadMode; detail?: number; drive?: Partial<RoadDrive> }) => {
    const next = { ...road, ...(patch.mode ? { mode: patch.mode } : {}), ...(patch.detail !== undefined ? { detail: patch.detail } : {}), drive: { ...drive, ...(patch.drive ?? {}) } };
    void writeTrip({ ...trip, road: next }).then((ok) => setFailed(!ok));
  };
  const driven = road.mode !== 'crow';
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="text-sm text-ink-soft w-16">Road</span>
        <SelectField<RoadMode> label="Which fixes make the road" value={road.mode} options={ROAD_MODES.map((id) => ({ id, label: ROAD_MODE_LABEL[id] }))} onChange={(mode) => write({ mode })} />
      </div>
      {driven ? (
        <>
          <div className="flex items-center gap-2">
            <span className="text-sm text-ink-soft w-16">Detail</span>
            <SelectField<string> label="The road’s detail" value={String(road.detail)} options={steps(ROAD_DETAILS).map((o) => (o.id === '0' ? { ...o, label: 'every point' } : o))} onChange={(v) => write({ detail: Number(v) })} />
          </div>
          <Segmented<RoadDriveStyle>
            options={ROAD_DRIVE_STYLES.map((id) => ({ id, label: ROAD_DRIVE_LABEL[id].name, title: ROAD_DRIVE_LABEL[id].says }))}
            value={drive.style}
            onChange={(style) => write({ drive: { style } })}
            size="sm"
            fill
            label="How the line is driven"
          />
          {drive.style === 'ribbon' ? (
            <>
              <div className="flex items-center gap-2">
                <span className="text-sm text-ink-soft w-16">Smooth</span>
                <SelectField<string> label="What the ribbon irons out" value={String(drive.smoothM)} options={steps(ROAD_SMOOTHS)} onChange={(v) => write({ drive: { smoothM: Number(v) } })} />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-ink-soft w-16">Corridor</span>
                <SelectField<string> label="How far from a fix the ribbon may pass" value={String(drive.withinM)} options={steps(ROAD_WITHINS)} onChange={(v) => write({ drive: { withinM: Number(v) } })} />
              </div>
            </>
          ) : drive.style === 'driver' ? (
            <>
              <div className="flex items-center gap-2">
                <span className="text-sm text-ink-soft w-16">Looks</span>
                <SelectField<string> label="How far ahead the driver aims" value={String(drive.lookM)} options={steps(ROAD_LOOKS)} onChange={(v) => write({ drive: { lookM: Number(v) } })} />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-ink-soft w-16">Radius</span>
                <SelectField<string> label="The tightest turn the driver takes" value={String(drive.radiusM)} options={steps(ROAD_RADII)} onChange={(v) => write({ drive: { radiusM: Number(v) } })} />
              </div>
            </>
          ) : null}
        </>
      ) : null}
      <p className="m-0 text-2xs text-muted leading-snug">
        {failed ? 'This browser refused to save the trip.' : `The trip’s own road: Trips’ openers and this map draw the same line. Its map and GPX are in Trips › ${trip.name || 'the trip'} › Road.`}
      </p>
    </div>
  );
}
