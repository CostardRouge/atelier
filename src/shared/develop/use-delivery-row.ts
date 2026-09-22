/**
 * The *Delivers* row for a host whose output frame is FIXED — Trips' deck,
 * a Studio variant. What the export will really write, said before anything
 * is pressed, which is the suite's standing rule: a panel that cannot say
 * what it does reads as broken.
 *
 * It fetches NOTHING. The original's size is what its source already
 * vouched for; a RAW's render is read from a megabyte of head, cached for
 * the session (`delivery-source.ts`), so the row and the run answer from the
 * same knowledge and cannot disagree.
 *
 * It does DECODE the picture to measure it, so a host passes `file` only
 * while the row is on screen — the pixel-budget rule again: a 48-megapixel
 * decode is 194 MB, and a sentence is not worth one on every slide you step
 * past.
 */

import { useEffect, useState } from 'react';
import type { Framing } from '../media/framing';
import { knownIdentity, mediaOrigin } from '../projects/media-identity';
import { isProxyOverRaw, originalOf, rawRenderOf } from './delivery-source';
import { fixedFrameDelivery, type DeliverySummary, type PictureSize } from './roll-export';
import { measurePicture } from './roll-render';

export function useDeliveryRow(
  file: File | null,
  framing: Framing | null,
  out: { w: number; h: number } | null,
): DeliverySummary | null {
  const [read, setRead] = useState<{
    file: File;
    size: PictureSize & { viaRawPreview?: boolean };
    render: PictureSize | null;
  } | null>(null);

  useEffect(() => {
    if (!file) {
      setRead(null);
      return;
    }
    let alive = true;
    void (async () => {
      const size = await measurePicture(file);
      if (!alive || !size) return;
      const origin = mediaOrigin(file);
      const render =
        origin && isProxyOverRaw(origin)
          ? (await rawRenderOf(origin, knownIdentity(file)?.assetId ?? null)).render
          : null;
      if (alive) setRead({ file, size, render });
    })();
    return () => {
      alive = false;
    };
  }, [file]);

  if (!file || !out || out.w <= 0 || !read || read.file !== file) return null;
  const origin = mediaOrigin(file);
  return fixedFrameDelivery(
    read.size,
    origin?.fidelity === 'proxy',
    originalOf(origin, read.render),
    framing,
    out,
  );
}
