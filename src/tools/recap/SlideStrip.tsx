import { useEffect, useRef, useState, type DragEvent } from 'react';
import type { RecapDoc } from '../../shared/recap/recap-doc';
import type { CarouselSlide, RecapLayout } from '../../shared/recap/recap-layout';
import type { FilmPlan } from '../../shared/recap/recap-motion';
import { drawCover, paintRecap, type PaintSources } from '../../shared/recap/recap-paint';
import type { DeviceAliases, ResolvedRecap } from '../../shared/recap/recap-slots';

const THUMB_W = 46;

/**
 * Every slide of the recap under the stage (carousel lab, A — every
 * template): each painted small by the one painter, its number the one the
 * carousel will show. A click shows it; dragging one moves it (the Reel
 * follows); a picture dragged off the stage lands on the slide under the
 * pointer (`data-slide-key`, read by the editor). A clip's slide shows its
 * still and ▶.
 */
export default function SlideStrip({
  doc,
  resolved,
  layout,
  film,
  slides,
  sources,
  aliases,
  clipSlides,
  version,
  current,
  onShow,
  onOrder,
}: {
  doc: RecapDoc;
  resolved: ResolvedRecap;
  layout: RecapLayout;
  film: FilmPlan;
  slides: readonly CarouselSlide[];
  /** Frames as they stand — the strip never seeks the stage's clips. */
  sources: PaintSources;
  aliases: DeviceAliases;
  clipSlides: ReadonlyMap<string, number>;
  version: number;
  /** The slide the stage shows. */
  current: string | null;
  onShow: (slide: CarouselSlide) => void;
  onOrder: (keys: string[]) => void;
}) {
  const page = layout.pages[0];
  const thumbH = page ? Math.round((THUMB_W * page.height) / page.width) : 82;
  const refs = useRef(new Map<string, HTMLCanvasElement>());
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  // Painted a beat after the edits settle: twenty small pages on every keystroke would cost the stage its frames.
  useEffect(() => {
    const id = window.setTimeout(() => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      for (const s of slides) {
        const c = refs.current.get(s.key);
        if (!c) continue;
        c.width = Math.round(THUMB_W * dpr);
        c.height = Math.round(thumbH * dpr);
        const g = c.getContext('2d');
        if (!g) continue;
        g.setTransform(1, 0, 0, 1, 0, 0);
        if (s.kind === 'page') {
          paintRecap(g, c.width, doc, resolved, layout, film, sources, { t: (film.pages[s.page]?.allOn ?? 0) + 0.05, page: s.page, aliases, clipSlides });
        } else {
          g.fillStyle = '#141210';
          g.fillRect(0, 0, c.width, c.height);
          const pic = resolved.slots.find((x) => x.id === s.slot)?.picture;
          const still = pic ? sources.still(pic.key) : null;
          if (still) drawCover(g, still, { x: 0, y: 0, w: c.width, h: c.height });
          const r = c.width * 0.16;
          g.fillStyle = 'rgba(16,15,13,0.6)';
          g.beginPath();
          g.arc(c.width / 2, c.height / 2, r, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = '#f4f0e7';
          g.beginPath();
          g.moveTo(c.width / 2 - r * 0.35, c.height / 2 - r * 0.5);
          g.lineTo(c.width / 2 + r * 0.55, c.height / 2);
          g.lineTo(c.width / 2 - r * 0.35, c.height / 2 + r * 0.5);
          g.fill();
        }
      }
    }, 250);
    return () => window.clearTimeout(id);
  }, [doc, resolved, layout, film, slides, sources, aliases, clipSlides, version, thumbH]);

  if (slides.length < 2) return null;

  const drop = (e: DragEvent, onto: string) => {
    e.preventDefault();
    setOver(null);
    const from = dragging ?? e.dataTransfer.getData('text/x-recap-slide');
    setDragging(null);
    if (!from || from === onto) return;
    const keys = slides.map((s) => s.key).filter((k) => k !== from);
    keys.splice(keys.indexOf(onto) + (slides.findIndex((s) => s.key === from) < slides.findIndex((s) => s.key === onto) ? 1 : 0), 0, from);
    onOrder(keys);
  };

  return (
    <div role="list" aria-label="The slides, in their order — drag one to move it" className="flex-none flex gap-1.5 overflow-x-auto px-1 pb-1 pt-0.5 [scrollbar-width:thin]">
      {slides.map((s, i) => {
        const on = s.key === current;
        return (
          <button
            key={s.key}
            type="button"
            role="listitem"
            data-slide-key={s.key}
            draggable
            onDragStart={(e) => {
              setDragging(s.key);
              e.dataTransfer.setData('text/x-recap-slide', s.key);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragEnd={() => {
              setDragging(null);
              setOver(null);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(s.key);
            }}
            onDragLeave={() => setOver((o) => (o === s.key ? null : o))}
            onDrop={(e) => drop(e, s.key)}
            onClick={() => onShow(s)}
            aria-current={on}
            aria-label={`Slide ${i + 1}${s.kind === 'clip' ? ', a clip' : s.key === 'first' ? ', the first' : ''}`}
            className={`flex-none flex flex-col items-center gap-0.5 p-0 border-0 bg-transparent cursor-pointer font-mono text-3xs tabular-nums ${on ? 'text-accent-ink' : 'text-muted'} ${dragging === s.key ? 'opacity-40' : ''}`}
          >
            <canvas
              ref={(el) => {
                if (el) refs.current.set(s.key, el);
                else refs.current.delete(s.key);
              }}
              style={{ width: THUMB_W, height: thumbH }}
              className={`block rounded-[3px] ${on ? 'outline outline-2 outline-accent' : over === s.key ? 'outline outline-2 outline-dashed outline-accent' : 'outline outline-1 outline-line-strong'}`}
              aria-hidden="true"
            />
            <span>
              {i + 1}
              {s.kind === 'clip' ? ' ▶' : s.kind === 'page' && doc.carousel.layouts[s.key] ? ' ·' : ''}
            </span>
          </button>
        );
      })}
    </div>
  );
}
