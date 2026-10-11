import type { ImageResult } from './registry';
import { contactSheetLayout } from './contact-sheet';
import { imageResult } from './image-result';

/** One picture of a sheet: its image (null draws an empty box) and its label. */
export interface SheetItem {
  image: Blob | null;
  label: string;
  /** Drawn in the accent under the label, e.g. "edited", "pick ★4". */
  mark?: string;
}

/**
 * A CONTACT SHEET as a command's picture answer: every item fitted in its cell
 * on paper, its label under it (`contact-sheet.ts` lays it out). A blob that
 * will not decode draws as an empty box rather than failing the sheet — one
 * broken thumbnail must not hide the forty others.
 */
export async function contactSheetImage(items: readonly SheetItem[], note: string, width = 1600): Promise<ImageResult> {
  const bitmaps = await Promise.all(
    items.map(async (item) => (item.image ? createImageBitmap(item.image).catch(() => null) : null)),
  );
  try {
    const layout = contactSheetLayout(
      bitmaps.map((b) => (b ? b.width / b.height : 1.5)),
      width,
    );
    const canvas = document.createElement('canvas');
    canvas.width = layout.width;
    canvas.height = layout.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('the browser refused a canvas');
    ctx.fillStyle = '#f4efe6';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.textBaseline = 'alphabetic';
    layout.cells.forEach((cell, i) => {
      const bitmap = bitmaps[i];
      const { x, y, w, h } = cell.image;
      if (bitmap) ctx.drawImage(bitmap, x, y, w, h);
      else {
        ctx.fillStyle = '#ddd5c7';
        ctx.fillRect(cell.x, cell.y, cell.w, Math.round(cell.w * 0.75));
      }
      ctx.fillStyle = '#1d1a16';
      ctx.font = `600 ${layout.fontPx}px ui-monospace, Menlo, monospace`;
      const label = fitText(ctx, items[i].label, cell.w - 4);
      ctx.fillText(label, cell.label.x, cell.label.y);
      const mark = items[i].mark;
      if (mark) {
        const at = cell.label.x + ctx.measureText(`${label} `).width;
        ctx.fillStyle = '#c4381f';
        ctx.font = `500 ${Math.round(layout.fontPx * 0.85)}px ui-monospace, Menlo, monospace`;
        ctx.fillText(fitText(ctx, mark, cell.x + cell.w - at - 2), at, cell.label.y);
      }
    });
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
    if (!blob) throw new Error('the browser refused to encode the sheet');
    return imageResult(blob, canvas.width, canvas.height, note);
  } finally {
    for (const b of bitmaps) b?.close();
  }
}

/** `text` cut with an ellipsis to fit `max` pixels in the context's font. */
function fitText(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (max <= 0) return '';
  if (ctx.measureText(text).width <= max) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > max) cut = cut.slice(0, -1);
  return `${cut}…`;
}
