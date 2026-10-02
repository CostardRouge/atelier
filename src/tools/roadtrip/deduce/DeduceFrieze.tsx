import { useMemo } from 'react';
import { daysBetween, parseIsoDate, type IsoDate } from '../../../shared/roadtrip/trip-days';
import { useElementWidth } from '../../../shared/ui/use-element-width';
import type { DayInfo } from './use-deduction';

/**
 * The trip's days as one strip — one column a day — with the proposals (and,
 * in the calque, the author's stages) as bars above and the media per day as
 * a small histogram below. A blind day is hatched, an ignored one amber.
 *
 * Measured to its box (`useElementWidth`), never scaled: a 345-day trip in a
 * 760px box is 2.2px a day, which still reads as a shape.
 */

export interface FriezeItem {
  key?: string;
  startDate: IsoDate;
  endDate: IsoDate;
  fill: string | null;
  stroke?: string | null;
  dashed?: boolean;
  label: string;
  ink?: string;
}

export interface FriezeLane {
  items: FriezeItem[];
}

interface DeduceFriezeProps {
  days: readonly DayInfo[];
  lanes: readonly FriezeLane[];
  hot?: string | null;
  barHeight?: number;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LANE_H = 18;
const TOP = 4;

export default function DeduceFrieze({ days, lanes, hot = null, barHeight = 34 }: DeduceFriezeProps) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const n = Math.max(1, days.length);
  const W = Math.max(260, width);
  const dw = W / n;
  const barTop = TOP + lanes.length * (LANE_H + 4) + 4;
  const H = barTop + barHeight + 16;
  const maxCount = Math.max(1, ...days.map((d) => d.count));
  const first = days[0]?.date;

  const months = useMemo(() => {
    const out: { offset: number; label: string }[] = [];
    days.forEach((d, i) => {
      const ms = parseIsoDate(d.date);
      if (ms === null) return;
      const dt = new Date(ms);
      if (i === 0 || dt.getUTCDate() === 1) out.push({ offset: i, label: MONTHS[dt.getUTCMonth()] });
    });
    return out;
  }, [days]);

  const offset = (iso: IsoDate) => (first ? (daysBetween(first, iso) ?? 0) : 0);

  return (
    <div ref={ref} className="rounded-paper border border-line bg-paper px-0 pt-2 pb-1">
      {width > 0 && (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block w-full h-auto" aria-hidden="true">
          <defs>
            <pattern id="deduce-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="2" height="4" fill="var(--color-faint)" />
            </pattern>
          </defs>
          {lanes.map((lane, k) => {
            const y = TOP + k * (LANE_H + 4);
            return lane.items.map((it, i) => {
              const from = Math.max(0, offset(it.startDate));
              const to = Math.min(n - 1, offset(it.endDate));
              if (to < from) return null;
              const x = from * dw;
              const w = Math.max(2, (to - from + 1) * dw - 1.5);
              const dimmed = hot && it.key !== hot;
              const room = Math.floor(w / 5.6) - 1;
              const label = w > 46 ? (it.label.length > room ? `${it.label.slice(0, Math.max(3, room))}…` : it.label) : '';
              return (
                <g key={`${k}-${it.key ?? i}`} className={`transition-opacity ${dimmed ? 'opacity-30' : ''}`}>
                  <rect
                    x={x.toFixed(1)}
                    y={y}
                    width={w.toFixed(1)}
                    height={LANE_H}
                    rx={4}
                    fill={it.fill ?? 'none'}
                    stroke={it.stroke ?? 'none'}
                    strokeWidth={1.3}
                    strokeDasharray={it.dashed ? '3 2' : undefined}
                  />
                  {label && (
                    <text x={(x + 5).toFixed(1)} y={y + 12.5} fontSize={9.5} fontFamily="var(--font-sans)" fill={it.ink ?? 'var(--color-surface)'}>
                      {label}
                    </text>
                  )}
                </g>
              );
            });
          })}
          {days.map((d, i) => {
            const h = Math.max(2, (d.count / maxCount) * barHeight);
            const x = i * dw + dw * 0.14;
            const w = Math.max(1, dw * 0.72);
            const y = barTop + barHeight - h;
            const fill = !d.placed ? 'url(#deduce-hatch)' : d.ignored ? 'var(--color-warn)' : 'var(--color-heat-2)';
            return <rect key={d.date} x={x.toFixed(1)} y={y.toFixed(1)} width={w.toFixed(1)} height={h.toFixed(1)} fill={fill} />;
          })}
          {months.map((m) => (
            <text key={m.offset} x={(m.offset * dw + 2).toFixed(1)} y={H - 3} fontSize={9} fontFamily="var(--font-mono)" fill="var(--color-muted)">
              {m.label}
            </text>
          ))}
        </svg>
      )}
    </div>
  );
}
