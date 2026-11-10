import { useEffect, useMemo, useState } from 'react';
import { chooserMonths, dayCounts, dayPictures, filterCounts, whereIs, withJoinedAfter, type DayFilter, type PictureWhere } from '../../shared/recap/recap-chooser';
import { withPick, type RecapDoc, type RecapPicture } from '../../shared/recap/recap-doc';
import type { RecapLayout } from '../../shared/recap/recap-layout';
import { hasCarouselPictures, withReplaced, withSwappedFlow } from '../../shared/recap/recap-selection';
import type { RecapSlot, ResolvedRecap } from '../../shared/recap/recap-slots';
import type { IsoDate } from '../../shared/roadtrip/trip-days';
import type { WinnowClient } from '../../shared/sources/winnow/client';
import { InspectorSection } from '../../shared/ui/Inspector';
import IconButton from '../../shared/ui/IconButton';
import Segmented from '../../shared/ui/Segmented';
import { Icons } from '../../shared/ui/icons';
import PictureThumb from './PictureThumb';
import type { Change } from './RecapPanels';

/** A day's photos shown at a time (lab 17: Miller, Doherty — «24 more» is instant). */
const PAGE = 24;
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
// Rungs 1–2 carry ink, 3–4 the paper (the heatmap's own rule, `heatmap-ramp.ts`).
const HEAT = ['', 'bg-heat-1 text-ink', 'bg-heat-2 text-ink', 'bg-heat-3 text-paper', 'bg-heat-4 text-paper'];
/** A day's rung by its shots, on a log scale: one day of 2 300 must not flatten every day of 20 into the palest rung. */
const rung = (n: number, max: number) => (n <= 0 ? 0 : max <= 1 ? 2 : Math.min(4, 1 + Math.floor((Math.log(n) / Math.log(max)) * 3.999)));

const longDay = (day: IsoDate) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const monthName = (month: string) => new Date(`${month}-01T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/**
 * The recap's days under the place in hand (lab 17, part II): a month of
 * days shaded by their shots — it opens on the held picture's day — and the
 * open day's photos, all of them, best first, 24 at a time, narrowed to ♥ or
 * picks. A tap gives the place in hand that photo (a carousel place is
 * replaced in the selection, a template's own place pinned); «+» adds it to
 * the carousel right after the held picture. A photo already shown somewhere
 * says where; one on the template's own page never joins the carousel (the
 * same picture twice reads as a mistake — Q6).
 */
export default function DayChooser({
  doc,
  resolved,
  layout,
  held,
  change,
  thumbs,
  onDay,
  onElsewhere,
}: {
  doc: RecapDoc;
  resolved: ResolvedRecap;
  layout: RecapLayout;
  /** The place in hand, or null when none is (the tab then only adds). */
  held: RecapSlot | null;
  change: Change;
  thumbs: { client: WinnowClient | null; instance: string | null; files: ReadonlyMap<string, File> };
  /** A day opened in the month: the editor selects that day's own place when the template has one. */
  onDay?: (day: IsoDate) => void;
  /** Your Winnow, for a picture outside the recap's days. */
  onElsewhere: (() => void) | null;
}) {
  const counts = useMemo(() => dayCounts(resolved), [resolved]);
  const months = useMemo(() => chooserMonths(counts, doc.cells.weekStart), [counts, doc.cells.weekStart]);
  const where = useMemo(() => whereIs(resolved, layout), [resolved, layout]);
  const first = useMemo(() => [...counts.keys()].sort()[0] ?? null, [counts]);
  const heldDay = held?.picture?.day ?? held?.day ?? null;
  const [day, setDay] = useState<IsoDate | null>(heldDay && counts.has(heldDay) ? heldDay : first);
  const [filter, setFilter] = useState<DayFilter>('all');
  const [shown, setShown] = useState(PAGE);
  // The month opens on the picture in hand's day, each time another place is held.
  useEffect(() => {
    if (heldDay && counts.has(heldDay)) setDay(heldDay);
    setShown(PAGE);
    // Only when the place in hand changes — never on an edit of the recap (`counts` and `heldDay` read as they stand).
  }, [held?.id]);
  const open = day && counts.has(day) ? day : first;
  const month = months.find((m) => open && open.startsWith(m.month)) ?? months[0];
  const max = Math.max(1, ...counts.values());
  const inCarousel = useMemo(() => new Set(resolved.slots.flatMap((s) => (s.flow && s.picture?.day ? [s.picture.day] : []))), [resolved.slots]);
  const fc = useMemo(() => (open ? filterCounts(resolved, open) : { fav: 0, picks: 0, all: 0 }), [resolved, open]);
  const active: DayFilter = (filter === 'fav' && !fc.fav) || (filter === 'picks' && !fc.picks) ? 'all' : filter;
  const list = useMemo(() => (open ? dayPictures(resolved, open, active) : []), [resolved, open, active]);
  if (!month || !open) return null;

  const carousel = hasCarouselPictures(doc);
  const heldKey = held?.picture?.key ?? null;
  const own = (w: PictureWhere) => !w.flow;
  const whereWord = (w: PictureWhere) => (own(w) && w.page === 0 ? (doc.template === 'month' ? 'calendar' : doc.template === 'week' ? 'week' : 'slide 1') : `slide ${w.page + 1}`);
  const go = (d: IsoDate) => {
    setDay(d);
    setShown(PAGE);
    onDay?.(d);
  };
  const at = months.indexOf(month);
  const step = (by: number) => {
    const m = months[at + by];
    if (!m) return;
    const d = m.days.find((x) => counts.has(x));
    if (d) go(d);
  };

  /** What a tap on `p` does, and why it cannot when it cannot. */
  const tap = (p: RecapPicture): { run: (() => void) | null; why: string } => {
    const w = where.get(p.key);
    if (!held) return { run: null, why: 'Click a place on the stage, or a picture of the slide, to choose for it' };
    if (p.key === heldKey) return { run: null, why: 'The picture in hand' };
    if (held.flow) {
      if (w && own(w)) return { run: null, why: `Already on the ${whereWord(w)}: the same picture twice reads as a mistake` };
      if (w?.flow && heldKey) return { run: () => change((d) => withSwappedFlow(d, resolved, heldKey, p.key)), why: `Trade places with the picture on ${whereWord(w)}` };
      return { run: heldKey ? () => change((d) => withReplaced(d, resolved, heldKey, p.key)) : null, why: 'Use it instead of the picture in hand' };
    }
    if (w) return { run: null, why: `Already on ${whereWord(w)}` };
    return { run: () => change((d) => withPick(d, held.id, p.key)), why: `Put it on ${held.label}` };
  };
  const add = (p: RecapPicture) => (carousel && !where.has(p.key) ? () => change((d) => withJoinedAfter(d, p.key, held?.flow ? heldKey : null)) : null);
  const hint = !held
    ? 'Click a place to choose for it · + adds a highlight'
    : held.flow
      ? `Tap to use it here${carousel ? ' · + adds it right after' : ''}`
      : `Tap to put it on ${held.label}${carousel ? ' · + adds it to the highlights' : ''}`;

  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  return (
    <>
      <InspectorSection id="recap-month" title={months.length > 1 ? 'The days' : 'The month'} summary={`${total.toLocaleString('en-GB')} shots`}>
        <div className="flex flex-col gap-1.5">
          {months.length > 1 && (
            <div className="flex items-center justify-between gap-2">
              <IconButton size="sm" variant="ghost" label="The month before" disabled={at === 0} onClick={() => step(-1)}>
                {Icons.back}
              </IconButton>
              <span className="text-sm font-semibold text-ink">{monthName(month.month)}</span>
              <IconButton size="sm" variant="ghost" label="The month after" disabled={at === months.length - 1} onClick={() => step(1)}>
                {Icons.forward}
              </IconButton>
            </div>
          )}
          <div role="group" aria-label={`The days of ${monthName(month.month)}, shaded by their shots`} className="grid grid-cols-7 gap-1">
            {Array.from({ length: 7 }, (_, i) => (
              <span key={`w${i}`} aria-hidden="true" className="text-center font-mono text-3xs text-muted">
                {WEEKDAYS[(i + doc.cells.weekStart) % 7]}
              </span>
            ))}
            {Array.from({ length: month.lead }, (_, i) => (
              <span key={`l${i}`} />
            ))}
            {month.days.map((d) => {
              const n = counts.get(d) ?? 0;
              const level = rung(n, max);
              return (
                <button
                  key={d}
                  type="button"
                  disabled={!n}
                  aria-pressed={d === open}
                  title={`${longDay(d)} · ${n.toLocaleString('en-GB')} shot${n === 1 ? '' : 's'}${inCarousel.has(d) ? ' · in the highlights' : ''}`}
                  onClick={() => go(d)}
                  className={`relative aspect-[1.15] pointer-coarse:min-h-11 rounded-[6px] border border-line font-mono text-2xs tabular-nums cursor-pointer disabled:cursor-default disabled:opacity-35 ${HEAT[level] || 'bg-paper text-ink'} ${d === open ? 'outline outline-2 outline-ink outline-offset-1' : ''}`}
                >
                  {Number(d.slice(8))}
                  {inCarousel.has(d) && <span aria-hidden="true" className="absolute right-0.5 top-0.5 w-1.5 h-1.5 rounded-full bg-ink shadow-[0_0_0_1.5px_var(--color-paper)]" />}
                </button>
              );
            })}
          </div>
          <span className="font-mono text-2xs text-muted">Shaded by shots · ● a day in the highlights</span>
        </div>
      </InspectorSection>
      <InspectorSection id="recap-day" title={longDay(open)} summary={`${fc.all.toLocaleString('en-GB')} shots`}>
        <div className="flex flex-col gap-1.5">
          {(fc.fav > 0 || fc.picks > 0) && (
            <Segmented<DayFilter>
              size="sm"
              fill
              label="Which photos of the day"
              value={active}
              onChange={(f) => {
                setFilter(f);
                setShown(PAGE);
              }}
              options={[
                ...(fc.fav ? [{ id: 'fav' as const, label: `♥ ${fc.fav}`, title: 'The ones you marked ♥ in Winnow' }] : []),
                ...(fc.picks ? [{ id: 'picks' as const, label: `Picks ${fc.picks}`, title: 'The ones you picked in Winnow' }] : []),
                { id: 'all', label: `All ${fc.all.toLocaleString('en-GB')}`, title: 'Every photo of the day, the best first' },
              ]}
            />
          )}
          <span className="font-mono text-2xs text-muted">{hint}</span>
          <div role="list" aria-label={`The photos of ${longDay(open)}`} className="grid grid-cols-4 gap-1.5">
            {list.slice(0, shown).map((p) => {
              const w = where.get(p.key);
              const t = tap(p);
              const plus = add(p);
              const isHeld = p.key === heldKey;
              return (
                <div key={p.key} role="listitem" className={`relative aspect-square rounded-[5px] overflow-hidden bg-frame ${isHeld ? 'outline outline-2 outline-accent outline-offset-1' : ''}`}>
                  <button
                    type="button"
                    disabled={!t.run}
                    onClick={t.run ?? undefined}
                    title={`${p.name} — ${t.why}`}
                    aria-label={`${p.name}: ${t.why}`}
                    className="absolute inset-0 p-0 border-0 cursor-pointer disabled:cursor-default enabled:hover:opacity-85"
                  >
                    <PictureThumb pic={p} client={thumbs.client} instance={thumbs.instance} file={thumbs.files.get(p.key) ?? null} className="w-full h-full" />
                    {w && !isHeld && <span aria-hidden="true" className={`absolute inset-0 ${own(w) && held?.flow ? 'bg-[rgba(16,14,12,0.45)]' : ''}`} />}
                  </button>
                  {(p.fav || p.picked) && (
                    <span aria-hidden="true" className="absolute right-1 top-0.5 text-2xs text-on-media [text-shadow:0_1px_2px_rgba(0,0,0,.7)] pointer-events-none">
                      {p.fav ? '♥' : '★'}
                    </span>
                  )}
                  {w && (
                    <span className="absolute left-1 bottom-1 px-1 py-px rounded-[3px] bg-[rgba(16,14,12,0.72)] text-on-media font-mono text-3xs uppercase tracking-[0.04em] pointer-events-none">{whereWord(w)}</span>
                  )}
                  {plus && (
                    <button
                      type="button"
                      onClick={plus}
                      aria-label={`Add ${p.name} to the highlights${held?.flow ? ', right after the picture in hand' : ''}`}
                      title={held?.flow ? 'Add it right after the picture in hand' : 'Add it to the highlights, at its moment'}
                      className="absolute right-1 bottom-1 w-6 h-6 pointer-coarse:w-9 pointer-coarse:h-9 inline-flex items-center justify-center rounded-full border-0 bg-[rgba(16,15,13,0.78)] text-on-media text-sm cursor-pointer hover:bg-accent"
                    >
                      +
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {list.length > shown && (
            <button type="button" onClick={() => setShown((n) => n + PAGE)} className="w-full min-h-9 pointer-coarse:min-h-11 rounded-control border border-line bg-paper-2 text-xs text-ink cursor-pointer hover:border-line-strong">
              {Math.min(PAGE, list.length - shown)} more · {(list.length - shown).toLocaleString('en-GB')} left
            </button>
          )}
          {onElsewhere && (
            <button type="button" onClick={onElsewhere} className="self-start text-2xs text-accent-ink underline-offset-2 hover:underline">
              Elsewhere — your Winnow…
            </button>
          )}
        </div>
      </InspectorSection>
    </>
  );
}
