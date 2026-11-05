import { useMemo, useState } from 'react';
import {
  MAX_HIGHLIGHTS,
  SLIDE_LAYOUTS,
  SLIDE_LAYOUT_LABEL,
  burstMembers,
  burstsOf,
  type AfterFirst,
  type RecapCarousel,
  type SlideLayout,
  type SlideTitles,
} from '../../shared/recap/recap-carousel';
import { withRecap, type RecapDoc, type RecapPicture } from '../../shared/recap/recap-doc';
import { MAX_SHEET_SLIDES, MIN_SHEET_SLIDES, SHEET_ARRANGEMENTS, SHEET_ARRANGEMENT_LABEL, sheetSlides, type RecapSheet, type SheetArrangement, type SheetCamera } from '../../shared/recap/recap-sheet';
import type { RecapPage } from '../../shared/recap/recap-layout';
import type { ResolvedRecap } from '../../shared/recap/recap-slots';
import type { WinnowClient } from '../../shared/sources/winnow/client';
import { InspectorSection, SliderRow, ToggleField } from '../../shared/ui/Inspector';
import Segmented from '../../shared/ui/Segmented';
import PictureThumb from './PictureThumb';
import type { Change } from './RecapPanels';

const legend = 'font-mono text-2xs tracking-[0.14em] uppercase text-muted';

const setCarousel = (change: Change, patch: Partial<RecapCarousel>) => change((d) => withRecap(d, { carousel: { ...d.carousel, ...patch } }));

interface Thumbs {
  client: WinnowClient | null;
  instance: string | null;
  files: ReadonlyMap<string, File>;
}

/**
 * What the slides after the first hold (carousel lab, B and C): nothing, the
 * highlights or a slide per week; the pictures IN the carousel with a ✕ that
 * leaves one out (the next best comes in), a burst's ×n that picks its frame,
 * and the ones left out, each back with one click.
 */
export function CarouselSection({ doc, resolved, change, thumbs }: { doc: RecapDoc; resolved: ResolvedRecap; change: Change; thumbs: Thumbs }) {
  const c = doc.carousel;
  // A dump and a sheet ARE their highlights: their tray, no «after the first slide».
  const dump = doc.template === 'dump' || doc.template === 'sheets';
  const flow = resolved.slots.filter((s) => (dump || s.flow) && s.picture);
  const bursts = useMemo(() => burstsOf(resolved.inScope), [resolved.inScope]);
  const members = useMemo(() => burstMembers(resolved.inScope, bursts), [resolved.inScope, bursts]);
  const [open, setOpen] = useState<string | null>(null);
  const byKey = useMemo(() => new Map(doc.pictures.map((p) => [p.key, p])), [doc.pictures]);
  const left = c.left.flatMap((k) => (byKey.has(k) ? [byKey.get(k)!] : []));
  const shows = dump || c.after === 'highlights';
  const openMembers = open ? (members.get(open) ?? []) : [];
  const tile = (pic: RecapPicture) => <PictureThumb pic={pic} client={thumbs.client} instance={thumbs.instance} file={thumbs.files.get(pic.key) ?? null} className="absolute inset-0 w-full h-full" />;
  const chip = 'absolute inline-flex items-center justify-center rounded-full bg-[rgba(16,15,13,0.72)] text-on-media cursor-pointer border-0';

  return (
    <InspectorSection id="recap-carousel" title={dump ? 'In the carousel' : 'After the first slide'} marked={c.left.length > 0}>
      <div className="flex flex-col gap-3">
        {!dump && (
          <Segmented<AfterFirst>
            size="sm"
            fill
            label="After the first slide"
            value={c.after}
            onChange={(after) => setCarousel(change, { after, order: null })}
            options={[
              { id: 'none', label: 'Nothing', title: 'The first slide alone (the clips’ slides when they are on)' },
              { id: 'highlights', label: 'Highlights', title: 'The best of the days the first slide does not show, in the photo dump’s rhythm' },
              ...(doc.template === 'month' ? [{ id: 'weeks' as const, label: 'Each week', title: 'A slide per week: its best day big, the others under it' }] : []),
            ]}
          />
        )}
        {!dump && c.after === 'highlights' && (
          <SliderRow label="Highlights" value={c.highlights} min={1} max={MAX_HIGHLIGHTS} step={1} reset={8} onChange={(highlights) => setCarousel(change, { highlights })} />
        )}
        {shows && (
          <ToggleField checked={c.bursts} onChange={(on) => setCarousel(change, { bursts: on })} label="One per burst">
            One per burst
          </ToggleField>
        )}
        {shows && flow.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className={legend}>
              In the carousel · {flow.length} · ✕ leaves one out
            </span>
            <div role="list" className="grid grid-cols-4 gap-1.5">
              {flow.map((s) => {
                const pic = s.picture!;
                const burst = bursts.get(pic.key);
                const n = burst ? (members.get(burst)?.length ?? 1) : 1;
                return (
                  <div key={s.id} role="listitem" className="relative aspect-[4/5] rounded-[5px] overflow-hidden bg-frame">
                    {tile(pic)}
                    <button
                      type="button"
                      aria-label={`Leave ${pic.name} out — the next best comes in`}
                      title="Leave it out — the next best comes in"
                      onClick={() => setCarousel(change, { left: [...c.left, pic.key] })}
                      className={`${chip} right-1 top-1 w-6 h-6 pointer-coarse:w-9 pointer-coarse:h-9 text-xs hover:bg-accent`}
                    >
                      ✕
                    </button>
                    {c.bursts && n > 1 && burst && (
                      <button
                        type="button"
                        aria-pressed={open === burst}
                        aria-label={`One of a burst of ${n} — choose the frame that enters`}
                        onClick={() => setOpen((o) => (o === burst ? null : burst))}
                        className={`${chip} left-1 bottom-1 h-5 px-1.5 rounded-[4px] font-mono text-3xs ${open === burst ? 'bg-accent' : ''}`}
                      >
                        ×{n}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {open && openMembers.length > 1 && (
          <div className="flex flex-col gap-1.5">
            <span className={legend}>This burst · the frame that enters</span>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {openMembers.map((m) => {
                const on = flow.some((s) => s.picture?.key === m.key);
                return (
                  <button
                    key={m.key}
                    type="button"
                    aria-pressed={on}
                    aria-label={`Use ${m.name}`}
                    onClick={() => setCarousel(change, { burstPick: { ...c.burstPick, [open]: m.key } })}
                    className={`relative flex-none w-16 aspect-[4/5] rounded-[5px] overflow-hidden bg-frame p-0 border-0 cursor-pointer ${on ? 'ring-2 ring-accent ring-offset-1 ring-offset-surface' : 'hover:opacity-80'}`}
                  >
                    {tile(m)}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {left.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className={legend}>Left out · {left.length}</span>
            <div role="list" className="grid grid-cols-5 gap-1.5">
              {left.map((pic) => (
                <div key={pic.key} role="listitem" className="relative aspect-[4/5] rounded-[5px] overflow-hidden bg-frame opacity-60 hover:opacity-100">
                  {tile(pic)}
                  <button
                    type="button"
                    aria-label={`Bring ${pic.name} back`}
                    title="Bring it back"
                    onClick={() => setCarousel(change, { left: c.left.filter((k) => k !== pic.key) })}
                    className={`${chip} right-1 top-1 w-6 h-6 pointer-coarse:w-9 pointer-coarse:h-9 text-xs hover:bg-accent`}
                  >
                    ↺
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </InspectorSection>
  );
}

const TITLES_LABEL: Record<SlideTitles, string> = { first: 'First only', head: 'Running head', same: 'Like the first' };

/** One cell drawn per place of a layout, for its chip. */
const GLYPH: Record<SlideLayout, { cols: number; rows: number; cells: [number, number, number, number][] }> = {
  full: { cols: 1, rows: 1, cells: [[0, 0, 1, 1]] },
  two: { cols: 1, rows: 2, cells: [[0, 0, 1, 1], [0, 1, 1, 1]] },
  oneTwo: { cols: 5, rows: 2, cells: [[0, 0, 3, 2], [3, 0, 2, 1], [3, 1, 2, 1]] },
  three: { cols: 3, rows: 1, cells: [[0, 0, 1, 1], [1, 0, 1, 1], [2, 0, 1, 1]] },
  four: { cols: 2, rows: 2, cells: [[0, 0, 1, 1], [1, 0, 1, 1], [0, 1, 1, 1], [1, 1, 1, 1]] },
  six: { cols: 2, rows: 3, cells: Array.from({ length: 6 }, (_, i) => [i % 2, Math.floor(i / 2), 1, 1] as [number, number, number, number]) },
};

function Glyph({ layout }: { layout: SlideLayout }) {
  const g = GLYPH[layout];
  return (
    <span aria-hidden="true" className="inline-grid w-3.5 h-5 gap-px p-px border border-current rounded-[2px]" style={{ gridTemplateColumns: `repeat(${g.cols}, 1fr)`, gridTemplateRows: `repeat(${g.rows}, 1fr)` }}>
      {g.cells.map(([x, y, sx, sy], i) => (
        <i key={i} className="bg-current opacity-55 rounded-[1px]" style={{ gridColumn: `${x + 1} / span ${sx}`, gridRow: `${y + 1} / span ${sy}` }} />
      ))}
    </span>
  );
}

/**
 * The slide on the stage (carousel lab, D and E): its layout — Auto (the
 * rhythm) or one set for it alone, the pictures flowing on to the next — and
 * whether the first slide's title repeats on the others.
 */
export function SlideSection({ doc, page, change }: { doc: RecapDoc; page: RecapPage | undefined; change: Change }) {
  const c = doc.carousel;
  const flowKey = page && page.key.startsWith('p:') ? page.key : null;
  const set = flowKey ? c.layouts[flowKey] : undefined;
  const layoutOf = (k: string) => {
    const { [k]: _gone, ...rest } = c.layouts;
    void _gone;
    return rest;
  };
  return (
    <InspectorSection id="recap-slide" title="Slides">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <span className={legend}>{flowKey ? 'This slide’s layout' : 'This slide keeps its template'}</span>
          <div role="group" aria-label="This slide's layout" className="grid grid-cols-7 gap-1 p-[3px] rounded-[10px] border border-line bg-paper2 max-[400px]:grid-cols-4">
            {(['auto', ...SLIDE_LAYOUTS] as const).map((l) => {
              const on = flowKey ? (l === 'auto' ? !set : set === l) : false;
              return (
                <button
                  key={l}
                  type="button"
                  disabled={!flowKey}
                  aria-pressed={on}
                  title={l === 'auto' ? 'The rhythm chooses' : `${SLIDE_LAYOUT_LABEL[l]} — the pictures after it flow on to the next slides`}
                  onClick={() => flowKey && setCarousel(change, { layouts: l === 'auto' ? layoutOf(flowKey) : { ...c.layouts, [flowKey]: l } })}
                  className={`h-9 pointer-coarse:h-11 inline-flex items-center justify-center gap-1 rounded-[8px] border text-2xs font-mono cursor-pointer disabled:opacity-40 disabled:cursor-default ${on ? 'bg-surface border-line-strong text-ink font-semibold' : 'border-transparent text-ink-soft'}`}
                >
                  {l === 'auto' ? 'Auto' : <Glyph layout={l} />}
                  {l !== 'auto' && <span className="max-[400px]:hidden">{SLIDE_LAYOUT_LABEL[l]}</span>}
                </button>
              );
            })}
          </div>
        </div>
        <Segmented<SlideTitles>
          size="sm"
          fill
          label="The title on the other slides"
          value={c.titles}
          onChange={(titles) => setCarousel(change, { titles })}
          options={(['first', 'head', 'same'] as const).map((t) => ({
            id: t,
            label: TITLES_LABEL[t],
            title: t === 'first' ? 'Only the first slide carries the title' : t === 'head' ? 'A small line with the title and the slide’s number on every other slide, the clips’ included' : 'The title as big as on the first slide, the pictures moved under it',
          }))}
        />
        {c.order && (
          <button type="button" onClick={() => setCarousel(change, { order: null })} className="self-start text-2xs text-accent-ink underline-offset-2 hover:underline">
            Put the slides back in their own order
          </button>
        )}
      </div>
    </InspectorSection>
  );
}

/**
 * The Sheets (lab 4): how the period is laid on its one sheet — rows, a
 * collage, a film strip or a timeline — how many slides it is cut into
 * (counted from the pictures unless set), and how the Reel's camera travels.
 * The cut rule is not a setting: never a face across a cut, one picture at
 * most per cut.
 */
export function SheetSection({ doc, change, pictures }: { doc: RecapDoc; change: Change; pictures: number }) {
  const sh = doc.sheet;
  const set = (patch: Partial<RecapSheet>) => change((d) => withRecap(d, { sheet: { ...d.sheet, ...patch } }));
  const counted = sheetSlides(pictures, null);
  return (
    <InspectorSection id="recap-sheet" title="The sheet">
      <div className="flex flex-col gap-3">
        <Segmented<SheetArrangement>
          size="sm"
          fill
          columns={2}
          label="Arrangement"
          value={sh.arrangement}
          onChange={(arrangement) => set({ arrangement })}
          options={SHEET_ARRANGEMENTS.map((a) => ({
            id: a,
            label: SHEET_ARRANGEMENT_LABEL[a],
            title:
              a === 'rows'
                ? 'Rows the whole length, each picture at its shape, time reading left to right'
                : a === 'collage'
                  ? 'Prints scattered and turned — best under 25 pictures'
                  : a === 'film'
                    ? 'One band of frames, its sprocket holes running across the cuts'
                    : 'Each picture hung on its day, above and below a line',
          }))}
        />
        <div className="flex flex-col gap-1">
          <ToggleField checked={sh.slides === null} onChange={(auto) => set({ slides: auto ? null : counted })} label="Slides counted for you">
            Slides counted for you · {counted}
          </ToggleField>
          {sh.slides !== null && <SliderRow label="Slides" value={sh.slides} min={MIN_SHEET_SLIDES} max={MAX_SHEET_SLIDES} step={1} reset={counted} onChange={(slides) => set({ slides })} />}
        </div>
        <Segmented<SheetCamera>
          size="sm"
          fill
          label="The Reel's camera"
          value={sh.camera}
          onChange={(camera) => set({ camera })}
          options={[
            { id: 'stops', label: 'Pause on each slide', title: 'A stop on each slide, a glide between — reads like the carousel' },
            { id: 'glide', label: 'Continuous', title: 'One slow travelling shot along the sheet' },
          ]}
        />
      </div>
    </InspectorSection>
  );
}

