import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { dragBand, dragEdge, loopBand } from '../../shared/recap/recap-clips';
import type { RecapBackground } from '../../shared/recap/recap-doc';
import { getClip } from './recap-store';

const FRAMES = 10;

/** Ten frames across a kept clip, as object URLs — the trimmer's strip. Empty while they are drawn or when none is kept. */
function useFilmstrip(clipKey: string | null): string[] {
  const [frames, setFrames] = useState<string[]>([]);
  useEffect(() => {
    if (!clipKey) return;
    let alive = true;
    const made: string[] = [];
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    let src: string | null = null;
    void (async () => {
      const blob = await getClip(clipKey);
      if (!blob || !alive) return;
      src = URL.createObjectURL(blob);
      await new Promise<void>((resolve, reject) => {
        v.onloadeddata = () => resolve();
        v.onerror = () => reject(new Error('unreadable'));
        v.src = src!;
      });
      const d = v.duration || 0;
      if (!d) return;
      const h = 72;
      const w = Math.max(1, Math.round((v.videoWidth / Math.max(1, v.videoHeight)) * h));
      const c = new OffscreenCanvas(w, h);
      const g = c.getContext('2d')!;
      for (let i = 0; i < FRAMES && alive; i++) {
        await new Promise<void>((resolve) => {
          v.onseeked = () => resolve();
          v.currentTime = ((i + 0.5) / FRAMES) * d;
        });
        g.drawImage(v, 0, 0, w, h);
        made.push(URL.createObjectURL(await c.convertToBlob({ type: 'image/jpeg', quality: 0.7 })));
      }
      if (alive) setFrames([...made]);
    })().catch(() => undefined);
    return () => {
      alive = false;
      made.forEach((u) => URL.revokeObjectURL(u));
      if (src) URL.revokeObjectURL(src);
      v.removeAttribute('src');
      v.load();
      setFrames([]);
    };
  }, [clipKey]);
  return frames;
}

/**
 * The background's loop over its clip (his ask, 2026-11-05): a filmstrip, the
 * loop as a band on it — its two handles set the in and the out, and the
 * band itself drags whole, left and right, its length kept. The arithmetic is
 * `recap-clips.ts`'s; arrow keys move what has the focus.
 */
export default function LoopTrimmer({ clipKey, length, bg, onLoop }: { clipKey: string | null; length: number; bg: RecapBackground; onLoop: (loop: Pick<RecapBackground, 'loopIn' | 'loopOut'>) => void }) {
  const frames = useFilmstrip(clipKey);
  const track = useRef<HTMLDivElement>(null);
  const L = Math.max(0.3, length);
  const { a, b } = loopBand(bg, L);
  const drag = useRef<{ what: 'in' | 'out' | 'band'; x: number; bg: Pick<RecapBackground, 'loopIn' | 'loopOut'>; id: number } | null>(null);
  const perPx = () => L / Math.max(1, track.current?.getBoundingClientRect().width ?? 1);
  const down = (what: 'in' | 'out' | 'band') => (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    drag.current = { what, x: e.clientX, bg: { loopIn: bg.loopIn, loopOut: bg.loopOut }, id: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const delta = (e.clientX - d.x) * perPx();
    if (d.what === 'band') onLoop(dragBand(d.bg, L, delta));
    else {
      const from = loopBand(d.bg, L);
      onLoop(dragEdge(d.bg, L, d.what, (d.what === 'in' ? from.a : from.b) + delta));
    }
  };
  const up = () => {
    drag.current = null;
  };
  const key = (what: 'in' | 'out' | 'band') => (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 1 : 0.1;
    const by = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    if (!by) return;
    e.preventDefault();
    onLoop(what === 'band' ? dragBand(bg, L, by) : dragEdge(bg, L, what, (what === 'in' ? a : b) + by));
  };
  const pct = (s: number) => `${(s / L) * 100}%`;
  const handle = 'absolute top-[-4px] bottom-[-4px] w-[14px] -ml-[7px] rounded-[4px] bg-accent border-2 border-on-media cursor-ew-resize touch-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent';
  return (
    <div className="flex flex-col gap-1.5">
      <div ref={track} className="relative h-12 mx-[7px] rounded-[5px] bg-frame select-none" onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <div className="absolute inset-0 flex overflow-hidden rounded-[5px]" aria-hidden="true">
          {frames.map((u, i) => (
            <img key={i} src={u} alt="" draggable={false} className="flex-1 min-w-0 h-full object-cover" />
          ))}
        </div>
        {/* Outside the loop, veiled. */}
        <div className="absolute inset-y-0 left-0 bg-[rgba(10,8,6,0.6)] rounded-l-[5px]" style={{ width: pct(a) }} aria-hidden="true" />
        <div className="absolute inset-y-0 right-0 bg-[rgba(10,8,6,0.6)] rounded-r-[5px]" style={{ width: `calc(100% - ${pct(b)})` }} aria-hidden="true" />
        <div
          role="slider"
          tabIndex={0}
          aria-label="The loop — drag it whole"
          aria-valuemin={0}
          aria-valuemax={Math.round(L * 10) / 10}
          aria-valuenow={Math.round(a * 10) / 10}
          aria-valuetext={`${a.toFixed(1)} s to ${b.toFixed(1)} s`}
          onPointerDown={down('band')}
          onPointerMove={move}
          onPointerUp={up}
          onKeyDown={key('band')}
          className="absolute inset-y-0 border-y-2 border-accent cursor-grab active:cursor-grabbing touch-none focus:outline-none focus-visible:bg-accent/10"
          style={{ left: pct(a), width: pct(b - a) }}
        />
        <span role="slider" tabIndex={0} aria-label="Loop from" aria-valuemin={0} aria-valuemax={Math.round(b * 10) / 10} aria-valuenow={Math.round(a * 10) / 10} onPointerDown={down('in')} onPointerMove={move} onPointerUp={up} onKeyDown={key('in')} className={handle} style={{ left: pct(a) }} />
        <span role="slider" tabIndex={0} aria-label="Loop to" aria-valuemin={Math.round(a * 10) / 10} aria-valuemax={Math.round(L * 10) / 10} aria-valuenow={Math.round(b * 10) / 10} onPointerDown={down('out')} onPointerMove={move} onPointerUp={up} onKeyDown={key('out')} className={handle} style={{ left: pct(b) }} />
      </div>
      <div className="flex justify-between font-mono text-2xs tabular-nums text-muted">
        <span>{a.toFixed(1)} s</span>
        <span className="text-ink">loop {(b - a).toFixed(1)} s</span>
        <span>{bg.loopOut === null ? `its end · ${L.toFixed(1)} s` : `${b.toFixed(1)} s`}</span>
      </div>
    </div>
  );
}
