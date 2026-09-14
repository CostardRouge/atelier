import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { locate, stripLayout } from '../../shared/roadtrip/deck-strip';

/** The open slide when it is a loaded clip: its own playhead is its clock. */
export interface TransportClip {
  /** The in point, in source seconds. */
  start: number;
  speed: number;
  /** The stage's playhead, in source seconds. */
  playhead: number;
  seek: (sourceSeconds: number) => void;
}

interface DeckTransportInputs {
  /** How long each slide holds the screen (`screenLength`). */
  lengths: readonly number[];
  /** A stable key per slide — what survives the deck being reordered. */
  keys: readonly string[];
  index: number;
  select: (index: number) => void;
  clip: TransportClip | null;
  /** The open slide's picture is still decoding: a still's clock waits for it. */
  pending: boolean;
}

export interface DeckTransport {
  /** Where the piece is, in seconds from the hook's first frame. */
  time: number;
  /** How far into the open slide. */
  local: number;
  /** The whole piece's length. */
  seconds: number;
  playing: boolean;
  setPlaying: (on: boolean) => void;
  toggle: () => void;
  /** Go to a moment of the piece — the slide under it opens there. */
  scrub: (t: number) => void;
  goTo: (index: number, local?: number) => void;
  /** The stage stopped a clip on its out point. */
  onClipEnded: () => void;
  /**
   * Where a clip slide just opened by `goTo` should put its playhead, in
   * seconds into the slide — read by the editor when it resets the playhead
   * on a new slide or a newly decoded file; 0 for a slide opened any other way.
   */
  pendingLocal: (key: string) => number;
}

/** A clip decoding for longer than this stops holding the piece up. */
const PENDING_GRACE_SECONDS = 2;
const END_TOLERANCE = 0.04;

/**
 * Playing the WHOLE piece on one stage that shows one slide at a time.
 *
 * The stage decodes the open slide only, so the piece is played by opening
 * each slide in turn. Two clocks, never both: on a loaded clip the video
 * element is the clock (the stage reports its playhead and says when it
 * stopped on the out point); on anything else — a photograph, the closing
 * card, a clip still decoding — a frame loop counts the slide's seconds. When
 * either runs out, the next slide opens and keeps playing; the last one
 * stops the piece where it ends, and pressing play there starts it over.
 *
 * The piece's time is DERIVED, never stored: the open slide's start plus how
 * far into it the clock is. A still's position is kept with the key of the
 * slide it belongs to, so a slide opened from anywhere else starts at zero
 * without an effect having to reset it.
 */
export function useDeckTransport({
  lengths,
  keys,
  index,
  select,
  clip,
  pending,
}: DeckTransportInputs): DeckTransport {
  const count = lengths.length;
  const open = Math.max(0, Math.min(index, count - 1));
  const key = keys[open] ?? '';
  const length = lengths[open] ?? 0;
  const layout = useMemo(() => stripLayout(lengths, 1, 0, 0), [lengths]);
  const start = layout.cells[open]?.start ?? 0;

  const [playing, setPlaying] = useState(false);
  const [still, setStill] = useState<{ key: string; local: number }>({ key: '', local: 0 });
  const pendingJump = useRef<{ key: string; local: number } | null>(null);

  const stillLocal = still.key === key ? still.local : 0;
  const local = clip
    ? clamp((clip.playhead - clip.start) / clip.speed, 0, length)
    : clamp(stillLocal, 0, length);

  // Read by callbacks that must not be rebuilt every frame.
  const live = useRef({ open, key, keys, count, length, local, clip, select, pending, playing });
  live.current = { open, key, keys, count, length, local, clip, select, pending, playing };

  const goTo = useCallback((target: number, at = 0) => {
    const l = live.current;
    const i = Math.max(0, Math.min(target, l.count - 1));
    const k = l.keys[i] ?? '';
    pendingJump.current = { key: k, local: at };
    setStill({ key: k, local: at });
    if (i !== l.open) l.select(i);
    else if (l.clip) l.clip.seek(l.clip.start + at * l.clip.speed);
  }, []);

  const advance = useCallback(() => {
    const l = live.current;
    if (l.open + 1 < l.count) goTo(l.open + 1, 0);
    else setPlaying(false);
  }, [goTo]);

  const toggle = useCallback(() => {
    const l = live.current;
    if (!l.count) return;
    if (l.playing) {
      setPlaying(false);
      return;
    }
    // Pressing play on the end of a slide moves on rather than replaying it,
    // and on the end of the piece starts it over.
    if (l.local >= l.length - END_TOLERANCE) goTo(l.open + 1 < l.count ? l.open + 1 : 0, 0);
    setPlaying(true);
  }, [goTo]);

  const scrub = useCallback(
    (t: number) => {
      setPlaying(false);
      const at = locate(layout, t);
      goTo(at.index, at.local);
    },
    [layout, goTo],
  );

  const onClipEnded = useCallback(() => {
    if (live.current.playing) advance();
  }, [advance]);

  const pendingLocal = useCallback(
    (k: string) => (pendingJump.current?.key === k ? pendingJump.current.local : 0),
    [],
  );

  // A still's clock: count its seconds while the piece plays, and hand over
  // to the next slide when they run out. Waits a moment on a picture still
  // decoding, so a clip is not skipped before it has shown a frame.
  const isClip = clip !== null;
  useEffect(() => {
    if (!playing || isClip) return;
    let raf = 0;
    let last = performance.now();
    let waited = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const l = live.current;
      if (l.pending && waited < PENDING_GRACE_SECONDS) {
        waited += dt;
      } else if (l.local + dt >= l.length) {
        setStill({ key: l.key, local: l.length });
        advance();
        return;
      } else {
        setStill({ key: l.key, local: l.local + dt });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, isClip, key, advance]);

  return {
    time: start + local,
    local,
    seconds: layout.seconds,
    playing,
    setPlaying,
    toggle,
    scrub,
    goTo,
    onClipEnded,
    pendingLocal,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
