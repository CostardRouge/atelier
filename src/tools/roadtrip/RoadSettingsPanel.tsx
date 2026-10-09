import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_ROAD_STEER,
  ROAD_DETAILS,
  ROAD_LOOKS,
  ROAD_RADII,
  decodeTrack,
  roadSourceText,
  NO_ROAD,
  tripRoadLine,
  type RoadMode,
  type RoadSteer,
  type TripRoad,
} from '../../shared/roadtrip/road-track';
import { roadFixes, roadGaps } from '../../shared/roadtrip/road-points';
import { addGpxToRoad } from '../../shared/roadtrip/gpx';
import { pickFilesOf } from '../../shared/sources/file-sources';
import RoadMap from './RoadMap';
import { formatIsoDate } from '../../shared/roadtrip/trip-days';
import ConfirmDialog from '../../shared/ui/ConfirmDialog';
import Segmented from '../../shared/ui/Segmented';
import { useIsCompact } from '../../shared/ui/use-layout-mode';
import { buttonClass } from '../../shared/ui/Button';
import { dangerLink, smallButton } from './panels/ui';

/** What the road is and how each mode reads it — the Road pane's ⓘ. */
export const ROAD_ABOUT = (
  <>
    <p>The line the openers drive and the kilometres they count. A place stays a place: the road is never named nor drawn as points.</p>
    <p>Between stays leaves out what happens while you stay somewhere (walks, buses, the commute). Every move keeps it, without the GPS’s noise. Raw keeps every fix.</p>
    <p>Look ahead steers the vehicle like a driver instead of a pen through every fix: it aims at the road that far ahead and turns no tighter than the turn radius, so the GPS’s scatter becomes a bend rather than a twitch. Further ahead is calmer and cuts corners more. The kilometres stay the road’s as recorded.</p>
    <p>The road is kept whole, raw fixes included, and travels in the trip’s backup. A GPX adds its timed points to it — a car’s log, a day the phone missed — within the trip’s dates.</p>
    <p>Dashed red on the map: a stretch over 20 km with no fix. With <i>Place road points</i> on, a click puts a point of road on the nearest stretch, at the time that far along it; a click on one of yours takes it back.</p>
  </>
);

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
  /** How the road is read — the trip's. */
  mode: RoadMode;
  detail: number;
  /** How the vehicle steers along the line (`roadSteerOf`); null drives it as recorded. */
  steer: RoadSteer | null;
  onMode: (mode: RoadMode) => void;
  onDetail: (detail: number) => void;
  onSteer: (steer: RoadSteer | null) => void;
  /** Take the road off the trip; absent hides the verb. */
  onForget?: () => void;
  /**
   * The road with GPX files merged in (or made from them), or with a point
   * placed or taken back on the map; absent, the map only shows the road.
   */
  onRoad?: (road: TripRoad) => void;
  /** The trip's two dates — what a GPX is kept within. */
  tripSpan?: { startDate: string; endDate: string };
  /** The trip's located places, in lived order — drawn on the map, the crow's line between them. */
  places?: readonly { lat: number; lon: number }[];
  /**
   * A question of this panel is open over the sheet it sits in — which then
   * leaves Escape and Enter to it, or one press closes both.
   */
  onNested?: (open: boolean) => void;
}

/**
 * Trip settings → Road (`road-track.ts`): the maintainer's four modes, each
 * saying the kilometres it would count, a detail apart from them, and — in
 * the pane's big space, his ask of 2026-10-09 — the MAP of the road as the
 * mode reads it, where points of road are placed by hand once *Place road
 * points* is on. The vehicle drives what the mode draws and the counter
 * counts what it drives, so this one choice is every opener's. Everything is
 * written at once, like the rest of the sheet.
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
  onNested,
  onRoad,
  tripSpan,
  places = [],
}: RoadSettingsPanelProps) {
  const [forgetting, setForgetting] = useState(false);
  // Four modes with their kilometres do not fit a phone's width on one row.
  const compact = useIsCompact();
  const [placing, setPlacing] = useState(false);
  // What the last GPX or the last click on the map did, said under the map.
  const [note, setNote] = useState<{ text: string; warn: boolean } | null>(null);
  useEffect(() => {
    onNested?.(forgetting);
  }, [forgetting, onNested]);

  const addGpx =
    onRoad && tripSpan
      ? async () => {
          const files = await pickFilesOf('.gpx,application/gpx+xml');
          if (!files.length) return;
          const texts = await Promise.all(files.map(async (f) => ({ name: f.name, body: await f.text() })));
          const out = addGpxToRoad(road, texts, tripSpan, Date.now());
          if (out.road && out.added) onRoad(out.road);
          setNote({ text: out.note, warn: !out.added });
        }
      : null;
  const gpxButton = addGpx && (
    <button type="button" onClick={() => void addGpx()} className={smallButton}>
      Add a GPX…
    </button>
  );
  const noteLine = note && (
    <p className={`m-0 text-xs ${note.warn ? 'text-warn' : 'text-muted'}`} role="status">
      {note.text}
    </p>
  );
  // The holes the track has, counted beside the verb that fills them.
  const holes = useMemo(() => (road ? roadGaps(roadFixes(road)).length : 0), [road]);

  // The track's two ends, read once per track.
  const span = useMemo(() => {
    if (!road) return null;
    const fixes = decodeTrack(road.track);
    return fixes.length ? { from: fixes[0].t, to: fixes[fixes.length - 1].t } : null;
  }, [road]);

  // What each mode reads at this detail — the numbers the choice is made on,
  // and the line the map places points on. Unsteered: steering never changes
  // what is counted, a hand point goes on the line as recorded, and a drive
  // per mode would cost a steer each.
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
        {noteLine}
      </div>
    );
  }

  const index = Math.max(0, ROAD_DETAILS.indexOf(detail));
  // 0 is off: the line driven as recorded.
  const lookIndex = steer ? Math.max(0, ROAD_LOOKS.indexOf(steer.lookM)) + 1 : 0;
  const radiusIndex = Math.max(0, ROAD_RADII.indexOf(steer?.radiusM ?? DEFAULT_ROAD_STEER.radiusM));
  const shown = mode === 'crow' ? null : lines[mode];

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3">
      <span className="font-mono text-2xs text-muted">
        {road.fixes.toLocaleString('en-GB')} fixes from {roadSourceText(road.source)}
        {span ? ` · ${dayOf(span.from)} → ${dayOf(span.to)}` : ''}
        {road.added.length ? ` · ${road.added.length} placed by hand` : ''}
      </span>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="flex-[1_1_26rem] max-w-[40rem]">
          <Segmented
            aria-label="The road follows"
            columns={compact ? 2 : 4}
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
        </div>
        <label className="flex-[1_1_16rem] flex items-center gap-x-3 text-xs text-muted">
          <span className="flex-none">Detail</span>
          <input
            type="range"
            min={0}
            max={ROAD_DETAILS.length - 1}
            step={1}
            value={index}
            onChange={(e) => onDetail(ROAD_DETAILS[Number(e.target.value)])}
            disabled={mode === 'crow'}
            aria-label="Road detail"
            className="flex-1 min-w-[6rem] accent-[var(--color-accent)]"
          />
          <span className="font-mono text-ink-soft min-w-[7.5rem] text-right max-[820px]:min-w-0">
            {detailText(detail)}
            {shown ? ` · ${shown.points.toLocaleString('en-GB')} pts` : ''}
          </span>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <label className="flex-[1_1_16rem] flex items-center gap-x-3 text-xs text-muted">
          <span className="flex-none">Look ahead</span>
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
            className="flex-1 min-w-[6rem] accent-[var(--color-accent)]"
          />
          <span className="font-mono text-ink-soft min-w-[7.5rem] text-right max-[820px]:min-w-0">{steer ? metres(steer.lookM) : 'off · every fix'}</span>
        </label>
        <label className="flex-[1_1_16rem] flex items-center gap-x-3 text-xs text-muted">
          <span className="flex-none">Turn radius</span>
          <input
            type="range"
            min={0}
            max={ROAD_RADII.length - 1}
            step={1}
            value={radiusIndex}
            onChange={(e) => steer && onSteer({ ...steer, radiusM: ROAD_RADII[Number(e.target.value)] })}
            disabled={mode === 'crow' || !steer}
            aria-label="The vehicle’s tightest turn"
            className="flex-1 min-w-[6rem] accent-[var(--color-accent)]"
          />
          <span className="font-mono text-ink-soft min-w-[7.5rem] text-right max-[820px]:min-w-0">{steer ? metres(steer.radiusM) : '—'}</span>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {gpxButton}
        {onRoad && (
          <button
            type="button"
            onClick={() => {
              setPlacing((p) => !p);
              setNote(null);
            }}
            aria-pressed={placing}
            className={placing ? buttonClass('primary', 'sm') : smallButton}
          >
            {placing ? 'Done placing' : '✎ Place road points'}
          </button>
        )}
        <span className="font-mono text-2xs text-muted">
          {holes} {holes === 1 ? 'hole' : 'holes'} over 20 km{road.added.length ? ` · ${road.added.length} placed` : ''}
        </span>
        {onRoad && road.added.length > 0 && (
          <button type="button" onClick={() => onRoad({ ...road, added: [] })} className={dangerLink}>
            Take the points back
          </button>
        )}
        <span className="flex-1" />
        {onForget && (
          <button type="button" onClick={() => setForgetting(true)} className={dangerLink}>
            Forget the road
          </button>
        )}
      </div>

      <RoadMap
        road={road}
        line={shown ?? NO_ROAD}
        places={places}
        placing={placing && !!onRoad}
        onRoad={(next) => onRoad?.(next)}
        onNote={(text) => setNote(text ? { text, warn: text.startsWith('Too far') } : null)}
      />
      {noteLine}

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
          <p>The openers go back to curves from place to place. A Polarsteps export written from Deduce, or a GPX, brings it back.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
