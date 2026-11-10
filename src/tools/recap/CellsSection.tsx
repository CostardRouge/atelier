import { useEffect, useState, type ReactNode } from 'react';
import { ARRANGES, type Arrange, type CellWords, type DateFormat, type NumberAt } from '../../shared/recap/recap-cellwords';
import { withRecap, type RecapDoc } from '../../shared/recap/recap-doc';
import type { RecapPage } from '../../shared/recap/recap-layout';
import { familyWords, hasFamily, inFamily, scopeNames, withWords, withoutSlideWords, type CellScope } from '../../shared/recap/recap-scope';
import { InspectorSection, ToggleField } from '../../shared/ui/Inspector';
import Segmented from '../../shared/ui/Segmented';
import { SlideLayoutPicker, SlideTitlesRow } from './CarouselPanel';
import { ExifChips, type Change } from './RecapPanels';

const legend = 'font-mono text-2xs tracking-[0.14em] uppercase text-muted';
const ARRANGE_LABEL: Record<Arrange, string> = { auto: 'Auto', line: 'One line', stack: 'Stacked' };
const PLACE_LABEL: Record<NumberAt, string> = { topLeft: 'Top left', topRight: 'Top right', bottomLeft: 'Bottom left', centre: 'Centre', foot: 'Under the picture' };
/** The presets, drawn on Monday 10 November 2025 (lab 17). */
const DATE_TILES: { id: DateFormat | 'none'; label: string; sub: string; wide?: boolean }[] = [
  { id: 'none', label: 'None', sub: 'no date' },
  { id: 'rank', label: '3', sub: 'its rank' },
  { id: 'd', label: '10', sub: 'd' },
  { id: 'wd', label: 'Mon 10', sub: 'wd' },
  { id: 'dMon', label: '10 Nov', sub: 'dMon' },
  { id: 'wdMon', label: 'Mon 10 Nov', sub: 'wdMon' },
  { id: 'full', label: 'Monday 10 November 2025', sub: 'full', wide: true },
];

/**
 * Layout › *Cells* (lab 17 part I, his yes of 2026-11-10): what a cell SAYS,
 * for the scope the chip names — the first slide (a month's calendar, a
 * dump's cover), the slides after it as a family (the highlights), or the
 * slide on the stage alone. The chip follows the stage; choosing a scope shows
 * its first slide. On *This slide*, a row the slide does not set shows its
 * family's value greyed; set, it is the slide's own, with ↺ beside it.
 */
export default function CellsSection({ doc, change, page, pages, onPage }: { doc: RecapDoc; change: Change; page: RecapPage | undefined; pages: readonly RecapPage[]; onPage: (index: number) => void }) {
  const fam = hasFamily(doc);
  const key = page?.key ?? 'first';
  const onFamily = fam && inFamily(key);
  const names = scopeNames(doc);
  const own = doc.carousel.slideCells[key] ?? {};
  const ownCount = Object.keys(own).length + (doc.carousel.layouts[key] ? 1 : 0);
  const [scope, setScope] = useState<CellScope>(onFamily ? (ownCount ? 'slide' : 'family') : 'first');
  // The chip follows the stage: the first slide is its own scope; a family slide keeps «This slide» if it was chosen.
  useEffect(() => {
    setScope((s) => (!onFamily ? 'first' : s === 'first' ? (doc.carousel.slideCells[key] || doc.carousel.layouts[key] ? 'slide' : 'family') : s));
    // On the slide shown only — an edit never moves the chip.
  }, [key, onFamily]);
  const sc: CellScope = !fam ? 'first' : scope;
  const firstIndex = Math.max(0, pages.findIndex((p) => !inFamily(p.key)));
  const familyIndices = pages.flatMap((p, i) => (inFamily(p.key) ? [i] : []));
  const choose = (s: CellScope) => {
    setScope(s);
    // Choosing a scope is a gesture: the stage shows it.
    if (s === 'first' && onFamily) onPage(firstIndex);
    else if (s !== 'first' && !onFamily && familyIndices.length) onPage(familyIndices[0]);
  };

  const fw = familyWords(doc);
  const words: CellWords = sc === 'first' ? doc.cells : sc === 'family' ? fw : { ...fw, ...own };
  const inherited = (k: keyof CellWords) => sc === 'slide' && !(k in own);
  const set = (patch: Partial<CellWords>) => change((d) => withWords(d, sc, key, patch));
  const reset = (k: keyof CellWords) => change((d) => withoutSlideWords(d, key, k));
  const row = (k: keyof CellWords, inner: ReactNode) => (
    <div className="flex items-center gap-1 min-w-0">
      <div className={`flex-1 min-w-0 ${inherited(k) ? 'opacity-55' : ''}`}>{inner}</div>
      {sc === 'slide' && k in own && (
        <button type="button" onClick={() => reset(k)} title={`As the ${names.family.toLowerCase()}`} aria-label={`As the ${names.family.toLowerCase()}`} className="flex-none px-1 font-mono text-xs text-accent-ink cursor-pointer hover:underline">
          ↺
        </button>
      )}
    </div>
  );

  // What the first slide's cells are: a calendar's days, a week's bands, or pictures (whose number is their rank).
  const days = doc.template === 'month' || doc.template === 'week' || doc.template === 'onThisDay';
  const calendar = sc === 'first' && (doc.template === 'month' || doc.template === 'week');
  const natural: DateFormat = sc === 'first' && days ? 'd' : 'rank';
  const dateValue: DateFormat | 'none' = !words.number ? 'none' : words.date === 'auto' ? natural : words.date;
  // The rank is offered where a cell's number IS a rank (a grid, a dump), or to a recap already on it — never as a new date.
  const tiles = DATE_TILES.filter((t) => t.id !== 'rank' || dateValue === 'rank' || (sc === 'first' && !days));
  const cellsOn = page?.parts.filter((p) => p.kind === 'cell').length ?? 0;
  const hint =
    sc === 'first'
      ? `The first slide · its ${cellsOn} cell${cellsOn === 1 ? '' : 's'}`
      : sc === 'family'
        ? `Slides ${familyIndices.length ? `${familyIndices[0] + 1}–${familyIndices[familyIndices.length - 1] + 1}` : ''} · what every one says`
        : `Slide ${pages.indexOf(page!) + 1} · grey = as the ${names.family.toLowerCase()}`;

  return (
    <InspectorSection id="recap-cells" title="Cells">
      <div className="flex flex-col gap-2">
        {fam && (
          <div className="flex flex-col gap-1">
            <Segmented<CellScope>
              size="sm"
              fill
              label="Who these settings are for"
              value={sc}
              onChange={choose}
              options={[
                { id: 'first', label: names.first, title: 'The first slide' },
                { id: 'family', label: <span className="inline-flex items-center gap-1">{Object.keys(doc.carousel.cells).length > 0 && <i aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-accent" />}{names.family}</span>, title: 'Every slide after the first' },
                {
                  id: 'slide',
                  label: <span className="inline-flex items-center gap-1">{onFamily && ownCount > 0 && <i aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-accent" />}This slide</span>,
                  title: 'The slide on the stage alone',
                  disabled: onFamily ? false : 'The first slide: its settings are already its own',
                },
              ]}
            />
            <span className="font-mono text-2xs text-muted">{hint}</span>
            {sc === 'slide' && <span className="font-mono text-2xs text-muted">{ownCount ? `${ownCount} of its own · the rest as the ${names.family.toLowerCase()}` : `Everything as the ${names.family.toLowerCase()}`}</span>}
          </div>
        )}
        <span className={legend}>The date</span>
        {row(
          'date',
          <div role="group" aria-label="The date's format" className="grid grid-cols-3 gap-1">
            {tiles.map((t) => {
              const tooLong = calendar && (t.id === 'wdMon' || t.id === 'full');
              const on = dateValue === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  disabled={tooLong}
                  aria-pressed={on}
                  title={tooLong ? 'Too long for a calendar cell' : t.id === 'none' ? 'No date on the cells' : `${t.label} — drawn on Monday 10 November 2025`}
                  onClick={() => set(t.id === 'none' ? { number: false } : { number: true, date: t.id })}
                  className={`${t.wide ? 'col-span-2' : ''} min-w-0 flex flex-col items-start justify-center gap-0.5 px-2 py-1.5 min-h-12 rounded-[9px] border text-left cursor-pointer disabled:opacity-40 disabled:cursor-default ${on ? 'border-ink bg-surface shadow-[inset_0_0_0_1px_var(--color-ink)]' : 'border-line bg-paper enabled:hover:border-line-strong'} ${on && inherited('date') ? 'border-dashed' : ''}`}
                >
                  <b className="max-w-full truncate text-xs font-semibold text-ink">{t.label}</b>
                  <small className="font-mono text-3xs text-muted">{t.sub}</small>
                </button>
              );
            })}
          </div>,
        )}
        {words.number &&
          row(
            'numberAt',
            <div className="flex flex-col gap-1">
              <span className={legend}>Where</span>
              <Segmented<NumberAt>
                size="sm"
                columns={3}
                label="Where the date sits"
                value={words.numberAt}
                onChange={(numberAt) => set({ numberAt })}
                options={(['topLeft', 'topRight', 'bottomLeft', 'centre', 'foot'] as const).map((id) => ({
                  id,
                  label: PLACE_LABEL[id],
                  ...(id === 'foot' ? { title: calendar ? undefined : 'A soft band and the date on one line, low: room for a long date', disabled: calendar ? 'A calendar cell has no room under its picture' : false } : {}),
                }))}
              />
            </div>,
          )}
        <span className={legend}>What else it says</span>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          {row('count', <ToggleField checked={words.count} onChange={(count) => set({ count })} label="Shots that day">Shots that day</ToggleField>)}
          {row('exif', <ToggleField checked={words.exif} onChange={(exif) => set({ exif })} label="Camera settings">Camera settings</ToggleField>)}
          {row('device', <ToggleField checked={words.device} onChange={(device) => set({ device })} label="Device">Device</ToggleField>)}
          {row(
            'caption',
            <ToggleField checked={words.caption} onChange={(caption) => set({ caption })} label={sc === 'first' && days ? 'A word per day' : 'A word per picture'}>
              {sc === 'first' && days ? 'A word per day' : 'A word per picture'}
            </ToggleField>,
          )}
        </div>
        {words.exif && row('exifParts', <ExifChips parts={words.exifParts} onParts={(exifParts) => set({ exifParts })} label="The camera's settings these cells say" />)}
        {(words.exif || words.device || words.caption) &&
          row(
            'arrange',
            <div title="Words never pass their cell: a long line shrinks, then ends in “…”. Auto packs them into lines that fit, and stacks them in a tall cell.">
              <Segmented<Arrange> size="sm" fill label="How a cell's words lie" value={words.arrange} onChange={(arrange) => set({ arrange })} options={ARRANGES.map((a) => ({ id: a, label: ARRANGE_LABEL[a] }))} />
            </div>,
          )}

        {sc === 'first' && <FirstSlideRows doc={doc} change={change} />}
        {sc === 'family' && (
          <>
            <span className={legend}>The title on the other slides</span>
            <SlideTitlesRow doc={doc} change={change} />
          </>
        )}
        {sc === 'slide' && (
          <>
            {key.startsWith('p:') && (
              <>
                <span className={legend}>This slide's layout</span>
                <SlideLayoutPicker doc={doc} flowKey={key} change={change} />
              </>
            )}
            {ownCount > 0 && (
              <button
                type="button"
                onClick={() =>
                  change((d) => {
                    const { [key]: _gone, ...layouts } = d.carousel.layouts;
                    void _gone;
                    const cleared = withoutSlideWords(d, key);
                    return withRecap(cleared, { carousel: { ...cleared.carousel, layouts } });
                  })
                }
                className="self-start text-2xs text-accent-ink underline-offset-2 hover:underline"
              >
                Back to the {names.family.toLowerCase()}
              </button>
            )}
          </>
        )}
      </div>
    </InspectorSection>
  );
}

/** What only the first slide's cells have: a calendar's weekdays, its first day, today ringed, a day with no picture. */
function FirstSlideRows({ doc, change }: { doc: RecapDoc; change: Change }) {
  const c = doc.cells;
  const set = (patch: Partial<RecapDoc['cells']>) => change((d) => withRecap(d, { cells: { ...d.cells, ...patch } }));
  const dayTemplate = doc.template === 'month' || doc.template === 'week' || doc.template === 'onThisDay';
  if (!dayTemplate) return null;
  return (
    <>
      <span className={legend}>{doc.template === 'month' ? 'The calendar' : doc.template === 'week' ? 'The week' : 'The days'}</span>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        {doc.template === 'month' && (
          <ToggleField checked={c.headers} onChange={(headers) => set({ headers })} label="Weekdays">
            Weekdays
          </ToggleField>
        )}
        <ToggleField checked={c.today} onChange={(today) => set({ today })} label="Ring today">
          Ring today
        </ToggleField>
      </div>
      {doc.template === 'month' && (
        <ToggleField checked={c.weekStart === 0} onChange={(on) => set({ weekStart: on ? 0 : 1 })} label="Weeks start on Sunday">
          Weeks start on Sunday
        </ToggleField>
      )}
      {(doc.template === 'month' || doc.template === 'week') && (
        <>
          <span className={legend}>A day with no picture</span>
          <Segmented
            size="sm"
            fill
            label="A day with no picture"
            value={c.empty}
            onChange={(empty) => set({ empty })}
            options={[
              { id: 'number', label: 'Its date' },
              { id: 'dashed', label: 'Dashed' },
              { id: 'hidden', label: 'Hidden' },
            ]}
          />
        </>
      )}
    </>
  );
}
