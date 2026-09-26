import { useEffect, useMemo, useRef, useState } from 'react';
import { isDecodableImage, isDrawableImage } from '../library/assets';
import { drawableStill, stageBudget } from './still-decode';

/**
 * The same files, each one an `<img>` can draw in THIS browser: a HEIF or a
 * JPEG XL that the browser refuses is swapped, once decoded, for a JPEG made
 * through the suite's own decoder at the stage's budget (`drawableStill`).
 * Every other file passes through untouched and at once.
 *
 * For the surfaces that show a picture by URL — the Library's lightbox — so
 * they can be fed to `useObjectUrls` unchanged. A conversion is held only
 * while its file is in the window the caller passes (a deck's open picture
 * and its neighbours), so paging through a folder of HEIFs never piles their
 * JPEGs up. The map returned is stable until a conversion lands.
 */
export function useDrawableFiles(files: ReadonlyMap<string, File>): ReadonlyMap<string, File> {
  const [ready, setReady] = useState<ReadonlyMap<File, File>>(() => new Map());
  const running = useRef(new Set<File>());
  const current = useRef(files);
  current.current = files;
  const held = useRef(ready);
  held.current = ready;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const wanted = new Set(files.values());
    // Let go of what left the window.
    setReady((prev) => {
      const kept = [...prev].filter(([file]) => wanted.has(file));
      return kept.length === prev.size ? prev : new Map(kept);
    });
    for (const file of wanted) {
      if (isDrawableImage(file.name) || !isDecodableImage(file.name)) continue;
      if (held.current.has(file) || running.current.has(file)) continue;
      running.current.add(file);
      void drawableStill(file, { budgetPixels: stageBudget() })
        .then((blob) => {
          // Still wanted? The window may have moved on while it decoded.
          const inWindow = [...current.current.values()].includes(file);
          if (!mounted.current || !inWindow || !blob || blob === file) return;
          const out = new File([blob], `${file.name}.jpg`, { type: blob.type, lastModified: file.lastModified });
          setReady((prev) => (prev.has(file) ? prev : new Map(prev).set(file, out)));
        })
        .finally(() => running.current.delete(file));
    }
  }, [files]);

  return useMemo(() => {
    let swapped = false;
    const out = new Map<string, File>();
    for (const [key, file] of files) {
      const drawn = ready.get(file);
      if (drawn) swapped = true;
      out.set(key, drawn ?? file);
    }
    return swapped ? out : files;
  }, [files, ready]);
}
