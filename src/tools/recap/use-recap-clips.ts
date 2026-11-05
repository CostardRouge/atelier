import { useEffect, useMemo, useRef, useState } from 'react';
import type { RecapDoc } from '../../shared/recap/recap-doc';
import { clipTime, loopTime, pageAt, type FilmPlan } from '../../shared/recap/recap-motion';
import type { Drawable, PaintSources } from '../../shared/recap/recap-paint';
import type { WinnowClient } from '../../shared/sources/winnow/client';
import { clipOf } from './recap-media';

interface Held {
  video: HTMLVideoElement;
  url: string;
  ready: boolean;
}

export interface ClipsState {
  sources: Pick<PaintSources, 'clip' | 'background' | 'backgroundLength'>;
  /**
   * The same frames as they stand, NEVER seeked — for a painter other than the
   * stage (the gallery's poster): one that seeks the stage's elements to its
   * own moment makes the paused stage's clip jump there and back.
   */
  peek: Pick<PaintSources, 'clip' | 'background' | 'backgroundLength'>;
  /** Each clip's length, measured by its element. */
  lengths: ReadonlyMap<string, number>;
  /** Each frame of play: every clip and the background put where the film says. */
  drive: (t: number, film: FilmPlan, slotKeys: ReadonlyMap<string, string>) => void;
  /** Pause them all — the stage stopped. */
  halt: () => void;
  /** Moves when a frame lands (a seek while paused) — a repaint. */
  version: number;
  /** Clips nothing can give in this visit. */
  missing: string[];
}

/** How far a playing element may drift from the film before it is put back. */
const DRIFT = 0.25;

/**
 * The clips a recap PLAYS — a cell's and the looping background — as video
 * elements kept in step with the film's clock: a clip plays in its window
 * (`recap-motion.ts`'s turns), holds its frame outside it, and the background
 * loops between its in and out points at its speed. Paused, a clip asked for a
 * time is SEEKED there, and the stage repaints when the frame lands. Muted
 * always: a recap's sound is its own bed.
 */
export function useRecapClips(doc: RecapDoc, keys: readonly string[], ctx: { files: ReadonlyMap<string, File>; client: WinnowClient | null; instance: string | null }): ClipsState {
  const held = useRef(new Map<string, Held>());
  const asked = useRef(new Set<string>());
  const [lengths, setLengths] = useState<Map<string, number>>(() => new Map());
  const [version, setVersion] = useState(0);
  const [missing, setMissing] = useState<string[]>([]);
  const byKey = useMemo(() => new Map(doc.pictures.map((p) => [p.key, p])), [doc.pictures]);
  const byKeyRef = useRef(byKey);
  byKeyRef.current = byKey;
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const keysKey = [...new Set(keys)].join('|');
  const ctxKey = `${ctx.instance ?? ''}|${ctx.files.size}`;

  useEffect(() => {
    let alive = true;
    const want = keysKey ? keysKey.split('|') : [];
    const mine: string[] = [];
    for (const key of want) {
      if (held.current.has(key) || asked.current.has(key)) continue;
      const pic = byKeyRef.current.get(key);
      if (!pic) continue;
      asked.current.add(key);
      mine.push(key);
      void clipOf(pic, ctxRef.current)
        .then((blob) => {
          if (!alive) return;
          if (!blob) {
            asked.current.delete(key);
            setMissing((m) => (m.includes(key) ? m : [...m, key]));
            return;
          }
          const url = URL.createObjectURL(blob);
          const video = document.createElement('video');
          video.muted = true;
          video.playsInline = true;
          video.preload = 'auto';
          const entry: Held = { video, url, ready: false };
          video.addEventListener('loadeddata', () => {
            entry.ready = true;
            setLengths((m) => new Map(m).set(key, Number.isFinite(video.duration) ? video.duration : 0));
            setVersion((v) => v + 1);
          });
          video.addEventListener('seeked', () => setVersion((v) => v + 1));
          video.addEventListener('error', () => setMissing((m) => (m.includes(key) ? m : [...m, key])));
          video.src = url;
          held.current.set(key, entry);
          setMissing((m) => m.filter((x) => x !== key));
        })
        .catch(() => {
          asked.current.delete(key);
          if (alive) setMissing((m) => (m.includes(key) ? m : [...m, key]));
        });
    }
    return () => {
      alive = false;
      // What this run asked and did not land is asked again by the next one. Without this a clip whose load was cut
      // (the Winnow connection arriving after the recap opened, React's double mount) stayed «asked» for good — his
      // black background «on its way» forever on a reopened recap.
      for (const k of mine) if (!held.current.has(k)) asked.current.delete(k);
    };
  }, [keysKey, ctxKey]);

  useEffect(
    () => () => {
      for (const h of held.current.values()) {
        h.video.pause();
        h.video.removeAttribute('src');
        h.video.load();
        URL.revokeObjectURL(h.url);
      }
      held.current.clear();
      // Emptied, so all of it is asked again if the editor comes back (a remount keeps the refs).
      asked.current.clear();
    },
    [],
  );

  const frameOf = (key: string, seconds: number, seek: boolean): Drawable | null => {
    const h = held.current.get(key);
    if (!h || !h.ready || !h.video.videoWidth) return null;
    if (seek && h.video.paused && Math.abs(h.video.currentTime - seconds) > 0.04) h.video.currentTime = seconds;
    return { image: h.video, width: h.video.videoWidth, height: h.video.videoHeight };
  };

  const bgKey = doc.background.kind === 'video' ? (doc.background.video ?? null) : null;
  const bgLength = bgKey ? (lengths.get(bgKey) ?? 0) : 0;
  const sources = useMemo<ClipsState['sources']>(
    () => ({
      clip: (key, seconds) => frameOf(key, seconds, true),
      background: bgKey ? (seconds) => frameOf(bgKey, seconds, true) : undefined,
      backgroundLength: bgLength,
    }),
    [bgKey, bgLength, version],
  );

  const peek = useMemo<ClipsState['peek']>(
    () => ({
      clip: (key, seconds) => frameOf(key, seconds, false),
      background: bgKey ? (seconds) => frameOf(bgKey, seconds, false) : undefined,
      backgroundLength: bgLength,
    }),
    [bgKey, bgLength, version],
  );

  const docRef = useRef(doc);
  docRef.current = doc;
  const keep = (h: Held | undefined, want: number | null, rate = 1) => {
    if (!h?.ready) return;
    const v = h.video;
    if (want === null) {
      if (!v.paused) v.pause();
      return;
    }
    if (v.playbackRate !== rate) v.playbackRate = rate;
    if (v.paused) {
      v.currentTime = want;
      void v.play().catch(() => undefined);
    } else if (Math.abs(v.currentTime - want) > DRIFT * Math.max(1, rate)) {
      v.currentTime = want;
    }
  };

  const drive = (t: number, film: FilmPlan, slotKeys: ReadonlyMap<string, string>) => {
    const d = docRef.current;
    const plan = film.pages[pageAt(film, t)];
    const playingKeys = new Set<string>();
    if (plan) {
      for (const [slot, windows] of plan.clips) {
        const key = slotKeys.get(slot);
        if (!key) continue;
        const h = held.current.get(key);
        const len = h?.ready && Number.isFinite(h.video.duration) ? h.video.duration : 0;
        const at = clipTime(windows, len, t);
        if (at !== null) playingKeys.add(key);
        keep(h, at);
      }
    }
    for (const [key, h] of held.current) if (!playingKeys.has(key) && key !== bgKey && !h.video.paused) h.video.pause();
    if (bgKey && d.background.kind === 'video') {
      const h = held.current.get(bgKey);
      const len = h?.ready && Number.isFinite(h.video.duration) ? h.video.duration : 0;
      if (len > 0) keep(h, loopTime(d.background, len, t), d.background.speed);
    }
  };

  const halt = () => {
    for (const h of held.current.values()) if (!h.video.paused) h.video.pause();
  };

  return { sources, peek, lengths, drive, halt, version, missing };
}
