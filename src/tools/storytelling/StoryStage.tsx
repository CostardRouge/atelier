import { memo, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { H, W } from '../../shared/story/charte';
import { drawEpisode, type ComposeOptions } from '../../shared/story/compose';
import type { Episode } from '../../shared/story/episode';
import type { DrawnObject } from '../../shared/story/objects';
import { drawGuides } from '../../shared/overlay/draw-guides';
import type { GuidesState } from '../../shared/overlay/guides';
import type { PlayClock } from '../../shared/media/play-clock';
import { useCoarsePointer } from '../../shared/ui/use-coarse-pointer';
import { boxOf, pickAt } from './stage-pick';

type Box = { x: number; y: number; w: number; h: number };

export interface StageDrag {
  /** A press landed on an object: select it; return false to keep it from being dragged. */
  onPick: (hit: DrawnObject) => boolean;
  /** The selected object moved by (dx, dy) frame pixels since the press. */
  onMove: (dx: number, dy: number) => void;
  /** The press ended; `moved` is whether it was a drag. */
  onEnd: (moved: boolean) => void;
}

interface StoryStageProps {
  clock: PlayClock;
  episode: Episode;
  opts: ComposeOptions;
  fontsReady: boolean;
  /** The social safe zone and the grid, drawn over the picture only (never exported). */
  guides: GuidesState;
  /** The selected object's instance, outlined once the playhead rests. */
  selectedId: string | null;
  drag: StageDrag;
  label: string;
}

/**
 * The post's stage. It paints from the clock in a frame loop, and only when
 * something changed (`dirty`): a playing post costs the stage and nothing
 * else (`use-story-playback.ts`). The 1080 × 1920 frame is drawn at full
 * size into a canvas fitted into its box at 9:16 (measured, `frontend.md`);
 * the guides are drawn on a second canvas at the screen's resolution over
 * it, so they never reach an export. A press picks what is under it
 * (`stage-pick.ts`); held and moved on an object, it drags it.
 */
function StoryStage({ clock, episode, opts, fontsReady, guides, selectedId, drag, label }: StoryStageProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const guideRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const fit = () => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      const h = Math.min(r.height, (r.width * H) / W);
      setSize((was) => {
        const next = { w: Math.floor((h * W) / H), h: Math.floor(h) };
        return was && was.w === next.w && was.h === next.h ? was : next;
      });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // What the loop paints from, refreshed every render without restarting it.
  const live = useRef({ episode, opts, fontsReady, size });
  live.current = { episode, opts, fontsReady, size };
  const dirty = useRef(true);
  useEffect(() => {
    dirty.current = true;
  }, [episode, opts, fontsReady, size]);
  useEffect(() => clock.subscribe(() => (dirty.current = true)), [clock]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const starting = clock.starting;
      clock.tick(dt);
      const { episode: ep, opts: o, fontsReady: ready, size: sz } = live.current;
      const canvas = canvasRef.current;
      if (canvas && sz && ready && dirty.current) {
        dirty.current = false;
        // Drawn at the size shown (× the screen's density, at most the frame's own): a full frame shrunk by the
        // browser cost three times the pixels and most of a slider step's time.
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const scale = Math.min(1, (sz.w * dpr) / W);
        const bw = Math.round(W * scale);
        const bh = Math.round(H * scale);
        if (canvas.width !== bw || canvas.height !== bh) {
          canvas.width = bw;
          canvas.height = bh;
        }
        const ctx = canvas.getContext('2d');
        if (ctx) drawEpisode(ctx, ep, Math.min(clock.t, clock.total - 0.001), { ...o, scale });
      }
      // The post moves from the end of its first frame: what that frame cost is not a jump on the next.
      if (starting) last = performance.now();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [clock]);

  // The guides, at the screen's resolution.
  useEffect(() => {
    const c = guideRef.current;
    if (!c || !size) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(size.w * dpr);
    c.height = Math.round(size.h * dpr);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    drawGuides(ctx, guides, c.width, c.height);
  }, [guides, size]);

  // The selected object's outline, once the playhead rests (one tiny frame per object: never while playing).
  const [box, setBox] = useState<Box | null>(null);
  useEffect(() => {
    let timer = 0;
    const update = () => {
      window.clearTimeout(timer);
      if (!selectedId || clock.playing || !fontsReady) {
        setBox(null);
        return;
      }
      timer = window.setTimeout(() => {
        const { episode: ep, opts: o } = live.current;
        setBox(boxOf(ep, Math.min(clock.t, clock.total - 0.001), o, selectedId));
      }, 80);
    };
    update();
    const off = clock.subscribe(update);
    return () => {
      off();
      window.clearTimeout(timer);
    };
  }, [clock, selectedId, fontsReady, episode, opts]);

  const press = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const scale = size ? size.w / W : 1;
  // How far around a press counts, in SCREEN pixels: a few under a mouse; under a finger, when that finds
  // nothing, a fingertip's half-width (`frontend.md`'s 44 px target) — so what is right under it still wins.
  const coarse = useCoarsePointer();
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!fontsReady || e.button !== 0) return;
    clock.setPlaying(false);
    const r = e.currentTarget.getBoundingClientRect();
    const t = Math.min(clock.t, clock.total - 0.001);
    const x = (e.clientX - r.left) / scale;
    const y = (e.clientY - r.top) / scale;
    const hit = pickAt(episode, t, opts, x, y, 6 / scale) ?? (coarse ? pickAt(episode, t, opts, x, y, 22 / scale) : null);
    if (!hit || !drag.onPick(hit)) return;
    press.current = { x: e.clientX, y: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p) return;
    const mx = (e.clientX - p.x) / scale;
    const my = (e.clientY - p.y) / scale;
    if (!p.moved && Math.hypot(mx, my) < 4 / scale) return;
    p.moved = true;
    drag.onMove(mx, my);
  };
  const onUp = () => {
    const p = press.current;
    press.current = null;
    if (p) drag.onEnd(p.moved);
  };

  return (
    <div ref={boxRef} className="relative w-full h-full min-h-0 min-w-0 grid place-items-center overflow-hidden">
      <div className="relative" style={size ? { width: size.w, height: size.h } : { width: 0, height: 0 }}>
        <canvas ref={canvasRef} width={W} height={H} className="block w-full h-full rounded-[3px] bg-paper shadow-sm" aria-label={label} />
        <canvas ref={guideRef} aria-hidden="true" className="absolute inset-0 w-full h-full pointer-events-none" />
        {!fontsReady ? (
          // The faces load before the first frame (a frame drawn in a fallback face would jump): until then,
          // Develop's thin bar says the stage is coming rather than leaving a blank sheet.
          <div className="absolute top-0 inset-x-0 h-[2px] overflow-hidden pointer-events-none" role="progressbar" aria-label="Loading the series' faces">
            <div className="h-full w-1/4 bg-accent animate-deck-load" />
          </div>
        ) : null}
        <div
          className={`absolute inset-0 cursor-crosshair ${selectedId ? 'touch-none' : ''}`}
          title="Click an object to select it; drag the selected one to move it"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          {box ? (
            <span
              aria-hidden="true"
              className="absolute pointer-events-none rounded-[2px] outline outline-2 outline-accent outline-offset-2"
              style={{ left: box.x * scale, top: box.y * scale, width: box.w * scale, height: box.h * scale }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default memo(StoryStage);
