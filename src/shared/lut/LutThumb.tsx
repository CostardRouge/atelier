import { useEffect, useRef } from 'react';
import type { RgbBitmap } from './lut-preview';

interface LutThumbProps {
  /** The baked preview, or undefined while its LUT is still loading. */
  bitmap: RgbBitmap | undefined;
  className?: string;
}

/**
 * Draws a baked `RgbBitmap` into a `<canvas>` sized to it. A plain
 * `putImageData` — no scaling here, the element's CSS box does that (see
 * `LutGalleryModal`'s grid, which keeps a fixed pixel height per
 * `frontend.md`'s rule against `aspect-square` in an `auto-fill` grid).
 * Undrawn (loading) reads as the paper surface underneath, not a flash.
 */
export default function LutThumb({ bitmap, className = '' }: LutThumbProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!bitmap) return;
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // `createImageData` + `.set()` rather than `new ImageData(bitmap.data, …)`:
    // the latter demands the DOM lib's own `Uint8ClampedArray<ArrayBuffer>`,
    // which a plain `new Uint8ClampedArray(n)` under an ES2020 target doesn't
    // structurally match — `.set()` only needs an ArrayLike<number>.
    const image = ctx.createImageData(bitmap.width, bitmap.height);
    image.data.set(bitmap.data);
    ctx.putImageData(image, 0, 0);
  }, [bitmap]);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className={`block w-full h-full object-cover bg-paper-2 ${className}`}
    />
  );
}
