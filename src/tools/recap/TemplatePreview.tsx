import { useEffect, useMemo, useRef } from 'react';
import { FORMATS, type RecapTemplate } from '../../shared/recap/recap-doc';
import { layoutRecap } from '../../shared/recap/recap-layout';
import { planFilm } from '../../shared/recap/recap-motion';
import { paintRecap } from '../../shared/recap/recap-paint';
import { resolveRecap } from '../../shared/recap/recap-slots';
import { prefersReducedMotion } from '../../shared/ui/reduced-motion';
import { sampleRecap, sampleSources } from './sample-recap';

/**
 * A template drawn by the real painter over sample colour fields: still at its
 * last frame, and PLAYING its entrance while `playing` (a card hovered or
 * focused) — the catalogue shows what a template does, not a picture of it.
 */
export default function TemplatePreview({ template, anchor, height, playing = false }: { template: RecapTemplate; anchor: string; height: number; playing?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const model = useMemo(() => {
    const doc = sampleRecap(template, anchor);
    const resolved = resolveRecap(doc);
    const layout = layoutRecap(doc, resolved, anchor);
    const film = planFilm(doc, layout, (slot) => resolved.slots.find((s) => s.id === slot)?.picture?.duration ?? null);
    return { doc, resolved, layout, film };
  }, [template, anchor]);
  const { width: pw, height: ph } = FORMATS[model.doc.format];
  const width = Math.round((height * pw) / ph);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const g = canvas.getContext('2d');
    if (!g) return;
    const src = sampleSources();
    const draw = (t: number) => paintRecap(g, canvas.width, model.doc, model.resolved, model.layout, model.film, src, { t, page: 0 });
    const end = model.film.pages[0]?.allOn ?? model.film.total;
    if (!playing || prefersReducedMotion()) {
      draw(end + 0.5);
      return;
    }
    let raf = 0;
    const started = performance.now();
    const tick = () => {
      const t = ((performance.now() - started) / 1000) % (end + 1.4);
      draw(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [model, width, height, playing]);

  return <canvas ref={ref} style={{ width, height }} className="block rounded-[4px] shadow-paper-soft" aria-hidden="true" />;
}
