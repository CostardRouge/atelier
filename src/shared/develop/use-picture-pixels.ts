/**
 * What a picture's pixels really are, for `pictureFidelity` — the block every
 * Develop host reads so the three of them cannot say different things about
 * one file (2026-09-20).
 *
 * It measures only where the size is SURPRISING and the measurement is cheap:
 * a source's proxy (2048 px at most) and a RAW, whose decodable half is the
 * render its camera wrote inside it — 960 × 540 on the maintainer's DJI. An
 * ordinary original is never decoded a second time just to say a number; the
 * pixel-budget rule (`media-pipeline.md`) exists because a 48-megapixel decode
 * is 194 MB, and a caption is not worth one. Such a host passes what it
 * already measured as `shown`, or nothing at all, and the sentence simply
 * stays what it was.
 *
 * The file's OWN pixels come free beside it: a proxy's original is on
 * `MediaOrigin`, a RAW's sensor plane is in its head (`raw-probe.ts`). That is
 * what turns "camera render" into "8.4× short on the long edge of its
 * 8064 × 4536".
 */

import { useEffect, useState } from 'react';
import { isRawImage } from '../library/assets';
import { mediaOrigin } from '../projects/media-identity';
import { rawSizes } from '../exif/raw-probe';
import type { FidelityPixels } from './picture-fidelity';
import { measurePicture } from './roll-render';
import type { PictureSize } from './roll-export';

/**
 * `shown` is what the host already knows about the pixels on screen, used
 * whenever this hook has nothing better — never overwritten by it.
 */
export function usePicturePixels(
  file: File | null,
  shown: PictureSize | null = null,
): FidelityPixels | null {
  const [read, setRead] = useState<{ file: File; pixels: FidelityPixels } | null>(null);

  useEffect(() => {
    if (!file) {
      setRead(null);
      return;
    }
    const origin = mediaOrigin(file);
    const isProxy = origin?.fidelity === 'proxy';
    const raw = isRawImage(file.name);
    if (!isProxy && !raw) return;
    let alive = true;
    void (async () => {
      const size = await measurePicture(file);
      if (!alive || !size) return;
      const full = raw
        ? (await rawSizes(file)).sensor
        : origin?.width && origin?.height
          ? { width: origin.width, height: origin.height }
          : null;
      if (alive) setRead({ file, pixels: { ...size, full } });
    })();
    return () => {
      alive = false;
    };
  }, [file]);

  if (read && read.file === file) return read.pixels;
  return shown ? { width: shown.width, height: shown.height } : null;
}
