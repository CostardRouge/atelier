import { useMemo, useState } from 'react';
import {
  baseDays,
  clampDays,
  loupeLimits,
  loupeScale,
  loupeSpan,
  monthsAround,
  type LoupeStore,
} from '../../shared/roadtrip/loupe';
import { startStageAt } from '../../shared/roadtrip/stage-edit';
import { rulerBars, rulerGaps, stageTint } from '../../shared/roadtrip/stage-ruler';
import { addDays, formatIsoDate, spanLength, type IsoDate } from '../../shared/roadtrip/trip-days';
import { PLACE_STYLE_OPTIONS, writePlace } from '../../shared/roadtrip/place-style';
import { stageLabel, stageRegionLabel } from '../../shared/roadtrip/trip-places';
import { stageProblem, type TripDoc, type TripStage } from '../../shared/roadtrip/trip-types';
import SectionLegend from '../../shared/ui/SectionLegend';
import StageZoomControl from '../../shared/ui/StageZoomControl';
import { stepZoom, zoomLabel, type ZoomControls } from '../../shared/ui/stage-zoom';
import { useElementWidth } from '../../shared/ui/use-element-width';
import { useLearnedGesture } from '../../shared/ui/use-learned-gesture';
import PlacesEditor, { PlaceStyleSelect } from './PlacesEditor';
import StageRuler from './StageRuler';
import { useLoupe } from './use-loupe';
import { Icons } from '../../shared/ui/icons';
import IconButton from '../../shared/ui/IconButton';
import Button from '../../shared/ui/Button';
import { DateRangeField } from '../../shared/ui/DateField';

interface StagesPanelProps {
  trip: TripDoc;
  /**
   * The first day of the month the calendar shows, on a long trip: the
   * ruler's window opens on it and its two neighbours (100%) and follows it
   * to another month. Absent on a short trip, whose 100% is the whole trip.
   */
  month?: IsoDate;
  /** Where the ruler publishes its window, for the year map to draw it too. */
  loupe?: LoupeStore;
  /** The open leg's card is drawn elsewhere (a wide screen's right column). */
  hideCard?: boolean;
  /** The grid's rung for a day (0..4), drawn as a strip on the ruler. */
  rungAt?: (date: IsoDate) => number;
  /** The leg open in the editor below the ruler; null shows the ruler alone. */
  selectedId: string | null;
  /** The day open on the overview, drawn on the ruler as a playhead. */
  cursorDate: IsoDate | null;
  onSelect: (id: string | null) => void;
  /** A leg was clicked on the ruler: open it, and go to the day it began. */
  onOpenStage: (stage: TripStage) => void;
  /** The playhead was moved on the ruler. */
  onScrub: (date: IsoDate) => void;
  onChange: (stages: TripStage[]) => void;
  /** Connected Winnows whose timeline can complete the stages; empty shows nothing. */
  timelineSources?: string[];
  onCompleteFrom?: (sourceId: string) => void;
  /** A state's code kept for the whole trip, from a place's own editor. */
  onRememberCode?: (state: string, code: string) => void;
}

const legend = 'font-mono text-2xs tracking-[0.14em] uppercase text-muted';
const inputClass =
  'font-sans text-sm px-2.5 py-1.5 border border-line-strong rounded-paper bg-paper text-ink focus:outline-none focus:border-accent';

export function StageCard({
  trip,
  stage,
  index,
  onChange,
  onDelete,
  onClose,
  onAdjust,
  onRememberCode,
}: {
  trip: TripDoc;
  stage: TripStage;
  index: number;
  onChange: (stage: TripStage) => void;
  onDelete: () => void;
  onClose: () => void;
  /**
   * Adjust the dates on the calendar itself — the phone's replacement for
   * the ruler's drag, offered by the legs sheet and never by the wide
   * screen, which has the ruler.
   */
  onAdjust?: () => void;
  /** A state's code kept for the whole trip, from a place's own editor. */
  onRememberCode?: (state: string, code: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const problem = stageProblem(trip, stage);
  const days = spanLength(stage.startDate, stage.endDate);
  // What the badge would REALLY say for this stage as it stands — never an
  // invented example. An empty name field showing "Perth → Cairns" is how the
  // author sees that clearing it computes rather than blanks.
  const derivedName = stageLabel({ ...stage, name: '' });
  const derivedRegion = stageRegionLabel({ ...stage, region: '' });

  return (
    <div
      className="flex flex-col gap-3 pt-1"
      aria-label={`Stage ${index + 1}`}
    >
      <div className="flex items-center gap-2">
        <span
          className="flex-none w-2.5 h-2.5 rounded-full"
          style={{ background: stageTint(index) }}
          aria-hidden="true"
        />
        <span className={`${legend} flex-1 truncate`}>
          Stage {index + 1}
          {days !== null && ` · ${days} day${days === 1 ? '' : 's'}`}
        </span>
        {confirming ? (
          <span className="flex items-center gap-1.5">
            <Button size="sm" variant="danger" onClick={onDelete}>
              Delete
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Keep
            </Button>
          </span>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setConfirming(true)}
            aria-label={`Delete ${stage.name || 'this stage'}`}
          >
            Delete
          </Button>
        )}
        <IconButton size="sm" variant="ghost" label="Close this stage" onClick={onClose}>
          {Icons.close}
        </IconButton>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={stage.name}
          onChange={(e) => onChange({ ...stage, name: e.target.value })}
          placeholder={derivedName || 'The Red Centre'}
          className={`${inputClass} flex-1 min-w-[8rem]`}
          aria-label="Stage name"
        />
        <input
          value={stage.region}
          onChange={(e) => onChange({ ...stage, region: e.target.value })}
          placeholder={derivedRegion || 'Western Australia'}
          className={`${inputClass} flex-1 min-w-[8rem]`}
          aria-label="Region"
        />
        <DateRangeField
          start={stage.startDate}
          end={stage.endDate}
          min={trip.startDate}
          max={trip.endDate}
          startLabel="Arrived"
          endLabel="Left"
          format={formatIsoDate}
          onChange={({ start, end }) => onChange({ ...stage, startDate: start, endDate: end })}
        />
        {/* How THIS stage's places are written, over the trip's two defaults —
            the look's cascade: empty means «like the trip». */}
        <PlaceStyleSelect
          value={stage.placeStyle ?? ''}
          inherit={`Like the trip · ${
            // The trip's lists writing shown on one of THIS stage's places, else the stock example.
            (() => {
              const sample = (stage.places ?? []).find((p) => p.name.trim() && p.state.trim());
              return sample
                ? writePlace(sample, trip.placeStyle.lists, trip)
                : (PLACE_STYLE_OPTIONS.find((o) => o.id === trip.placeStyle.lists)?.example ?? '');
            })()
          }`}
          label="How this stage's places are written"
          onChange={(style) => {
            const next = { ...stage };
            if (style) next.placeStyle = style;
            else delete next.placeStyle;
            onChange(next);
          }}
          className={`${inputClass} min-w-[8rem]`}
        />
      </div>
      <p
        className={`m-0 font-mono text-2xs ${problem ? 'text-danger' : 'text-faint'}`}
        role={problem ? 'alert' : undefined}
      >
        {problem ??
          (days === null
            ? ''
            : [stageLabel(stage), `${formatIsoDate(stage.startDate)} → ${formatIsoDate(stage.endDate)}`]
                .filter(Boolean)
                .join(' · '))}
      </p>
      {onAdjust && (
        <Button variant="primary" onClick={onAdjust} icon={Icons.swap} className="self-stretch justify-center">
          Adjust on the calendar
        </Button>
      )}
      <PlacesEditor
        trip={trip}
        stage={stage}
        onChange={(places) => onChange({ ...stage, places })}
        onRememberCode={onRememberCode}
      />
    </div>
  );
}

/**
 * The places the trip stopped at. Without these a badge has no place to name
 * and the "day at the place" counters have nothing to count inside — so this
 * is not a nicety, it is what makes half the badge modes reachable.
 *
 * The legs live on a ruler (`StageRuler`) and ONE of them is open at a time
 * beneath it: the accordion of every stage with every field used to be the
 * widest thing on the page. Selection is the overview's, not this panel's,
 * because clicking a day on the calendar is another way to open its leg.
 *
 * Stages may overlap on purpose: a travel day belongs to the place you left
 * and the one you reached, and `stageAt` gives it to where you ended up.
 */
export default function StagesPanel({
  trip,
  month,
  loupe,
  hideCard = false,
  rungAt,
  selectedId,
  cursorDate,
  onSelect,
  onOpenStage,
  onScrub,
  onChange,
  timelineSources = [],
  onCompleteFrom,
  onRememberCode,
}: StagesPanelProps) {
  // The track's gestures are spelled out until the track has been USED at all
  // — a leg opened, a day tapped, a leg dragged, a gap filled — and stay behind
  // the legend's ⓘ after that. Any of them means the surface has been found,
  // which is the only thing the hint was there to say.
  const ruler = useLearnedGesture('roadtrip.stage-ruler');
  const selectedIndex = trip.stages.findIndex((s) => s.id === selectedId);
  const selected = selectedIndex >= 0 ? trip.stages[selectedIndex] : null;

  // The ruler's ZOOM is how many days its box shows (`loupe.ts`), made here
  // because the − / + sit in this header — and measured here, once, on the
  // ruler's own box, so the pill's limits are the ones the track is drawn to.
  // 100% is the three months around the one on screen (the whole trip on a
  // short one); the scale is kept as the months go by.
  const [rulerBox, rulerWidth] = useElementWidth<HTMLDivElement>();
  const total = spanLength(trip.startDate, trip.endDate) ?? 1;
  const limits = useMemo(() => loupeLimits(total, rulerWidth), [total, rulerWidth]);
  const around = month ? monthsAround(trip.startDate, month) : null;
  const base = baseDays(total, around, limits);
  const [scale, setScale] = useState(1);
  const days = clampDays(base / scale, limits);
  const shownScale = loupeScale(base, days);
  const zoomable = limits.max > limits.min;
  const zoom: ZoomControls = {
    scale: shownScale,
    label: zoomLabel(shownScale),
    canZoomIn: days > limits.min + 1e-6,
    canZoomOut: days < limits.max - 1e-6,
    zoomIn: () => setScale(stepZoom(shownScale, 1, loupeScale(base, limits.max))),
    zoomOut: () => setScale(stepZoom(shownScale, -1, loupeScale(base, limits.max))),
    reset: () => setScale(1),
  };

  function add() {
    // The first day no leg covers, else the trip's end: a new leg starts where
    // the story has a hole, and the ruler's own `+` does the same per gap.
    // Inside the ruler's window: a leg added off-screen is a leg the author
    // cannot see appear.
    const view = loupe?.get();
    const shown = view ? loupeSpan(total, view) : null;
    const first = shown ? addDays(trip.startDate, shown.first) : null;
    const last = shown ? addDays(trip.startDate, shown.last) : null;
    const drawn = first && last ? { ...trip, startDate: first, endDate: last } : trip;
    const gap = rulerGaps(drawn, rulerBars(drawn))[0];
    const result = startStageAt(trip, gap ? gap.startDate : drawn.endDate);
    onChange(result.stages);
    const added = result.stages.find((s) => s.id === result.selectedId);
    if (added) onOpenStage(added);
  }

  return (
    <section
      // A section, not a card and not a rule: the calendar above and the day
      // below are the same document, and a frame here made three levels of
      // boxes on one screen (the audit's Z4). Spacing alone separates them —
      // the maintainer removed the rules too. The open leg is a row of it.
      className="flex flex-col gap-3 pt-2"
      aria-label="Stages"
    >
      <div className="flex items-center gap-3">
        <span className="flex-1 min-w-0 flex items-center gap-3">
          <SectionLegend label={`Stages · ${trip.stages.length} leg${trip.stages.length === 1 ? '' : 's'}`}>
            <p>
              A stage is a leg of the trip and the days you were on it. A badge can name
              it, count the days you stayed, or say which day of the stop a picture is.
            </p>
            <p>
              List the places it went through and its name writes itself —
              &ldquo;Perth → Cairns&rdquo;.
            </p>
            <p>
              On the track: tap a leg to edit it and go to its first day · tap anywhere
              else to open that day · hold a leg, or either of its edges, then drag to
              move its dates.
              <span className="max-[600px]:hidden">
                {' '}
                Right-click a day on the calendar to start or end a stage there.
              </span>
            </p>
            <p>
              Too many legs to read? Scroll or pinch over the track to zoom it — fewer
              days, wider legs, down to a week across — or use − and +; the percentage
              goes back to the three months around the one on screen. Swipe sideways
              to travel along the trip.{month ? ' The track follows the calendar to the month on screen, and the map above marks the days it shows.' : ''}
            </p>
          </SectionLegend>
          <LoupeReadout trip={trip} total={total} loupe={loupe} mapped={Boolean(month)} />
        </span>
        {/* The timeline of a connected Winnow proposes what this list lacks —
            a diff the author accepts leg by leg, never a sync. */}
        {onCompleteFrom &&
          timelineSources.map((id) => (
            <Button
              key={id}
              onClick={() => onCompleteFrom(id)}
              title={`Compare these stages with ${id}'s timeline and take what you want`}
              icon={Icons.download}
            >
              From {id}
            </Button>
          ))}
        {/* The zoom's buttons: nothing here is gesture-only, and a mouse
            with no wheel still reaches every scale. */}
        {zoomable && <StageZoomControl zoom={zoom} hint="scroll or pinch over the track" className="flex-none" />}
        <Button variant="primary" onClick={add} icon={Icons.plus}>
          Stage
        </Button>
      </div>

      <StageRuler
        trip={trip}
        rungAt={rungAt}
        selectedId={selected?.id ?? null}
        cursorDate={cursorDate}
        onOpenStage={(stage) => {
          ruler.learn();
          onOpenStage(stage);
        }}
        onScrub={(date) => {
          ruler.learn();
          onScrub(date);
        }}
        onChange={(stages) => {
          ruler.learn();
          onChange(stages);
        }}
        boxRef={rulerBox}
        width={rulerWidth}
        days={days}
        limits={limits}
        base={base}
        onScale={setScale}
        month={month}
        loupe={loupe}
      />

      {trip.stages.length === 0 ? (
        /* The empty state says what to DO; what a stage IS sits behind the
           legend's ⓘ, where it stops taking five lines on every visit. */
        <p className="m-0 text-xs text-muted">
          No legs yet — add one with the + above
          <span className="max-[600px]:hidden">
            , or right-click a day on the calendar
          </span>
          .
        </p>
      ) : (
        !selected &&
        !ruler.learned && (
          <p className="m-0 font-mono text-2xs text-faint">
            Tap a leg to edit it and go to its first day · tap anywhere else on
            the track to open that day · hold a leg, or either of its edges,
            then drag to move its dates
            {zoomable ? ' · scroll or pinch over the track to zoom it' : ''}
            {/* A gesture a phone does not have, hidden where there is none —
                the calendar's own hint above does the same. */}
            <span className="max-[600px]:hidden">
              {' '}· right-click a day on the calendar to start or end a stage there
            </span>
          </p>
        )
      )}

      {selected && !hideCard && (
        <StageCard
          key={selected.id}
          trip={trip}
          stage={selected}
          index={selectedIndex}
          onChange={(next) => onChange(trip.stages.map((s) => (s.id === next.id ? next : s)))}
          onDelete={() => {
            onChange(trip.stages.filter((s) => s.id !== selected.id));
            onSelect(null);
          }}
          onClose={() => onSelect(null)}
          onRememberCode={onRememberCode}
        />
      )}
    </section>
  );
}

/**
 * The days the ruler's window shows, said beside the legend and kept current
 * as it travels and zooms — read from the ruler's publication so only this
 * line re-renders per frame. On a long trip it wears the accent bar the year
 * map draws the same window with. Nothing when the window is the whole trip:
 * the heading already says those dates.
 */
function LoupeReadout({
  trip,
  total,
  loupe,
  mapped,
}: {
  trip: TripDoc;
  total: number;
  loupe?: LoupeStore;
  mapped: boolean;
}) {
  const view = useLoupe(loupe);
  if (!view) return null;
  const { first, last } = loupeSpan(total, view);
  if (first === 0 && last === total - 1) return null;
  const start = addDays(trip.startDate, first);
  const end = addDays(trip.startDate, last);
  if (!start || !end) return null;
  return (
    <span
      className="min-w-0 flex items-center gap-1.5 font-mono text-2xs text-muted tabular-nums"
      title="The days the stage ruler shows"
    >
      {mapped && <span className="flex-none w-3 h-[3px] rounded-full bg-accent" aria-hidden="true" />}
      <span className="truncate">
        {formatIsoDate(start)} → {formatIsoDate(end)} · {last - first + 1} days
      </span>
    </span>
  );
}
