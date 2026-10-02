import { useEffect, useRef } from 'react';
import type { LayerThumb } from './use-layer-thumbs';

/**
 * A mask drawn small, as ink on the paper — the coverage as the ink's alpha,
 * so it follows the theme. The Layers list's rows and the recipe's terms both
 * wear it (`use-layer-thumbs.ts`). Empty until the first map is made.
 */
export default function MaskThumb({ thumb, className = '' }: { thumb: LayerThumb | undefined; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !thumb) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const ink = getComputedStyle(canvas).color.match(/\d+(\.\d+)?/g)?.map(Number) ?? [27, 24, 19];
    const image = ctx.createImageData(thumb.width, thumb.height);
    for (let i = 0; i < thumb.data.length; i += 1) {
      image.data[i * 4] = ink[0];
      image.data[i * 4 + 1] = ink[1];
      image.data[i * 4 + 2] = ink[2];
      image.data[i * 4 + 3] = thumb.data[i];
    }
    ctx.putImageData(image, 0, 0);
  }, [thumb]);
  return (
    <canvas
      ref={ref}
      width={thumb?.width ?? 64}
      height={thumb?.height ?? 43}
      aria-hidden="true"
      className={`block border border-line bg-paper-2 object-contain text-ink ${className}`}
    />
  );
}
