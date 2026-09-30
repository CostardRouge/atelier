import type { RulerGap } from '../../shared/roadtrip/stage-ruler';
import { stageTint } from '../../shared/roadtrip/stage-ruler';
import { formatIsoDate, type IsoDate } from '../../shared/roadtrip/trip-days';
import type { MapStage } from '../../shared/roadtrip/trip-map';
import Button from '../../shared/ui/Button';
import IconButton from '../../shared/ui/IconButton';
import { Icons } from '../../shared/ui/icons';
import StageDays from './StageDays';

/** `21 Feb` — the bar is one line on a phone, and the year is on the screen already. */
const short = (date: IsoDate) => formatIsoDate(date).replace(/ \d{4}$/, '');

interface MapStageBarProps {
  /** The open stage, or null when the open day lies in no stage. */
  stage: MapStage | null;
  /** The run of days no stage covers that holds the open day, when there is one. */
  gap: RulerGap | null;
  selected: IsoDate | null;
  rungAt: (date: IsoDate) => number;
  told: number;
  onSelectDate: (date: IsoDate) => void;
  /** Step to the stage before or after, in lived order. */
  onStep: (dir: -1 | 1) => void;
  canStep: { back: boolean; forward: boolean };
  /** Open the stage in the legs sheet, where it is edited. */
  onEdit: () => void;
  onCover: (gap: RulerGap) => void;
}

/**
 * The phone's stage, over the foot of the map: which stage is open, a way to
 * the one before and after (the keyboard twin of a tap on a dial, and the
 * thumb's way along the route), and the stage's days in one scrolling row —
 * because the map shows a stage once and pins no day inside it, this row is
 * where one of its days is picked.
 */
export default function MapStageBar({
  stage,
  gap,
  selected,
  rungAt,
  told,
  onSelectDate,
  onStep,
  canStep,
  onEdit,
  onCover,
}: MapStageBarProps) {
  return (
    <div className="flex flex-col gap-1.5 p-1.5 rounded-paper-lg border border-line bg-surface shadow-paper">
      <div className="flex items-center gap-1 min-w-0">
        <IconButton size="sm" variant="ghost" label="The stage before" disabled={!canStep.back} onClick={() => onStep(-1)}>
          {Icons.back}
        </IconButton>
        {stage ? (
          <>
            <span className="flex-none w-2.5 h-2.5 rounded-full" style={{ background: stageTint(stage.index) }} aria-hidden="true" />
            <span className="flex-1 min-w-0 pl-1">
              <span className="block text-sm font-semibold leading-tight truncate">{stage.label || 'Unnamed stage'}</span>
              <span className="block font-mono text-3xs text-muted truncate">
                {short(stage.dates[0])} → {short(stage.dates[stage.dates.length - 1])} · {stage.dates.length} d · {told} told
                {stage.anchor ? '' : ' · not on the map'}
              </span>
            </span>
            <Button size="sm" onClick={onEdit}>
              Edit
            </Button>
          </>
        ) : (
          <>
            <span className="flex-none w-2.5 h-2.5 rounded-full border-[1.5px] border-dashed border-faint" aria-hidden="true" />
            <span className="flex-1 min-w-0 pl-1">
              <span className="block text-sm font-semibold leading-tight truncate">
                {gap ? `${gap.length} day${gap.length === 1 ? '' : 's'} in no stage` : 'No stage here'}
              </span>
              {gap && (
                <span className="block font-mono text-3xs text-muted truncate">
                  {short(gap.startDate)} → {short(gap.endDate)} · the dotted road
                </span>
              )}
            </span>
            {gap && (
              <Button size="sm" onClick={() => onCover(gap)}>
                Cover…
              </Button>
            )}
          </>
        )}
        <IconButton size="sm" variant="ghost" label="The stage after" disabled={!canStep.forward} onClick={() => onStep(1)}>
          {Icons.forward}
        </IconButton>
      </div>
      {stage && <StageDays dates={stage.dates} selected={selected} rungAt={rungAt} onSelect={onSelectDate} layout="row" />}
    </div>
  );
}
