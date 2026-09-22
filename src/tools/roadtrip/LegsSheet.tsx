import { insertStageInOrder, stageOverGap, startStageAt } from '../../shared/roadtrip/stage-edit';
import { rulerBars, rulerGaps, stageTint } from '../../shared/roadtrip/stage-ruler';
import { enumerateDays, formatIsoDate, spanLength, type IsoDate } from '../../shared/roadtrip/trip-days';
import { stageLabel } from '../../shared/roadtrip/trip-places';
import type { TripDoc, TripStage } from '../../shared/roadtrip/trip-types';
import Button from '../../shared/ui/Button';
import { Icons } from '../../shared/ui/icons';
import { HEATMAP_LEVELS } from './heatmap-ramp';
import { StageCard } from './StagesPanel';

interface LegsSheetProps {
  trip: TripDoc;
  /** The grid's rung for a day (0..4): each leg wears its own coverage as a barcode. */
  rungAt: (date: IsoDate) => number;
  /** The leg open in the list, its editor unfolded under its row. */
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (stages: TripStage[]) => void;
  /** Connected Winnows whose timeline can complete the stages. */
  timelineSources?: readonly string[];
  onCompleteFrom?: (sourceId: string) => void;
  /** Connected Winnows the itinerary can be deduced from. */
  deduceSources?: readonly string[];
  onDeduceFrom?: (sourceId: string) => void;
}

/** How many days of a leg the barcode shows before it samples. */
const BARS = 26;

/**
 * The trip's legs as a list — the phone's answer to the stage ruler, which
 * needs 6px a day it does not have there (`docs/roadtrip-overview-mobile.md`
 * §8.3). Every leg is a row with its own coverage as a small barcode; the one
 * you open unfolds the same `StageCard` the wide screen edits with. The runs
 * of days no leg covers are rows too, with the `+` the ruler draws over a
 * gap, so nothing the ruler offered is lost — only the drag, which the
 * calendar itself takes over.
 */
export default function LegsSheet({
  trip,
  rungAt,
  selectedId,
  onSelect,
  onChange,
  timelineSources = [],
  onCompleteFrom,
  deduceSources = [],
  onDeduceFrom,
}: LegsSheetProps) {
  const bars = rulerBars(trip);
  const gaps = rulerGaps(trip, bars);
  const total = spanLength(trip.startDate, trip.endDate) ?? 0;
  const uncovered = gaps.reduce((n, g) => n + g.length, 0);

  const add = () => {
    const gap = gaps[0];
    const result = startStageAt(trip, gap ? gap.startDate : trip.endDate);
    onChange(result.stages);
    onSelect(result.selectedId);
  };
  const cover = (startDate: IsoDate, endDate: IsoDate) => {
    const stage = stageOverGap(trip, startDate, endDate);
    onChange(insertStageInOrder(trip.stages, stage));
    onSelect(stage.id);
  };

  // Rows in lived order, gaps slotted where they fall.
  type Row = { kind: 'leg'; stage: TripStage; index: number } | { kind: 'gap'; startDate: IsoDate; endDate: IsoDate; length: number };
  const rows: Row[] = [
    ...trip.stages.map((stage, index) => ({ kind: 'leg' as const, stage, index })),
    ...gaps.map((g) => ({ kind: 'gap' as const, startDate: g.startDate, endDate: g.endDate, length: g.length })),
  ].sort((a, b) => {
    const da = a.kind === 'leg' ? a.stage.startDate : a.startDate;
    const db = b.kind === 'leg' ? b.stage.startDate : b.startDate;
    return da < db ? -1 : da > db ? 1 : 0;
  });

  return (
    <div className="flex flex-col gap-2 px-4 pt-2 pb-4">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono text-2xs text-muted">
          {trip.stages.length} leg{trip.stages.length === 1 ? '' : 's'} · {total - uncovered}/{total} days covered
        </span>
        <span className="flex-1" />
        {onCompleteFrom &&
          timelineSources.map((id) => (
            <Button key={id} size="sm" onClick={() => onCompleteFrom(id)} icon={Icons.download} title={`Compare these stages with ${id}'s timeline and take what you want`}>
              From {id}
            </Button>
          ))}
        {onDeduceFrom &&
          deduceSources.map((id) => (
            <Button key={`deduce-${id}`} size="sm" onClick={() => onDeduceFrom(id)} icon={Icons.search} title={`Work these legs out from where ${id} says each day was`}>
              Deduce
            </Button>
          ))}
        <Button variant="primary" size="sm" onClick={add} icon={Icons.plus}>
          Stage
        </Button>
      </div>

      {trip.stages.length === 0 && (
        <p className="m-0 text-xs text-muted">No legs yet — add one with the + above, or cover the days below.</p>
      )}

      <ul className="m-0 p-0 list-none flex flex-col">
        {rows.map((row) => {
          if (row.kind === 'gap') {
            return (
              <li key={`gap-${row.startDate}`} className="flex items-center gap-2.5 min-h-[48px] py-2 border-b border-line">
                <span className="flex-none w-[9px] h-[9px] rounded-full border border-dashed border-line-strong" aria-hidden="true" />
                <span className="flex-1 min-w-0 text-sm text-muted truncate">
                  {row.length} day{row.length === 1 ? '' : 's'} without a stage
                  <span className="font-mono text-2xs text-faint"> · {formatIsoDate(row.startDate)} → {formatIsoDate(row.endDate)}</span>
                </span>
                <Button size="sm" onClick={() => cover(row.startDate, row.endDate)} title={`Add a stage covering ${formatIsoDate(row.startDate)} → ${formatIsoDate(row.endDate)}`}>
                  + cover
                </Button>
              </li>
            );
          }
          const { stage, index } = row;
          const open = stage.id === selectedId;
          const days = spanLength(stage.startDate, stage.endDate) ?? 0;
          const all = enumerateDays(stage.startDate, stage.endDate);
          const told = all.filter((d) => rungAt(d) > 0).length;
          // The barcode samples a long leg so it stays one row wide.
          const stride = Math.max(1, Math.ceil(all.length / BARS));
          const sample = all.filter((_, i) => i % stride === 0);
          const label = stageLabel(stage) || 'Unnamed stage';
          return (
            <li key={stage.id} className="border-b border-line">
              <button
                type="button"
                onClick={() => onSelect(open ? null : stage.id)}
                aria-expanded={open}
                className="flex items-center gap-2.5 w-full min-h-[54px] py-2 border-0 bg-transparent text-left cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ink rounded-control"
              >
                <span className="flex-none w-[9px] h-[9px] rounded-full" style={{ background: stageTint(index) }} aria-hidden="true" />
                <span className="flex-1 min-w-0">
                  <span className={`block text-sm leading-tight truncate ${open ? 'font-semibold' : ''} ${stageLabel(stage) ? '' : 'text-muted'}`}>{label}</span>
                  <span className="block font-mono text-2xs text-muted truncate">
                    {formatIsoDate(stage.startDate)} → {formatIsoDate(stage.endDate)} · {days} d · {told} told
                  </span>
                </span>
                <span className="flex-none flex gap-px" aria-hidden="true">
                  {sample.map((d) => (
                    <span key={d} className="w-[3px] h-5 rounded-[1px]" style={{ background: HEATMAP_LEVELS[rungAt(d)] }} />
                  ))}
                </span>
                <span className="flex-none w-4 text-center text-sm text-faint" aria-hidden="true">
                  {open ? '⌄' : '›'}
                </span>
              </button>
              {open && (
                <div className="pb-3">
                  <StageCard
                    trip={trip}
                    stage={stage}
                    index={index}
                    onChange={(next) => onChange(trip.stages.map((s) => (s.id === next.id ? next : s)))}
                    onDelete={() => {
                      onChange(trip.stages.filter((s) => s.id !== stage.id));
                      onSelect(null);
                    }}
                    onClose={() => onSelect(null)}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <p className="m-0 font-mono text-2xs text-faint leading-snug">
        Two stages may overlap: a travel day belongs to the one you left and the one you reached.
      </p>
    </div>
  );
}
