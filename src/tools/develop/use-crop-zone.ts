import { useCallback, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { isFreeAspect, pictureAspectRatio } from '../../shared/develop/crop-aspect';
import {
  aspectIdFor,
  cropFromZone,
  fitAround,
  maxZone,
  zoneFromCrop,
  type CropZone,
  type PictureDims,
} from '../../shared/develop/crop-rect';
import type { Framing } from '../../shared/media/framing';
import { ASPECT_PRESETS } from '../../shared/projects/project-types';

/** The format chip on screen: Free, Original, or a preset id. */
export type CropChip = 'free' | 'original' | string;

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
  /** A framing the stage did not draw (rotation, flips), written as is. */
  setFraming: (framing: Framing) => void;
  /** The zone last DRAWN (not fitted after a rotation), for the rotation phase. */
  intent: MutableRefObject<CropZone | null>;
}

function chipOf(aspect: string): CropChip {
  if (aspect === 'original') return 'original';
  if (isFreeAspect(aspect)) return 'free';
  return ASPECT_PRESETS.some((p) => p.id === aspect) ? aspect : 'free';
}

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
  const [chip, setChipState] = useState<CropChip>(() => chipOf(aspect));
  const intent = useRef<CropZone | null>(null);

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

  const write = useCallback((z: CropZone, chipNow: CropChip = live.current.chip) => {
    const { src: s, aspect: a, framing: f, onAspect: setAspect, onFraming: setFraming } = live.current;
    if (!s) return;
    const ratio = z.w / z.h;
    const own = s.width / s.height;
    const id = chipNow === 'original' && Math.abs(ratio / own - 1) < 1e-3 ? 'original' : aspectIdFor(ratio);
    if (id !== a) setAspect(id);
    setFraming(cropFromZone(s, z, f.rotation, f.flipX, f.flipY));
  }, []);

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
    setChipState('original');
    intent.current = s ? { cx: 0, cy: 0, w: s.width, h: s.height } : null;
    if (a !== 'original') setAspect('original');
    setFraming({ scale: 1, x: 0, y: 0, rotation: 0, flipX: false, flipY: false, fit: 'cover' });
  }, []);

  const setFraming = useCallback((f: Framing) => live.current.onFraming(f), []);

  return { src, zone, framing, chip, lock, setZone, setChip, swap, maximize, reset, setFraming, intent };
}
