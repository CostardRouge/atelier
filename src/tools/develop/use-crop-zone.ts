import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { openingCropChip, pictureAspectRatio, type CropChip } from '../../shared/develop/crop-aspect';
import {
  aspectIdFor,
  cropFromZone,
  fitAround,
  fitIntent,
  flipZone,
  levelDelta,
  maxZone,
  quarterTurnZone,
  splitRotation,
  zoneFromCrop,
  type CropZone,
  type PictureDims,
} from '../../shared/develop/crop-rect';
import { isDefaultFraming, sameFraming, wrapDegrees, type Framing } from '../../shared/media/framing';
import { ASPECT_PRESETS } from '../../shared/projects/project-types';
import { CROP_VIEW_FIT, clampCropView, type CropView, type StageBox } from './crop-view';

export type { CropChip } from '../../shared/develop/crop-aspect';

export interface CropZoneApi {
  /** The decoded picture the zone is measured on; null while decoding. */
  src: PictureDims | null;
  /** The zone the stored crop shows, in the turned picture's frame. */
  zone: CropZone | null;
  framing: Framing;
  chip: CropChip;
  /** The ratio a format holds the zone to, or null in Free. */
  lock: number | null;
  /** A zone the author drew — written through, and remembered as the intent. */
  setZone: (zone: CropZone) => void;
  /** A format chip: the centre kept, the largest zone of that ratio that fits there. */
  setChip: (chip: CropChip) => void;
  /** Portrait ↔ landscape about the centre. */
  swap: () => void;
  /** The largest zone of the current format, centred — the double-click. */
  maximize: () => void;
  /** Back to the whole picture as shot. */
  reset: () => void;
  /**
   * The fine straighten, −45..45 within the current quarter: the picture turns
   * UNDER the zone, which is refitted from the intent — never grown past it.
   */
  straighten: (fine: number) => void;
  /** A quarter turn, the zone turning with the picture. */
  quarterTurn: (dir: 1 | -1) => void;
  /** Mirror what the frame shows; the zone is mirrored with it. */
  flip: (axis: 'x' | 'y') => void;
  /** A Level line drawn on the stage, in the zone's frame: the fine angle corrected by it. */
  level: (x1: number, y1: number, x2: number, y2: number) => void;
  /** True for a moment after the angle moved — the stage draws its dense grid. */
  rotating: boolean;
  /** The Level tool is armed: the next drag on the stage draws a line. */
  levelling: boolean;
  setLevelling: (on: boolean) => void;
  /** The zone last DRAWN (not fitted after a rotation). */
  intent: MutableRefObject<CropZone | null>;
  /**
   * How closely the STAGE looks at the picture — inspection only, never the
   * zone: a pinch, the wheel, the pill or `Z` move this, and the crop is
   * exactly what it was. Every write is clamped to the stage the stage
   * reports (`crop-view.ts`), so what is stored is what is drawn.
   */
  view: CropView;
  setView: (view: CropView | ((v: CropView) => CropView)) => void;
  /** The stage's measured size, which the view is held inside; null while unmeasured. */
  setStageBox: (box: StageBox | null) => void;
}

/** How long the dense grid stays after the angle last moved. */
const ROTATING_MS = 700;

/** The ratio a chip holds, on a picture whose DISPLAYED shape is `shown`. */
function chipRatio(chip: CropChip, shown: number): number | null {
  if (chip === 'free') return null;
  if (chip === 'original') return shown;
  const preset = ASPECT_PRESETS.find((p) => p.id === chip);
  return preset ? preset.w / preset.h : null;
}

/**
 * The Crop tab's one state: the zone the stored crop shows and every way it is
 * changed — the stage's gestures and the panel's chips both write through
 * here, so the two cannot disagree about what "the zone" is.
 *
 * The zone is DERIVED from what the roll stores (the aspect, and the framing
 * draft the workbench writes through), never kept beside it: an undo, a batch
 * verb or an instance's copy moves the zone with no extra wiring. What is kept
 * here is only what the document does not say — which chip is lit (Free and a
 * preset can store the same ratio) and the intent a rotation shrinks from.
 */
export function useCropZone({
  src,
  aspect,
  framing,
  onAspect,
  onFraming,
}: {
  src: PictureDims | null;
  aspect: string;
  framing: Framing;
  onAspect: (aspect: string) => void;
  onFraming: (framing: Framing) => void;
}): CropZoneApi {
  // An untouched picture opens on Free, a cropped one on the chip its stored
  // crop names (`openingCropChip`). The workbench is keyed per picture, so
  // stepping along the roll re-asks this for the picture actually open.
  const [chip, setChipState] = useState<CropChip>(() =>
    openingCropChip(aspect, aspect === 'original' && isDefaultFraming(framing)),
  );
  const intent = useRef<CropZone | null>(null);
  // What this hook last wrote, to tell its own writes from an undo, a batch
  // verb or an instance's copy — after which the intent is the zone on screen.
  const written = useRef<{ aspect: string; framing: Framing } | null>(null);
  const [rotating, setRotating] = useState(false);
  const [levelling, setLevelling] = useState(false);
  const [rawView, setRawView] = useState<CropView>(CROP_VIEW_FIT);
  const [stageBox, setStageBox] = useState<StageBox | null>(null);
  // Held inside the stage on every write AND whenever the stage, the picture
  // or its quarter turn changes under a zoomed view.
  const view = useMemo(
    () => clampCropView(rawView, stageBox, src, framing.rotation),
    [rawView, stageBox, src, framing.rotation],
  );
  const bounds = useRef({ stageBox, src, rotation: framing.rotation });
  bounds.current = { stageBox, src, rotation: framing.rotation };
  const setView = useCallback((next: CropView | ((v: CropView) => CropView)) => {
    setRawView((v) => {
      const b = bounds.current;
      const held = clampCropView(v, b.stageBox, b.src, b.rotation);
      return clampCropView(typeof next === 'function' ? next(held) : next, b.stageBox, b.src, b.rotation);
    });
  }, []);
  const rotatingTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(rotatingTimer.current), []);

  const quarterOdd = Math.abs(Math.round(framing.rotation / 90)) % 2 === 1;
  const shown = src ? (quarterOdd ? src.height / src.width : src.width / src.height) : 1;
  const lock = chipRatio(chip, shown);

  const zone = useMemo(
    () => (src ? zoneFromCrop(src, pictureAspectRatio(aspect, src.width, src.height), framing) : null),
    [src, aspect, framing],
  );

  // Read by callbacks that must not change identity on every drag frame.
  const live = useRef({ src, aspect, framing, chip, zone, shown, onAspect, onFraming });
  live.current = { src, aspect, framing, chip, zone, shown, onAspect, onFraming };

  const write = useCallback(
    (z: CropZone, chipNow: CropChip = live.current.chip, turned?: Pick<Framing, 'rotation' | 'flipX' | 'flipY'>) => {
      const { src: s, aspect: a, framing: f, onAspect: setAspect, onFraming: setFraming } = live.current;
      if (!s) return;
      const ratio = z.w / z.h;
      const own = s.width / s.height;
      const id = chipNow === 'original' && Math.abs(ratio / own - 1) < 1e-3 ? 'original' : aspectIdFor(ratio);
      const g = turned ?? f;
      const next = cropFromZone(s, z, g.rotation, g.flipX, g.flipY);
      if (id !== a) setAspect(id);
      setFraming(next);
      written.current = { aspect: id, framing: next };
      // The document's copy of the numbers moves before the next render: a
      // second write in the same tick (a slider's burst) must start from it.
      live.current = { ...live.current, aspect: id, framing: next };
    },
    [],
  );

  /** The intent, or — when the crop moved under this hook — the zone on screen. */
  const currentIntent = useCallback((): CropZone | null => {
    const { src: s, aspect: a, framing: f } = live.current;
    const w = written.current;
    if (!intent.current || !w || w.aspect !== a || !sameFraming(w.framing, f)) {
      intent.current = s ? zoneFromCrop(s, pictureAspectRatio(a, s.width, s.height), f) : null;
    }
    return intent.current;
  }, []);

  const pulse = useCallback(() => {
    setRotating(true);
    window.clearTimeout(rotatingTimer.current);
    rotatingTimer.current = window.setTimeout(() => setRotating(false), ROTATING_MS);
  }, []);

  /** The picture at `deg`, the zone refitted from the intent. */
  const turnTo = useCallback(
    (deg: number) => {
      const { src: s, framing: f } = live.current;
      const aim = currentIntent();
      if (!s || !aim) return;
      const rotation = wrapDegrees(deg);
      write(fitIntent(aim, rotation, s), live.current.chip, { rotation, flipX: f.flipX, flipY: f.flipY });
      pulse();
    },
    [currentIntent, pulse, write],
  );

  const straighten = useCallback(
    (fine: number) => {
      const { quarter } = splitRotation(live.current.framing.rotation);
      turnTo(quarter + Math.max(-45, Math.min(45, fine)));
    },
    [turnTo],
  );

  const quarterTurn = useCallback(
    (dir: 1 | -1) => {
      const { src: s, zone: z, framing: f, chip: c } = live.current;
      const aim = currentIntent();
      if (!s || !z || !aim) return;
      // The zone turns WITH the picture — a quarter maps a zone inside the
      // picture onto one inside it exactly, so nothing is refitted.
      const turned = quarterTurnZone(z, dir);
      intent.current = quarterTurnZone(aim, dir);
      const ratio = turned.w / turned.h;
      const twin = ASPECT_PRESETS.find((p) => Math.abs(p.w / p.h / ratio - 1) < 1e-3);
      const nextChip: CropChip = c === 'free' || c === 'original' ? c : twin ? twin.id : 'free';
      setChipState(nextChip);
      write(turned, nextChip, { rotation: wrapDegrees(f.rotation + 90 * dir), flipX: f.flipX, flipY: f.flipY });
    },
    [currentIntent, write],
  );

  const flip = useCallback(
    (axis: 'x' | 'y') => {
      const { zone: z, framing: f } = live.current;
      const aim = currentIntent();
      if (!z || !aim) return;
      // `flipFraming`'s rule in zone terms: the angle negated, the centre
      // mirrored across that axis.
      intent.current = flipZone(aim, axis);
      write(flipZone(z, axis), live.current.chip, {
        rotation: wrapDegrees(-f.rotation),
        flipX: axis === 'x' ? !f.flipX : f.flipX,
        flipY: axis === 'y' ? !f.flipY : f.flipY,
      });
    },
    [currentIntent, write],
  );

  const level = useCallback(
    (x1: number, y1: number, x2: number, y2: number) => {
      const delta = levelDelta(x1, y1, x2, y2);
      setLevelling(false);
      if (delta === 0) return;
      const { quarter, fine } = splitRotation(live.current.framing.rotation);
      turnTo(quarter + Math.max(-45, Math.min(45, fine + delta)));
    },
    [turnTo],
  );

  const setZone = useCallback(
    (z: CropZone) => {
      intent.current = z;
      write(z);
    },
    [write],
  );

  const setChip = useCallback(
    (next: CropChip) => {
      const { src: s, zone: z, framing: f, shown: sh } = live.current;
      setChipState(next);
      if (!s || !z) return;
      const ratio = chipRatio(next, sh);
      // Free changes nothing but what may now be changed.
      if (ratio === null) return;
      const fitted = fitAround(z.cx, z.cy, ratio, 1, f.rotation, s);
      intent.current = fitted;
      write(fitted, next);
    },
    [write],
  );

  const swap = useCallback(() => {
    const { src: s, zone: z, framing: f, chip: c } = live.current;
    if (!s || !z) return;
    const ratio = z.h / z.w;
    // A preset keeps its chip when its turned twin is one too (3:2 ↔ 2:3);
    // otherwise the swapped shape becomes a Free one, seeded from the screen.
    const twin = ASPECT_PRESETS.find((p) => Math.abs(p.w / p.h / ratio - 1) < 1e-3);
    const nextChip: CropChip = c === 'free' ? 'free' : c === 'original' ? 'free' : twin ? twin.id : 'free';
    setChipState(nextChip);
    const fitted = fitAround(z.cx, z.cy, z.h, z.w, f.rotation, s, 1);
    intent.current = fitted;
    write(fitted, nextChip);
  }, [write]);

  const maximize = useCallback(() => {
    const { src: s, zone: z, framing: f, chip: c, shown: sh } = live.current;
    if (!s || !z) return;
    const fitted = maxZone(chipRatio(c, sh) ?? z.w / z.h, f.rotation, s);
    intent.current = fitted;
    write(fitted);
  }, [write]);

  const reset = useCallback(() => {
    const { src: s, onAspect: setAspect, onFraming: setFraming, aspect: a } = live.current;
    // Reset leaves the picture untouched, which is where Free is the default.
    setChipState('free');
    intent.current = s ? { cx: 0, cy: 0, w: s.width, h: s.height } : null;
    if (a !== 'original') setAspect('original');
    const whole: Framing = { scale: 1, x: 0, y: 0, rotation: 0, flipX: false, flipY: false, fit: 'cover' };
    setFraming(whole);
    written.current = { aspect: 'original', framing: whole };
  }, []);

  return {
    src,
    zone,
    framing,
    chip,
    lock,
    setZone,
    setChip,
    swap,
    maximize,
    reset,
    straighten,
    quarterTurn,
    flip,
    level,
    rotating,
    levelling,
    setLevelling,
    intent,
    view,
    setView,
    setStageBox,
  };
}
