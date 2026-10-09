import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_ROAD_STEER,
  ROAD_DETAILS,
  ROAD_LOOKS,
  ROAD_RADII,
  decodeTrack,
  roadSourceText,
  tripRoadLine,
  type RoadFix,
  type RoadMode,
  type RoadSteer,
  type TripRoad,
} from '../../shared/roadtrip/road-track';
import { roadFixes, roadGaps } from '../../shared/roadtrip/road-points';
import { addGpxToRoad } from '../../shared/roadtrip/gpx';
import { pickFilesOf } from '../../shared/sources/file-sources';
import RoadPointsSheet from './RoadPointsSheet';
import { formatIsoDate } from '../../shared/roadtrip/trip-days';
import ConfirmDialog from '../../shared/ui/ConfirmDialog';
import InfoDot from '../../shared/ui/InfoDot';
import Segmented from '../../shared/ui/Segmented';
import { dangerLink, smallButton } from './panels/ui';

const MODE_LABEL: Record<RoadMode, string> = {
  crow: 'Crow flies',
  stages: 'Between stays',
  moves: 'Every move',
  raw: 'Raw',
};

const km = (n: number) => `${Math.round(n).toLocaleString('en-GB')} km`;
const metres = (m: number) => (m >= 1000 ? `${m / 1000} km` : `${m} m`);
const detailText = (m: number) => (m === 0 ? 'every point' : metres(m));
const dayOf = (seconds: number) => formatIsoDate(new Date(seconds * 1000).toISOString().slice(0, 10));

interface RoadSettingsPanelProps {
  road: TripRoad | null;
  /** How the road is read — the trip's, or a sheet's draft of it. */
  mode: RoadMode;
  detail: number;
  /** How the vehicle steers along the line; null drives it as recorded. */
  steer: RoadSteer | null;
  onMode: (mode: RoadMode) => void;
  onDetail: (detail: number) => void;
  onSteer: (steer: RoadSteer | null) => void;
  /** Take the road off the trip; absent hides the verb. */
  onForget?: () => void;
  /** The points of road placed by hand on the big map; absent hides the verb. */
  onAdded?: (added: RoadFix[]) => void;
  /**
   * The road with GPX files merged in (or made from them), kept within
   * `span`; absent hides *Add a GPX…*.
   */
  onRoad?: (road: TripRoad) => void;
  /** The trip's two dates — what a GPX is kept within. */
  tripSpan?: { startDate: string; endDate: string };
  /**
   * A sheet or a question of this panel is open over the one it sits in —
   * which then leaves Escape and Enter to it, or one press closes both.
   */
  onNested?: (open: boolean) => void;
}

/**
 * How the trip reads its ROAD (`road-track.ts`): the maintainer's four modes,
 * each saying the kilometres it would count, and a detail apart from them.
 * The vehicle drives what the mode draws and the counter counts what it
 * drives, so this one choice is every opener's. Drawn in both trip sheets —
 * live in the piece's, as a draft in the overview's — from one component.
 */
export default function RoadSettingsPanel({
  road,
  mode,
  detail,
  steer,
  onMode,
  onDetail,
  onSteer,
  onForget,
  onAdded,
  onNested,
  onRoad,
  tripSpan,
}: RoadSettingsPanelProps) {
  const [forgetting, setForgetting] = useState(false);
  // What the last GPX did, said under the verbs until the next one.
  const [gpxNote, setGpxNote] = useState<{ text: string; warn: boolean } | null>(null);
  const addGpx =
    onRoad && tripSpan
      ? async () => {
          const files = await pickFilesOf('.gpx,application/gpx+xml');
          if (!files.length) return;
          const texts = await Promise.all(files.map(async (f) => ({ name: f.name, body: await f.text() })));
          const out = addGpxToRoad(road, texts, tripSpan, Date.now());
          if (out.road && out.added) onRoad(out.road);
          setGpxNote({ text: out.note, warn: !out.added });
        }
      : null;
  const gpxButton = addGpx && (
    <button type="button" onClick={() => void addGpx()} className={smallButton}>
      Add a GPX…
    </button>
  );
  const gpxLine = gpxNote && (
    <p className={`m-0 text-xs ${gpxNote.warn ? 'text-warn' : 'text-muted'}`} role="status">
      {gpxNote.text}
    </p>
  );
  const [placing, setPlacing] = useState(false);
  const nested = forgetting || placing;
  useEffect(() => {
    onNested?.(nested);
  }, [nested, onNested]);
  // The holes the track has, counted on the button that fills them.
  const holes = useMemo(() => (road ? roadGaps(roadFixes(road)).length : 0), [road]);

  // The track's two ends, read once per track.
  const span = useMemo(() => {
    if (!road) return null;
    const fixes = decodeTrack(road.track);
    return fixes.length ? { from: fixes[0].t, to: fixes[fixes.length - 1].t } : null;
  }, [road]);

  // What each mode reads at this detail — the numbers the choice is made on.
  // Unsteered: steering never changes what is counted, and costs a drive.
  const lines = useMemo(() => {
    if (!road) return null;
    return {
      stages: tripRoadLine({ ...road, mode: 'stages', detail, steer: null }),
      moves: tripRoadLine({ ...road, mode: 'moves', detail, steer: null }),
      raw: tripRoadLine({ ...road, mode: 'raw', detail, steer: null }),
    };
  }, [road, detail]);

  if (!road || !lines) {
    return (
      <div className="flex flex-col gap-2.5">
        <p className="m-0 text-sm text-muted">
          No road yet. Drop a Polarsteps export in <b className="font-medium text-ink-soft">Deduce</b> and keep its road,
          or add a GPX: the openers will drive it instead of a curve from place to place.
        </p>
        {gpxButton && <span>{gpxButton}</span>}
        {gpxLine}
      </div>
    );
  }

  const index = Math.max(0, ROAD_DETAILS.indexOf(detail));
  // 0 is off: the line driven as recorded.
  const lookIndex = steer ? Math.max(0, ROAD_LOOKS.indexOf(steer.lookM)) + 1 : 0;
  const radiusIndex = Math.max(0, ROAD_RADII.indexOf(steer?.radiusM ?? DEFAULT_ROAD_STEER.radiusM));
  const shown = mode === 'crow' ? null : lines[mode];

  return (
    <div className="flex flex-col gap-3">
      <span className="font-mono text-2xs text-muted">
        {road.fixes.toLocaleString('en-GB')} fixes from {roadSourceText(road.source)}
        {span ? ` · ${dayOf(span.from)} → ${dayOf(span.to)}` : ''}
        {road.added.length ? ` · ${road.added.length} placed by hand` : ''}{' '}
        <InfoDot about="the road">
          <p>The line the openers drive and the kilometres they count. A place stays a place: the road is never named nor drawn as points.</p>
          <p>Between stays leaves out what happens while you stay somewhere (walks, buses, the commute). Every move keeps it, without the GPS’s noise. Raw keeps every fix.</p>
          <p>Look ahead steers the vehicle like a driver instead of a pen through every fix: it aims at the road that far ahead and turns no tighter than the turn radius, so the GPS’s scatter becomes a bend rather than a twitch. Further ahead is calmer and cuts corners more. The kilometres stay the road’s as recorded.</p>
          <p>The road is kept whole, raw fixes included, and travels in the trip’s backup. A GPX adds its timed points to it — a car’s log, a day the phone missed — within the trip’s dates.</p>
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
        <span className="w-[5.5rem] flex-none">Detail</span>
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

      <label className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span className="w-[5.5rem] flex-none">Look ahead</span>
        <input
          type="range"
          min={0}
          max={ROAD_LOOKS.length}
          step={1}
          value={lookIndex}
          onChange={(e) => {
            const i = Number(e.target.value);
            onSteer(i === 0 ? null : { lookM: ROAD_LOOKS[i - 1], radiusM: steer?.radiusM ?? DEFAULT_ROAD_STEER.radiusM });
          }}
          disabled={mode === 'crow'}
          aria-label="How far ahead the vehicle aims"
          className="flex-1 min-w-[8rem] accent-[var(--color-accent)]"
        />
        <span className="font-mono text-ink-soft w-[10rem] text-right">{steer ? metres(steer.lookM) : 'off · every fix'}</span>
      </label>

      <label className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span className="w-[5.5rem] flex-none">Turn radius</span>
        <input
          type="range"
          min={0}
          max={ROAD_RADII.length - 1}
          step={1}
          value={radiusIndex}
          onChange={(e) => steer && onSteer({ ...steer, radiusM: ROAD_RADII[Number(e.target.value)] })}
          disabled={mode === 'crow' || !steer}
          aria-label="The vehicle’s tightest turn"
          className="flex-1 min-w-[8rem] accent-[var(--color-accent)]"
        />
        <span className="font-mono text-ink-soft w-[10rem] text-right">{steer ? metres(steer.radiusM) : '—'}</span>
      </label>

      <span className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {gpxButton}
        {onAdded && (
          <button type="button" onClick={() => setPlacing(true)} className={smallButton}>
            Place road points…
          </button>
        )}
        {onAdded && (
          <span className="font-mono text-2xs text-muted">
            {holes} {holes === 1 ? 'hole' : 'holes'} in the track{road.added.length ? ` · ${road.added.length} placed` : ''}
          </span>
        )}
        <span className="flex-1" />
        {onForget && (
          <button type="button" onClick={() => setForgetting(true)} className={dangerLink}>
            Forget the road
          </button>
        )}
      </span>
      {gpxLine}
      {placing && onAdded && (
        <RoadPointsSheet
          road={road}
          onCancel={() => setPlacing(false)}
          onDone={(added) => {
            setPlacing(false);
            onAdded(added);
          }}
        />
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
