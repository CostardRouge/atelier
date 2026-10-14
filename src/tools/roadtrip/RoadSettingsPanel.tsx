import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ROAD_DETAILS,
  ROAD_LOOKS,
  ROAD_RADII,
  ROAD_SMOOTHS,
  ROAD_WITHINS,
  decodeTrack,
  primeTripRoadLine,
  roadDriveOf,
  roadSourceText,
  type RoadDrive,
  type RoadDriveStyle,
  type RoadMode,
  type TripRoad,
} from '../../shared/roadtrip/road-track';
import { COUNTED_MODES, previewAsk, type CountedMode, type RoadPreview } from '../../shared/roadtrip/road-preview';
import { roadFixes, roadGaps } from '../../shared/roadtrip/road-points';
import { addGpxToRoad } from '../../shared/roadtrip/gpx';
import { pickFilesOf } from '../../shared/sources/file-sources';
import RoadMap from './RoadMap';
import { useRoadPreview } from './use-road-preview';
import { formatIsoDate } from '../../shared/roadtrip/trip-days';
import ConfirmDialog from '../../shared/ui/ConfirmDialog';
import Segmented from '../../shared/ui/Segmented';
import { useIsCompact } from '../../shared/ui/use-layout-mode';
import { buttonClass } from '../../shared/ui/Button';
import { dangerLink, smallButton } from './panels/ui';

/** What the road is, how each mode reads it and how each drive follows it — the Road pane's ⓘ. */
export const ROAD_ABOUT = (
  <>
    <p>The line the openers drive and the kilometres they count. A place stays a place: the road is never named nor drawn as points.</p>
    <p>Between stays leaves out what happens while you stay somewhere (walks, buses, the commute). Every move keeps it, without the GPS’s noise. Raw keeps every fix.</p>
    <p>
      How the vehicle drives that line. <i>Point to point</i> goes straight from fix to fix, so every scatter of the GPS is a turn of the wheel.
      <i> Driver</i> aims at the road ahead and turns no tighter than its radius: calm, but it cuts bends and leaves the road. <i>Ribbon</i> draws
      the smoothest line that stays within its corridor of every fix — no corner anywhere, and never further off the road than you set (or than the
      fixes’ own scatter where they spread wider). Smoothness irons out the wiggles shorter than it.
    </p>
    <p>Whatever drives it, the kilometres are the road’s as recorded. The map shows the line driven over the line as recorded, the fixes as dots once you zoom in.</p>
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

const DRIVE_LABEL: Record<RoadDriveStyle, { name: string; says: string }> = {
  fixes: { name: 'Point to point', says: 'every fix' },
  driver: { name: 'Driver', says: 'aims ahead' },
  ribbon: { name: 'Ribbon', says: 'smooth, on the road' },
};

const km = (n: number) => `${Math.round(n).toLocaleString('en-GB')} km`;
const metres = (m: number) => (m >= 1000 ? `${m / 1000} km` : `${m} m`);
const detailText = (m: number) => (m === 0 ? 'every point' : metres(m));
const dayOf = (seconds: number) => formatIsoDate(new Date(seconds * 1000).toISOString().slice(0, 10));

/** How the trip reads its road: the three settings the pane tunes. */
interface Reading {
  mode: RoadMode;
  detail: number;
  drive: RoadDrive;
}

const readingOf = (road: TripRoad): Reading => ({ mode: road.mode, detail: road.detail, drive: roadDriveOf(road) });

function sameReading(a: Reading, b: Reading): boolean {
  const x = a.drive;
  const y = b.drive;
  return (
    a.mode === b.mode &&
    a.detail === b.detail &&
    x.style === y.style &&
    x.lookM === y.lookM &&
    x.radiusM === y.radiusM &&
    x.withinM === y.withinM &&
    x.smoothM === y.smoothM
  );
}

interface RoadSettingsPanelProps {
  road: TripRoad | null;
  /**
   * The road written back: a reading tuned here (once its line is drawn and
   * the hand has let go of the slider), GPX files merged in, a point placed
   * or taken back on the map.
   */
  onRoad: (road: TripRoad) => void;
  /** Take the road off the trip; absent hides the verb. */
  onForget?: () => void;
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
 * saying the kilometres it would count, a detail apart from them, how the
 * vehicle DRIVES the line (point to point, the driver, the ribbon — his ask
 * of 2026-10-13 to switch between the road-tremor lab's options, each with
 * its own sliders), and the MAP of the road as it will be driven, over the
 * line as recorded.
 *
 * A slider answers the hand at once: the reading is a DRAFT here, its line
 * computed off the main thread (`use-road-preview.ts`) while the map's edge
 * says so, and written to the trip once it is drawn and the slider let go —
 * the line handed to `tripRoadLine` with it, so no other surface computes it
 * again. Every write is one undo step, like the rest of the sheet.
 */
export default function RoadSettingsPanel({ road, onRoad, onForget, onNested, tripSpan, places = [] }: RoadSettingsPanelProps) {
  const [forgetting, setForgetting] = useState(false);
  // Four modes with their kilometres do not fit a phone's width on one row.
  const compact = useIsCompact();
  const [placing, setPlacing] = useState(false);
  // What the last GPX or the last click on the map did, said under the map.
  const [note, setNote] = useState<{ text: string; warn: boolean } | null>(null);
  useEffect(() => {
    onNested?.(forgetting);
  }, [forgetting, onNested]);

  // --- the reading being tried, and when it is written ---------------------------
  // The draft carries the road it is a draft OF — the one this pane last
  // wrote, or last followed. Any other road arriving (an undo, a GPX, a
  // re-import from Deduce) replaces it DURING the render: reset in an effect,
  // the write below once saw the old draft first and put an undone reading
  // straight back.
  const [drafted, setDrafted] = useState<{ base: TripRoad | null; reading: Reading | null }>(() => ({
    base: road,
    reading: road ? readingOf(road) : null,
  }));
  let draft = drafted.reading;
  if (road !== drafted.base) {
    draft = road ? readingOf(road) : null;
    setDrafted({ base: road, reading: draft });
  }
  // A slider held: its steps are previewed, written only once it is let go.
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!held) return;
    const release = () => setHeld(false);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
  }, [held]);

  const ask = useMemo(() => (road && draft ? previewAsk(road, draft.mode, draft.detail, draft.drive) : null), [road, draft]);
  const { preview, answered, computing } = useRoadPreview(ask);
  // The preview on screen is the draft's, for this very road.
  const current = !!preview && !!answered && !!ask && answered.track === ask.track && answered.added === ask.added && sameReading(answered, ask);

  const write = useCallback(
    (reading: Reading, drawn: RoadPreview | null) => {
      if (!road) return;
      const next: TripRoad = { ...road, mode: reading.mode, detail: reading.detail, drive: reading.drive };
      if (drawn) primeTripRoadLine(next, drawn.line);
      setDrafted((cur) => ({ ...cur, base: next }));
      onRoad(next);
    },
    [road, onRoad],
  );

  useEffect(() => {
    if (!road || !draft || held || !current || sameReading(draft, readingOf(road))) return;
    write(draft, preview);
  }, [road, draft, held, current, preview, write]);

  // Closed with a reading still unwritten (the sheet shut mid-draw): written as it is.
  const latest = useRef({ road, draft, current, preview, write });
  latest.current = { road, draft, current, preview, write };
  useEffect(
    () => () => {
      const { road: r, draft: d, current: c, preview: p, write: w } = latest.current;
      if (r && d && !sameReading(d, readingOf(r))) w(d, c ? p : null);
    },
    [],
  );

  const tune = (patch: Partial<Reading>) => setDrafted((cur) => (cur.reading ? { ...cur, reading: { ...cur.reading, ...patch } } : cur));
  const tuneDrive = (patch: Partial<RoadDrive>) =>
    setDrafted((cur) => (cur.reading ? { ...cur, reading: { ...cur.reading, drive: { ...cur.reading.drive, ...patch } } } : cur));

  const addGpx = tripSpan
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

  if (!road || !draft) {
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

  const crow = draft.mode === 'crow';
  const drive = draft.drive;
  // Each mode's kilometres, the last drawn while the next is: they move little.
  const shownModes = preview?.modes ?? null;
  const points = !crow && preview && answered?.detail === draft.detail ? preview.modes[draft.mode as CountedMode].points : null;
  const hold = { onHold: () => setHeld(true) };

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3">
      <span className="font-mono text-2xs text-muted">
        {road.fixes.toLocaleString('en-GB')} fixes from {roadSourceText(road.source)}
        {span ? ` · ${dayOf(span.from)} → ${dayOf(span.to)}` : ''}
        {road.added.length ? ` · ${road.added.length} placed by hand` : ''}
      </span>

      {/* What is read: the mode and its detail. The two pickers share one
          column, their settings the other, so each row reads the same way. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="flex-[0_1_34rem] min-w-0 max-[820px]:flex-[1_1_100%]">
          <Segmented
            label="The road follows"
            columns={compact ? 2 : 4}
            value={draft.mode}
            onChange={(mode) => tune({ mode })}
            options={(['crow', ...COUNTED_MODES] as const).map((m) => ({
              id: m,
              label: (
                <span className="flex flex-col leading-tight">
                  <span>{MODE_LABEL[m]}</span>
                  <span className="font-mono text-3xs text-muted">{m === 'crow' ? 'curves' : shownModes ? km(shownModes[m].km) : '…'}</span>
                </span>
              ),
            }))}
          />
        </div>
        <StepSlider
          label="Detail"
          aria="Road detail"
          steps={ROAD_DETAILS}
          value={draft.detail}
          onChange={(detail) => tune({ detail })}
          disabled={crow}
          shown={`${detailText(draft.detail)}${points != null ? ` · ${points.toLocaleString('en-GB')} pts` : ''}`}
          {...hold}
        />
      </div>

      {/* How it is driven: the style, and that style's own two settings. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="flex-[0_1_34rem] min-w-0 max-[820px]:flex-[1_1_100%]">
          <Segmented
            label="The vehicle drives"
            columns={3}
            value={drive.style}
            onChange={(style) => tuneDrive({ style })}
            options={(['fixes', 'driver', 'ribbon'] as const).map((s) => ({
              id: s,
              disabled: crow ? 'No road to drive as the crow flies' : undefined,
              label: (
                <span className="flex flex-col leading-tight">
                  <span>{DRIVE_LABEL[s].name}</span>
                  <span className="font-mono text-3xs text-muted">{DRIVE_LABEL[s].says}</span>
                </span>
              ),
            }))}
          />
        </div>
        {drive.style === 'ribbon' && (
          <div className="flex-[1_1_20rem] flex flex-wrap items-center gap-x-4 gap-y-2">
            <StepSlider
              label="Stays within"
              aria="How far the ribbon may pass from a fix"
              steps={ROAD_WITHINS}
              value={drive.withinM}
              onChange={(withinM) => tuneDrive({ withinM })}
              disabled={crow}
              shown={metres(drive.withinM)}
              short
              {...hold}
            />
            <StepSlider
              label="Smoothness"
              aria="The shortest wiggle the ribbon keeps"
              steps={ROAD_SMOOTHS}
              value={drive.smoothM}
              onChange={(smoothM) => tuneDrive({ smoothM })}
              disabled={crow}
              shown={metres(drive.smoothM)}
              short
              {...hold}
            />
          </div>
        )}
        {drive.style === 'driver' && (
          <div className="flex-[1_1_20rem] flex flex-wrap items-center gap-x-4 gap-y-2">
            <StepSlider
              label="Look ahead"
              aria="How far ahead the vehicle aims"
              steps={ROAD_LOOKS}
              value={drive.lookM}
              onChange={(lookM) => tuneDrive({ lookM })}
              disabled={crow}
              shown={metres(drive.lookM)}
              short
              {...hold}
            />
            <StepSlider
              label="Turn radius"
              aria="The vehicle’s tightest turn"
              steps={ROAD_RADII}
              value={drive.radiusM}
              onChange={(radiusM) => tuneDrive({ radiusM })}
              disabled={crow}
              shown={metres(drive.radiusM)}
              short
              {...hold}
            />
          </div>
        )}
        {drive.style === 'fixes' && !crow && (
          <span className="flex-[1_1_20rem] text-xs text-muted">Straight from fix to fix: nothing to set.</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {gpxButton}
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
        <span className="font-mono text-2xs text-muted">
          {holes} {holes === 1 ? 'hole' : 'holes'} over 20 km{road.added.length ? ` · ${road.added.length} placed` : ''}
        </span>
        {road.added.length > 0 && (
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
        preview={crow ? null : preview}
        crow={crow}
        computing={computing}
        places={places}
        placing={placing}
        onRoad={onRoad}
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

interface StepSliderProps<T extends number> {
  label: ReactNode;
  aria: string;
  steps: readonly T[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  /** The value as said beside the slider, in a slot of fixed width so nothing moves as it changes. */
  shown: ReactNode;
  /** The hand took the slider: its steps are previewed and written once it is let go. */
  onHold: () => void;
  /** A value of a few characters ("100 m"), two sliders to a row. */
  short?: boolean;
}

/** A labelled slider over a list of stops. */
function StepSlider<T extends number>({ label, aria, steps, value, onChange, disabled, shown, onHold, short }: StepSliderProps<T>) {
  const index = Math.max(0, steps.indexOf(value));
  return (
    <label className={`${short ? 'flex-[1_1_13rem]' : 'flex-[1_1_16rem]'} flex items-center gap-x-3 text-xs text-muted`}>
      <span className="flex-none">{label}</span>
      <input
        type="range"
        min={0}
        max={steps.length - 1}
        step={1}
        value={index}
        onPointerDown={onHold}
        onChange={(e) => onChange(steps[Number(e.target.value)])}
        disabled={disabled}
        aria-label={aria}
        className="flex-1 min-w-[6rem] accent-[var(--color-accent)]"
      />
      <span className={`font-mono text-ink-soft text-right max-[820px]:min-w-0 ${short ? 'min-w-[3.5rem]' : 'min-w-[7.5rem]'}`}>{shown}</span>
    </label>
  );
}
