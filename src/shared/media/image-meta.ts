/**
 * Lightweight image metadata + thumbnail, mirroring `video-metadata` for the
 * asset library. Decodable formats (JPEG/PNG/WebP/…) yield dimensions and a
 * small cover thumbnail via `createImageBitmap`; camera RAW (and anything the
 * browser can't decode) gracefully degrades to a type label with no thumbnail.
 */

const RAW_EXTENSIONS = new Set([
  'raf', 'arw', 'cr2', 'cr3', 'nef', 'dng', 'orf', 'rw2', 'raw', 'srw', 'pef',
]);

/** Human label for an image file: `RAW`, `JPEG`, or the bare extension. */
export function imageTypeLabel(name: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
  if (RAW_EXTENSIONS.has(ext)) return 'RAW';
  if (ext === 'jpg' || ext === 'jpeg') return 'JPEG';
  return ext ? ext.toUpperCase() : 'image';
}

export interface ImageMeta {
  width?: number;
  height?: number;
  /** Object URL of a small thumbnail (caller revokes), if decodable. */
  thumbUrl?: string;
  /** `RAW`, `JPEG`, `PNG`, … always present. */
  imageType: string;
}

/**
 * Read an image's dimensions and build a cover thumbnail. Never rejects: an
 * undecodable file (RAW, or a format the browser lacks) resolves with just its
 * type label.
 */
export async function loadImageMeta(file: File): Promise<ImageMeta> {
  const imageType = imageTypeLabel(file.name);
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    const scale = Math.min(1, 200 / Math.max(1, width));
    const cw = Math.max(1, Math.round(width * scale));
    const ch = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    let thumbUrl: string | undefined;
    if (ctx) {
      ctx.drawImage(bitmap, 0, 0, cw, ch);
      thumbUrl = await new Promise<string | undefined>((resolve) =>
        canvas.toBlob(
          (blob) => resolve(blob ? URL.createObjectURL(blob) : undefined),
          'image/jpeg',
          0.72,
        ),
      );
    }
    bitmap.close?.();
    return { width, height, thumbUrl, imageType };
  } catch {
    // RAW / HEIC / anything the browser can't decode — type only.
    return { imageType };
  }
}
