import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { Crop, Rect } from '../../shared/mosaic/frame';
import { IDENTITY_VIEW, canPanView, clampStageView, cropFromView, isIdentityView, panStageView, pictureArea, viewBounds, viewWindow, zoomStageView, type StageView } from '../../shared/mosaic/stage-view';
import { useZoomGestures } from '../../shared/ui/use-zoom-gestures';
import type { MosaicScene } from './scene-builder';

/** What a zoom on the stage means (the Performance panel's `zoom`): the crop, or only a look. */
export type ZoomMeaning = 'frame' | 'look';

/** How long after the last wheel notch a zoom is taken as released. */
const WHEEL_SETTLE_MS = 260;

interface StageZoomOptions {
  /** The stage's own box (sized `stageW × stageH`), the gestures' surface. */
  ref: RefObject<HTMLElement | null>;
  enabled: boolean;
  stageW: number;
  stageH: number;
  /** The scene on the stage, which the view enlarges and a commit reads the frame from. */
  scene: MosaicScene | null;
  crop: Crop | undefined;
  meaning: ZoomMeaning;
  /** The view became the crop: write it; `carry` is what the next build starts from. */
  onCommit: (crop: Crop, carry: { scene: MosaicScene; window: Rect }) => void;
}

export interface StageZoom {
  view: StageView;
  zoomed: boolean;
  /** Write the view as the crop now (the *Frame this* verb under `look`). */
  commit: () => void;
  /** Back to the mosaic as built, nothing written. */
  fit: () => void;
  /** Pan the view by a stage-pixel delta (the arrows). */
  pan: (dx: number, dy: number) => void;
  /** Zoom by a factor about the stage's centre (the ± keys or buttons). */
  zoomBy: (factor: number) => void;
  /** A drag just ended: the click the browser sends after it is not a click on a cell. */
  justDragged: () => boolean;
  /** A drag would move something: the stage's cursor says so. */
  pannable: boolean;
}

/** How long after a drag's end its trailing click is swallowed. */
const AFTER_DRAG_MS = 250;

const sameCrop = (a: Crop | undefined, b: Crop) => {
  const x = a ?? { cx: 0.5, cy: 0.5, scale: 1 };
  return Math.abs(x.cx - b.cx) < 1e-4 && Math.abs(x.cy - b.cy) < 1e-4 && Math.abs(x.scale - b.scale) < 1e-4;
};

/**
 * The zoom over the Still stage (lab 2, R7): the suite's one reading of the
 * hand (`use-zoom-gestures.ts`) enlarging the painted mosaic for free while
 * it moves; on release — the wheel quiet for a moment, the fingers or the
 * drag lifted — the part in view becomes the target's CROP (`cropFromView`)
 * under `frame`, and the view is held until the scene rebuilt for that crop
 * lands (its canvas starts from the same pixels enlarged, so nothing jumps);
 * under `look` the view stays and *Frame this* writes it. A drag pans in both
 * (lab 4, L3) — under `frame` across the whole picture, the frame following
 * on release — and a click under the slop stays the stage's: a pick, at any
 * zoom, the trailing click of a drag swallowed (`justDragged`).
 */
export function useStageZoom({ ref, enabled, stageW, stageH, scene, crop, meaning, onCommit }: StageZoomOptions): StageZoom {
  const [view, setView] = useState<StageView>(IDENTITY_VIEW);
  const bounds = viewBounds(crop?.scale ?? 1);
  const live = useRef({ view, bounds, stageW, stageH, scene, crop, meaning, onCommit });
  live.current = { view, bounds, stageW, stageH, scene, crop, meaning, onCommit };
  /** The scene the last commit was read from: the view resets once another one is on the stage. */
  const held = useRef<MosaicScene | null>(null);
  const settle = useRef<number | null>(null);
  const dragEnded = useRef(0);
  /**
   * Where the window may go: the mosaic built while a zoom only looks; under Auto-frame the whole picture, so a drag
   * slides the frame across the target and the release rebuilds there (lab 4, L3).
   */
  const area = useCallback(() => {
    const { scene: s, meaning: m, stageW: W, stageH: H } = live.current;
    return m === 'frame' && s ? pictureArea(s.targetRect, s.target.width, s.target.height, W, H) : undefined;
  }, []);

  const local = useCallback(
    (p: { x: number; y: number }) => {
      const el = ref.current;
      if (!el) return p;
      const r = el.getBoundingClientRect();
      return { x: ((p.x - r.left) / Math.max(1, r.width)) * live.current.stageW, y: ((p.y - r.top) / Math.max(1, r.height)) * live.current.stageH };
    },
    [ref],
  );

  const commit = useCallback(() => {
    const { view: v, scene: s, crop: c, stageW: W, stageH: H } = live.current;
    if (!s || isIdentityView(v)) return;
    const next = cropFromView(v, W, H, s.targetRect, s.target.width, s.target.height, W / H);
    if (sameCrop(c, next)) {
      setView(IDENTITY_VIEW);
      return;
    }
    held.current = s;
    live.current.onCommit(next, { scene: s, window: viewWindow(v, W, H) });
  }, []);

  // The scene rebuilt for the committed crop is on the stage: the view is the mosaic again.
  useEffect(() => {
    if (held.current && scene && scene !== held.current) {
      held.current = null;
      setView(IDENTITY_VIEW);
    }
  }, [scene]);
  // A new crop from elsewhere (the card, Whole picture, an undo) while a view is kept: the view no longer means it.
  const cropKey = crop ? `${crop.cx}|${crop.cy}|${crop.scale}` : '';
  useEffect(() => {
    if (!held.current) setView(IDENTITY_VIEW);
  }, [cropKey, stageW, stageH]);

  const released = useCallback(() => {
    if (settle.current !== null) {
      window.clearTimeout(settle.current);
      settle.current = null;
    }
    if (live.current.meaning === 'frame') commit();
  }, [commit]);
  const settleLater = useCallback(() => {
    if (settle.current !== null) window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => {
      settle.current = null;
      released();
    }, WHEEL_SETTLE_MS);
  }, [released]);
  useEffect(
    () => () => {
      if (settle.current !== null) window.clearTimeout(settle.current);
    },
    [],
  );

  useZoomGestures({
    ref,
    enabled: enabled && Boolean(scene),
    active: enabled && Boolean(scene),
    wheel: 'any',
    target: {
      scaleAt: () => live.current.view.s,
      zoomTo: (scale, anchor, by) => {
        const { stageW: W, stageH: H, bounds: b } = live.current;
        const a = area();
        setView((v) => zoomStageView(v, scale, local(anchor), W, H, b, a));
        if (by === 'wheel') settleLater();
      },
      panBy: (dx, dy, _at, by) => {
        const { stageW: W, stageH: H, bounds: b } = live.current;
        const el = ref.current;
        const k = el ? W / Math.max(1, el.getBoundingClientRect().width) : 1;
        const a = area();
        setView((v) => panStageView(v, dx * k, dy * k, W, H, b, a));
        if (by === 'wheel') settleLater();
      },
      // One pointer pans whenever there is somewhere to go — a zoomed view, or under Auto-frame the picture past the
      // frame; under the slop it stays a click on a cell, left to the stage.
      drag: () => (canPanView(live.current.view, live.current.stageW, live.current.stageH, area()) ? 'pan' : null),
      onDragging: (on) => {
        if (!on) {
          dragEnded.current = performance.now();
          released();
        }
      },
      onPinch: (on) => {
        if (!on) released();
      },
    },
  });

  const fit = useCallback(() => {
    held.current = null;
    setView(IDENTITY_VIEW);
  }, []);
  const pan = useCallback((dx: number, dy: number) => {
    const { stageW: W, stageH: H, bounds: b } = live.current;
    const a = area();
    setView((v) => panStageView(v, dx, dy, W, H, b, a));
  }, [area]);
  const zoomBy = useCallback(
    (factor: number) => {
      const { stageW: W, stageH: H, bounds: b } = live.current;
      const a = area();
      setView((v) => clampStageView(zoomStageView(v, v.s * factor, { x: W / 2, y: H / 2 }, W, H, b, a), W, H, b, a));
      if (live.current.meaning === 'frame') settleLater();
    },
    [settleLater, area],
  );
  const justDragged = useCallback(() => performance.now() - dragEnded.current < AFTER_DRAG_MS, []);

  const pannable = Boolean(scene) && canPanView(view, stageW, stageH, meaning === 'frame' && scene ? pictureArea(scene.targetRect, scene.target.width, scene.target.height, stageW, stageH) : undefined);

  return { view, zoomed: !isIdentityView(view), commit, fit, pan, zoomBy, justDragged, pannable };
}
