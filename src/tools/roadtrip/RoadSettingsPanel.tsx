import { useMemo, useState } from 'react';
import {
  ROAD_DETAILS,
  decodeTrack,
  tripRoadLine,
  type RoadMode,
  type TripRoad,
} from '../../shared/roadtrip/road-track';
import { formatIsoDate } from '../../shared/roadtrip/trip-days';
import ConfirmDialog from '../../shared/ui/ConfirmDialog';
import InfoDot from '../../shared/ui/InfoDot';
import Segmented from '../../shared/ui/Segmented';
import { dangerLink } from './panels/ui';

const MODE_LABEL: Record<RoadMode, string> = {
  crow: 'Crow flies',
  stages: 'Between stays',
  moves: 'Every move',
  raw: 'Raw',
};

const km = (n: number) => `${Math.round(n).toLocaleString('en-GB')} km`;
const detailText = (m: number) => (m === 0 ? 'every point' : m >= 1000 ? `${m / 1000} km` : `${m} m`);
const dayOf = (seconds: number) => formatIsoDate(new Date(seconds * 1000).toISOString().slice(0, 10));

interface RoadSettingsPanelProps {
  road: TripRoad | null;
  /** How the road is read — the trip's, or a sheet's draft of it. */
  mode: RoadMode;
  detail: number;
  onMode: (mode: RoadMode) => void;
  onDetail: (detail: number) => void;
  /** Take the road off the trip; absent hides the verb. */
  onForget?: () => void;
}

/**
 * How the trip reads its ROAD (`road-track.ts`): the maintainer's four modes,
 * each saying the kilometres it would count, and a detail apart from them.
 * The vehicle drives what the mode draws and the counter counts what it
 * drives, so this one choice is every opener's. Drawn in both trip sheets —
 * live in the piece's, as a draft in the overview's — from one component.
 */
export default function RoadSettingsPanel({ road, mode, detail, onMode, onDetail, onForget }: RoadSettingsPanelProps) {
  const [forgetting, setForgetting] = useState(false);

  // The track's two ends, read once per track.
  const span = useMemo(() => {
    if (!road) return null;
    const fixes = decodeTrack(road.track);
    return fixes.length ? { from: fixes[0].t, to: fixes[fixes.length - 1].t } : null;
  }, [road]);

  // What each mode reads at this detail — the numbers the choice is made on.
  const lines = useMemo(() => {
    if (!road) return null;
    return {
      stages: tripRoadLine({ ...road, mode: 'stages', detail }),
      moves: tripRoadLine({ ...road, mode: 'moves', detail }),
      raw: tripRoadLine({ ...road, mode: 'raw', detail }),
    };
  }, [road, detail]);

  if (!road || !lines) {
    return (
      <p className="m-0 text-sm text-muted">
        No road yet. Drop a Polarsteps export in <b className="font-medium text-ink-soft">Deduce</b> and keep its road: the
        openers will drive it instead of a curve from place to place.
      </p>
    );
  }

  const index = Math.max(0, ROAD_DETAILS.indexOf(detail));
  const shown = mode === 'crow' ? null : lines[mode];

  return (
    <div className="flex flex-col gap-3">
      <span className="font-mono text-2xs text-muted">
        {road.fixes.toLocaleString('en-GB')} fixes from Polarsteps
        {span ? ` · ${dayOf(span.from)} → ${dayOf(span.to)}` : ''}
        {road.added.length ? ` · ${road.added.length} placed by hand` : ''}{' '}
        <InfoDot about="the road">
          <p>The line the openers drive and the kilometres they count. A place stays a place: the road is never named nor drawn as points.</p>
          <p>Between stays leaves out what happens while you stay somewhere (walks, buses, the commute). Every move keeps it, without the GPS’s noise. Raw keeps every fix.</p>
          <p>The road is kept whole, raw fixes included, and travels in the trip’s backup.</p>
        </InfoDot>
      </span>

      <Segmented
        aria-label="The road follows"
        columns={4}
        value={mode}
        onChange={onMode}
        options={(['crow', 'stages', 'moves', 'raw'] as const).map((m) => ({
          id: m,
          label: (
            <span className="flex flex-col leading-tight">
              <span>{MODE_LABEL[m]}</span>
              <span className="font-mono text-3xs text-muted">{m === 'crow' ? 'curves' : km(lines[m].km)}</span>
            </span>
          ),
        }))}
      />

      <label className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span className="w-[4.5rem] flex-none">Detail</span>
        <input
          type="range"
          min={0}
          max={ROAD_DETAILS.length - 1}
          step={1}
          value={index}
          onChange={(e) => onDetail(ROAD_DETAILS[Number(e.target.value)])}
          disabled={mode === 'crow'}
          aria-label="Road detail"
          className="flex-1 min-w-[8rem] accent-[var(--color-accent)]"
        />
        <span className="font-mono text-ink-soft w-[10rem] text-right">
          {detailText(detail)}
          {shown ? ` · ${shown.points.toLocaleString('en-GB')} pts` : ''}
        </span>
      </label>

      {onForget && (
        <span>
          <button type="button" onClick={() => setForgetting(true)} className={dangerLink}>
            Forget the road
          </button>
        </span>
      )}
      {forgetting && onForget && (
        <ConfirmDialog
          title="Forget the trip’s road?"
          confirmLabel="Forget"
          danger
          onCancel={() => setForgetting(false)}
          onConfirm={() => {
            setForgetting(false);
            onForget();
          }}
        >
          <p>The openers go back to curves from place to place. A new Polarsteps export written from Deduce brings it back.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
