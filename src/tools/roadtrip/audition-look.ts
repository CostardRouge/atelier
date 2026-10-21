import { decodeStill } from '../../shared/media/still-decode';
import { coverCrop } from '../../shared/roadtrip/hooks/picture-budget';
import { makeFrameGrader, type FrameGrader } from '../../shared/lut/frame-grader';
import type { CubeLut } from '../../shared/lib/cube-parser';

/** The long edge an auditioned picture is drawn at: a phone's stage, a desktop modal's. */
const LONG_EDGE = 1440;

/**
 * A picture as a slide of the piece would show it, before it is one: cropped
 * to the piece's frame the way a new slide frames it (fill, centred) and
 * graded through the piece's look — decoded at that size only, never whole.
 * Resolves with a JPEG to draw, or null when the browser cannot read it (the
 * Audition then draws the plain picture).
 *
 * One grader per size, kept by the caller for the session and disposed when
 * the Audition closes: a WebGL2 context per picture is never reclaimed fast
 * enough to page a day through.
 */
export async function auditionStill(
  blob: Blob,
  name: string,
  aspect: number,
  lut: CubeLut | null,
  graders: Map<string, FrameGrader>,
): Promise<Blob | null> {
  const cap = LONG_EDGE * LONG_EDGE;
  let decoded: ImageBitmap;
  try {
    decoded = (
      await decodeStill(
        blob,
        (natural) => {
          const crop = coverCrop(natural.width, natural.height, aspect, cap, LONG_EDGE);
          const scale = Math.min(1, crop.width / Math.max(1, crop.sw));
          return { width: Math.ceil(natural.width * scale), height: Math.ceil(natural.height * scale) };
        },
        name,
      )
    ).bitmap;
  } catch {
    return null;
  }
  try {
    const crop = coverCrop(decoded.width, decoded.height, aspect, cap, LONG_EDGE);
    const cropped = await createImageBitmap(
      decoded,
      Math.round(crop.sx),
      Math.round(crop.sy),
      Math.max(1, Math.round(crop.sw)),
      Math.max(1, Math.round(crop.sh)),
      { resizeWidth: crop.width, resizeHeight: crop.height, resizeQuality: 'high' },
    );
    try {
      const { width, height } = cropped;
      const canvas = new OffscreenCanvas(width, height);
      const g = canvas.getContext('2d');
      if (!g) return null;
      let drawn = false;
      if (lut) {
        const size = `${width}x${height}`;
        let grader = graders.get(size);
        try {
          if (!grader) {
            grader = makeFrameGrader(lut, width, height);
            graders.set(size, grader);
          }
          // Drawn in the same task as the grade, so the GL canvas still holds it.
          g.drawImage(grader.render(cropped), 0, 0, width, height);
          drawn = true;
        } catch {
          // An ungraded picture is better than none.
        }
      }
      if (!drawn) g.drawImage(cropped, 0, 0);
      return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
    } finally {
      cropped.close();
    }
  } finally {
    decoded.close();
  }
}
