import { describe, expect, it } from 'vitest';
import { DEFAULT_FRAMING, flipFraming, framePoint, framingTransform, unframePoint, zoomFramingAbout, type Framing } from './framing';
import {
  KEY_SNAP_SECONDS,
  STARTER_ZOOM,
  PRESET_ZOOM,
  applyPreset,
  arrivalMarks,
  framingOn,
  framingWindow,
  tourMotion,
  tourOf,
  MIN_GLIDE_SECONDS,
  presetProblem,
  deepestFraming,
  flipMotion,
  framingAt,
  framingAtNeedle,
  framingAtProgress,
  framingOnClock,
  hasMotion,
  keepEnds,
  motionMarks,
  motionProgress,
  needleTarget,
  placeAtNeedle,
  readMotion,
  removeAtNeedle,
  snapShare,
  starterMotion,
  type FramingMotion,
} from './framing-motion';

// A 3:2 landscape framed into a 9:16 reel — the case the feature exists for.
const SRC = { w: 3000, h: 2000 };
const DST = { w: 1080, h: 1920 };

function motion(keys: FramingMotion['keys'], extra: Partial<FramingMotion> = {}): FramingMotion {
  return { keys, easing: 'linear', start: 'slide', ...extra };
}

describe('readMotion', () => {
  it('turns anything that is not a list of keys into no motion', () => {
    expect(readMotion(undefined)).toBeNull();
    expect(readMotion(null)).toBeNull();
    expect(readMotion({})).toBeNull();
    expect(readMotion({ keys: [] })).toBeNull();
    expect(readMotion({ keys: [{ at: 'x', scale: 2, x: 0, y: 0 }] })).toBeNull();
  });

  it('keeps finite keys, sorted, clamped, one per instant', () => {
    const m = readMotion({
      keys: [
        { at: 0.5, scale: 12, x: 0.1, y: 0 },
        { at: -1, scale: 0.5, x: 0, y: 0 },
        { at: 0.5, scale: 2, x: 0.2, y: 0 },
        { at: 3, scale: 2, x: 0, y: Number.NaN },
      ],
      easing: 'nope',
      start: 'whenever',
    });
    expect(m).not.toBeNull();
    expect(m!.keys.map((k) => k.at)).toEqual([0, 0.5]);
    expect(m!.keys[0].scale).toBe(1);
    // The later write at the same instant wins.
    expect(m!.keys[1]).toEqual({ at: 0.5, scale: 2, x: 0.2, y: 0 });
    expect(m!.easing).toBe('in-out-cubic');
    expect(m!.start).toBe('slide');
  });

  it('keeps a step count only for the stepped curve', () => {
    expect(readMotion({ keys: [{ at: 0, scale: 2, x: 0, y: 0 }], easing: 'steps', steps: 40 })!.steps).toBe(12);
    expect(readMotion({ keys: [{ at: 0, scale: 2, x: 0, y: 0 }], easing: 'linear', steps: 4 })!.steps).toBeUndefined();
  });

  it('never lets a key sit on the rest', () => {
    expect(readMotion({ keys: [{ at: 1, scale: 2, x: 0, y: 0 }] })!.keys[0].at).toBeLessThan(1);
  });
});

describe('the clock', () => {
  const m = motion([{ at: 0, scale: 2, x: 0, y: 0 }]);

  it('runs over the slide', () => {
    expect(motionProgress(m, 0, 6)).toBe(0);
    expect(motionProgress(m, 3, 6)).toBe(0.5);
    expect(motionProgress(m, 9, 6)).toBe(1);
  });

  it('waits for the opener when asked, and only then', () => {
    const after = { ...m, start: 'after-opener' as const };
    expect(motionProgress(after, 1, 6, 2)).toBe(0);
    expect(motionProgress(after, 4, 6, 2)).toBe(0.5);
    expect(motionProgress(m, 1, 6, 2)).toBeCloseTo(1 / 6);
  });

  it('never divides by a span it does not have', () => {
    const after = { ...m, start: 'after-opener' as const };
    expect(motionProgress(after, 5, 3, 5)).toBe(1);
    expect(motionProgress(after, 1, 3, 5)).toBe(0);
  });

  it('marks every placed frame and the rest on the slide', () => {
    const two = motion([
      { at: 0, scale: 2, x: 0, y: 0 },
      { at: 0.5, scale: 1.5, x: 0, y: 0 },
    ], { start: 'after-opener' });
    expect(motionMarks(two, 6, 2)).toEqual([2, 4, 6]);
    expect(motionMarks(null, 6)).toEqual([]);
  });
});

describe('framingAtProgress', () => {
  const rest: Framing = { ...DEFAULT_FRAMING, scale: 1.4, x: 0.05, y: 0, rotation: 12 };
  const m = motion([{ at: 0.2, scale: 3, x: -0.3, y: 0.1 }]);

  it('is the framing itself at rest, and with no motion', () => {
    expect(framingAtProgress(rest, m, 1)).toBe(rest);
    expect(framingAtProgress(rest, null, 0.3)).toBe(rest);
  });

  it('holds on the first key before it, with the rest\'s rotation', () => {
    const f = framingAtProgress(rest, m, 0.1);
    expect(f).toEqual({ ...rest, scale: 3, x: -0.3, y: 0.1 });
  });

  it('zooms geometrically, so the speed looks constant', () => {
    const m2 = motion([{ at: 0, scale: 4, x: 0, y: 0 }]);
    expect(framingAtProgress({ ...DEFAULT_FRAMING, scale: 1 }, m2, 0.5).scale).toBeCloseTo(2);
  });

  it('keeps a point the two frames share still on screen', () => {
    // Start zoomed out, end moved in on a point left of centre — the frames a
    // wheel on the stage would write.
    const start: Framing = { ...DEFAULT_FRAMING, scale: 1.2 };
    const anchor = { x: DST.w * 0.4, y: DST.h * 0.45 };
    const end = zoomFramingAbout(start, 3, anchor, SRC.w, SRC.h, DST.w, DST.h);
    const mv = motion([{ at: 0, scale: start.scale, x: start.x, y: start.y }], { easing: 'in-out-cubic' });
    const [sx, sy] = unframePoint(anchor.x, anchor.y, SRC.w, SRC.h, DST.w, DST.h, start);
    for (let i = 0; i <= 20; i++) {
      const f = framingAtProgress(end, mv, i / 20);
      const [px, py] = framePoint(sx, sy, SRC.w, SRC.h, DST.w, DST.h, f);
      expect(px).toBeCloseTo(anchor.x, 6);
      expect(py).toBeCloseTo(anchor.y, 6);
    }
  });

  it('holds between two equal keys — a pause is two frames', () => {
    const hold = motion([
      { at: 0, scale: 2, x: 0.1, y: 0 },
      { at: 0.4, scale: 2, x: 0.1, y: 0 },
    ]);
    const f = framingAtProgress({ ...DEFAULT_FRAMING }, hold, 0.2);
    expect(f.scale).toBeCloseTo(2);
    expect(f.x).toBeCloseTo(0.1);
  });

  it('keeps an overshooting curve inside the scale range', () => {
    const back = motion([{ at: 0, scale: 1, x: 0, y: 0 }], { easing: 'back' });
    for (let i = 0; i <= 50; i++) {
      const f = framingAtProgress({ ...DEFAULT_FRAMING, scale: 8 }, back, i / 50);
      expect(f.scale).toBeGreaterThanOrEqual(1);
      expect(f.scale).toBeLessThanOrEqual(8);
    }
  });

  it('never shows an edge under cover, whatever instant is drawn', () => {
    // The draw clamps; this is the invariant the renderers rely on.
    const spring = motion([{ at: 0, scale: 2.5, x: -0.4, y: 0.2 }], { easing: 'spring' });
    const end: Framing = { ...DEFAULT_FRAMING, scale: 1, x: 0.3, y: 0 };
    for (let i = 0; i <= 60; i++) {
      const f = framingAtProgress(end, spring, i / 60);
      const t = framingTransform(SRC.w, SRC.h, DST.w, DST.h, f);
      expect(Math.abs(t.panX)).toBeLessThanOrEqual(t.slackX + 1e-6);
      expect(Math.abs(t.panY)).toBeLessThanOrEqual(t.slackY + 1e-6);
    }
  });

  it('moves in whole steps under the stepped curve', () => {
    const steps = motion([{ at: 0, scale: 1, x: 0, y: 0 }], { easing: 'steps', steps: 4 });
    const at = (u: number) => framingAtProgress({ ...DEFAULT_FRAMING, scale: 3 }, steps, u).scale;
    expect(at(0.1)).toBeCloseTo(at(0.2));
    expect(at(0.3)).toBeGreaterThan(at(0.2));
  });

  it('reads a slide\'s seconds through framingAt and a clock', () => {
    const rest2: Framing = { ...DEFAULT_FRAMING };
    const m2 = motion([{ at: 0, scale: 2, x: 0, y: 0 }]);
    expect(framingAt(rest2, m2, 0, 4).scale).toBe(2);
    expect(framingAt(rest2, m2, 4, 4)).toBe(rest2);
    expect(framingOnClock(rest2, null, 0)).toBe(rest2);
    expect(framingOnClock(rest2, { motion: m2, seconds: 4 }, 0).scale).toBe(2);
  });
});

describe('editing at the needle', () => {
  const rest: Framing = { ...DEFAULT_FRAMING, scale: 1.2 };
  const m = motion([
    { at: 0, scale: 2, x: 0, y: 0 },
    { at: 0.5, scale: 1.6, x: 0.1, y: 0 },
  ]);
  const snap = 0.05;

  it('names the frame the needle is on', () => {
    expect(needleTarget(m, 0.01, snap)).toEqual({ kind: 'key', index: 0, start: true });
    expect(needleTarget(m, 0.52, snap)).toEqual({ kind: 'key', index: 1, start: false });
    expect(needleTarget(m, 0.3, snap)).toEqual({ kind: 'new' });
    expect(needleTarget(m, 0.97, snap)).toEqual({ kind: 'rest' });
    expect(needleTarget(null, 0.3, snap)).toEqual({ kind: 'rest' });
  });

  it('shows the frame itself near a key, the instant elsewhere', () => {
    expect(framingAtNeedle(rest, m, 0.52, snap)).toEqual({ ...rest, scale: 1.6, x: 0.1, y: 0 });
    expect(framingAtNeedle(rest, m, 0.97, snap)).toBe(rest);
    expect(framingAtNeedle(rest, m, 0.3, snap)).toEqual(framingAtProgress(rest, m, 0.3));
  });

  it('writes the pan and zoom to that frame, rotation and fit to the rest', () => {
    const next: Framing = { ...rest, scale: 3, x: -0.2, y: 0.05, rotation: 5 };
    const onKey = placeAtNeedle(rest, m, 0.02, next, snap);
    expect(onKey.motion!.keys[0]).toEqual({ at: 0, scale: 3, x: -0.2, y: 0.05 });
    expect(onKey.framing).toEqual({ ...rest, rotation: 5 });

    const onRest = placeAtNeedle(rest, m, 0.99, next, snap);
    expect(onRest.framing).toEqual(next);
    expect(onRest.motion).toBe(m);
  });

  it('places a new frame where the needle is on none', () => {
    const next: Framing = { ...rest, scale: 2.5, x: 0.2, y: 0 };
    const placed = placeAtNeedle(rest, m, 0.3, next, snap);
    expect(placed.motion!.keys.map((k) => k.at)).toEqual([0, 0.3, 0.5]);
    // What the stage shows once the write lands is what the hand left.
    expect(framingAtNeedle(placed.framing, placed.motion, 0.3, snap)).toEqual({ ...rest, scale: 2.5, x: 0.2, y: 0 });
  });

  it('is the plain write with no motion', () => {
    const next: Framing = { ...rest, scale: 2 };
    expect(placeAtNeedle(rest, null, 0.3, next, snap)).toEqual({ framing: next, motion: null });
  });

  it('takes off a frame, and the last one takes the motion with it', () => {
    expect(removeAtNeedle(m, 0.5, snap)!.keys).toHaveLength(1);
    expect(removeAtNeedle(m, 0.3, snap)).toBe(m);
    expect(removeAtNeedle(motion([{ at: 0, scale: 2, x: 0, y: 0 }]), 0, snap)).toBeNull();
    expect(keepEnds(m)!.keys).toEqual([m.keys[0]]);
  });

  it('snaps to the same seconds whatever the slide\'s length', () => {
    expect(snapShare(m, 6)).toBeCloseTo(KEY_SNAP_SECONDS / 6);
    expect(snapShare(m, 0)).toBe(0.25);
    expect(snapShare(null, 6)).toBe(0);
  });
});

describe('starting and mirroring', () => {
  it('starts closer on the same point and rests on the composed frame', () => {
    const composed: Framing = { ...DEFAULT_FRAMING, scale: 2, x: 0.1, y: -0.05 };
    const m = starterMotion(composed);
    expect(hasMotion(m)).toBe(true);
    expect(m.keys[0].scale).toBeCloseTo(2 * STARTER_ZOOM);
    // Same point in the middle: pan / scale unchanged.
    expect(m.keys[0].x / m.keys[0].scale).toBeCloseTo(composed.x / composed.scale);
    const [cx, cy] = unframePoint(DST.w / 2, DST.h / 2, SRC.w, SRC.h, DST.w, DST.h, composed);
    const start = framingAtProgress(composed, m, 0);
    const [ex, ey] = unframePoint(DST.w / 2, DST.h / 2, SRC.w, SRC.h, DST.w, DST.h, start);
    expect(ex).toBeCloseTo(cx, 3);
    expect(ey).toBeCloseTo(cy, 3);
  });

  it('mirrors every key as flipFraming mirrors the rest', () => {
    const rest: Framing = { ...DEFAULT_FRAMING, scale: 2, x: 0.2, y: 0.1 };
    const m = motion([{ at: 0, scale: 3, x: -0.25, y: 0.1 }]);
    const flippedRest = flipFraming(rest, 'x');
    const flipped = flipMotion(m, 'x')!;
    expect(flipped.keys[0]).toEqual({ at: 0, scale: 3, x: 0.25, y: 0.1 });
    // The mirrored move shows the mirrored picture at every instant.
    const a = framingAtProgress(rest, m, 0.4);
    const b = framingAtProgress(flippedRest, flipped, 0.4);
    expect(b.x).toBeCloseTo(-a.x);
    expect(flipMotion(null, 'y')).toBeNull();
  });
});

describe('deepestFraming', () => {
  it('judges a move by its closest frame, not by where it rests', () => {
    const rest: Framing = { ...DEFAULT_FRAMING, scale: 1.1 };
    expect(deepestFraming(rest, motion([{ at: 0, scale: 2.4, x: 0, y: 0 }])).scale).toBe(2.4);
    expect(deepestFraming(rest, motion([{ at: 0, scale: 1, x: 0, y: 0 }]))).toBe(rest);
    expect(deepestFraming(rest, null)).toBe(rest);
  });
});

describe('presets', () => {
  // A 3:2 landscape in a 9:16 reel: all the room is sideways.
  const box = { srcW: SRC.w, srcH: SRC.h, dstW: DST.w, dstH: DST.h };
  const rest: Framing = { ...DEFAULT_FRAMING };

  it('pans from one edge of the real slack to the other, the view travelling the way it says', () => {
    const out = applyPreset('pan-right', rest, null, box)!;
    const start = framingAtProgress(out.framing, out.motion, 0);
    const a = framingTransform(SRC.w, SRC.h, DST.w, DST.h, start);
    const b = framingTransform(SRC.w, SRC.h, DST.w, DST.h, out.framing);
    // Starts on the picture's left edge, rests on its right.
    expect(a.panX).toBeCloseTo(a.slackX, 6);
    expect(b.panX).toBeCloseTo(-b.slackX, 6);
    const [leftStart] = unframePoint(0, DST.h / 2, SRC.w, SRC.h, DST.w, DST.h, start);
    const [rightEnd] = unframePoint(DST.w, DST.h / 2, SRC.w, SRC.h, DST.w, DST.h, out.framing);
    expect(leftStart).toBeCloseTo(0, 3);
    expect(rightEnd).toBeCloseTo(SRC.w, 3);
    // Left is the same move backwards.
    const left = applyPreset('pan-left', rest, null, box)!;
    expect(left.motion.keys[0].x).toBeCloseTo(-out.motion.keys[0].x);
    expect(left.framing.x).toBeCloseTo(-out.framing.x);
  });

  it('refuses a pan with no room, and says why', () => {
    expect(presetProblem('pan-up', rest, box)).toMatch(/No room to pan up/);
    expect(applyPreset('pan-up', rest, null, box)).toBeNull();
    // Zoomed in, the same picture has room to travel up and down.
    expect(presetProblem('pan-up', { ...rest, scale: 1.5 }, box)).toBeNull();
    expect(presetProblem('pan-left', rest, null)).toMatch(/still being read/);
  });

  it('pushes in onto the composition when it can start wider', () => {
    const composed: Framing = { ...rest, scale: 2, x: 0.05 };
    const out = applyPreset('push-in', composed, null, box)!;
    expect(out.framing).toEqual(composed);
    expect(out.motion.keys[0].scale).toBeCloseTo(2 / PRESET_ZOOM);
    // About the middle of the frame: the point there does not move.
    const mid = (f: Framing) => unframePoint(DST.w / 2, DST.h / 2, SRC.w, SRC.h, DST.w, DST.h, f);
    const start = framingAtProgress(out.framing, out.motion, 0);
    expect(mid(start)[0]).toBeCloseTo(mid(composed)[0], 3);
  });

  it('pushes the rest in when the composition is already at its widest', () => {
    const out = applyPreset('push-in', rest, null, box)!;
    expect(out.motion.keys[0].scale).toBe(1);
    expect(out.framing.scale).toBeCloseTo(PRESET_ZOOM);
  });

  it('pulls out onto the composition, and refuses at the ceiling', () => {
    const out = applyPreset('pull-out', rest, null, box)!;
    expect(out.framing).toBe(rest);
    expect(out.motion.keys[0].scale).toBeCloseTo(PRESET_ZOOM);
    expect(presetProblem('pull-out', { ...rest, scale: 8 }, box)).toMatch(/already as close/);
  });

  it('replaces the frames and keeps how the motion travels', () => {
    const before = motion(
      [
        { at: 0, scale: 3, x: 0, y: 0 },
        { at: 0.5, scale: 2, x: 0, y: 0 },
      ],
      { easing: 'steps', steps: 6, start: 'after-opener' },
    );
    const out = applyPreset('pull-out', rest, before, box)!;
    expect(out.motion.keys).toHaveLength(1);
    expect(out.motion).toMatchObject({ easing: 'steps', steps: 6, start: 'after-opener' });
  });
});

describe('the tour', () => {
  const box = { srcW: SRC.w, srcH: SRC.h, dstW: DST.w, dstH: DST.h };
  const rest: Framing = { ...DEFAULT_FRAMING };
  const centre = (f: Framing) => {
    const [x, y] = unframePoint(DST.w / 2, DST.h / 2, SRC.w, SRC.h, DST.w, DST.h, f);
    return { x: x / SRC.w, y: y / SRC.h };
  };
  const stops = [
    { x: 0.3, y: 0.45 },
    { x: 0.55, y: 0.6 },
    { x: 0.7, y: 0.4 },
  ];

  it('looks at a stop in the middle of the frame, and clamps one near an edge', () => {
    const f = framingOn(rest, { x: 0.4, y: 0.55 }, 2, box);
    expect(centre(f).x).toBeCloseTo(0.4, 6);
    expect(centre(f).y).toBeCloseTo(0.55, 6);
    const edge = framingOn(rest, { x: 0.01, y: 0.5 }, 2, box);
    const t = framingTransform(SRC.w, SRC.h, DST.w, DST.h, edge);
    expect(Math.abs(t.panX)).toBeLessThanOrEqual(t.slackX + 1e-6);
    expect(centre(edge).x).toBeGreaterThan(0.01);
  });

  it('holds on each stop, glides between them, and rests on the last', () => {
    const out = tourMotion(rest, null, { stops, zoom: 2, holdSeconds: 0.5 }, box, 6)!;
    const m = out.motion!;
    // Stop 1 at 0 and 0.5 s, stop 2 arriving and leaving, stop 3 arriving 0.5 s before the end.
    expect(m.keys).toHaveLength(5);
    expect(m.keys[0].at).toBe(0);
    expect(m.keys[1].at).toBeCloseTo(0.5 / 6);
    expect(m.keys[4].at).toBeCloseTo(1 - 0.5 / 6);
    expect(m.keys[3].at - m.keys[2].at).toBeCloseTo(0.5 / 6);
    // Every stop is looked at where it was tapped; the rest is the last one.
    expect(centre(framingAtProgress(out.framing, m, 0.01)).x).toBeCloseTo(0.3, 6);
    expect(centre(framingAtProgress(out.framing, m, (m.keys[2].at + m.keys[3].at) / 2)).x).toBeCloseTo(0.55, 6);
    expect(centre(out.framing).x).toBeCloseTo(0.7, 6);
    expect(out.framing.scale).toBe(2);
  });

  it('shares the glides by distance, so the pace holds on a long hop', () => {
    const far = [
      { x: 0.3, y: 0.5 },
      { x: 0.35, y: 0.5 },
      { x: 0.75, y: 0.5 },
    ];
    const m = tourMotion(rest, null, { stops: far, zoom: 2, holdSeconds: 0 }, box, 6)!.motion!;
    const first = m.keys[1].at - m.keys[0].at;
    const second = 1 - m.keys[1].at;
    expect(second / first).toBeCloseTo(8, 0);
  });

  it('shrinks the pauses before a glide gets too short', () => {
    const m = tourMotion(rest, null, { stops, zoom: 2, holdSeconds: 5 }, box, 3)!.motion!;
    const glide = (m.keys[2].at - m.keys[1].at) * 3;
    expect(glide).toBeGreaterThanOrEqual(MIN_GLIDE_SECONDS - 1e-6);
  });

  it('is no move with one stop, and nothing with none', () => {
    const one = tourMotion(rest, null, { stops: [{ x: 0.6, y: 0.5 }], zoom: 1.5, holdSeconds: 0 }, box, 4)!;
    expect(one.motion).toBeNull();
    expect(centre(one.framing).x).toBeCloseTo(0.6, 6);
    expect(tourMotion(rest, null, { stops: [], zoom: 1.5, holdSeconds: 0 }, box, 4)).toBeNull();
  });

  it('reads a written tour back as the same stops, zoom and pause', () => {
    const out = tourMotion(rest, null, { stops, zoom: 2, holdSeconds: 0.5 }, box, 6)!;
    const back = tourOf(out.framing, out.motion, box, 6);
    expect(back.stops).toHaveLength(3);
    back.stops.forEach((s, i) => {
      expect(s.x).toBeCloseTo(stops[i].x, 6);
      expect(s.y).toBeCloseTo(stops[i].y, 6);
    });
    expect(back.zoom).toBe(2);
    expect(back.holdSeconds).toBeCloseTo(0.5, 6);
    // A picture that holds still is a tour of the one stop it rests on.
    expect(tourOf(rest, null, box, 6).stops).toEqual([{ x: 0.5, y: 0.5 }]);
  });

  it('outlines what a frame shows, turned with the picture', () => {
    const w = framingWindow(framingOn(rest, { x: 0.5, y: 0.5 }, 2, box), box);
    expect(w).toHaveLength(4);
    // 9:16 over 3:2 at ×2: a window 0.1875 of the width, the full height / 2.
    expect(w[1][0] - w[0][0]).toBeCloseTo(0.1875, 6);
    expect(w[3][1] - w[0][1]).toBeCloseTo(0.5, 6);
    const turned = framingWindow({ ...framingOn(rest, { x: 0.5, y: 0.5 }, 2, box), rotation: 10 }, box);
    expect(turned[1][1]).not.toBeCloseTo(turned[0][1], 3);
  });
});

describe('arrivalMarks', () => {
  it('steps from stop to stop, over the end of each pause', () => {
    const rest: Framing = { ...DEFAULT_FRAMING };
    const m = motion([
      { at: 0, scale: 2, x: 0, y: 0 },
      { at: 0.1, scale: 2, x: 0, y: 0 },
      { at: 0.5, scale: 1.5, x: 0.1, y: 0 },
    ]);
    expect(arrivalMarks(rest, m, 10)).toEqual([0, 5, 10]);
    expect(arrivalMarks(rest, null, 10)).toEqual([]);
  });
});
